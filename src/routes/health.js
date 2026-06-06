const express = require('express');
const router = express.Router();
const { isOnline } = require('../services/sensors');
const { getCache } = require('../services/apis');

const API_SOURCES = ['weather', 'air_quality', 'redata', 'effis', 'aemet', 'nasa_power'];

// Age threshold after which a cache entry is considered stale (30 min)
const STALE_MS = 30 * 60 * 1000;

function buildApiStatus() {
  return API_SOURCES.reduce((acc, source) => {
    const cached = getCache(source);
    if (!cached) {
      acc[source] = { status: 'no_data' };
    } else {
      const ageMs = Date.now() - new Date(cached.updated_at).getTime();
      acc[source] = {
        status:     ageMs < STALE_MS ? 'ok' : 'stale',
        updated_at: cached.updated_at,
        age_seconds: Math.round(ageMs / 1000),
      };
    }
    return acc;
  }, {});
}

// GET /api/system/health — no auth required
router.get('/', (req, res) => {
  const sensorOnline = isOnline();
  const apis = buildApiStatus();
  const allApisOk = Object.values(apis).every(a => a.status === 'ok');

  res.json({
    status:        sensorOnline && allApisOk ? 'healthy' : 'degraded',
    sensor_online: sensorOnline,
    apis,
    uptime_seconds: Math.round(process.uptime()),
    timestamp:      new Date().toISOString(),
  });
});

module.exports = router;
