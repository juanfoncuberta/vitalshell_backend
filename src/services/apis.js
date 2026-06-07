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
  const now  = new Date();
  const date = now.toISOString().slice(0, 10);  // "2026-06-07"

  // Two parallel calls:
  //   demanda-tiempo-real → real-time demand MW (type 'Real')
  //   balance-electrico   → renewable % for the day (type 'Renovable' / 'No-Renovable')
  //   Note: balance-electrico only works with time_trunc=day, not hour.
  const [demandRes, balanceRes] = await Promise.allSettled([
    axios.get('https://apidatos.ree.es/es/datos/demanda/demanda-tiempo-real', {
      params: {
        start_date: new Date(now - 60 * 60 * 1000).toISOString(),
        end_date:   now.toISOString(),
        time_trunc: 'hour',
      },
      timeout: 10000,
    }),
    axios.get('https://apidatos.ree.es/es/datos/balance/balance-electrico', {
      params: {
        start_date: `${date}T00:00:00`,
        end_date:   `${date}T23:59:59`,
        time_trunc: 'day',
      },
      timeout: 10000,
    }),
  ]);

  // demand_mw — type is 'Real' (not 'Demanda real')
  let demand_mw = null;
  if (demandRes.status === 'fulfilled') {
    const included = demandRes.value.data.included || [];
    const real = included.find(i => i.type === 'Real');
    demand_mw = real?.attributes?.values?.at(-1)?.value ?? null;
  } else {
    console.warn('[REData] demand fetch failed:', demandRes.reason?.message);
  }

  // renewables_percent — balance-electrico nests values inside
  // attributes.content[].attributes.values (one value per technology per day)
  let renewables_percent = null;
  if (balanceRes.status === 'fulfilled') {
    const included = balanceRes.value.data.included || [];

    function sumGroupLastValue(group) {
      const content = group?.attributes?.content ?? [];
      return content.reduce((sum, sub) => {
        const val = sub.attributes?.values?.at(-1)?.value;
        return sum + (val ?? 0);
      }, 0);
    }

    const renovable   = included.find(i => i.type === 'Renovable');
    const noRenovable = included.find(i => i.type === 'No-Renovable');
    const renMWh      = renovable   ? sumGroupLastValue(renovable)   : null;
    const noRenMWh    = noRenovable ? sumGroupLastValue(noRenovable) : null;

    if (renMWh !== null && noRenMWh !== null && renMWh + noRenMWh > 0) {
      renewables_percent = Math.round((renMWh / (renMWh + noRenMWh)) * 100);
    }
  } else {
    console.warn('[REData] balance fetch failed:', balanceRes.reason?.message);
  }

  const result = {
    demand_mw,
    renewables_percent,
    co2_intensity: null,
    price_eur_mwh: null,
    source:        'REData',
    fetched_at:    now.toISOString(),
  };

  setCache('redata', result);
  return result;
}

// ---------------------------------------------------------------------------
// Open-Meteo — Weather forecast
// ---------------------------------------------------------------------------

async function fetchWeather() {
  try {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude:        LAT,
        longitude:       LON,
        current:         'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code,uv_index',
        hourly:          'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation_probability,weather_code',
        daily:           'precipitation_sum,et0_fao_evapotranspiration',
        past_days:       7,
        forecast_days:   2,
        timezone:        'Europe/Madrid',
        wind_speed_unit: 'kmh',
      },
      timeout: 10000,
    });

    const current = data.current ?? {};
    const daily   = data.daily   ?? {};

    // 7-day water balance: precipitation minus evapotranspiration (mm)
    const precip = daily.precipitation_sum           ?? [];
    const et0    = daily.et0_fao_evapotranspiration  ?? [];
    const waterBalance = Math.round(
      precip.reduce((sum, p, i) => sum + (p ?? 0) - (et0[i] ?? 0), 0) * 10
    ) / 10;

    const result = {
      temperature:        current.temperature_2m          ?? null,
      humidity:           current.relative_humidity_2m    ?? null,
      precipitation:      current.precipitation           ?? null,
      wind_speed:         current.wind_speed_10m          ?? null,
      weather_code:       current.weather_code            ?? null,
      uv_index:           current.uv_index                ?? null,
      water_balance_7d:   waterBalance,
      current_local_time: current.time                    ?? null,
      hourly_forecast:    data.hourly                     ?? null,
      source:             'Open-Meteo',
      fetched_at:         new Date().toISOString(),
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
  const url    = 'https://ies-ows.jrc.ec.europa.eu/effis';
  // Correct layer: ms:fwi_nuts5.fwi (confirmed via GetCapabilities)
  // Previous layer ms:modis.fires.viirs.24h does not exist on this server.
  const bbox   = `${parseFloat(LAT) - 2},${parseFloat(LON) - 2},${parseFloat(LAT) + 2},${parseFloat(LON) + 2}`;
  const params = {
    SERVICE:      'WFS',
    VERSION:      '2.0.0',
    REQUEST:      'GetFeature',
    TYPENAMES:    'ms:fwi_nuts5.fwi',
    OUTPUTFORMAT: 'application/json',
    COUNT:        5,
    BBOX:         bbox,
  };

  try {
    const response = await axios.get(url, { params, timeout: 15000 });
    const features = response.data.features ?? [];

    // Average FWI over returned NUTS5 polygons that intersect the bounding box
    const fwiValues = features
      .map(f => f.properties?.fwi ?? f.properties?.FWI ?? null)
      .filter(v => v !== null && v >= 0);

    const fwi = fwiValues.length > 0
      ? Math.round((fwiValues.reduce((s, v) => s + v, 0) / fwiValues.length) * 10) / 10
      : null;

    const result = {
      fwi_today:           fwi,
      active_fires_nearby: features.length,
      source:              'EFFIS',
      fetched_at:          new Date().toISOString(),
    };

    setCache('effis', result);
    return result;
  } catch (err) {
    console.warn('[EFFIS] fetch failed:', err.message);
    if (err.response) {
      console.warn('[EFFIS] HTTP', err.response.status, '—', JSON.stringify(err.response.data).slice(0, 300));
    }
    return getCachedData('effis');
  }
}

// ---------------------------------------------------------------------------
// FWI — Fire Weather Index + Water Balance
// Primary source: EFFIS ms:fwi_nuts5.fwi (fetchEFFIS).
// Fallback: Open-Meteo daily data + Canadian FWI algorithm (Van Wagner 1987).
//
// NOTE: Open-Meteo has no fire_danger_index variable in any of their endpoints
// (forecast, archive, climate). We compute it from first principles using the
// same Canadian FWI algorithm that EFFIS uses internally.
// ---------------------------------------------------------------------------

// Canadian Forest Fire Weather Index System — Van Wagner (1987) TR-35
// Inputs: array of {temp(°C), rh(%), wind(km/h), rain(mm)}, oldest first.
// Returns today's FWI value.
function canadianFWI(history) {
  if (!history || history.length === 0) return null;

  // Day-length adjustment factors (monthly, Jan–Dec index 0–11)
  const LE = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0]; // DMC
  const LF = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6]; // DC

  const month = new Date().getMonth();

  // Start-of-season default moisture codes
  let ffmc = 85.0;
  let dmc  = 6.0;
  let dc   = 15.0;

  for (const { temp: T, rh: H, wind: W, rain: r } of history) {
    // ── FFMC ─────────────────────────────────────────────────────────────────
    const mo = 147.2 * (101 - ffmc) / (59.5 + ffmc);
    let m = mo;

    if (r > 0.5) {
      const rf  = r - 0.5;
      const mrr = 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
      m = mo <= 150 ? mo + mrr : mo + mrr + 0.0015 * (mo - 150) ** 2 * rf ** 0.5;
      if (m > 250) m = 250;
    }

    const Ed = 0.942 * H ** 0.679 + 11 * Math.exp((H - 100) / 10) + 0.18 * (21.1 - T) * (1 - Math.exp(-0.115 * H));
    const Ew = 0.618 * H ** 0.753 + 10 * Math.exp((H - 100) / 10) + 0.18 * (21.1 - T) * (1 - Math.exp(-0.115 * H));

    if (m > Ed) {
      const kd = 0.424 * (1 - ((100 - H) / 100) ** 1.7) + 0.0694 * W ** 0.5 * (1 - ((100 - H) / 100) ** 8);
      m = Ed + (m - Ed) * 10 ** (-kd);
    } else if (m < Ew) {
      const kw = 0.424 * (1 - (H / 100) ** 1.7) + 0.0694 * W ** 0.5 * (1 - (H / 100) ** 8);
      m = Ew - (Ew - m) * 10 ** (-kw);
    }
    ffmc = Math.max(0, Math.min(99, 59.5 * (250 - m) / (147.2 + m)));

    // ── DMC ──────────────────────────────────────────────────────────────────
    if (r > 1.5) {
      const re = 0.92 * r - 1.27;
      const Mo = 20 + 280 / Math.exp(0.023 * dmc);
      const b  = dmc <= 33 ? 100 / (0.5 + 0.3 * dmc)
               : dmc <= 65 ? 14 - 1.3 * Math.log(dmc)
               :             6.2 * Math.log(dmc) - 17.2;
      const Mr = Mo + 1000 * re / (48.77 + b * re);
      dmc = Math.max(0, 43.43 * (5.6348 - Math.log(Mr - 20)));
    }
    if (T >= -1.1) {
      dmc = Math.max(0, dmc + 100 * 1.894 * (T + 1.1) * (100 - H) * LE[month] * 0.0001);
    }

    // ── DC ───────────────────────────────────────────────────────────────────
    if (r > 2.8) {
      const rd = 0.83 * r - 1.27;
      const Qr = 800 * Math.exp(-dc / 400) + 3.937 * rd;
      dc = Math.max(0, 400 * Math.log(800 / Qr));
    }
    if (T >= -2.8) {
      dc = Math.max(0, dc + 0.5 * (0.36 * (T + 2.8) + LF[month]));
    }
  }

  // ── ISI ──────────────────────────────────────────────────────────────────
  const Wf  = history[history.length - 1].wind;
  const mf  = 147.2 * (101 - ffmc) / (59.5 + ffmc);
  const isi = 0.208 * Math.exp(0.05039 * Wf) * 91.9 * Math.exp(-0.1386 * mf) * (1 + mf ** 5.31 / 49300000);

  // ── BUI ──────────────────────────────────────────────────────────────────
  const bui = Math.max(0,
    dmc <= 0.4 * dc
      ? 0.8 * dmc * dc / (dmc + 0.4 * dc)
      : dmc - (1 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + (0.0114 * dmc) ** 1.7)
  );

  // ── FWI ──────────────────────────────────────────────────────────────────
  const fD = bui <= 80
    ? 0.626 * bui ** 0.809 + 2
    : 1000 / (25 + 108.64 * Math.exp(-0.023 * bui));
  const B   = 0.1 * isi * fD;
  const fwi = B > 1 ? Math.exp(2.72 * (0.434 * Math.log(B)) ** 0.647) : B;

  return Math.max(0, Math.round(fwi * 10) / 10);
}

async function fetchFWI() {
  try {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude:        LAT,
        longitude:       LON,
        daily:           'temperature_2m_max,relative_humidity_2m_min,wind_speed_10m_max,precipitation_sum,et0_fao_evapotranspiration',
        past_days:       30,
        forecast_days:   3,
        timezone:        'Europe/Madrid',
        wind_speed_unit: 'kmh',
      },
      timeout: 10000,
    });

    const d = data.daily ?? {};
    const n = (d.time ?? []).length;

    // Indices 0–29 = past 30 days; index 30 = today
    const history = [];
    for (let i = 0; i < Math.min(n, 31); i++) {
      history.push({
        temp: d.temperature_2m_max?.[i]          ?? 20,
        rh:   d.relative_humidity_2m_min?.[i]    ?? 50,
        wind: d.wind_speed_10m_max?.[i]          ?? 10,
        rain: d.precipitation_sum?.[i]           ?? 0,
      });
    }

    // Water balance: accumulated difference over past 30 days (indices 0–29)
    const precip = d.precipitation_sum          ?? [];
    const et0    = d.et0_fao_evapotranspiration ?? [];
    const waterBalance = Math.round(
      precip.slice(0, 30).reduce((sum, p, i) => sum + (p ?? 0) - (et0[i] ?? 0), 0) * 10
    ) / 10;

    const result = {
      fwi_today:        canadianFWI(history),
      water_balance_mm: waterBalance,
      source:           'Open-Meteo (Canadian FWI)',
      fetched_at:       new Date().toISOString(),
    };

    setCache('fwi', result);
    return result;
  } catch (err) {
    console.warn('[FWI] Open-Meteo fetch failed:', err.message);
    return getCachedData('fwi');
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
    fwi:         getCachedData('fwi'),
    aemet:       getCachedData('aemet'),
    nasa_power:  getCachedData('nasa_power'),
  };
}

module.exports = {
  fetchREData,
  fetchWeather,
  fetchAirQuality,
  fetchEFFIS,
  fetchFWI,
  fetchAEMET,
  fetchNASAPower,
  getAllCached,
  getCache,
  setCache,
};
