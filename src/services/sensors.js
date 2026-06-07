const { getDb } = require('../db');

const PERIOD_SECONDS = {
  '1h':  3600,
  '24h': 86400,
  '7d':  604800,
};

function saveReading(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sensors (temperature, humidity, water_level, battery_level, timestamp)
    VALUES (@temperature, @humidity, @water_level, @battery_level, @timestamp)
  `);
  const info = stmt.run({
    temperature:   data.temperature   ?? null,
    humidity:      data.humidity      ?? null,
    water_level:   data.water_level   ?? null,
    battery_level: data.battery_level ?? null,
    timestamp:     data.timestamp     ?? new Date().toISOString(),
  });
  return getLatestReading();
}

function getLatestReading() {
  const db = getDb();
  return db.prepare('SELECT * FROM sensors ORDER BY id DESC LIMIT 1').get() ?? null;
}

function getHistory(period = '24h') {
  const db = getDb();
  const seconds = PERIOD_SECONDS[period] ?? PERIOD_SECONDS['24h'];
  const since = new Date(Date.now() - seconds * 1000).toISOString();

  // Fetch all rows with their day and time extracted
  const rows = db.prepare(`
    SELECT
      date(created_at)                 AS date,
      strftime('%H:%M:%S', created_at) AS time,
      temperature,
      humidity,
      water_level,
      battery_level
    FROM sensors
    WHERE datetime(created_at) >= datetime(?)
    ORDER BY created_at ASC
  `).all(since);

  // Group intervals by calendar date
  const dateMap = {};
  for (const { date, ...interval } of rows) {
    if (!dateMap[date]) dateMap[date] = { date, intervals: [] };
    dateMap[date].intervals.push(interval);
  }

  return Object.values(dateMap);
}

function isOnline() {
  const db = getDb();
  const latest = db.prepare('SELECT created_at FROM sensors ORDER BY id DESC LIMIT 1').get();
  if (!latest) return false;
  const diffMs = Date.now() - new Date(latest.created_at).getTime();
  // Consider online if a reading arrived in the last 10 minutes
  return diffMs < 10 * 60 * 1000;
}

module.exports = { saveReading, getLatestReading, getHistory, isOnline };
