const express = require('express');
const router = express.Router();
const { getLastKnown, getLastSeenAt } = require('../services/sensors');
const { getAllCached } = require('../services/apis');
const { getComfort } = require('../services/comfort');

// ── Status helpers ───────────────────────────────────────────────────────────

function sensorStatus(field, value) {
  if (value === null || value === undefined) return 'unknown';
  switch (field) {
    case 'temperature':   return value < 30 ? 'ok' : value <= 35 ? 'warning' : 'danger';
    case 'humidity':      return value < 70 ? 'ok' : value <= 85 ? 'warning' : 'danger';
    case 'water_level':   return value > 20 ? 'ok' : value >= 10 ? 'warning' : 'danger';
    case 'battery_level': return value > 30 ? 'ok' : value >= 15 ? 'warning' : 'danger';
    default: return 'ok';
  }
}

function envStatus(field, value) {
  if (value === null || value === undefined) return 'unknown';
  switch (field) {
    case 'ext_temperature': return value < 30 ? 'ok' : value <= 38 ? 'warning' : 'danger';
    case 'uv_index':        return value < 6  ? 'ok' : value <= 8  ? 'warning' : 'danger';
    case 'fire_risk_fwi':   return value < 11 ? 'ok' : value <= 21 ? 'warning' : 'danger';
    case 'renewables_pct':  return value > 50 ? 'ok' : value >= 30 ? 'warning' : 'danger';
    case 'co2_g_kwh':       return value < 200 ? 'ok' : value <= 400 ? 'warning' : 'danger';
    // 30-day accumulated deficit (mm): ok > -30, warning -30 to -60, danger < -60
    case 'water_balance_mm': return value > -30 ? 'ok' : value >= -60 ? 'warning' : 'danger';
    default: return 'ok';
  }
}

function aqiStatus(value) {
  if (value === null || value === undefined) return 'unknown';
  return value < 50 ? 'ok' : value <= 100 ? 'warning' : 'danger';
}

function metricStatus(field, value) {
  if (value === null || value === undefined) return 'unknown';
  switch (field) {
    case 'comfort_score':       return value > 70 ? 'ok' : value >= 40 ? 'warning' : 'danger';
    case 'water_autonomy_days': return value > 7  ? 'ok' : value >= 3  ? 'warning' : 'danger';
    default: return 'ok';
  }
}

// Shorthand: { value, status } object
function sv(value, status) {
  return { value: value ?? null, status };
}

// ── System health ────────────────────────────────────────────────────────────

function computeSensorsHealth(lastSeenAt) {
  if (!lastSeenAt) return { sensors_last_seen: null, sensors_status: 'danger' };
  const diffSec = (Date.now() - lastSeenAt.getTime()) / 1000;
  const status  = diffSec < 30 ? 'ok' : diffSec < 120 ? 'warning' : 'danger';
  return { sensors_last_seen: lastSeenAt.toISOString(), sensors_status: status };
}

function computeApisStatus(apis) {
  const required = ['weather', 'air_quality', 'redata'];
  const present  = required.filter(k => apis[k] !== null).length;
  if (present === required.length) return 'ok';
  if (present > 0) return 'degraded';
  return 'error';
}

// ── Calculated metrics ───────────────────────────────────────────────────────

function computeComfortScore(lastKnown, comfort) {
  if (!lastKnown || !comfort) return null;
  const { temperature: t, humidity: h } = lastKnown;
  if (t === null || h === null) return null;

  const tMid   = (comfort.temperature_min + comfort.temperature_max) / 2;
  const tRange = (comfort.temperature_max - comfort.temperature_min) / 2;
  const hMid   = (comfort.humidity_min + comfort.humidity_max) / 2;
  const hRange = (comfort.humidity_max - comfort.humidity_min) / 2;

  const outside = (v, mid, range) => Math.max(0, Math.abs(v - mid) - range);
  const tScore  = Math.max(0, 100 - (outside(t, tMid, tRange) / tRange) * 100);
  const hScore  = Math.max(0, 100 - (outside(h, hMid, hRange) / hRange) * 100);

  return Math.round((tScore + hScore) / 2);
}

// Assumes ~6.5% tank consumption per day
function computeWaterAutonomy(waterLevel) {
  if (waterLevel === null || waterLevel === undefined) return null;
  return Math.max(0, Math.round(waterLevel / 6.5));
}

// Estimate grid CO₂ intensity from renewable share
function estimateCO2(renewablesPct) {
  if (renewablesPct === null || renewablesPct === undefined) return null;
  return Math.round(400 - (renewablesPct / 100) * 380);
}

// Solar/battery/grid breakdown from irradiance and national renewable %
function computeEnergySource(nasaPower, renewablesPct) {
  const irr      = nasaPower?.irradiance_kwh_m2 ?? null;
  // NASA POWER uses -999 as fill value for missing days
  const validIrr = irr !== null && irr > 0 ? irr : null;
  const solarPct = validIrr !== null ? Math.min(75, Math.round(validIrr * 10)) : 40;
  const gridPct  = Math.max(5, Math.round((100 - (renewablesPct ?? 50)) * 0.25));
  const battPct  = Math.max(0, 100 - solarPct - gridPct);
  return { solar_pct: solarPct, battery_pct: battPct, grid_pct: gridPct };
}

// Daily savings assuming 20 kWh/day at 0.22 EUR/kWh, solar fraction
function computeSavingsToday(solarPct) {
  if (solarPct === null || solarPct === undefined) return null;
  return Math.round(solarPct / 100 * 20 * 0.22 * 100) / 100;
}

// ── Forecast builder ─────────────────────────────────────────────────────────

function buildForecast(weather) {
  const hourly      = weather?.hourly_forecast;
  const currentTime = weather?.current_local_time; // "2026-06-07T09:00" local
  if (!hourly?.time || !currentTime) return [];

  const entries = [];
  for (let i = 0; i < hourly.time.length && entries.length < 12; i++) {
    if (hourly.time[i] <= currentTime) continue;
    entries.push({
      timestamp:          hourly.time[i],
      temperature:        hourly.temperature_2m?.[i]          ?? null,
      humidity:           hourly.relative_humidity_2m?.[i]    ?? null,
      wind_kmh:           hourly.wind_speed_10m?.[i]          ?? null,
      precipitation_prob: hourly.precipitation_probability?.[i] ?? null,
      weather_code:       hourly.weather_code?.[i]            ?? null,
      source:             'open_meteo',
    });
  }
  return entries;
}

// ── Route ────────────────────────────────────────────────────────────────────

// GET /api/data
router.get('/', (req, res) => {
  const lastKnown  = getLastKnown();
  const lastSeenAt = getLastSeenAt();
  const apis       = getAllCached();
  const comfort    = getComfort();

  const sensorsHealth = computeSensorsHealth(lastSeenAt);
  const apisStatus    = computeApisStatus(apis);

  const weather   = apis.weather    ?? {};
  const aq        = apis.air_quality ?? {};
  const redata    = apis.redata     ?? {};
  const effis     = apis.effis      ?? {};
  const fwi       = apis.fwi        ?? {};
  const nasaPower = apis.nasa_power  ?? {};

  const renewablesPct = redata.renewables_percent ?? null;
  const co2           = estimateCO2(renewablesPct);
  // Prefer EFFIS FWI (real measurement) over weather-computed fallback
  const fwiValue      = effis.fwi_today ?? fwi.fwi_today ?? null;

  const comfortScore  = computeComfortScore(lastKnown, comfort);
  const waterAutonomy = computeWaterAutonomy(lastKnown.water_level);
  const energySource  = computeEnergySource(nasaPower, renewablesPct);
  const savingsToday  = computeSavingsToday(energySource.solar_pct);

  res.json({
    timestamp: new Date().toISOString(),

    system_health: {
      sensors_last_seen: sensorsHealth.sensors_last_seen,
      sensors_status:    sensorsHealth.sensors_status,
      apis_status:       apisStatus,
    },

    sensors: {
      temperature:   sv(lastKnown.temperature,   sensorStatus('temperature',   lastKnown.temperature)),
      humidity:      sv(lastKnown.humidity,       sensorStatus('humidity',      lastKnown.humidity)),
      water_level:   sv(lastKnown.water_level,    sensorStatus('water_level',   lastKnown.water_level)),
      battery_level: sv(lastKnown.battery_level,  sensorStatus('battery_level', lastKnown.battery_level)),
    },

    environmental_context: {
      current: {
        ext_temperature:  sv(weather.temperature, envStatus('ext_temperature', weather.temperature)),
        ext_humidity:     sv(weather.humidity,     'ok'),
        wind_kmh:         sv(weather.wind_speed,   'ok'),
        uv_index:         sv(weather.uv_index,     envStatus('uv_index',      weather.uv_index)),
        renewables_pct:   sv(renewablesPct,        envStatus('renewables_pct', renewablesPct)),
        co2_g_kwh:        sv(co2,                  envStatus('co2_g_kwh',     co2)),
        fire_risk_fwi:    sv(fwiValue,                                 envStatus('fire_risk_fwi', fwiValue)),
        // 30-day accumulated balance from Open-Meteo (fwi cache); 7-day as fallback
        water_balance_mm: sv(fwi.water_balance_mm ?? weather.water_balance_7d ?? null,
                             envStatus('water_balance_mm', fwi.water_balance_mm ?? weather.water_balance_7d ?? null)),
      },
      forecast: buildForecast(weather),
    },

    air_quality: {
      pm25: sv(aq.pm2_5,            'ok'),
      pm10: sv(aq.pm10,             'ok'),
      co:   sv(aq.carbon_monoxide !== null && aq.carbon_monoxide !== undefined
               ? Math.round(aq.carbon_monoxide / 1000 * 10) / 10
               : null,             'ok'),
      no2:  sv(aq.nitrogen_dioxide, 'ok'),
      o3:   sv(aq.ozone,            'ok'),
      aqi:  sv(aq.european_aqi,     aqiStatus(aq.european_aqi)),
    },

    calculated_metrics: {
      comfort_score:       sv(comfortScore,  metricStatus('comfort_score',       comfortScore)),
      water_autonomy_days: sv(waterAutonomy, metricStatus('water_autonomy_days', waterAutonomy)),
      energy_source:       energySource,
      savings_eur_today:   sv(savingsToday,  'ok'),
    },
  });
});

module.exports = router;
