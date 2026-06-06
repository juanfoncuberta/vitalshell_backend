const { WebSocketServer } = require('ws');

const VALID_MESSAGE_TYPES = [
  'sensor_update',
  'environmental_update',
  'air_quality_update',
  'rule_update',
  'metrics_update',
  'alert',
  'health_update',
];

let wss = null;

/**
 * Attaches a WebSocket server to an existing HTTP server.
 * Clients must authenticate via ?apiKey=<key> in the URL.
 */
function initWebSocket(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    // Use WHATWG URL with a dummy base so relative URLs parse correctly
    const url = new URL(req.url, 'http://localhost');
    const apiKey = url.searchParams.get('apiKey');
    if (!apiKey || apiKey !== process.env.API_KEY) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    console.log(`[ws] Client connected (${wss.clients.size} total)`);

    // Send welcome with current timestamp
    safeSend(ws, 'connected', {
      message:   'VitalShell WebSocket ready',
      timestamp: new Date().toISOString(),
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleClientMessage(ws, msg);
      } catch {
        safeSend(ws, 'error', { message: 'Invalid JSON' });
      }
    });

    ws.on('close', () => {
      if (wss) console.log(`[ws] Client disconnected (${wss.clients.size} remaining)`);
    });

    ws.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
    });
  });

  console.log('[ws] WebSocket server ready');
  return wss;
}

function handleClientMessage(ws, msg) {
  if (msg.type === 'ping') {
    safeSend(ws, 'pong', { timestamp: new Date().toISOString() });
  }
  // Extend here for client-initiated commands
}

function safeSend(ws, type, payload) {
  if (ws.readyState !== 1 /* OPEN */) return;
  try {
    ws.send(JSON.stringify({ type, payload, timestamp: new Date().toISOString() }));
  } catch (err) {
    console.error('[ws] Send error:', err.message);
  }
}

/**
 * Broadcast a typed message to all authenticated connected clients.
 * Safe to call even before initWebSocket (no-op if wss is null).
 */
function broadcast(type, payload) {
  if (!wss) return;
  if (!VALID_MESSAGE_TYPES.includes(type)) {
    console.warn(`[ws] Unknown broadcast type: ${type}`);
  }
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      try { client.send(message); sent++; } catch { /* skip dead socket */ }
    }
  });
  if (sent > 0) console.log(`[ws] Broadcast "${type}" → ${sent} client(s)`);
}

function getClientCount() {
  return wss ? wss.clients.size : 0;
}

function terminateAll() {
  if (!wss) return;
  wss.clients.forEach((client) => client.terminate());
}

module.exports = { initWebSocket, broadcast, getClientCount, terminateAll };
