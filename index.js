require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const { initWebSocket } = require('./src/websocket');
const { startCronJobs, initialFetch } = require('./src/cron');

const PORT = process.env.PORT || 3001;

const server = http.createServer(app);

initWebSocket(server);
startCronJobs();

server.listen(PORT, async () => {
  console.log(`[server] VitalShell backend listening on port ${PORT}`);
  // Fetch APIs in the background after startup
  initialFetch().catch(err => console.error('[server] Initial fetch error:', err.message));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received — shutting down');
  server.close(() => {
    const { closeDb } = require('./src/db');
    closeDb();
    process.exit(0);
  });
});
