// TEMPORARY — remove once APIs are debugged
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const LAT = process.env.NODE_LAT || '41.3851';
const LON = process.env.NODE_LON || '2.1734';

// Raw HTTP probe — bypasses cache and returns full response for inspection
async function probeREData() {
  const now   = new Date();
  const date  = now.toISOString().slice(0, 10);

  const demandUrl  = 'https://apidatos.ree.es/es/datos/demanda/demanda-tiempo-real';
  const balanceUrl = 'https://apidatos.ree.es/es/datos/balance/balance-electrico';

  const demandParams  = { start_date: new Date(now - 3600000).toISOString(), end_date: now.toISOString(), time_trunc: 'hour' };
  const balanceParams = { start_date: `${date}T00:00:00`, end_date: `${date}T23:59:59`, time_trunc: 'day' };

  const [demandRes, balanceRes] = await Promise.allSettled([
    axios.get(demandUrl,  { params: demandParams,  timeout: 10000 }),
    axios.get(balanceUrl, { params: balanceParams, timeout: 10000 }),
  ]);

  // Demand response
  const demandOut = demandRes.status === 'fulfilled'
    ? (() => {
        const included = demandRes.value.data.included || [];
        const real = included.find(i => i.type === 'Real');
        return {
          ok:             true,
          request_url:    `${demandUrl}?${new URLSearchParams(demandParams)}`,
          http_status:    demandRes.value.status,
          included_types: included.map(i => i.type),
          real_series:    real
            ? { found: true, last_value: real.attributes?.values?.at(-1) }
            : { found: false, available_types: included.map(i => i.type) },
        };
      })()
    : { ok: false, error: demandRes.reason?.message, http_status: demandRes.reason?.response?.status };

  // Balance response — nested structure: attributes.content[].attributes.values
  const balanceOut = balanceRes.status === 'fulfilled'
    ? (() => {
        const included = balanceRes.value.data.included || [];

        function sumGroup(group) {
          const content = group?.attributes?.content ?? [];
          return {
            sub_items: content.length,
            total:     content.reduce((s, sub) => s + (sub.attributes?.values?.at(-1)?.value ?? 0), 0),
          };
        }

        const renovable   = included.find(i => i.type === 'Renovable');
        const noRenovable = included.find(i => i.type === 'No-Renovable');
        const renStats    = renovable   ? sumGroup(renovable)   : null;
        const noRenStats  = noRenovable ? sumGroup(noRenovable) : null;

        let renewables_percent = null;
        if (renStats && noRenStats && renStats.total + noRenStats.total > 0) {
          renewables_percent = Math.round(renStats.total / (renStats.total + noRenStats.total) * 100);
        }

        return {
          ok:                true,
          request_url:       `${balanceUrl}?${new URLSearchParams(balanceParams)}`,
          http_status:       balanceRes.value.status,
          included_types:    included.map(i => i.type),
          renovable:         renStats,
          no_renovable:      noRenStats,
          renewables_percent,
        };
      })()
    : { ok: false, error: balanceRes.reason?.message, http_status: balanceRes.reason?.response?.status, raw_body: balanceRes.reason?.response?.data };

  return { demand: demandOut, balance: balanceOut };
}

async function probeEFFIS() {
  const url    = 'https://ies-ows.jrc.ec.europa.eu/effis';
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

  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  try {
    const response = await axios.get(url, { params, timeout: 15000 });
    const features = response.data.features ?? [];
    return {
      ok:              true,
      request_url:     `${url}?${qs}`,
      http_status:     response.status,
      features_count:  features.length,
      first_properties: features[0]?.properties ?? null,
      fwi_values:      features.map(f => f.properties?.fwi ?? f.properties?.FWI ?? null),
    };
  } catch (err) {
    return {
      ok:          false,
      request_url: `${url}?${qs}`,
      error:       err.message,
      http_status: err.response?.status ?? null,
      raw_body:    err.response?.data   ?? null,
    };
  }
}

// GET /api/debug/apis
router.get('/apis', async (req, res) => {
  const [redata, effis] = await Promise.allSettled([probeREData(), probeEFFIS()]);

  res.json({
    _note:  'Temporary debug endpoint — remove before production',
    redata: redata.status === 'fulfilled' ? redata.value : { ok: false, error: redata.reason?.message },
    effis:  effis.status  === 'fulfilled' ? effis.value  : { ok: false, error: effis.reason?.message },
  });
});

module.exports = router;
