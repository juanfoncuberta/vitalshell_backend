const request = require('supertest');

process.env.API_KEY = 'test-key';

const app = require('../src/app');

describe('GET /api/system/health', () => {
  it('is publicly accessible', async () => {
    const res = await request(app).get('/api/system/health');
    expect(res.status).toBe(200);
  });

  it('returns expected shape', async () => {
    const res = await request(app).get('/api/system/health');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('sensors');
    expect(res.body).toHaveProperty('apis');
    expect(res.body.sensors).toHaveProperty('status');
    expect(res.body.sensors).toHaveProperty('last_seen');
    expect(['open_meteo', 'nasa_power', 'redata', 'effis', 'aemet']).toEqual(
      expect.arrayContaining(Object.keys(res.body.apis))
    );
  });

  it('sensors block has valid status and last_seen', async () => {
    const res = await request(app).get('/api/system/health');
    expect(['ok', 'warning', 'danger']).toContain(res.body.sensors.status);
    // last_seen is null or a valid ISO8601 string
    const { last_seen } = res.body.sensors;
    if (last_seen !== null) {
      expect(() => new Date(last_seen).toISOString()).not.toThrow();
    }
  });
});
