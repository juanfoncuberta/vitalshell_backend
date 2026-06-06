const express = require('express');
const cors = require('cors');
const { requireApiKey } = require('./middleware/auth');

const sensorsRouter = require('./routes/sensors');
const dataRouter    = require('./routes/data');
const rulesRouter   = require('./routes/rules');
const comfortRouter = require('./routes/comfort');
const healthRouter  = require('./routes/health');

const app = express();

app.use(cors());
app.use(express.json());

// Public routes
app.use('/api/sensors',      sensorsRouter);
app.use('/api/system/health', healthRouter);

// Protected routes
app.use('/api/data',    requireApiKey, dataRouter);
app.use('/api/rules',   requireApiKey, rulesRouter);
app.use('/api/comfort', requireApiKey, comfortRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[app] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
