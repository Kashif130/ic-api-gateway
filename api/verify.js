// api/verify.js
// Verifies a signed oracle response.
// Contracts / keepers can call this to confirm data integrity.
// POST /api/verify  { data, signature, timestamp }

const { verifyResponse } = require("../lib/signer");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "IC API Gateway",
      version: "1.0.0",
      endpoints: {
        weather: "/api/weather?action=current&location=Karachi",
        price:   "/api/price?action=price&pair=ETH/USD",
        social:  "/api/social?action=sentiment&query=$ETH",
        verify:  "POST /api/verify { data, signature, timestamp }"
      },
      status: {
        weather_key: !!process.env.OPENWEATHER_API_KEY,
        twitter_key: !!process.env.TWITTER_BEARER_TOKEN,
        signing_key: !!process.env.ORACLE_SIGNING_SECRET
      }
    });
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const { data, signature, timestamp } = body;
      if (!data || !signature || !timestamp) {
        return res.status(400).json({ error: "Missing fields: data, signature, timestamp" });
      }
      const valid = verifyResponse({ data, signature, timestamp });
      return res.status(200).json({ ok: true, valid, timestamp });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
