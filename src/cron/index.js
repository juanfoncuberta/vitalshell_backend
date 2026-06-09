const cron = require('node-cron');
const {
  fetchREData,
  fetchWeather,
  fetchAirQuality,
  fetchEFFIS,
  fetchFWI,
  fetchAEMET,
  fetchNASAPower,
  getAllCached,
} = require('../services/apis');
const { getLatestReading } = require('../services/sensors');
const { runRulesEngine } = require('../services/rules');
const { evaluateAlerts } = require('../services/alerts');
const { broadcast } = require('../websocket');

function withFutureHourly(result) {
  const hourly = result?.hourly_forecast;
  const now    = result?.current_local_time;
  if (!hourly?.time || !now) return result;

  const indices = hourly.time.map((_, i) => i).filter(i => hourly.time[i] > now);
  const filtered = {};
  for (const key of Object.keys(hourly)) {
    filtered[key] = Array.isArray(hourly[key]) ? indices.map(i => hourly[key][i]) : hourly[key];
  }
  return { ...result, hourly_forecast: filtered };
}

// Re-run rules after an API fetch and broadcast any new rules
async function refreshAndEvaluate(label, fetchFn, wsType) {
  console.log(`[cron] Fetching ${label}...`);
  try {
    const result = await fetchFn();
    if (result && wsType) {
      const payload = wsType === 'environmental_update' ? withFutureHourly(result) : result;
      broadcast(wsType, payload);
    }

    // Re-evaluate rules with latest sensor reading + full API cache
    const sensor  = getLatestReading();
    const apiData = getAllCached();
    const newRules = runRulesEngine(sensor, apiData);
    newRules.forEach(rule => broadcast('rule_update', rule));

    const newAlerts = evaluateAlerts(sensor, apiData);
    newAlerts.forEach(alert => broadcast('alert', alert));

    console.log(`[cron] ${label} updated. New rules: ${newRules.length}`);
  } catch (err) {
    console.error(`[cron] ${label} error:`, err.message);
  }
}

function startCronJobs() {
  // Every 5 min — REData (energy mix, renewables %)
  cron.schedule('*/5 * * * *', () => {
    refreshAndEvaluate('REData', fetchREData, 'metrics_update');
  });

  // Every 15 min — Open-Meteo weather
  cron.schedule('*/15 * * * *', () => {
    refreshAndEvaluate('Weather', fetchWeather, 'environmental_update');
  });

  // Every 15 min (offset 5) — Open-Meteo Air Quality
  cron.schedule('5,20,35,50 * * * *', () => {
    refreshAndEvaluate('Air Quality', fetchAirQuality, 'air_quality_update');
  });

  // Every 15 min (offset 10) — EFFIS fire risk
  cron.schedule('10,25,40,55 * * * *', () => {
    refreshAndEvaluate('EFFIS', fetchEFFIS, null);
  });

  // Every 30 min — Fire Weather Index (Open-Meteo FD)
  cron.schedule('*/30 * * * *', () => {
    refreshAndEvaluate('FWI', fetchFWI, null);
  });

  // Every 15 min (offset 2) — AEMET
  cron.schedule('2,17,32,47 * * * *', () => {
    refreshAndEvaluate('AEMET', fetchAEMET, 'environmental_update');
  });

  // Daily at 06:00 — NASA POWER solar irradiance
  cron.schedule('0 6 * * *', () => {
    refreshAndEvaluate('NASA POWER', fetchNASAPower, 'metrics_update');
  });

  // Periodic health broadcast every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    const { isOnline } = require('../services/sensors');
    broadcast('health_update', {
      sensor_online:  isOnline(),
      clients:        require('../websocket').getClientCount(),
      uptime_seconds: Math.round(process.uptime()),
    });

    const sensor  = getLatestReading();
    const apiData = getAllCached();
    const newAlerts = evaluateAlerts(sensor, apiData);
    newAlerts.forEach(alert => broadcast('alert', alert));
  });

  console.log('[cron] All jobs scheduled');
}

// Do an initial fetch on startup (non-blocking)
async function initialFetch() {
  console.log('[cron] Running initial API fetches...');
  await Promise.allSettled([
    fetchWeather(),
    fetchAirQuality(),
    fetchREData(),
    fetchEFFIS(),
    fetchFWI(),
    fetchAEMET(),
    fetchNASAPower(),
  ]);
  console.log('[cron] Initial fetch complete');
}

module.exports = { startCronJobs, initialFetch };
