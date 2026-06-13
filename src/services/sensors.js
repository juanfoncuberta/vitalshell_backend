const { getDb } = require('../db');

let heartbeatAt = null;

function loadLastKnownFromDb() {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      (SELECT temperature   FROM sensors WHERE temperature   IS NOT NULL ORDER BY id DESC LIMIT 1) AS temperature,
      (SELECT humidity      FROM sensors WHERE humidity      IS NOT NULL ORDER BY id DESC LIMIT 1) AS humidity,
      (SELECT water_level   FROM sensors WHERE water_level   IS NOT NULL ORDER BY id DESC LIMIT 1) AS water_level,
      (SELECT battery_level FROM sensors WHERE battery_level IS NOT NULL ORDER BY id DESC LIMIT 1) AS battery_level
  `).get();
  return {
    temperature:   row?.temperature   ?? null,
    humidity:      row?.humidity      ?? null,
    water_level:   row?.water_level   ?? null,
    battery_level: row?.battery_level ?? null,
  };
}

let lastKnown = loadLastKnownFromDb();

function setHeartbeat() {
  heartbeatAt = new Date();
}

function getLastKnown() {
  return { ...lastKnown };
}

function getLastSeenAt() {
  const db = getDb();
  const row = db.prepare('SELECT created_at FROM sensors ORDER BY id DESC LIMIT 1').get();
  const dbDate = row ? new Date(row.created_at) : null;
  if (!dbDate && !heartbeatAt) return null;
  if (!dbDate) return heartbeatAt;
  if (!heartbeatAt) return dbDate;
  return heartbeatAt > dbDate ? heartbeatAt : dbDate;
}

const PERIOD_SECONDS = {
  '1h':  3600,
  '24h': 86400,
  '7d':  604800,
};

// Use hardware timestamp when available, fall back to server receipt time
const TS = `COALESCE(timestamp, created_at)`;

// SQL expression that truncates the effective timestamp to the aggregation bucket for each period
const BUCKET_SQL = {
  '1h':  `strftime('%Y-%m-%dT%H:%M', ${TS})`,
  '24h': `strftime('%Y-%m-%dT%H:', ${TS}) || printf('%02d', (CAST(strftime('%M', ${TS}) AS INTEGER) / 15) * 15)`,
  '7d':  `strftime('%Y-%m-%dT%H:00', ${TS})`,
};

function saveReading(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sensors (temperature, humidity, water_level, battery_level, timestamp)
    VALUES (@temperature, @humidity, @water_level, @battery_level, @timestamp)
  `);
  stmt.run({
    temperature:   data.temperature   ?? null,
    humidity:      data.humidity      ?? null,
    water_level:   data.water_level   ?? null,
    battery_level: data.battery_level ?? null,
    timestamp:     data.timestamp     ?? new Date().toISOString(),
  });

  for (const field of ['temperature', 'humidity', 'water_level', 'battery_level']) {
    if (data[field] !== null && data[field] !== undefined) {
      lastKnown[field] = data[field];
    }
  }

  return getLatestReading();
}

function getLatestReading() {
  const db = getDb();
  return db.prepare('SELECT * FROM sensors ORDER BY id DESC LIMIT 1').get() ?? null;
}

function getHistory(period = '24h') {
  const db = getDb();
  const seconds = PERIOD_SECONDS[period] ?? PERIOD_SECONDS['24h'];
  const since  = new Date(Date.now() - seconds * 1000).toISOString();
  const bucket = BUCKET_SQL[period] ?? BUCKET_SQL['24h'];

  // Seed forward-fill with the last known value for each field before the window
  const seed = db.prepare(`
    SELECT
      (SELECT temperature   FROM sensors WHERE temperature   IS NOT NULL AND datetime(${TS}) < datetime(?) ORDER BY id DESC LIMIT 1) AS temperature,
      (SELECT humidity      FROM sensors WHERE humidity      IS NOT NULL AND datetime(${TS}) < datetime(?) ORDER BY id DESC LIMIT 1) AS humidity,
      (SELECT water_level   FROM sensors WHERE water_level   IS NOT NULL AND datetime(${TS}) < datetime(?) ORDER BY id DESC LIMIT 1) AS water_level,
      (SELECT battery_level FROM sensors WHERE battery_level IS NOT NULL AND datetime(${TS}) < datetime(?) ORDER BY id DESC LIMIT 1) AS battery_level
  `).get(since, since, since, since);

  const rows = db.prepare(`
    SELECT
      ${bucket}                          AS timestamp,
      ROUND(AVG(temperature),   1)       AS temperature,
      ROUND(AVG(humidity),      1)       AS humidity,
      ROUND(AVG(water_level),   1)       AS water_level,
      ROUND(AVG(battery_level), 1)       AS battery_level
    FROM sensors
    WHERE datetime(${TS}) >= datetime(?)
    GROUP BY ${bucket}
    ORDER BY timestamp ASC
  `).all(since);

  const FIELDS = ['temperature', 'humidity', 'water_level', 'battery_level'];
  const last = Object.fromEntries(FIELDS.map(f => [f, seed?.[f] ?? null]));

  for (const row of rows) {
    for (const f of FIELDS) {
      if (row[f] !== null) {
        last[f] = row[f];
      } else {
        row[f] = last[f];
      }
    }
  }

  return rows;
}

function isOnline() {
  const db = getDb();
  const latest = db.prepare('SELECT created_at FROM sensors ORDER BY id DESC LIMIT 1').get();
  if (!latest) return false;
  const diffMs = Date.now() - new Date(latest.created_at).getTime();
  // Consider online if a reading arrived in the last 10 minutes
  return diffMs < 10 * 60 * 1000;
}

module.exports = { saveReading, getLatestReading, getHistory, isOnline, setHeartbeat, getLastSeenAt, getLastKnown };
