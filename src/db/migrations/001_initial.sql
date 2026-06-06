-- Sensor readings from hardware
CREATE TABLE IF NOT EXISTS sensors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  temperature   REAL,
  humidity      REAL,
  water_level   REAL,
  battery_level REAL,
  timestamp     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI rules (active, pending, completed, disabled)
CREATE TABLE IF NOT EXISTS rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  condition       TEXT    NOT NULL,
  action          TEXT    NOT NULL,
  description     TEXT,
  affected_layer  TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',
  duration_hours  REAL,
  trigger_source  TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- User comfort preferences
CREATE TABLE IF NOT EXISTS comfort (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  temperature_min REAL    NOT NULL DEFAULT 18,
  temperature_max REAL    NOT NULL DEFAULT 26,
  humidity_min    REAL    NOT NULL DEFAULT 30,
  humidity_max    REAL    NOT NULL DEFAULT 60,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Cache for external API responses
CREATE TABLE IF NOT EXISTS api_cache (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT    NOT NULL UNIQUE,
  data       TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Seed default comfort row
INSERT OR IGNORE INTO comfort (id, temperature_min, temperature_max, humidity_min, humidity_max)
VALUES (1, 18, 26, 30, 60);
