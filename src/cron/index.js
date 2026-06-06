const cron = require('node-cron');
const {
  fetchREData,
  fetchWeather,
  fetchAirQuality,
  fetchEFFIS,
  fetchAEMET,
  fetchNASAPower,
  getAllCached,
} = require('../services/apis');
const { getLatestReading } = require('../services/sensors');
const { runRulesEngine } = require('../services/rules');
const { broadcast } = require('../websocket');

// Re-run rules after an API fetch and broadcast any new rules
async function refreshAndEvaluate(label, fetchFn, wsType) {
  console.log(`[cron] Fetching ${label}...`);
  try {
    const result = await fetchFn();
    if (result && wsType) broadcast(wsType, result);

    // Re-evaluate rules with latest sensor reading + full API cache
    const sensor  = getLatestReading();
    const apiData = getAllCached();
    const newRules = runRulesEngine(sensor, apiData);
    newRules.forEach(rule => broadcast('rule_update', rule));

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
    fetchAEMET(),
    fetchNASAPower(),
  ]);
  console.log('[cron] Initial fetch complete');
}

module.exports = { startCronJobs, initialFetch };
