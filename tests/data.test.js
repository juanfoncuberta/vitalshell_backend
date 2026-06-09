const request = require('supertest');

process.env.API_KEY = 'test-key';

const app = require('../src/app');

describe('GET /api/data', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong API key', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns correct top-level structure', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'test-key');

    expect(res.status).toBe(200);
    const b = res.body;

    expect(b).toHaveProperty('timestamp');
    expect(b).toHaveProperty('system_health');
    expect(b).toHaveProperty('sensors');
    expect(b).toHaveProperty('environmental_context');
    expect(b).toHaveProperty('air_quality');
    expect(b).toHaveProperty('calculated_metrics');
  });

  it('system_health has required fields and valid values', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'test-key');

    const h = res.body.system_health;
    expect(['ok', 'warning', 'danger']).toContain(h.sensors_status);
    expect(['ok', 'degraded', 'error']).toContain(h.apis_status);
  });

  it('sensors have value+status objects for all four fields', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'test-key');

    const s = res.body.sensors;
    for (const field of ['temperature', 'humidity', 'water_level', 'battery_level']) {
      expect(s).toHaveProperty(field);
      expect(s[field]).toHaveProperty('value');
      expect(s[field]).toHaveProperty('status');
    }
  });

  it('environmental_context has current and forecast array', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'test-key');

    const ec = res.body.environmental_context;
    expect(ec).toHaveProperty('current');
    expect(Array.isArray(ec.forecast)).toBe(true);

    const cur = ec.current;
    for (const field of ['ext_temperature', 'ext_humidity', 'wind_kmh', 'uv_index',
                         'renewables_pct', 'co2_g_kwh', 'fire_risk_fwi', 'water_balance_mm']) {
      expect(cur).toHaveProperty(field);
      expect(cur[field]).toHaveProperty('value');
      expect(cur[field]).toHaveProperty('status');
    }
  });

  it('air_quality has all pollutant fields', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'test-key');

    const aq = res.body.air_quality;
    for (const field of ['pm25', 'pm10', 'co', 'no2', 'o3', 'aqi']) {
      expect(aq).toHaveProperty(field);
      expect(aq[field]).toHaveProperty('value');
      expect(aq[field]).toHaveProperty('status');
    }
    expect(['ok', 'warning', 'danger', 'unknown']).toContain(aq.aqi.status);
  });

  it('sensors reflect lastKnown — values survive across partial POSTs', async () => {
    // Establish all four fields with known values
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 11.1, humidity: 22.2, water_level: 33.3, battery_level: 44.4 });

    // Second POST updates only temperature
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 99.9 });

    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'test-key');

    const s = res.body.sensors;
    expect(s.temperature.value).toBe(99.9);   // updated
    expect(s.humidity.value).toBe(22.2);       // retained
    expect(s.water_level.value).toBe(33.3);    // retained
    expect(s.battery_level.value).toBe(44.4);  // retained
  });

  it('calculated_metrics has all required fields', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'test-key');

    const m = res.body.calculated_metrics;
    expect(m).toHaveProperty('comfort_score.value');
    expect(m).toHaveProperty('comfort_score.status');
    expect(m).toHaveProperty('water_autonomy_days.value');
    expect(m).toHaveProperty('water_autonomy_days.status');
    expect(m).toHaveProperty('energy_source.solar_pct');
    expect(m).toHaveProperty('energy_source.battery_pct');
    expect(m).toHaveProperty('energy_source.grid_pct');
    expect(m).toHaveProperty('savings_eur_today.value');
  });
});
