const axios = require('axios');
const { getDb } = require('../db');

const LAT = process.env.NODE_LAT || '41.3851';
const LON = process.env.NODE_LON || '2.1734';

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function getCache(source) {
  const db = getDb();
  const row = db.prepare('SELECT data, updated_at FROM api_cache WHERE source = ?').get(source);
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data), updated_at: row.updated_at };
  } catch {
    return null;
  }
}

function setCache(source, data) {
  const db = getDb();
  db.prepare(`
    INSERT INTO api_cache (source, data, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(source) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(source, JSON.stringify(data));
}

function getCachedData(source) {
  const cached = getCache(source);
  return cached ? cached.data : null;
}

// ---------------------------------------------------------------------------
// REData — Red Eléctrica de España (ESIOS/REData public API)
// Renovables, CO2 intensity, precio spot
// ---------------------------------------------------------------------------

async function fetchREData() {
  try {
    const now = new Date();
    const start = new Date(now - 60 * 60 * 1000).toISOString();
    const end = now.toISOString();

    // Demanda peninsular en tiempo real
    const { data } = await axios.get(
      'https://apidatos.ree.es/es/datos/demanda/demanda-tiempo-real',
      {
        params: { start_date: start, end_date: end, time_trunc: 'hour' },
        timeout: 10000,
      }
    );

    const included = data.included || [];
    const demanda = included.find(i => i.type === 'Demanda real');
    const renovable = included.find(i => i.type === 'Demanda renovable');

    const result = {
      demand_mw:          demanda?.attributes?.values?.at(-1)?.value ?? null,
      renewables_mw:      renovable?.attributes?.values?.at(-1)?.value ?? null,
      renewables_percent: null,
      co2_intensity:      null,
      price_eur_mwh:      null,
      source:             'REData',
      fetched_at:         now.toISOString(),
    };

    if (result.demand_mw && result.renewables_mw) {
      result.renewables_percent = Math.round((result.renewables_mw / result.demand_mw) * 100);
    }

    setCache('redata', result);
    return result;
  } catch (err) {
    console.warn('[apis] REData fetch failed:', err.message);
    return getCachedData('redata');
  }
}

// ---------------------------------------------------------------------------
// Open-Meteo — Weather forecast
// ---------------------------------------------------------------------------

async function fetchWeather() {
  try {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude:       LAT,
        longitude:      LON,
        current:        'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code',
        hourly:         'temperature_2m,precipitation_probability',
        forecast_days:  2,
        timezone:       'Europe/Madrid',
      },
      timeout: 10000,
    });

    const current = data.current ?? {};
    const result = {
      temperature:           current.temperature_2m ?? null,
      humidity:              current.relative_humidity_2m ?? null,
      precipitation:         current.precipitation ?? null,
      wind_speed:            current.wind_speed_10m ?? null,
      weather_code:          current.weather_code ?? null,
      hourly_forecast:       data.hourly ?? null,
      source:                'Open-Meteo',
      fetched_at:            new Date().toISOString(),
    };

    setCache('weather', result);
    return result;
  } catch (err) {
    console.warn('[apis] Open-Meteo weather fetch failed:', err.message);
    return getCachedData('weather');
  }
}

// ---------------------------------------------------------------------------
// Open-Meteo Air Quality
// ---------------------------------------------------------------------------

async function fetchAirQuality() {
  try {
    const { data } = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
      params: {
        latitude:  LAT,
        longitude: LON,
        current:   'pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,european_aqi',
      },
      timeout: 10000,
    });

    const current = data.current ?? {};
    const result = {
      pm10:              current.pm10 ?? null,
      pm2_5:             current.pm2_5 ?? null,
      carbon_monoxide:   current.carbon_monoxide ?? null,
      nitrogen_dioxide:  current.nitrogen_dioxide ?? null,
      ozone:             current.ozone ?? null,
      european_aqi:      current.european_aqi ?? null,
      source:            'Open-Meteo AQ',
      fetched_at:        new Date().toISOString(),
    };

    setCache('air_quality', result);
    return result;
  } catch (err) {
    console.warn('[apis] Open-Meteo AQ fetch failed:', err.message);
    return getCachedData('air_quality');
  }
}

// ---------------------------------------------------------------------------
// EFFIS — European Forest Fire Information System
// ---------------------------------------------------------------------------

async function fetchEFFIS() {
  try {
    // EFFIS current fire danger index via WMS/WFS public endpoint
    const { data } = await axios.get(
      'https://ies-ows.jrc.ec.europa.eu/effis',
      {
        params: {
          SERVICE: 'WFS',
          VERSION: '2.0.0',
          REQUEST: 'GetFeature',
          TYPENAMES: 'ms:modis.fires.viirs.24h',
          OUTPUTFORMAT: 'application/json',
          COUNT: 1,
          // Bounding box around the node location ±2 degrees
          BBOX: `${parseFloat(LAT) - 2},${parseFloat(LON) - 2},${parseFloat(LAT) + 2},${parseFloat(LON) + 2}`,
        },
        timeout: 15000,
      }
    );

    const features = data.features ?? [];
    const result = {
      active_fires_nearby: features.length,
      fire_risk:           features.length > 0 ? 'high' : 'low',
      source:              'EFFIS',
      fetched_at:          new Date().toISOString(),
    };

    setCache('effis', result);
    return result;
  } catch (err) {
    console.warn('[apis] EFFIS fetch failed:', err.message);
    return getCachedData('effis');
  }
}

// ---------------------------------------------------------------------------
// AEMET — Agencia Estatal de Meteorología
// ---------------------------------------------------------------------------

async function fetchAEMET() {
  const apiKey = process.env.AEMET_API_KEY;
  if (!apiKey || apiKey.startsWith('eyJhbGci')) {
    // Placeholder key — return mock data
    const mock = {
      station:   process.env.NODE_LABEL || 'Barcelona',
      temp:      null,
      humidity:  null,
      wind:      null,
      condition: null,
      source:    'AEMET (mock)',
      fetched_at: new Date().toISOString(),
    };
    setCache('aemet', mock);
    return mock;
  }

  try {
    // Step 1: get data URL
    const { data: meta } = await axios.get(
      'https://opendata.aemet.es/opendata/api/observacion/convencional/todas',
      { headers: { api_key: apiKey }, timeout: 10000 }
    );

    // Step 2: fetch actual data
    const { data: observations } = await axios.get(meta.datos, { timeout: 10000 });

    // Pick the station closest to our coordinates by brute force
    let closest = null;
    let minDist = Infinity;
    for (const obs of observations) {
      if (!obs.lat || !obs.lon) continue;
      const d = Math.hypot(obs.lat - parseFloat(LAT), obs.lon - parseFloat(LON));
      if (d < minDist) { minDist = d; closest = obs; }
    }

    const result = {
      station:    closest?.nombre ?? null,
      temp:       closest?.ta ?? null,
      humidity:   closest?.hr ?? null,
      wind:       closest?.vv ?? null,
      condition:  null,
      source:     'AEMET',
      fetched_at: new Date().toISOString(),
    };

    setCache('aemet', result);
    return result;
  } catch (err) {
    console.warn('[apis] AEMET fetch failed:', err.message);
    return getCachedData('aemet');
  }
}

// ---------------------------------------------------------------------------
// NASA POWER — Solar irradiance (daily)
// ---------------------------------------------------------------------------

async function fetchNASAPower() {
  try {
    const today = new Date();
    const end = today.toISOString().slice(0, 10).replace(/-/g, '');
    const startDate = new Date(today - 7 * 86400 * 1000);
    const start = startDate.toISOString().slice(0, 10).replace(/-/g, '');

    const { data } = await axios.get('https://power.larc.nasa.gov/api/temporal/daily/point', {
      params: {
        parameters: 'ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN',
        community:  'RE',
        longitude:  LON,
        latitude:   LAT,
        start,
        end,
        format:     'JSON',
      },
      timeout: 20000,
    });

    const props = data.properties?.parameter ?? {};
    const allsky = props.ALLSKY_SFC_SW_DWN ?? {};
    const dates = Object.keys(allsky).sort();
    const latest = dates.at(-1);

    const result = {
      irradiance_kwh_m2: allsky[latest] ?? null,
      date:              latest ?? null,
      source:            'NASA POWER',
      fetched_at:        new Date().toISOString(),
    };

    setCache('nasa_power', result);
    return result;
  } catch (err) {
    console.warn('[apis] NASA POWER fetch failed:', err.message);
    return getCachedData('nasa_power');
  }
}

// ---------------------------------------------------------------------------
// Aggregate all cached external data
// ---------------------------------------------------------------------------

function getAllCached() {
  return {
    weather:     getCachedData('weather'),
    air_quality: getCachedData('air_quality'),
    redata:      getCachedData('redata'),
    effis:       getCachedData('effis'),
    aemet:       getCachedData('aemet'),
    nasa_power:  getCachedData('nasa_power'),
  };
}

module.exports = {
  fetchREData,
  fetchWeather,
  fetchAirQuality,
  fetchEFFIS,
  fetchAEMET,
  fetchNASAPower,
  getAllCached,
  getCache,
  setCache,
};
