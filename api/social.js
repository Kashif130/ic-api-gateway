// api/social.js
// Social Signal Proxy — uses Reddit API (free, no key needed)
// Reddit's public JSON API works without any authentication.
// Endpoint: GET /api/social?action=sentiment&query=ethereum
//           GET /api/social?action=trending&category=crypto
//           GET /api/social?action=profile&handle=vitalik (Reddit username)

const fetch = require("node-fetch");
const { signResponse } = require("../lib/signer");

// Subreddit map for categories
const CATEGORY_SUBS = {
  crypto:  "CryptoCurrency",
  defi:    "defi",
  nft:     "NFT",
  web3:    "web3",
  bitcoin: "bitcoin",
  eth:     "ethereum",
  solana:  "solana"
};

// Simple sentiment from post titles
function analyzeSentiment(posts) {
  const positive = ["bullish", "moon", "pump", "surge", "ath", "green", "up", "buy",
                    "strong", "great", "gain", "profit", "growth", "adoption", "🚀"];
  const negative = ["bearish", "dump", "crash", "down", "red", "sell", "weak",
                    "rekt", "fear", "scam", "rug", "loss", "drop", "fell"];
  let pos = 0, neg = 0;
  for (const post of posts) {
    const text = (post.title + " " + (post.selftext || "")).toLowerCase();
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

// GET sentiment — search Reddit for query
async function getSentiment(query, limit = 25) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${limit}&type=link`;
  const res  = await fetch(url, { headers: { "User-Agent": "ic-api-gateway/1.0" } });
  if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
  const d = await res.json();
  const posts = d.data?.children?.map(c => c.data) || [];
  if (!posts.length) return { query, volume: 0, sentiment: { score: 0.5, label: "neutral" }, posts: [] };

  const sentiment = analyzeSentiment(posts);
  return {
    query,
    source: "Reddit",
    volume: posts.length,
    sentiment,
    sample_posts: posts.slice(0, 3).map(p => ({
      title: p.title?.substring(0, 120),
      subreddit: `r/${p.subreddit}`,
      upvotes: p.ups,
      comments: p.num_comments,
      created_at: new Date(p.created_utc * 1000).toISOString()
    }))
  };
}

// GET trending — hot posts from relevant subreddit
async function getTrending(category, limit = 10) {
  const sub = CATEGORY_SUBS[category.toLowerCase()] || "CryptoCurrency";
  const url  = `https://www.reddit.com/r/${sub}/hot.json?limit=${limit}`;
  const res   = await fetch(url, { headers: { "User-Agent": "ic-api-gateway/1.0" } });
  if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
  const d = await res.json();
  const posts = d.data?.children?.map(c => c.data) || [];

  // Extract trending keywords from titles
  const wordCount = {};
  for (const p of posts) {
    const words = p.title.toLowerCase()
      .replace(/[^a-z0-9$#\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3 && !["this","that","with","from","have","what","your","just","more","been"].includes(w));
    for (const w of words) wordCount[w] = (wordCount[w] || 0) + 1;
  }
  const topics = Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ keyword: word, mentions: count }));

  return {
    category,
    subreddit: `r/${sub}`,
    source: "Reddit",
    topics,
    hot_posts: posts.slice(0, 3).map(p => ({
      title: p.title?.substring(0, 100),
      upvotes: p.ups,
      comments: p.num_comments,
      url: `https://reddit.com${p.permalink}`
    }))
  };
}

// GET profile — Reddit user public info
async function getProfile(handle) {
  const username = handle.replace(/^u\//, "").replace(/^@/, "");
  const url = `https://www.reddit.com/user/${username}/about.json`;
  const res  = await fetch(url, { headers: { "User-Agent": "ic-api-gateway/1.0" } });
  if (!res.ok) throw new Error(`Reddit user not found: ${handle}`);
  const d = await res.json();
  const u = d.data;
  return {
    handle: `u/${u.name}`,
    name: u.name,
    karma_post: u.link_karma,
    karma_comment: u.comment_karma,
    total_karma: u.total_karma,
    verified: u.verified,
    created_at: new Date(u.created_utc * 1000).toISOString(),
    is_mod: u.is_mod,
    source: "Reddit"
  };
}

// Main Vercel handler
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action = "sentiment", query, category, handle, limit = 10 } = req.query;

  try {
    let result;
    switch (action) {
      case "sentiment":
        if (!query) return res.status(400).json({ error: "query param required. Example: ethereum" });
        result = await getSentiment(query, parseInt(limit));
        break;
      case "trending":
        if (!category) return res.status(400).json({ error: "category required. Use: crypto, defi, nft, web3, bitcoin, eth, solana" });
        result = await getTrending(category, parseInt(limit));
        break;
      case "profile":
        if (!handle) return res.status(400).json({ error: "handle required. Example: vitalik" });
        result = await getProfile(handle);
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}. Use: sentiment, trending, profile` });
    }

    const signed = signResponse(result);
    return res.status(200).json({ ok: true, action, ...signed });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
