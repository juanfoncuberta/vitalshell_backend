const { getLastSeenAt } = require('./sensors');

const DEFINITIONS = {
  water_empty: {
    level:          'danger',
    message:        'Depósito de agua crítico. Nivel por debajo del 15%.',
    affected_layer: 2,
    source:         null,
  },
  battery_critical: {
    level:          'danger',
    message:        'Batería del dispositivo crítica. Nivel por debajo del 15%.',
    affected_layer: null,
    source:         null,
  },
  sensors_disconnected: {
    level:          'danger',
    message:        'Sensores desconectados. Sin datos en los últimos 2 minutos.',
    affected_layer: null,
    source:         null,
  },
  fire_risk_extreme: {
    level:          'danger',
    message:        'Riesgo de incendio extremo. Índice FWI por encima de 38.',
    affected_layer: null,
    source:         null,
  },
};

// In-memory deduplication: only fires when a code transitions to active
const activeAlerts = new Set();

function check(code, condition) {
  if (condition) {
    if (activeAlerts.has(code)) return null;
    activeAlerts.add(code);
    return { code, ...DEFINITIONS[code] };
  }
  activeAlerts.delete(code);
  return null;
}

function evaluateAlerts(sensorData, apiData) {
  const alerts = [];

  const waterLevel = sensorData?.water_level;
  if (waterLevel !== null && waterLevel !== undefined) {
    const a = check('water_empty', waterLevel < 15);
    if (a) alerts.push(a);
  }

  const battery = sensorData?.battery_level;
  if (battery !== null && battery !== undefined) {
    const a = check('battery_critical', battery < 15);
    if (a) alerts.push(a);
  }

  const lastSeenAt = getLastSeenAt();
  const disconnected = !lastSeenAt || (Date.now() - lastSeenAt.getTime()) > 2 * 60 * 1000;
  const a = check('sensors_disconnected', disconnected);
  if (a) alerts.push(a);

  const fwiValue = apiData?.effis?.fwi_today ?? apiData?.fwi?.fwi_today ?? null;
  if (fwiValue !== null && fwiValue !== undefined) {
    const a = check('fire_risk_extreme', fwiValue > 38);
    if (a) alerts.push(a);
  }

  return alerts;
}

// Exposed for testing
function _resetActiveAlerts() {
  activeAlerts.clear();
}

module.exports = { evaluateAlerts, _resetActiveAlerts };
