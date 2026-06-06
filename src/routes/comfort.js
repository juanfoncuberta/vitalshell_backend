const express = require('express');
const router = express.Router();
const { getComfort, setComfort } = require('../services/comfort');

// GET /api/comfort
router.get('/', (req, res) => {
  res.json(getComfort());
});

// POST /api/comfort
router.post('/', (req, res) => {
  const { temperature_min, temperature_max, humidity_min, humidity_max } = req.body;

  // Validate ranges if provided
  if (temperature_min !== undefined && temperature_max !== undefined) {
    if (Number(temperature_min) >= Number(temperature_max)) {
      return res.status(400).json({ error: 'temperature_min must be less than temperature_max' });
    }
  }
  if (humidity_min !== undefined && humidity_max !== undefined) {
    if (Number(humidity_min) >= Number(humidity_max)) {
      return res.status(400).json({ error: 'humidity_min must be less than humidity_max' });
    }
  }

  const updated = setComfort({ temperature_min, temperature_max, humidity_min, humidity_max });
  res.json(updated);
});

module.exports = router;
