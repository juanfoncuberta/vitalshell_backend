const express = require('express');
const router = express.Router();
const { getLastSeenAt } = require('../services/sensors');
const { getCache } = require('../services/apis');

// Age threshold after which a cache entry is considered stale (30 min)
const STALE_MS = 30 * 60 * 1000;

function sensorsHealth() {
  const lastSeen = getLastSeenAt();
  if (!lastSeen) return { last_seen: null, status: 'danger' };
  const diffSec = (Date.now() - lastSeen.getTime()) / 1000;
  const status  = diffSec < 30 ? 'ok' : diffSec < 120 ? 'warning' : 'danger';
  return { last_seen: lastSeen.toISOString(), status };
}

// Map internal cache-source keys to the spec's field names
const SOURCE_MAP = {
  open_meteo: 'weather',
  nasa_power: 'nasa_power',
  redata:     'redata',
  effis:      'effis',
  aemet:      'aemet',
};

function apisHealth() {
  const result = {};
  for (const [key, source] of Object.entries(SOURCE_MAP)) {
    const cached = getCache(source);
    if (!cached) {
      result[key] = { status: 'no_data', last_updated: null };
    } else {
      const ageMs      = Date.now() - new Date(cached.updated_at).getTime();
      const lastUpdated = new Date(cached.updated_at.replace(' ', 'T') + 'Z').toISOString();
      result[key] = {
        status:       ageMs < STALE_MS ? 'ok' : 'stale',
        last_updated: lastUpdated,
      };
    }
  }
  return result;
}

// GET /api/system/health — no auth required
router.get('/', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    sensors:   sensorsHealth(),
    apis:      apisHealth(),
  });
});

module.exports = router;
