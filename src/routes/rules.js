const express = require('express');
const router = express.Router();
const { listRules, listRulesHistory, updateRuleStatus } = require('../services/rules');
const { broadcast } = require('../websocket');

// GET /api/rules?limit=20&offset=0
router.get('/', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? '20', 10), 100);
  const offset = parseInt(req.query.offset ?? '0', 10);

  if (isNaN(limit) || isNaN(offset) || limit < 1 || offset < 0) {
    return res.status(400).json({ error: 'Invalid limit or offset' });
  }

  const rules = listRules({ limit, offset });
  res.json({ limit, offset, count: rules.length, data: rules });
});

// GET /api/rules/history?period=1h|24h|7d&limit=20
router.get('/history', (req, res) => {
  const { period = '24h' } = req.query;
  const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);

  if (!['1h', '24h', '7d'].includes(period)) {
    return res.status(400).json({ error: 'period must be 1h, 24h or 7d' });
  }

  const history = listRulesHistory({ period, limit });
  res.json({ period, limit, count: history.length, data: history });
});

// PATCH /api/rules/:id — { status: 'active'|'pending'|'completed'|'disabled' }
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid rule id' });
  }
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  try {
    const rule = updateRuleStatus(id, status);
    if (!rule) {
      return res.status(404).json({ error: `Rule ${id} not found` });
    }
    broadcast('rule_update', rule);
    res.json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
