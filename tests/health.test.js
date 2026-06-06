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
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('sensor_online');
    expect(res.body).toHaveProperty('apis');
    expect(res.body).toHaveProperty('uptime_seconds');
    expect(['healthy', 'degraded']).toContain(res.body.status);
  });

  it('reports sensor as offline when no reading exists', async () => {
    // Fresh DB has no readings
    const res = await request(app).get('/api/system/health');
    expect(res.body.sensor_online).toBe(false);
  });
});
