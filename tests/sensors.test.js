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

    // Each entry is a date object with an intervals array
    const day = res.body.data[0];
    expect(day).toHaveProperty('date');
    expect(Array.isArray(day.intervals)).toBe(true);
    expect(day.intervals[0]).toHaveProperty('temperature');
    expect(day.intervals[0]).toHaveProperty('time');
    expect(day.intervals[0].time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(day.intervals[0]).not.toHaveProperty('id');
    expect(day.intervals[0]).not.toHaveProperty('created_at');
  });

  it('count reflects number of days, not readings', async () => {
    const res = await request(app).get('/api/sensors/history?period=24h');
    expect(res.status).toBe(200);
    // count is the number of day groups
    expect(res.body.count).toBe(res.body.data.length);
  });
});

describe('POST /api/sensors/heartbeat', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).post('/api/sensors/heartbeat');
    expect(res.status).toBe(401);
  });

  it('returns { ok: true } with valid API key', async () => {
    const res = await request(app)
      .post('/api/sensors/heartbeat')
      .set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('does not write a new row to SQLite', async () => {
    const countIntervals = async () => {
      const r = await request(app).get('/api/sensors/history?period=1h');
      return r.body.data.reduce((n, day) => n + day.intervals.length, 0);
    };

    const before = await countIntervals();
    await request(app)
      .post('/api/sensors/heartbeat')
      .set('X-API-Key', 'test-key');
    const after = await countIntervals();

    expect(after).toBe(before);
  });
});

describe('POST /api/sensors — partial fields', () => {
  it('accepts a reading with only one field', async () => {
    const res = await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ humidity: 77 });
    expect(res.status).toBe(201);
    expect(res.body.reading.humidity).toBe(77);
  });

  it('stores null in SQLite for fields not sent', async () => {
    const res = await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ water_level: 50 });
    expect(res.status).toBe(201);
    expect(res.body.reading.water_level).toBe(50);
    expect(res.body.reading.temperature).toBeNull();
    expect(res.body.reading.humidity).toBeNull();
    expect(res.body.reading.battery_level).toBeNull();
  });
});
