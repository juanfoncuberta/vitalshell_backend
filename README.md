# VitalShell Backend

Backend IoT para el sistema **VitalShell / VitalWall**. Recibe datos de sensores hardware, consulta APIs ambientales externas, ejecuta un motor de reglas heurístico (dummy) y expone una API REST + WebSocket para dos dashboards en tiempo real.

---

## Índice

- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Ejecución](#ejecución)
- [API REST](#api-rest)
- [WebSocket](#websocket)
- [Motor de reglas (dummy)](#motor-de-reglas-dummy)
- [APIs externas](#apis-externas)
- [Base de datos](#base-de-datos)
- [Tests](#tests)
- [Estructura del proyecto](#estructura-del-proyecto)

---

## Arquitectura

```
Hardware (sensores)
        │
        │  POST /api/sensors
        ▼
┌───────────────────────────────────────────────┐
│              Express REST API                 │
│                                               │
│  ┌─────────────┐   ┌──────────────────────┐  │
│  │ Motor de    │◄──│  Cron Jobs           │  │
│  │ Motor de    │   │  (APIs externas)     │  │
│  │ Reglas      │   │  REData / Meteo /    │  │
│  └──────┬──────┘   │  EFFIS / AEMET /     │  │
│         │          │  NASA POWER          │  │
│         │          └──────────────────────┘  │
│         │                                     │
│  ┌──────▼──────────────────────────────────┐  │
│  │           SQLite (better-sqlite3)       │  │
│  │  sensors · rules · comfort · api_cache  │  │
│  └─────────────────────────────────────────┘  │
└──────────────┬────────────────────────────────┘
               │  broadcast
               ▼
        WebSocket Server
        ws://.../api?apiKey=...
               │
        ┌──────┴──────┐
        │  Dashboard  │  (×2)
        └─────────────┘
```

---

## Requisitos

- **Node.js** >= 18 (probado en Node 25)
- **npm** >= 9

---

## Instalación

```bash
git clone https://github.com/juanfoncuberta/vitalshell_backend.git
cd vitalshell_backend
npm install
cp .env.example .env
# edita .env con tus claves de API
```

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3001` | Puerto del servidor HTTP |
| `API_KEY` | — | Clave para proteger los endpoints REST y WebSocket |
| `NODE_LAT` | `41.3851` | Latitud del nodo (para APIs georreferenciadas) |
| `NODE_LON` | `2.1734` | Longitud del nodo |
| `NODE_LABEL` | `Barcelona` | Nombre descriptivo de la ubicación |
| `AEMET_API_KEY` | — | Clave de la API de AEMET (opcional) |
| `ELECTRICITYMAPS_API_KEY` | — | Reservado para futura integración |
| `ENTSOE_API_KEY` | — | Reservado para futura integración |
| `CRON_REDATA_INTERVAL` | `300000` | Intervalo REData en ms (referencia, no usado en cron) |
| `CRON_WEATHER_INTERVAL` | `900000` | Intervalo meteorología en ms (referencia) |
| `CRON_NASA_INTERVAL` | `86400000` | Intervalo NASA POWER en ms (referencia) |
| `DB_PATH` | `./vitalshell.db` | Ruta del fichero SQLite (`:memory:` para tests) |

---

## Ejecución

```bash
# Producción
npm start

# Desarrollo con hot-reload
npm run dev

# Tests
npm test

# Tests con cobertura
npm run test:coverage
```

---

## API REST

### Autenticación

Los endpoints protegidos requieren el header:

```
X-API-Key: <tu_api_key>
```

El único endpoint público es `GET /api/system/health`. Todos los demás, incluido `POST /api/sensors`, requieren autenticación.

---

### Endpoints

#### `POST /api/sensors` — Ingestar dato de sensor
> **Protegido**

Recibe una lectura del hardware. Dispara el motor de reglas y emite broadcast WebSocket.

**Body:**
```json
{
  "temperature":   22.5,
  "humidity":      55,
  "water_level":   80,
  "battery_level": 90,
  "timestamp":     "2024-06-01T12:00:00.000Z"
}
```
Todos los campos son opcionales pero se requiere al menos uno.

**Respuesta `201`:**
```json
{
  "ok": true,
  "reading": {
    "id": 1,
    "temperature": 22.5,
    "humidity": 55,
    "water_level": 80,
    "battery_level": 90,
    "timestamp": "2024-06-01T12:00:00.000Z",
    "created_at": "2024-06-01T12:00:00.000Z"
  },
  "new_rules": []
}
```

---

#### `GET /api/data` — Estado completo del sistema
> **Protegido**

Devuelve un snapshot completo: último dato de sensor, todas las APIs cacheadas, reglas activas/pendientes y preferencias de confort.

**Respuesta `200`:**
```json
{
  "sensor": { "id": 1, "temperature": 22.5, "humidity": 55, ... },
  "sensor_online": true,
  "environmental": {
    "weather": { "temperature": 28, "humidity": 60, ... },
    "aemet":   { "station": "Barcelona", "temp": 27, ... }
  },
  "air_quality":  { "european_aqi": 45, "pm2_5": 12, ... },
  "energy": {
    "redata":     { "renewables_percent": 62, "demand_mw": 28000, ... },
    "nasa_power": { "irradiance_kwh_m2": 5.8, "date": "20240601" }
  },
  "fire_risk":  { "fire_risk": "low", "active_fires_nearby": 0 },
  "rules":      [...],
  "comfort":    { "temperature_min": 18, "temperature_max": 26, ... },
  "timestamp":  "2024-06-01T12:00:00.000Z"
}
```

---

#### `GET /api/sensors/history` — Historial de sensores
> **Público**

| Parámetro | Valores | Default |
|---|---|---|
| `period` | `1h` · `24h` · `7d` | `24h` |

Siempre devuelve un array de días. Dentro de cada día, un array `readings` con todas las lecturas registradas ese día incluyendo la hora exacta (`time`). El campo `count` del wrapper refleja el número de días, no de lecturas individuales.

**Respuesta `200`:**
```json
{
  "period": "7d",
  "count": 3,
  "data": [
    {
      "day": "2024-05-26",
      "readings": [
        {
          "id": 1,
          "temperature": 21.4,
          "humidity": 52,
          "water_level": 78,
          "battery_level": 85,
          "timestamp": "2024-05-26T08:00:00.000Z",
          "created_at": "2024-05-26 08:00:00",
          "time": "08:00"
        },
        {
          "id": 2,
          "temperature": 22.1,
          "humidity": 55,
          "water_level": 77,
          "battery_level": 84,
          "timestamp": "2024-05-26T14:30:00.000Z",
          "created_at": "2024-05-26 14:30:00",
          "time": "14:30"
        }
      ]
    },
    {
      "day": "2024-05-27",
      "readings": [ ... ]
    }
  ]
}
```

---

#### `GET /api/rules` — Reglas activas y pendientes
> **Protegido**

| Parámetro | Default | Máximo |
|---|---|---|
| `limit` | `20` | `100` |
| `offset` | `0` | — |

**Respuesta `200`:**
```json
{
  "limit": 20,
  "offset": 0,
  "count": 2,
  "data": [
    {
      "id": 3,
      "condition": "interior_temp > 28 (current: 30°C)",
      "action": "activate_ventilation",
      "description": "Temperatura interior elevada — activar ventilación",
      "affected_layer": "ventilation",
      "status": "pending",
      "duration_hours": 2,
      "trigger_source": "sensor",
      "created_at": "2024-06-01T12:00:00",
      "updated_at": "2024-06-01T12:00:00"
    }
  ]
}
```

---

#### `GET /api/rules/history` — Historial de reglas completadas
> **Protegido**

| Parámetro | Valores | Default |
|---|---|---|
| `period` | `1h` · `24h` · `7d` | `24h` |
| `limit` | número | `20` |

Devuelve reglas con `status = 'completed'` en el período indicado.

---

#### `PATCH /api/rules/:id` — Cambiar estado de una regla
> **Protegido**

**Body:**
```json
{ "status": "active" }
```

Estados válidos: `pending` · `active` · `completed` · `disabled`

| Transición | Cuándo usarla |
|---|---|
| `pending → active` | El dashboard confirma que la acción está en marcha |
| `active → completed` | La acción ha finalizado |
| `* → disabled` | Se descarta la regla sin ejecutarla |

Emite broadcast WebSocket `rule_update` al cambiar.

**Respuesta `200`:** la regla actualizada.

---

#### `GET /api/system/health` — Estado del sistema
> **Público**

**Respuesta `200`:**
```json
{
  "status": "healthy",
  "sensor_online": true,
  "apis": {
    "weather":     { "status": "ok",      "updated_at": "...", "age_seconds": 420 },
    "air_quality": { "status": "ok",      "updated_at": "...", "age_seconds": 310 },
    "redata":      { "status": "stale",   "updated_at": "...", "age_seconds": 2100 },
    "effis":       { "status": "no_data"  },
    "aemet":       { "status": "ok",      "updated_at": "...", "age_seconds": 180 },
    "nasa_power":  { "status": "ok",      "updated_at": "...", "age_seconds": 7200 }
  },
  "uptime_seconds": 3600,
  "timestamp": "2024-06-01T12:00:00.000Z"
}
```

- `healthy` → sensor online + todas las APIs en estado `ok`
- `degraded` → alguna API `stale` o `no_data`, o sensor offline
- Una API es `stale` si su caché tiene más de 30 minutos
- El sensor se considera offline si no ha enviado datos en los últimos 10 minutos

---

#### `POST /api/comfort` — Guardar preferencias de confort
> **Protegido**

**Body** (todos los campos son opcionales, se hace merge con los valores actuales):
```json
{
  "temperature_min": 19,
  "temperature_max": 25,
  "humidity_min":    35,
  "humidity_max":    65
}
```

**Respuesta `200`:** preferencias actualizadas.

---

#### `GET /api/comfort` — Leer preferencias de confort
> **Protegido**

**Respuesta `200`:**
```json
{
  "id": 1,
  "temperature_min": 19,
  "temperature_max": 25,
  "humidity_min": 35,
  "humidity_max": 65,
  "updated_at": "2024-06-01T12:00:00"
}
```

---

## WebSocket

### Conexión

```
ws://<host>:<port>/?apiKey=<tu_api_key>
```

La autenticación se verifica en el handshake HTTP. Si la clave es incorrecta o falta, el servidor devuelve `401` y cierra la conexión.

### Tipos de mensaje del servidor al cliente

Todos los mensajes siguen el formato:
```json
{
  "type": "<tipo>",
  "payload": { ... },
  "timestamp": "2024-06-01T12:00:00.000Z"
}
```

| Tipo | Cuándo se emite | Payload |
|---|---|---|
| `connected` | Al conectar | `{ message, timestamp }` |
| `sensor_update` | Tras cada `POST /api/sensors` | Última lectura del sensor |
| `environmental_update` | Tras actualizar Open-Meteo o AEMET | Datos meteorológicos |
| `air_quality_update` | Tras actualizar Open-Meteo AQ | Índices de calidad del aire |
| `rule_update` | Al crear una regla nueva o al hacer `PATCH` | Regla actualizada |
| `metrics_update` | Tras actualizar REData o NASA POWER | Datos energéticos |
| `health_update` | Cada 2 minutos | `{ sensor_online, clients, uptime_seconds }` |
| `alert` | Disponible para alertas críticas futuras | — |
| `pong` | En respuesta a un `ping` del cliente | `{ timestamp }` |

### Mensaje del cliente al servidor

```json
{ "type": "ping" }
```

### Ejemplo de cliente con reconexión (Exponential Backoff)

```javascript
class VitalShellWS {
  constructor(url) {
    this.url = url;
    this.delay = 1000;
    this.maxDelay = 30000;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('Conectado');
      this.delay = 1000; // reset backoff
    };

    this.ws.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);
      this.handleMessage(type, payload);
    };

    this.ws.onclose = () => {
      console.log(`Reconectando en ${this.delay}ms...`);
      setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 2, this.maxDelay);
    };
  }

  handleMessage(type, payload) {
    switch (type) {
      case 'sensor_update':      /* actualizar dashboard sensor */ break;
      case 'environmental_update': /* actualizar clima */ break;
      case 'air_quality_update': /* actualizar AQI */ break;
      case 'rule_update':        /* actualizar lista de reglas */ break;
      case 'metrics_update':     /* actualizar energía */ break;
      case 'health_update':      /* actualizar indicadores */ break;
    }
  }
}

const ws = new VitalShellWS('ws://localhost:3001/?apiKey=vitalshell-secret-key');
```

---

## Motor de reglas (dummy)

La lógica es **heurística y determinista** — no usa ningún modelo de machine learning. Se evalúa en dos momentos:
1. Tras cada `POST /api/sensors`
2. Tras cada actualización de una API externa (cron jobs)

Combina el último dato del sensor con todos los datos de APIs cacheados y genera reglas si se cumplen las condiciones. Nunca genera duplicados: si ya existe una regla con la misma condición en estado `pending` o `active`, la ignora.

### Reglas disponibles

| Condición | Acción generada | Fuente | Duración |
|---|---|---|---|
| Temperatura interior > 28°C | `activate_ventilation` | sensor | 2h |
| Temperatura interior < 16°C | `activate_heating` | sensor | 3h |
| Humedad interior > 75% | `activate_dehumidifier` | sensor | 1h |
| Humedad interior < 25% | `activate_humidifier` | sensor | 1h |
| Nivel de agua < 15% | `alert_low_water` | sensor | — |
| Batería < 20% | `alert_low_battery` | sensor | — |
| Temperatura exterior > 35°C | `close_blinds` | Open-Meteo | 4h |
| Temperatura exterior < 0°C | `insulate_pipes` | Open-Meteo | 8h |
| AQI europeo > 100 | `close_windows` | Open-Meteo AQ | 3h |
| Riesgo de incendio EFFIS alto | `alert_fire_risk` | EFFIS | 12h |
| Renovables ≥ 60% | `shift_load_to_now` | REData | 1h |
| Irradiancia solar > 5 kWh/m² | `activate_solar_charging` | NASA POWER | 6h |

> `duration_hours` es orientativo para el dashboard. El backend no cambia el estado automáticamente al expirar — debe hacerse vía `PATCH /api/rules/:id`.

---

## APIs externas

| API | Intervalo | Datos |
|---|---|---|
| [REData (Red Eléctrica)](https://www.ree.es/es/apidatos) | Cada 5 min | Demanda, % renovables, MW renovables |
| [Open-Meteo Weather](https://open-meteo.com) | Cada 15 min | Temperatura, humedad, precipitación, viento, código meteorológico |
| [Open-Meteo Air Quality](https://air-quality-api.open-meteo.com) | Cada 15 min | PM10, PM2.5, CO, NO₂, O₃, AQI europeo |
| [EFFIS (JRC)](https://effis.jrc.ec.europa.eu) | Cada 15 min | Incendios activos cercanos, nivel de riesgo |
| [AEMET](https://opendata.aemet.es) | Cada 15 min | Observación de la estación más cercana |
| [NASA POWER](https://power.larc.nasa.gov) | Diario (06:00) | Irradiancia solar (kWh/m²) |

Todas las respuestas se cachean en SQLite. Si una petición falla, se devuelven los últimos datos disponibles.

---

## Base de datos

SQLite gestionado con `better-sqlite3`. El fichero se crea automáticamente en la raíz del proyecto como `vitalshell.db`.

### Tablas

**`sensors`** — Lecturas del hardware
```sql
id, temperature, humidity, water_level, battery_level, timestamp, created_at
```

**`rules`** — Reglas del motor heurístico
```sql
id, condition, action, description, affected_layer,
status, duration_hours, trigger_source, created_at, updated_at
```

**`comfort`** — Preferencias de confort (siempre id=1)
```sql
id, temperature_min, temperature_max, humidity_min, humidity_max, updated_at
```

**`api_cache`** — Caché de APIs externas
```sql
id, source, data (JSON), updated_at
```

---

## Tests

```bash
npm test                 # todos los tests
npm run test:coverage    # con informe de cobertura
```

**44 tests distribuidos en 7 suites:**

| Suite | Tests | Qué cubre |
|---|---|---|
| `sensors.test.js` | 5 | POST /api/sensors, validaciones, historial por período |
| `data.test.js` | 3 | Auth 401, shape de la respuesta completa |
| `rules.test.js` | 16 | 10 tests unitarios del motor de reglas + 6 de integración REST |
| `comfort.test.js` | 5 | GET/POST, actualización parcial, validación min < max |
| `health.test.js` | 3 | Acceso público, shape, sensor offline en DB vacía |
| `websocket.test.js` | 5 | Auth WS, ping/pong, broadcast tras POST sensor |
| `apis.test.js` | 7 | Sistema de caché: miss, write/read, overwrite, getAllCached |

---

## Estructura del proyecto

```
vitalshell-backend/
├── index.js                        # Entry point: HTTP server + WS + cron
├── src/
│   ├── app.js                      # Express: middlewares y rutas
│   ├── middleware/
│   │   └── auth.js                 # Guard X-API-Key
│   ├── db/
│   │   ├── index.js                # Conexión SQLite singleton
│   │   └── migrations/
│   │       └── 001_initial.sql     # Esquema de tablas
│   ├── routes/
│   │   ├── sensors.js              # POST /api/sensors, GET /api/sensors/history
│   │   ├── data.js                 # GET /api/data
│   │   ├── rules.js                # GET|PATCH /api/rules
│   │   ├── comfort.js              # GET|POST /api/comfort
│   │   └── health.js               # GET /api/system/health
│   ├── services/
│   │   ├── sensors.js              # CRUD sensores + agrupación historial
│   │   ├── apis.js                 # Fetch + caché de 6 APIs externas
│   │   ├── rules.js                # Motor de reglas heurístico (dummy)
│   │   └── comfort.js              # Preferencias de confort
│   ├── websocket/
│   │   └── index.js                # WS server, auth upgrade, broadcast
│   └── cron/
│       └── index.js                # 7 cron jobs + initial fetch
├── tests/
│   ├── sensors.test.js
│   ├── data.test.js
│   ├── rules.test.js
│   ├── comfort.test.js
│   ├── health.test.js
│   ├── websocket.test.js
│   └── apis.test.js
├── .env.example
├── .gitignore
└── package.json
```
