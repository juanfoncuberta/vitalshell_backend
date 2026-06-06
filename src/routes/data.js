const express = require('express');
const router = express.Router();
const { getLatestReading, isOnline } = require('../services/sensors');
const { getAllCached } = require('../services/apis');
const { listRules } = require('../services/rules');
const { getComfort } = require('../services/comfort');

// GET /api/data — full system state (requires auth)
router.get('/', (req, res) => {
  const latest  = getLatestReading();
  const apis    = getAllCached();
  const rules   = listRules({ limit: 10, offset: 0 });
  const comfort = getComfort();

  res.json({
    sensor:      latest,
    sensor_online: isOnline(),
    environmental: {
      weather:     apis.weather,
      aemet:       apis.aemet,
    },
    air_quality:  apis.air_quality,
    energy:       {
      redata:      apis.redata,
      nasa_power:  apis.nasa_power,
    },
    fire_risk:    apis.effis,
    rules,
    comfort,
    timestamp:    new Date().toISOString(),
  });
});

module.exports = router;
