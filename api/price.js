// api/price.js
// Vercel Serverless Function — Price Feed Proxy
// Uses CoinGecko API (free tier — no key needed for basic endpoints).
// Endpoint: GET /api/price?action=price&pair=ETH/USD
//           GET /api/price?action=twap&pair=BTC/USD&interval=3600
//           GET /api/price?action=multi&coins=bitcoin,ethereum,solana

const fetch = require("node-fetch");
const { signResponse } = require("../lib/signer");

const BASE_URL = "https://api.coingecko.com/api/v3";
const KEY      = process.env.COINGECKO_API_KEY; // optional — works without for free tier

// Normalize pair like "ETH/USD" → coingecko id "ethereum"
const PAIR_MAP = {
  "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana",
  "MATIC": "matic-network", "ARB": "arbitrum", "OP": "optimism",
  "AVAX": "avalanche-2", "BNB": "binancecoin", "LINK": "chainlink",
  "UNI": "uniswap", "AAVE": "aave", "CRV": "curve-dao-token"
};

function pairToId(pair) {
  const base = pair.split("/")[0].toUpperCase();
  const id = PAIR_MAP[base];
  if (!id) throw new Error(`Unknown pair: ${pair}. Supported: ${Object.keys(PAIR_MAP).join(", ")}`);
  return id;
}

function buildHeaders() {
  const h = { "Accept": "application/json" };
  if (KEY) h["x-cg-demo-api-key"] = KEY;
  return h;
}

// GET current price
async function getPrice(pair) {
  const id  = pairToId(pair);
  const url = `${BASE_URL}/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true&include_market_cap=true`;
  const res  = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const d = await res.json();
  const coin = d[id];
  if (!coin) throw new Error(`No price data for ${pair}`);
  return {
    pair,
    price_usd: coin.usd,
    change_24h_pct: coin.usd_24h_change?.toFixed(4),
    market_cap_usd: coin.usd_market_cap,
    last_updated: new Date(coin.last_updated_at * 1000).toISOString(),
    source: "CoinGecko"
  };
}

// GET TWAP — approximated using OHLCV candles average over interval
async function getTWAP(pair, intervalSeconds = 3600) {
  const id   = pairToId(pair);
  // CoinGecko market chart — use 1 day data for hourly TWAP approximation
  const days = Math.max(1, Math.ceil(intervalSeconds / 86400));
  const url  = `${BASE_URL}/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=hourly`;
  const res   = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) throw new Error(`CoinGecko OHLCV error: ${res.status}`);
  const d     = await res.json();
  const prices = d.prices; // [[timestamp, price], ...]
  if (!prices || !prices.length) throw new Error("No price history available");

  // Take only the last N prices covering the interval
  const points = Math.max(1, Math.floor(intervalSeconds / 3600));
  const slice  = prices.slice(-points);
  const twap   = slice.reduce((sum, [, p]) => sum + p, 0) / slice.length;

  return {
    pair,
    twap_usd: parseFloat(twap.toFixed(6)),
    interval_seconds: intervalSeconds,
    interval_label: intervalSeconds >= 3600 ? `${intervalSeconds / 3600}h` : `${intervalSeconds}s`,
    data_points_used: slice.length,
    from: new Date(slice[0][0]).toISOString(),
    to: new Date(slice[slice.length - 1][0]).toISOString(),
    source: "CoinGecko"
  };
}

// GET multi coin prices
async function getMulti(coins) {
  const ids  = coins.split(",").map(c => c.trim().toLowerCase()).join(",");
  const url  = `${BASE_URL}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
  const res   = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) throw new Error(`CoinGecko multi error: ${res.status}`);
  const d = await res.json();
  return {
    coins: Object.entries(d).map(([id, val]) => ({
      id,
      price_usd: val.usd,
      change_24h_pct: val.usd_24h_change?.toFixed(4),
      market_cap_usd: val.usd_market_cap
    })),
    fetched_at: new Date().toISOString(),
    source: "CoinGecko"
  };
}

// Main Vercel handler
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action = "price", pair, interval, coins } = req.query;

  try {
    let result;
    switch (action) {
      case "price":
        if (!pair) return res.status(400).json({ error: "pair param required. Example: ETH/USD" });
        result = await getPrice(pair);
        break;
      case "twap":
        if (!pair) return res.status(400).json({ error: "pair param required" });
        result = await getTWAP(pair, parseInt(interval || 3600));
        break;
      case "multi":
        if (!coins) return res.status(400).json({ error: "coins param required. Example: bitcoin,ethereum,solana" });
        result = await getMulti(coins);
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}. Use: price, twap, multi` });
    }

    const signed = signResponse(result);
    return res.status(200).json({ ok: true, action, ...signed });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
