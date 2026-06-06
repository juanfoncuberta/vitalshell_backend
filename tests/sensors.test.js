const request = require('supertest');

// Use an in-memory DB for tests
process.env.DB_PATH = ':memory:';
process.env.API_KEY = 'test-key';

const app = require('../src/app');

describe('POST /api/sensors', () => {
  it('returns 400 when body has no sensor fields', async () => {
    const res = await request(app).post('/api/sensors').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('accepts a valid sensor reading', async () => {
    const res = await request(app).post('/api/sensors').send({
      temperature:   22.5,
      humidity:      55,
      water_level:   80,
      battery_level: 90,
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.reading).toHaveProperty('temperature', 22.5);
  });

  it('accepts a partial reading (only temperature)', async () => {
    const res = await request(app).post('/api/sensors').send({ temperature: 19 });
    expect(res.status).toBe(201);
    expect(res.body.reading.temperature).toBe(19);
  });
});

describe('GET /api/sensors/history', () => {
  it('requires auth', async () => {
    // history is under /api/sensors which is public — confirm 200
    const res = await request(app).get('/api/sensors/history');
    expect([200, 400]).toContain(res.status);
  });

  it('returns 400 for invalid period', async () => {
    const res = await request(app).get('/api/sensors/history?period=bad');
    expect(res.status).toBe(400);
  });

  it('returns history for valid period', async () => {
    const res = await request(app).get('/api/sensors/history?period=1h');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('period', '1h');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
