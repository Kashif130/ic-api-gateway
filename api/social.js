// api/social.js
// Social Signal Proxy — uses NewsAPI (free, 100 req/day)
// Get free key at: https://newsapi.org/register
// Endpoint: GET /api/social?action=sentiment&query=ethereum
//           GET /api/social?action=trending&category=crypto
//           GET /api/social?action=headlines&query=bitcoin

const fetch = require("node-fetch");
const { signResponse } = require("../lib/signer");

const NEWS_KEY = process.env.NEWSAPI_KEY;
const BASE_URL = "https://newsapi.org/v2";

function analyzeSentiment(articles) {
  const positive = ["surge", "rally", "bullish", "gain", "rise", "up", "growth",
    "adoption", "record", "high", "profit", "buy", "strong", "launch", "partnership"];
  const negative = ["crash", "dump", "bearish", "fall", "drop", "down", "loss",
    "hack", "ban", "fear", "sell", "weak", "fraud", "collapse", "warning"];
  let pos = 0, neg = 0;
  for (const a of articles) {
    const text = ((a.title || "") + " " + (a.description || "")).toLowerCase();
    pos += positive.filter(w => text.includes(w)).length;
    neg += negative.filter(w => text.includes(w)).length;
  }
  const total = pos + neg || 1;
  const score = parseFloat((pos / total).toFixed(4));
  return {
    score,
    label: score > 0.6 ? "bullish" : score < 0.4 ? "bearish" : "neutral",
    positive_signals: pos,
    negative_signals: neg
  };
}

async function getSentiment(query, limit = 20) {
  if (!NEWS_KEY) throw new Error("NEWSAPI_KEY not configured on server");
  const url = `${BASE_URL}/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=${Math.min(limit, 100)}&apiKey=${NEWS_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`);
  const d = await res.json();
  if (d.status !== "ok") throw new Error(d.message || "NewsAPI error");
  const articles = d.articles || [];
  return {
    query,
    source: "NewsAPI",
    volume: d.totalResults,
    articles_analyzed: articles.length,
    sentiment: analyzeSentiment(articles),
    sample_articles: articles.slice(0, 3).map(a => ({
      title: a.title?.substring(0, 120),
      source: a.source?.name,
      published: a.publishedAt
    }))
  };
}

async function getTrending(category, limit = 10) {
  if (!NEWS_KEY) throw new Error("NEWSAPI_KEY not configured on server");
  const qMap = {
    crypto: "cryptocurrency OR bitcoin OR ethereum",
    defi: "DeFi OR decentralized finance",
    nft: "NFT OR non-fungible token",
    web3: "web3 OR blockchain",
    solana: "solana",
    bitcoin: "bitcoin"
  };
  const q = qMap[category.toLowerCase()] || category;
  const url = `${BASE_URL}/everything?q=${encodeURIComponent(q)}&language=en&sortBy=popularity&pageSize=${Math.min(limit, 20)}&apiKey=${NEWS_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`);
  const d = await res.json();
  if (d.status !== "ok") throw new Error(d.message || "NewsAPI error");
  const wordCount = {};
  for (const a of (d.articles || [])) {
    const words = (a.title || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
      .filter(w => w.length > 3 && !["this","that","with","from","have","what","your","just","more","been","will","says","after","over","into"].includes(w));
    for (const w of words) wordCount[w] = (wordCount[w] || 0) + 1;
  }
  const keywords = Object.entries(wordCount).sort((a,b)=>b[1]-a[1]).slice(0, limit)
    .map(([word, count]) => ({ keyword: word, mentions: count }));
  return {
    category,
    source: "NewsAPI",
    trending_keywords: keywords,
    top_articles: (d.articles || []).slice(0, 5).map(a => ({
      title: a.title?.substring(0, 100),
      source: a.source?.name,
      published: a.publishedAt
    }))
  };
}

async function getHeadlines(query, limit = 5) {
  if (!NEWS_KEY) throw new Error("NEWSAPI_KEY not configured on server");
  const url = `${BASE_URL}/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=${Math.min(limit, 10)}&apiKey=${NEWS_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`);
  const d = await res.json();
  if (d.status !== "ok") throw new Error(d.message || "NewsAPI error");
  return {
    query,
    source: "NewsAPI",
    total_results: d.totalResults,
    headlines: (d.articles || []).map(a => ({
      title: a.title,
      source: a.source?.name,
      published: a.publishedAt
    }))
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action = "sentiment", query, category, limit = 10 } = req.query;

  try {
    let result;
    switch (action) {
      case "sentiment":
        if (!query) return res.status(400).json({ error: "query param required. Example: ethereum" });
        result = await getSentiment(query, parseInt(limit));
        break;
      case "trending":
        if (!category) return res.status(400).json({ error: "category required. Use: crypto, defi, nft, web3, bitcoin, solana" });
        result = await getTrending(category, parseInt(limit));
        break;
      case "headlines":
        if (!query) return res.status(400).json({ error: "query param required" });
        result = await getHeadlines(query, parseInt(limit));
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}. Use: sentiment, trending, headlines` });
    }
    const signed = signResponse(result);
    return res.status(200).json({ ok: true, action, ...signed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
