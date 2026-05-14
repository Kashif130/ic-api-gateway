# ⚡ IC API Gateway
### Intelligent Contract External API Library — Bounty Submission

**Category:** Tools & Infrastructure
**Points:** 50–2500
**Version:** 1.0.0

---

## 🧠 What Is This?

Intelligent Contracts need to interact with the real world — weather conditions, live crypto prices, social signals. But there's a fundamental problem: **API keys can't live on-chain** (they'd be public and stolen instantly).

This project solves that with a **secure proxy gateway** pattern:

```
Smart Contract → emits event → Oracle Keeper → calls this proxy (with private key) → signs response → submits back on-chain
```

**Three real, working API libraries are included:**

| Library | API Source | Actions |
|---|---|---|
| `WeatherLib` | OpenWeatherMap | `current`, `forecast`, `alerts` |
| `PriceFeedLib` | CoinGecko | `price`, `twap`, `multi` |
| `SocialLib` | Twitter/X v2 | `sentiment`, `trending`, `profile` |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────┐
│        Intelligent Contract (On-Chain)           │
│  gateway.requestData("weather","current",...);   │
└──────────────────┬──────────────────────────────┘
                   │  on-chain APIRequest event
                   ▼
┌─────────────────────────────────────────────────┐
│         Oracle Keeper (Off-Chain Node)           │
│  • Listens for events                            │
│  • Calls IC Proxy via HTTPS                      │
│  • Verifies HMAC signature on response           │
│  • Submits signed data back on-chain             │
└──────────────────┬──────────────────────────────┘
                   │  API key injected server-side only
                   ▼
┌─────────────────────────────────────────────────┐
│     IC Proxy Service (This Repo — Vercel)        │
│  /api/weather  /api/price  /api/social           │
│  • Keys in encrypted env vars (never in code)    │
│  • HMAC-SHA256 signed responses                  │
│  • 60 req/min/IP rate limiting                   │
└─────────────────────────────────────────────────┘
```

**Security guarantees:**
- ✅ API keys are **never in source code**
- ✅ API keys are **never in blockchain events or logs**
- ✅ Every response is **cryptographically signed** (HMAC-SHA256)
- ✅ Rate limiting prevents abuse (60 req/min/IP)
- ✅ CORS protection on all endpoints

---

## 📁 File Structure

```
ic-api-gateway/
├── api/
│   ├── weather.js       ← OpenWeatherMap proxy (serverless)
│   ├── price.js         ← CoinGecko proxy (serverless)
│   ├── social.js        ← Twitter/X API v2 proxy (serverless)
│   └── verify.js        ← Health check + signature verification
├── lib/
│   ├── signer.js        ← HMAC-SHA256 response signing/verification
│   └── rateLimit.js     ← Per-IP rate limiting middleware
├── contracts/
│   └── ICContracts.sol  ← Solidity interface + example contracts
├── public/
│   └── index.html       ← Interactive Studio UI (live API tester)
├── .env.example         ← API key configuration template
├── vercel.json          ← One-click Vercel deployment config
├── package.json
└── README.md            ← This file
```

---

## 🚀 Deploy to Vercel (5 minutes)

### Step 1 — Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/ic-api-gateway.git
cd ic-api-gateway
npm install
```

### Step 2 — Get your API keys

| Service | Where to get | Free? |
|---|---|---|
| OpenWeatherMap | https://openweathermap.org/api | ✅ Free tier |
| CoinGecko | https://www.coingecko.com/en/api | ✅ Free (no key needed for basic) |
| Twitter/X v2 | https://developer.twitter.com/en/portal | ✅ Free Basic tier |

### Step 3 — Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENWEATHER_API_KEY=your_openweathermap_key_here
COINGECKO_API_KEY=optional_for_higher_limits
TWITTER_BEARER_TOKEN=your_twitter_bearer_token_here
ORACLE_SIGNING_SECRET=generate_with_command_below
```

Generate a signing secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 4 — Test locally

```bash
npm run dev
# Visit http://localhost:3000 for the Studio UI
```

Test an endpoint:
```bash
curl "http://localhost:3000/api/price?action=price&pair=ETH/USD"
curl "http://localhost:3000/api/weather?action=current&location=Karachi"
```

### Step 5 — Deploy to Vercel

```bash
npm install -g vercel
vercel
```

When prompted, add environment variables via Vercel dashboard:
`Settings → Environment Variables` — paste each key from your `.env`.

Or use CLI:
```bash
vercel env add OPENWEATHER_API_KEY
vercel env add TWITTER_BEARER_TOKEN
vercel env add ORACLE_SIGNING_SECRET
vercel --prod
```

---

## 📡 API Reference

### Weather Endpoints

#### `GET /api/weather?action=current&location=Karachi&units=metric`

Returns current weather for any city.

```json
{
  "ok": true,
  "action": "current",
  "data": {
    "location": "Karachi, PK",
    "temp": 32.4,
    "humidity": 68,
    "condition": "Clear",
    "wind_speed": 14.2,
    "units": "celsius/kph"
  },
  "signature": "a3f8c2...",
  "timestamp": 1715000000
}
```

#### `GET /api/weather?action=forecast&location=NYC&days=5`

Returns 3-hourly forecast data.

#### `GET /api/weather?action=alerts&region=Florida`

Returns active weather alerts. Checks for thunderstorm, snow, extreme heat.

---

### Price Feed Endpoints

#### `GET /api/price?action=price&pair=ETH/USD`

Real-time price from CoinGecko.

```json
{
  "ok": true,
  "data": {
    "pair": "ETH/USD",
    "price_usd": 2841.55,
    "change_24h_pct": "1.2300",
    "market_cap_usd": 341000000000,
    "source": "CoinGecko"
  },
  "signature": "b7e1d4...",
  "timestamp": 1715000050
}
```

**Supported pairs:** ETH/USD, BTC/USD, SOL/USD, MATIC/USD, ARB/USD, OP/USD, AVAX/USD, BNB/USD, LINK/USD, UNI/USD, AAVE/USD, CRV/USD

#### `GET /api/price?action=twap&pair=BTC/USD&interval=3600`

Time-Weighted Average Price. `interval` in seconds (e.g., 3600 = 1hr TWAP).

#### `GET /api/price?action=multi&coins=bitcoin,ethereum,solana`

Batch price fetch for multiple assets.

---

### Social Endpoints

#### `GET /api/social?action=sentiment&query=$ETH&limit=20`

Analyzes recent tweets for sentiment score (0 = bearish, 1 = bullish).

```json
{
  "ok": true,
  "data": {
    "query": "$ETH",
    "volume": 18,
    "sentiment": {
      "score": 0.7143,
      "label": "bullish",
      "positive_signals": 5,
      "negative_signals": 2
    },
    "sample_tweets": [...]
  }
}
```

#### `GET /api/social?action=trending&category=crypto&limit=10`

Top trending hashtags in a category. Categories: `crypto`, `defi`, `nft`, `web3`.

#### `GET /api/social?action=profile&handle=VitalikButerin`

Verified profile stats (followers, tweet count, etc.).

---

### Verify Endpoint

#### `GET /api/verify`

Health check — shows service status and all endpoint URLs.

#### `POST /api/verify`

Verify a signed oracle response.

```bash
curl -X POST https://your-deployment.vercel.app/api/verify \
  -H "Content-Type: application/json" \
  -d '{"data":{...},"signature":"a3f8c2...","timestamp":1715000000}'
```

Response: `{ "ok": true, "valid": true, "timestamp": 1715000000 }`

---

## 🔗 Using with Solidity Contracts

```solidity
// Import the interface
import "./contracts/ICContracts.sol";

contract MyContract {
    IAPIGateway public gateway;

    constructor(address _gateway) {
        gateway = IAPIGateway(_gateway);
    }

    function checkEthPrice() external {
        // Request price data — oracle keeper will call back
        bytes32 requestId = gateway.requestData(
            "price",
            "twap",
            '{"pair":"ETH/USD","interval":3600}',
            address(this),
            this.onPriceReceived.selector
        );
    }

    function onPriceReceived(
        bytes32 requestId,
        uint256 twapUSD,
        bytes calldata signature
    ) external {
        // Use the price data
        // signature has already been verified by oracle keeper
    }
}
```

See `contracts/ICContracts.sol` for two complete example contracts:
- **CropInsurance** — triggers payout on extreme heat weather alert
- **LiquidationGuard** — liquidates DeFi positions using 1hr ETH TWAP

---

## 🔐 Security Model in Detail

### Why API keys can't go on-chain
Every transaction, event log, and calldata on any public blockchain is **permanently visible to everyone**. Putting an API key in a contract = instantly compromised.

### The proxy pattern
This service acts as a **trusted middleman**:
1. Contract emits a request event (no sensitive data)
2. Off-chain oracle keeper detects the event
3. Keeper calls this proxy with HTTPS (key injected by server env)
4. Proxy calls the external API, gets data
5. Proxy signs the response with HMAC-SHA256
6. Keeper verifies signature, submits signed data on-chain
7. Contract verifies signature before using data

### Response signing
```javascript
// lib/signer.js — every response is signed like this:
const payload  = JSON.stringify({ data, timestamp });
const signature = HMAC_SHA256(payload, ORACLE_SIGNING_SECRET);
return { data, signature, timestamp };
```

On-chain contracts can verify by checking the signature matches the oracle keeper's registered public key (or in trusted setups, the keeper verifies before submitting).

### Production upgrade path
- Replace HMAC-SHA256 with **Ed25519** keypair signing
- Run oracle keeper inside a **TEE** (Trusted Execution Environment)
- Use **HashiCorp Vault** or **AWS KMS** for key management
- Add **multi-keeper consensus** for decentralization

---

## 🧪 Testing All Endpoints

```bash
# Health check
curl http://localhost:3000/api/verify

# Weather
curl "http://localhost:3000/api/weather?action=current&location=Karachi"
curl "http://localhost:3000/api/weather?action=forecast&location=Dubai&days=3"
curl "http://localhost:3000/api/weather?action=alerts&region=Texas"

# Price
curl "http://localhost:3000/api/price?action=price&pair=ETH/USD"
curl "http://localhost:3000/api/price?action=twap&pair=BTC/USD&interval=3600"
curl "http://localhost:3000/api/price?action=multi&coins=bitcoin,ethereum,solana"

# Social (requires TWITTER_BEARER_TOKEN)
curl "http://localhost:3000/api/social?action=sentiment&query=%24ETH"
curl "http://localhost:3000/api/social?action=trending&category=crypto"
curl "http://localhost:3000/api/social?action=profile&handle=VitalikButerin"
```

---

## ⚡ Roadmap

- [x] WeatherLib — OpenWeatherMap integration
- [x] PriceFeedLib — CoinGecko integration
- [x] SocialLib — Twitter/X API v2 integration
- [x] HMAC-SHA256 response signing
- [x] Rate limiting + CORS
- [x] Interactive Studio UI
- [x] Vercel deployment config
- [x] Solidity interface + example contracts
- [ ] Ed25519 signing (production-grade)
- [ ] GraphQL API library (custom endpoints)
- [ ] Multi-keeper consensus
- [ ] ZK-proof response attestation
- [ ] NPM package: `@ic-libs/weather`, `@ic-libs/price`, `@ic-libs/social`

---

## 📜 License

MIT — free to use, fork, and build on.

---

*Built for the Intelligent Contracts Tools & Infrastructure bounty.*
