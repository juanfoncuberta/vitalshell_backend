process.env.DB_PATH = ':memory:';
process.env.API_KEY = 'test-key';

const request = require('supertest');
const { evaluateRules, runRulesEngine, listRules } = require('../src/services/rules');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Unit tests — rules engine logic
// ---------------------------------------------------------------------------

describe('evaluateRules (dummy AI)', () => {
  it('generates ventilation rule when temp > 28', () => {
    const rules = evaluateRules({ temperature: 30 }, {});
    const rule = rules.find(r => r.action === 'activate_ventilation');
    expect(rule).toBeDefined();
    expect(rule.affected_layer).toBe('ventilation');
  });

  it('generates heating rule when temp < 16', () => {
    const rules = evaluateRules({ temperature: 12 }, {});
    const rule = rules.find(r => r.action === 'activate_heating');
    expect(rule).toBeDefined();
  });

  it('generates dehumidifier rule when humidity > 75', () => {
    const rules = evaluateRules({ humidity: 80 }, {});
    const rule = rules.find(r => r.action === 'activate_dehumidifier');
    expect(rule).toBeDefined();
  });

  it('generates humidifier rule when humidity < 25', () => {
    const rules = evaluateRules({ humidity: 20 }, {});
    const rule = rules.find(r => r.action === 'activate_humidifier');
    expect(rule).toBeDefined();
  });

  it('generates low water alert', () => {
    const rules = evaluateRules({ water_level: 10 }, {});
    const rule = rules.find(r => r.action === 'alert_low_water');
    expect(rule).toBeDefined();
  });

  it('generates low battery alert', () => {
    const rules = evaluateRules({ battery_level: 15 }, {});
    const rule = rules.find(r => r.action === 'alert_low_battery');
    expect(rule).toBeDefined();
  });

  it('generates close_blinds when exterior temp > 35', () => {
    const rules = evaluateRules({}, { weather: { temperature: 38 } });
    const rule = rules.find(r => r.action === 'close_blinds');
    expect(rule).toBeDefined();
  });

  it('generates fire alert when EFFIS risk is high', () => {
    const rules = evaluateRules({}, { effis: { fire_risk: 'high' } });
    const rule = rules.find(r => r.action === 'alert_fire_risk');
    expect(rule).toBeDefined();
  });

  it('generates load shift rule when renewables >= 60%', () => {
    const rules = evaluateRules({}, { redata: { renewables_percent: 65 } });
    const rule = rules.find(r => r.action === 'shift_load_to_now');
    expect(rule).toBeDefined();
  });

  it('generates no rules for optimal conditions', () => {
    const rules = evaluateRules(
      { temperature: 22, humidity: 50, water_level: 70, battery_level: 80 },
      { weather: { temperature: 22 }, effis: { fire_risk: 'low' }, redata: { renewables_percent: 40 } }
    );
    expect(rules.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runRulesEngine — deduplication
// ---------------------------------------------------------------------------

describe('runRulesEngine — deduplication', () => {
  it('does not create a duplicate rule when action already exists in active/pending', () => {
    const sensorData = { temperature: 35 }; // triggers activate_ventilation
    const apiData    = {};

    const first  = runRulesEngine(sensorData, apiData);
    const second = runRulesEngine(sensorData, apiData);

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0); // no new rules — already exists

    const all = listRules();
    const ventilation = all.filter(r => r.action === 'activate_ventilation');
    expect(ventilation.length).toBe(1);
  });

  it('creates a new rule after the previous one is no longer active/pending', () => {
    const { updateRuleStatus } = require('../src/services/rules');
    const sensorData = { battery_level: 10 }; // triggers alert_low_battery
    const apiData    = {};

    const first = runRulesEngine(sensorData, apiData);
    expect(first.length).toBeGreaterThan(0);

    // Mark it completed — dedup should no longer block a new one
    updateRuleStatus(first[0].id, 'completed');

    const second = runRulesEngine(sensorData, apiData);
    expect(second.length).toBe(1);
    expect(second[0].action).toBe('alert_low_battery');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — REST endpoints
// ---------------------------------------------------------------------------

describe('GET /api/rules', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/rules');
    expect(res.status).toBe(401);
  });

  it('returns rule list with pagination', async () => {
    const res = await request(app)
      .get('/api/rules?limit=5&offset=0')
      .set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.limit).toBe(5);
  });

  it('returns 400 for invalid limit', async () => {
    const res = await request(app)
      .get('/api/rules?limit=-1')
      .set('X-API-Key', 'test-key');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/rules/history', () => {
  it('returns history for valid period', async () => {
    const res = await request(app)
      .get('/api/rules/history?period=24h')
      .set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('PATCH /api/rules/:id', () => {
  it('returns 404 for non-existent rule', async () => {
    const res = await request(app)
      .patch('/api/rules/9999')
      .set('X-API-Key', 'test-key')
      .send({ status: 'active' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app)
      .patch('/api/rules/1')
      .set('X-API-Key', 'test-key')
      .send({ status: 'invalid_status' });
    expect(res.status).toBe(400);
  });

  it('updates rule status', async () => {
    // First create a rule via the sensor endpoint
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 30 });

    const listRes = await request(app)
      .get('/api/rules')
      .set('X-API-Key', 'test-key');

    const rule = listRes.body.data[0];
    if (!rule) return; // no rule generated — skip

    const patchRes = await request(app)
      .patch(`/api/rules/${rule.id}`)
      .set('X-API-Key', 'test-key')
      .send({ status: 'active' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('active');
  });
});
