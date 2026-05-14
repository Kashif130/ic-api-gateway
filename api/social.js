// api/social.js
// Vercel Serverless Function — Social Signal Proxy
// Uses Twitter/X API v2. Bearer token stays server-side only.
// Endpoint: GET /api/social?action=sentiment&query=%24ETH
//           GET /api/social?action=trending&category=crypto&limit=5
//           GET /api/social?action=profile&handle=VitalikButerin

const fetch = require("node-fetch");
const { signResponse } = require("../lib/signer");

const TWITTER_BASE = "https://api.twitter.com/2";
const BEARER       = process.env.TWITTER_BEARER_TOKEN;

function twitterHeaders() {
  if (!BEARER) throw new Error("TWITTER_BEARER_TOKEN not configured on server");
  return {
    "Authorization": `Bearer ${BEARER}`,
    "Content-Type": "application/json"
  };
}

// Naive sentiment analysis from tweet texts
function analyzeSentiment(tweets) {
  const positive = ["bullish", "moon", "pump", "surge", "ath", "green", "up", "buy", "strong", "great", "🚀", "💚", "📈"];
  const negative = ["bearish", "dump", "crash", "down", "red", "sell", "weak", "rekt", "fear", "📉", "🔴"];

  let posCount = 0, negCount = 0;
  for (const tweet of tweets) {
    const text = tweet.text.toLowerCase();
    posCount += positive.filter(w => text.includes(w)).length;
    negCount += negative.filter(w => text.includes(w)).length;
  }
  const total = posCount + negCount || 1;
  const score = parseFloat((posCount / total).toFixed(4));
  return {
    score,
    label: score > 0.6 ? "bullish" : score < 0.4 ? "bearish" : "neutral",
    positive_signals: posCount,
    negative_signals: negCount
  };
}

// GET sentiment for a query/ticker
async function getSentiment(query, limit = 20) {
  const params = new URLSearchParams({
    query: `${query} lang:en -is:retweet`,
    max_results: Math.min(limit, 100),
    "tweet.fields": "text,created_at,public_metrics"
  });
  const url = `${TWITTER_BASE}/tweets/search/recent?${params}`;
  const res  = await fetch(url, { headers: twitterHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Twitter API ${res.status}: ${err.title || res.statusText}`);
  }
  const d = await res.json();
  if (!d.data || !d.data.length) {
    return { query, volume: 0, sentiment: { score: 0.5, label: "neutral" }, tweets: [] };
  }
  const sentiment = analyzeSentiment(d.data);
  return {
    query,
    volume: d.meta?.result_count || d.data.length,
    sentiment,
    sample_tweets: d.data.slice(0, 3).map(t => ({
      text: t.text.substring(0, 140),
      likes: t.public_metrics?.like_count,
      retweets: t.public_metrics?.retweet_count,
      created_at: t.created_at
    }))
  };
}

// GET trending — Twitter v2 trends endpoint (available on Basic/Pro plans)
// Falls back to topic search on free tier
async function getTrending(category, limit = 10) {
  // Use recent search as proxy for trending (free tier compatible)
  const queries = {
    crypto: "cryptocurrency OR bitcoin OR ethereum OR DeFi",
    nft: "NFT OR web3 OR opensea",
    defi: "DeFi OR yield OR liquidity OR protocol",
    web3: "web3 OR blockchain OR smart contract"
  };
  const q = queries[category.toLowerCase()] || category;
  const params = new URLSearchParams({
    query: `(${q}) lang:en -is:retweet`,
    max_results: Math.min(limit * 3, 100),
    "tweet.fields": "text,created_at,public_metrics"
  });
  const url = `${TWITTER_BASE}/tweets/search/recent?${params}`;
  const res  = await fetch(url, { headers: twitterHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Twitter API ${res.status}: ${err.title || res.statusText}`);
  }
  const d = await res.json();
  if (!d.data) return { category, topics: [], note: "No recent data" };

  // Extract hashtags and keywords as "topics"
  const hashtagCount = {};
  for (const tweet of d.data) {
    const tags = tweet.text.match(/#\w+/g) || [];
    for (const tag of tags) {
      const key = tag.toLowerCase();
      hashtagCount[key] = (hashtagCount[key] || 0) + 1;
    }
  }
  const topics = Object.entries(hashtagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, mentions: count }));

  return { category, topics, tweet_sample_size: d.data.length };
}

// GET profile info for a handle
async function getProfile(handle) {
  // Remove @ if present
  const username = handle.replace(/^@/, "");
  const params = new URLSearchParams({
    "user.fields": "public_metrics,description,verified,created_at,location,url"
  });
  const url = `${TWITTER_BASE}/users/by/username/${username}?${params}`;
  const res  = await fetch(url, { headers: twitterHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Twitter API ${res.status}: ${err.title || res.statusText}`);
  }
  const d = await res.json();
  if (!d.data) throw new Error(`User not found: ${handle}`);
  return {
    handle: `@${d.data.username}`,
    name: d.data.name,
    description: d.data.description,
    followers: d.data.public_metrics?.followers_count,
    following: d.data.public_metrics?.following_count,
    tweet_count: d.data.public_metrics?.tweet_count,
    verified: d.data.verified || false,
    created_at: d.data.created_at,
    location: d.data.location
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
        if (!query) return res.status(400).json({ error: "query param required. Example: $ETH" });
        result = await getSentiment(query, parseInt(limit));
        break;
      case "trending":
        if (!category) return res.status(400).json({ error: "category param required. Use: crypto, nft, defi, web3" });
        result = await getTrending(category, parseInt(limit));
        break;
      case "profile":
        if (!handle) return res.status(400).json({ error: "handle param required. Example: VitalikButerin" });
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
