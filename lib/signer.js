// lib/signer.js
// Signs every oracle response so on-chain contracts can verify authenticity.
// Uses HMAC-SHA256 — replace with Ed25519 when deploying to production TEE.

const crypto = require("crypto");

const SECRET = process.env.ORACLE_SIGNING_SECRET || "dev-secret-change-in-production";

/**
 * Sign a response payload.
 * @param {object} data - The response object to sign
 * @returns {object} - { data, signature, timestamp }
 */
function signResponse(data) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ data, timestamp });
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex");

  return { data, signature, timestamp };
}

/**
 * Verify a signed response (for testing / on-chain keeper validation).
 * @param {object} signedResponse - { data, signature, timestamp }
 * @returns {boolean}
 */
function verifyResponse(signedResponse) {
  const { data, signature, timestamp } = signedResponse;
  const payload = JSON.stringify({ data, timestamp });
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex")
  );
}

module.exports = { signResponse, verifyResponse };
