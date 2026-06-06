const http = require('http');
const WebSocket = require('ws');
const request = require('supertest');

process.env.API_KEY = 'test-key';

const app = require('../src/app');
const { initWebSocket, terminateAll } = require('../src/websocket');

let server;
let baseUrl;

beforeAll((done) => {
  server = http.createServer(app);
  initWebSocket(server);
  server.listen(0, () => {
    const { port } = server.address();
    baseUrl = `ws://localhost:${port}`;
    done();
  });
});

afterAll(async () => {
  terminateAll();
  // Wait for close events to fire before Jest tears down the environment
  await new Promise(r => setTimeout(r, 50));
  await new Promise(resolve => server.close(resolve));
});

/**
 * Opens a WebSocket connection that buffers messages arriving before
 * nextMessage() is called — prevents the race between server sending
 * 'connected' and the test registering its listener.
 */
function openWs(query = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/${query}`);
    const buffer = [];
    const waiting = [];

    ws.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString());
      if (waiting.length > 0) {
        waiting.shift()(parsed);
      } else {
        buffer.push(parsed);
      }
    });

    // Attach a helper that returns the next message, respecting the buffer
    ws.nextMessage = () =>
      new Promise((res) => {
        if (buffer.length > 0) {
          res(buffer.shift());
        } else {
          waiting.push(res);
        }
      });

    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

describe('WebSocket authentication', () => {
  it('rejects connection without apiKey', (done) => {
    const ws = new WebSocket(baseUrl);
    ws.on('unexpected-response', (req, res) => {
      expect(res.statusCode).toBe(401);
      done();
    });
    // ws may emit 'error' instead of 'unexpected-response' depending on version
    ws.on('error', () => done());
  });

  it('rejects connection with wrong apiKey', (done) => {
    const ws = new WebSocket(`${baseUrl}/?apiKey=wrong`);
    ws.on('unexpected-response', (req, res) => {
      expect(res.statusCode).toBe(401);
      done();
    });
    ws.on('error', () => done());
  });

  it('accepts connection with correct apiKey and receives connected message', async () => {
    const ws = await openWs('?apiKey=test-key');
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('connected');
    expect(msg.payload).toHaveProperty('message');
    ws.close();
  });
});

describe('WebSocket ping/pong', () => {
  it('responds to ping with pong', async () => {
    const ws = await openWs('?apiKey=test-key');
    await ws.nextMessage(); // consume 'connected'

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await ws.nextMessage();
    expect(pong.type).toBe('pong');
    ws.close();
  });
});

describe('WebSocket broadcast', () => {
  it('receives sensor_update after POST /api/sensors', async () => {
    const ws = await openWs('?apiKey=test-key');
    await ws.nextMessage(); // consume 'connected'

    // Post a sensor reading in parallel — triggers broadcast
    request(app).post('/api/sensors').send({ temperature: 23, humidity: 55 }).end(() => {});

    const update = await ws.nextMessage();
    expect(update.type).toBe('sensor_update');
    expect(update.payload).toHaveProperty('temperature', 23);
    ws.close();
  }, 10000);
});
