// api/weather.js
// Vercel Serverless Function — Weather API Proxy
// Wraps OpenWeatherMap API. API key stays server-side only.
// Endpoint: GET /api/weather?action=current&location=Karachi
//           GET /api/weather?action=forecast&location=NYC&days=5
//           GET /api/weather?action=alerts&region=Florida

const fetch = require("node-fetch");
const { signResponse } = require("../lib/signer");
const { limiter } = require("../lib/rateLimit");

const BASE_URL = "https://api.openweathermap.org/data/2.5";
const GEO_URL  = "https://api.openweathermap.org/geo/1.0";
const KEY      = process.env.OPENWEATHER_API_KEY;

// Helper: get lat/lon for a location name
async function getCoords(location) {
  const url = `${GEO_URL}/direct?q=${encodeURIComponent(location)}&limit=1&appid=${KEY}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (!data.length) throw new Error(`Location not found: ${location}`);
  return { lat: data[0].lat, lon: data[0].lon, name: data[0].name, country: data[0].country };
}

// GET current weather
async function getCurrent(location, units = "metric") {
  const coords = await getCoords(location);
  const url = `${BASE_URL}/weather?lat=${coords.lat}&lon=${coords.lon}&units=${units}&appid=${KEY}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  const d = await res.json();
  return {
    location: `${coords.name}, ${coords.country}`,
    temp: d.main.temp,
    feels_like: d.main.feels_like,
    humidity: d.main.humidity,
    pressure: d.main.pressure,
    wind_speed: d.wind.speed,
    wind_deg: d.wind.deg,
    condition: d.weather[0].main,
    description: d.weather[0].description,
    visibility: d.visibility,
    units: units === "metric" ? "celsius/kph" : "fahrenheit/mph",
    sunrise: new Date(d.sys.sunrise * 1000).toISOString(),
    sunset: new Date(d.sys.sunset * 1000).toISOString()
  };
}

// GET forecast (up to 5 days, 3hr steps)
async function getForecast(location, days = 5, units = "metric") {
  const coords = await getCoords(location);
  const cnt    = Math.min(days * 8, 40); // 8 data points per day
  const url = `${BASE_URL}/forecast?lat=${coords.lat}&lon=${coords.lon}&cnt=${cnt}&units=${units}&appid=${KEY}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`);
  const d = await res.json();
  return {
    location: `${coords.name}, ${coords.country}`,
    days_requested: days,
    forecast: d.list.map(item => ({
      datetime: item.dt_txt,
      temp: item.main.temp,
      humidity: item.main.humidity,
      condition: item.weather[0].main,
      description: item.weather[0].description,
      wind_speed: item.wind.speed,
      pop: item.pop // probability of precipitation
    }))
  };
}

// GET weather alerts (uses OneCall API if available, else returns empty)
async function getAlerts(region, units = "metric") {
  try {
    const coords = await getCoords(region);
    // OneCall 3.0 requires paid plan — fallback to current weather for demo
    const url = `${BASE_URL}/weather?lat=${coords.lat}&lon=${coords.lon}&units=${units}&appid=${KEY}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Alerts API error: ${res.status}`);
    const d = await res.json();
    const alerts = [];
    if (d.weather[0].main === "Thunderstorm") alerts.push({ type: "THUNDERSTORM", severity: "MODERATE", description: d.weather[0].description });
    if (d.weather[0].main === "Snow") alerts.push({ type: "SNOW", severity: "LOW", description: d.weather[0].description });
    if (d.main.temp > 40) alerts.push({ type: "HEAT", severity: "HIGH", description: "Extreme heat conditions" });
    return { region, alerts, total: alerts.length };
  } catch (e) {
    return { region, alerts: [], total: 0, note: e.message };
  }
}

// Main Vercel handler
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Check API key configured
  if (!KEY) {
    return res.status(500).json({ error: "OPENWEATHER_API_KEY not configured on server" });
  }

  const { action = "current", location, region, days = 5, units = "metric" } = req.query;

  try {
    let result;
    switch (action) {
      case "current":
        if (!location) return res.status(400).json({ error: "location param required" });
        result = await getCurrent(location, units);
        break;
      case "forecast":
        if (!location) return res.status(400).json({ error: "location param required" });
        result = await getForecast(location, parseInt(days), units);
        break;
      case "alerts":
        if (!region) return res.status(400).json({ error: "region param required" });
        result = await getAlerts(region, units);
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}. Use: current, forecast, alerts` });
    }

    // Sign the response before sending
    const signed = signResponse(result);
    return res.status(200).json({ ok: true, action, ...signed });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
