const { getDb } = require('../db');

function getComfort() {
  const db = getDb();
  return db.prepare('SELECT * FROM comfort WHERE id = 1').get();
}

function setComfort(prefs) {
  const db = getDb();
  const current = getComfort();
  const merged = {
    temperature_min: prefs.temperature_min ?? current.temperature_min,
    temperature_max: prefs.temperature_max ?? current.temperature_max,
    humidity_min:    prefs.humidity_min    ?? current.humidity_min,
    humidity_max:    prefs.humidity_max    ?? current.humidity_max,
  };

  db.prepare(`
    UPDATE comfort SET
      temperature_min = @temperature_min,
      temperature_max = @temperature_max,
      humidity_min    = @humidity_min,
      humidity_max    = @humidity_max,
      updated_at      = datetime('now')
    WHERE id = 1
  `).run(merged);

  return getComfort();
}

module.exports = { getComfort, setComfort };
