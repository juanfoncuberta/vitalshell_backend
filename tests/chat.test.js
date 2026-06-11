const request = require('supertest');

// Mocks must be set up before requiring the app, because chat.js calls
// `new Anthropic()` at module-load time and captures the instance.
jest.mock('axios');
jest.mock('@anthropic-ai/sdk');

process.env.API_KEY = 'test-key';

const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

// Single persistent mock function — chat.js will hold a reference to this
// via the client object created at load time.
const mockCreate = jest.fn();
Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));

const FAKE_DATA = { timestamp: '2026-01-01T00:00:00Z', sensors: {} };
const FAKE_REPLY = 'Mi temperatura interior es 22°C, todo en orden.';

// App is required after mocks are in place
const app = require('../src/app');

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: FAKE_DATA });
  mockCreate.mockResolvedValue({ content: [{ text: FAKE_REPLY }] });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/chat — auth', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).post('/api/chat').send({ message: 'hola' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong API key', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('X-API-Key', 'bad-key')
      .send({ message: 'hola' });
    expect(res.status).toBe(401);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /api/chat — validation', () => {
  it('returns 400 when message is missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('X-API-Key', 'test-key')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when message is not a string', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('X-API-Key', 'test-key')
      .send({ message: 42 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/chat — success', () => {
  it('returns { reply } on a valid request', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('X-API-Key', 'test-key')
      .send({ message: '¿Cómo estás?' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: FAKE_REPLY });
  });

  it('fetches /api/data internally with the correct API key', async () => {
    await request(app)
      .post('/api/chat')
      .set('X-API-Key', 'test-key')
      .send({ message: 'temperatura' });

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/data'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
      })
    );
  });

  it('injects system data into the Anthropic call', async () => {
    await request(app)
      .post('/api/chat')
      .set('X-API-Key', 'test-key')
      .send({ message: '¿Cómo está el sistema?' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5-20251001');
    expect(call.max_tokens).toBe(300);
    expect(call.system).toContain(FAKE_DATA.timestamp);
    expect(call.messages[0]).toEqual({ role: 'user', content: '¿Cómo está el sistema?' });
  });
});

// ── Resilience ────────────────────────────────────────────────────────────────

describe('POST /api/chat — resilience', () => {
  it('still calls Anthropic if /api/data fetch fails', async () => {
    axios.get.mockRejectedValueOnce(new Error('network error'));

    const res = await request(app)
      .post('/api/chat')
      .set('X-API-Key', 'test-key')
      .send({ message: 'hola' });

    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('returns 502 when Anthropic throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));

    const res = await request(app)
      .post('/api/chat')
      .set('X-API-Key', 'test-key')
      .send({ message: 'hola' });

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty('error');
  });
});
