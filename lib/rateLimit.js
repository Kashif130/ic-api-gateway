// lib/rateLimit.js
// Per-IP rate limiter. Prevents abuse of the proxy service.
// Limits: 60 requests/minute per IP across all endpoints.

const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 60 * 1000,      // 1 minute window
  max: 60,                   // 60 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Rate limit exceeded",
    message: "Too many requests — max 60/minute per IP. Slow down.",
    retryAfter: 60
  },
  keyGenerator: (req) => {
    // Use forwarded IP for Vercel/proxy environments
    return req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;
  }
});

module.exports = { limiter };
