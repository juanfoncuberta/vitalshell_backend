const express = require('express');
const router = express.Router();
const { saveReading, getHistory } = require('../services/sensors');
const { runRulesEngine } = require('../services/rules');
const { getAllCached } = require('../services/apis');
const { broadcast } = require('../websocket');

// POST /api/sensors — ingest data from hardware (no auth)
router.post('/', (req, res) => {
  const { temperature, humidity, water_level, battery_level, timestamp } = req.body;

  if (
    temperature === undefined &&
    humidity === undefined &&
    water_level === undefined &&
    battery_level === undefined
  ) {
    return res.status(400).json({ error: 'At least one sensor field is required' });
  }

  const reading = saveReading({ temperature, humidity, water_level, battery_level, timestamp });

  // Reactive rules evaluation
  const apiData = getAllCached();
  const newRules = runRulesEngine(reading, apiData);

  // Broadcast to WebSocket clients
  broadcast('sensor_update', reading);
  if (newRules.length > 0) {
    newRules.forEach(rule => broadcast('rule_update', rule));
  }

  res.status(201).json({ ok: true, reading, new_rules: newRules });
});

// GET /api/sensors/history?period=1h|24h|7d
router.get('/history', (req, res) => {
  const { period = '24h' } = req.query;
  if (!['1h', '24h', '7d'].includes(period)) {
    return res.status(400).json({ error: 'period must be 1h, 24h or 7d' });
  }
  const history = getHistory(period);
  res.json({ period, count: history.length, data: history });
});

module.exports = router;
