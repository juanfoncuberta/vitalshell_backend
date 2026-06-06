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

  it('returns system state with valid API key', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('rules');
    expect(res.body).toHaveProperty('comfort');
    expect(res.body).toHaveProperty('sensor_online');
  });
});
