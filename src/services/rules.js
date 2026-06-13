const { getDb } = require('../db');

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['pending', 'active', 'completed', 'disabled', 'inactive'];

// SQLite stores datetime('now') as "2026-06-07 14:00:00" (UTC, no Z).
// Convert every rule row to proper ISO8601 before returning it.
function formatRule(row) {
  if (!row) return null;
  return {
    ...row,
    created_at: row.created_at ? new Date(row.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at.replace(' ', 'T') + 'Z').toISOString() : null,
  };
}

const PERIOD_SECONDS = {
  '1h':  3600,
  '24h': 86400,
  '7d':  604800,
};

function listRules({ limit = 20, offset = 0 } = {}) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM rules
    WHERE status IN ('active', 'pending')
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset)).map(formatRule);
}

function listRulesHistory({ period = '24h', limit = 20 } = {}) {
  const db = getDb();
  const seconds = PERIOD_SECONDS[period] ?? PERIOD_SECONDS['24h'];
  const since = new Date(Date.now() - seconds * 1000).toISOString();

  return db.prepare(`
    SELECT * FROM rules
    WHERE status = 'completed' AND datetime(updated_at) >= datetime(?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(since, Number(limit)).map(formatRule);
}

function updateRuleStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  const db = getDb();
  const info = db.prepare(`
    UPDATE rules SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, Number(id));

  if (info.changes === 0) return null;
  return formatRule(db.prepare('SELECT * FROM rules WHERE id = ?').get(Number(id)));
}

function createRule(rule) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO rules (condition, action, description, affected_layer, status, duration_hours, trigger_source)
    VALUES (@condition, @action, @description, @affected_layer, @status, @duration_hours, @trigger_source)
  `).run({
    condition:      rule.condition,
    action:         rule.action,
    description:    rule.description    ?? null,
    affected_layer: rule.affected_layer ?? null,
    status:         rule.status         ?? 'pending',
    duration_hours: rule.duration_hours ?? null,
    trigger_source: rule.trigger_source ?? null,
  });
  return formatRule(db.prepare('SELECT * FROM rules WHERE id = ?').get(info.lastInsertRowid));
}

// ---------------------------------------------------------------------------
// Dummy AI rules engine
// Evaluates sensor data + external API cache and generates rules reactively.
// ---------------------------------------------------------------------------

/**
 * Evaluates conditions and returns a list of rule descriptors to upsert.
 * "Dummy AI" means the logic is deterministic/heuristic, not ML-based.
 */
function evaluateRules(sensorData, apiData) {
  const candidates = [];
  const now = new Date();

  const temp      = sensorData?.temperature;
  const humidity  = sensorData?.humidity;
  const waterLvl  = sensorData?.water_level;
  const battery   = sensorData?.battery_level;

  const extTemp   = apiData?.weather?.temperature;
  const aqi       = apiData?.air_quality?.european_aqi;
  const fireRisk  = apiData?.effis?.fire_risk;
  const renewPct  = apiData?.redata?.renewables_percent;
  const irradiance = apiData?.nasa_power?.irradiance_kwh_m2;

  // --- Temperature-based rules ---
  if (temp !== null && temp !== undefined) {
    if (temp > 28) {
      candidates.push({
        condition:      `interior_temp > 28 (current: ${temp}°C)`,
        action:         'activate_ventilation',
        description:    'Temperatura interior elevada — activar ventilación',
        affected_layer: 'ventilation',
        trigger_source: 'sensor',
        duration_hours: 2,
      });
    }
    if (temp < 16) {
      candidates.push({
        condition:      `interior_temp < 16 (current: ${temp}°C)`,
        action:         'activate_heating',
        description:    'Temperatura interior baja — activar calefacción',
        affected_layer: 'heating',
        trigger_source: 'sensor',
        duration_hours: 3,
      });
    }
  }

  // --- Humidity-based rules ---
  if (humidity !== null && humidity !== undefined) {
    if (humidity > 75) {
      candidates.push({
        condition:      `humidity > 75% (current: ${humidity}%)`,
        action:         'activate_dehumidifier',
        description:    'Humedad excesiva — activar deshumidificador',
        affected_layer: 'humidity_control',
        trigger_source: 'sensor',
        duration_hours: 1,
      });
    }
    if (humidity < 25) {
      candidates.push({
        condition:      `humidity < 25% (current: ${humidity}%)`,
        action:         'activate_humidifier',
        description:    'Humedad muy baja — activar humidificador',
        affected_layer: 'humidity_control',
        trigger_source: 'sensor',
        duration_hours: 1,
      });
    }
  }

  // --- Water level ---
  if (waterLvl !== null && waterLvl !== undefined) {
    if (waterLvl < 15) {
      candidates.push({
        condition:      `water_level < 15% (current: ${waterLvl}%)`,
        action:         'alert_low_water',
        description:    'Nivel de agua crítico — reponer depósito',
        affected_layer: 'water_system',
        trigger_source: 'sensor',
        duration_hours: null,
      });
    }
  }

  // --- Battery ---
  if (battery !== null && battery !== undefined) {
    if (battery < 20) {
      candidates.push({
        condition:      `battery < 20% (current: ${battery}%)`,
        action:         'alert_low_battery',
        description:    'Batería baja — conectar cargador',
        affected_layer: 'power',
        trigger_source: 'sensor',
        duration_hours: null,
      });
    }
  }

  // --- External temperature ---
  if (extTemp !== null && extTemp !== undefined) {
    if (extTemp > 35) {
      candidates.push({
        condition:      `exterior_temp > 35°C (current: ${extTemp}°C)`,
        action:         'close_blinds',
        description:    'Calor exterior extremo — cerrar persianas',
        affected_layer: 'solar_protection',
        trigger_source: 'weather_api',
        duration_hours: 4,
      });
    }
    if (extTemp < 0) {
      candidates.push({
        condition:      `exterior_temp < 0°C (current: ${extTemp}°C)`,
        action:         'insulate_pipes',
        description:    'Riesgo de helada — proteger tuberías',
        affected_layer: 'water_system',
        trigger_source: 'weather_api',
        duration_hours: 8,
      });
    }
  }

  // --- Air quality ---
  if (aqi !== null && aqi !== undefined) {
    if (aqi > 100) {
      candidates.push({
        condition:      `european_aqi > 100 (current: ${aqi})`,
        action:         'close_windows',
        description:    'Calidad del aire mala — cerrar ventanas',
        affected_layer: 'ventilation',
        trigger_source: 'air_quality_api',
        duration_hours: 3,
      });
    }
  }

  // --- Fire risk ---
  if (fireRisk === 'high') {
    candidates.push({
      condition:      'fire_risk = high (EFFIS)',
      action:         'alert_fire_risk',
      description:    'Riesgo de incendio forestal en la zona',
      affected_layer: 'safety',
      trigger_source: 'effis_api',
      duration_hours: 12,
    });
  }

  // --- Renewables — shift load to green windows ---
  if (renewPct !== null && renewPct !== undefined) {
    if (renewPct >= 60) {
      candidates.push({
        condition:      `renewables_percent >= 60% (current: ${renewPct}%)`,
        action:         'shift_load_to_now',
        description:    'Alto porcentaje renovable — buen momento para consumir',
        affected_layer: 'energy_management',
        trigger_source: 'redata_api',
        duration_hours: 1,
      });
    }
  }

  // --- Solar irradiance ---
  if (irradiance !== null && irradiance !== undefined) {
    if (irradiance > 5) {
      candidates.push({
        condition:      `solar_irradiance > 5 kWh/m² (current: ${irradiance})`,
        action:         'activate_solar_charging',
        description:    'Alta irradiancia solar — cargar baterías/depósito solar',
        affected_layer: 'energy_management',
        trigger_source: 'nasa_power_api',
        duration_hours: 6,
      });
    }
  }

  return candidates;
}

/**
 * Runs the rules engine and persists any new non-duplicate rules.
 * Called reactively after every sensor update or API fetch.
 */
function runRulesEngine(sensorData, apiData) {
  const db = getDb();
  const candidates = evaluateRules(sensorData, apiData);
  const created = [];

  for (const candidate of candidates) {
    const existing = db.prepare(`
      SELECT id FROM rules WHERE action = ? AND status IN ('active', 'pending') LIMIT 1
    `).get(candidate.action);

    if (existing) {
      db.prepare(`UPDATE rules SET updated_at = datetime('now') WHERE id = ?`).run(existing.id);
    } else {
      const rule = createRule({ ...candidate, status: 'pending' });
      created.push(rule);
    }
  }

  return created;
}

module.exports = {
  listRules,
  listRulesHistory,
  updateRuleStatus,
  createRule,
  runRulesEngine,
  evaluateRules,
};
