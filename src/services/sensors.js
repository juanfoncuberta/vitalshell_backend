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

  if (period === '7d') {
    // Group by calendar day
    return db.prepare(`
      SELECT
        date(created_at) AS day,
        ROUND(AVG(temperature), 2)   AS avg_temperature,
        ROUND(AVG(humidity), 2)      AS avg_humidity,
        ROUND(AVG(water_level), 2)   AS avg_water_level,
        ROUND(AVG(battery_level), 2) AS avg_battery_level,
        COUNT(*) AS count
      FROM sensors
      WHERE created_at >= ?
      GROUP BY day
      ORDER BY day ASC
    `).all(since);
  }

  // For 1h / 24h return raw rows
  return db.prepare(`
    SELECT * FROM sensors
    WHERE created_at >= ?
    ORDER BY created_at ASC
  `).all(since);
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
