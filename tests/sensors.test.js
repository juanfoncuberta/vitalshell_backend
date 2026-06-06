const request = require('supertest');

process.env.DB_PATH = ':memory:';
process.env.API_KEY = 'test-key';

const app = require('../src/app');

describe('POST /api/sensors', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).post('/api/sensors').send({ temperature: 22 });
    expect(res.status).toBe(401);
  });

  it('returns 400 when body has no sensor fields', async () => {
    const res = await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('accepts a valid sensor reading', async () => {
    const res = await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 22.5, humidity: 55, water_level: 80, battery_level: 90 });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.reading).toHaveProperty('temperature', 22.5);
  });

  it('accepts a partial reading (only temperature)', async () => {
    const res = await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 19 });
    expect(res.status).toBe(201);
    expect(res.body.reading.temperature).toBe(19);
  });
});

describe('GET /api/sensors/history', () => {
  it('returns 400 for invalid period', async () => {
    const res = await request(app).get('/api/sensors/history?period=bad');
    expect(res.status).toBe(400);
  });

  it('returns history grouped by day with readings array', async () => {
    // Insert a reading first
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 21, humidity: 50 });

    const res = await request(app).get('/api/sensors/history?period=1h');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('period', '1h');
    expect(Array.isArray(res.body.data)).toBe(true);

    // Each entry is a day object with a readings array
    const day = res.body.data[0];
    expect(day).toHaveProperty('day');
    expect(Array.isArray(day.readings)).toBe(true);
    expect(day.readings[0]).toHaveProperty('temperature');
    expect(day.readings[0]).toHaveProperty('time');
  });

  it('count reflects number of days, not readings', async () => {
    const res = await request(app).get('/api/sensors/history?period=24h');
    expect(res.status).toBe(200);
    // count is the number of day groups
    expect(res.body.count).toBe(res.body.data.length);
  });
});
