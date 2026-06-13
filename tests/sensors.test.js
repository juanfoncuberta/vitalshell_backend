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

  it('returns flat aggregated points with timestamp and sensor averages', async () => {
    // Insert a reading first
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 21, humidity: 50 });

    const res = await request(app).get('/api/sensors/history?period=1h');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('period', '1h');
    expect(Array.isArray(res.body.data)).toBe(true);

    const point = res.body.data[0];
    expect(point).toHaveProperty('timestamp');
    expect(point.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(point).toHaveProperty('temperature');
    expect(point).toHaveProperty('humidity');
    expect(point).toHaveProperty('water_level');
    expect(point).toHaveProperty('battery_level');
    expect(point).not.toHaveProperty('id');
    expect(point).not.toHaveProperty('created_at');
    expect(point).not.toHaveProperty('intervals');
  });

  it('count reflects number of aggregated points', async () => {
    const res = await request(app).get('/api/sensors/history?period=24h');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.data.length);
  });

  it('forward-fills null fields from the last non-null value in earlier buckets', async () => {
    const now = Date.now();

    // Bucket A (2 min ago) — temperature only
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 29.9, timestamp: new Date(now - 2 * 60000).toISOString() });

    // Bucket B (1 min ago) — humidity only; temperature is null in this bucket
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ humidity: 55.5, timestamp: new Date(now - 1 * 60000).toISOString() });

    const res = await request(app).get('/api/sensors/history?period=1h');
    expect(res.status).toBe(200);

    // The bucket that received only humidity should have temperature forward-filled
    const bucketB = res.body.data.find(p => p.humidity === 55.5);
    expect(bucketB).toBeDefined();
    expect(bucketB.temperature).toBe(29.9);
  });

  it('seeds forward-fill from data before the query window', async () => {
    const now = Date.now();

    // Reading outside the 1h window — sets a known temperature
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ temperature: 18.3, timestamp: new Date(now - 90 * 60000).toISOString() });

    // Reading inside the 1h window — no temperature, only humidity
    await request(app)
      .post('/api/sensors')
      .set('X-API-Key', 'test-key')
      .send({ humidity: 42.0, timestamp: new Date(now - 10 * 60000).toISOString() });

    const res = await request(app).get('/api/sensors/history?period=1h');
    expect(res.status).toBe(200);

    // The first bucket in the window has no temperature reading,
    // so it should be filled from the pre-window value (18.3)
    const firstInWindow = res.body.data.find(p => p.humidity === 42.0);
    expect(firstInWindow).toBeDefined();
    expect(firstInWindow.temperature).toBe(18.3);
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
      return r.body.data.length;
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
