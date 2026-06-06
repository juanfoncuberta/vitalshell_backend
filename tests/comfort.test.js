const request = require('supertest');

process.env.API_KEY = 'test-key';

const app = require('../src/app');

describe('GET /api/comfort', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/comfort');
    expect(res.status).toBe(401);
  });

  it('returns default comfort preferences', async () => {
    const res = await request(app)
      .get('/api/comfort')
      .set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('temperature_min');
    expect(res.body).toHaveProperty('temperature_max');
    expect(res.body).toHaveProperty('humidity_min');
    expect(res.body).toHaveProperty('humidity_max');
  });
});

describe('POST /api/comfort', () => {
  it('updates preferences', async () => {
    const res = await request(app)
      .post('/api/comfort')
      .set('X-API-Key', 'test-key')
      .send({ temperature_min: 19, temperature_max: 24 });
    expect(res.status).toBe(200);
    expect(res.body.temperature_min).toBe(19);
    expect(res.body.temperature_max).toBe(24);
  });

  it('returns 400 when min >= max temperature', async () => {
    const res = await request(app)
      .post('/api/comfort')
      .set('X-API-Key', 'test-key')
      .send({ temperature_min: 25, temperature_max: 20 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when min >= max humidity', async () => {
    const res = await request(app)
      .post('/api/comfort')
      .set('X-API-Key', 'test-key')
      .send({ humidity_min: 70, humidity_max: 50 });
    expect(res.status).toBe(400);
  });

  it('allows partial updates', async () => {
    const res = await request(app)
      .post('/api/comfort')
      .set('X-API-Key', 'test-key')
      .send({ humidity_min: 35 });
    expect(res.status).toBe(200);
    expect(res.body.humidity_min).toBe(35);
  });
});
