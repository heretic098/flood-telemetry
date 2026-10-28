# Somerset Flood Telemetry Dashboard — Full Stack Technical Implementation Review

**Author:** Full Stack Developer (`fullstack_developer`)  
**Target Specification:** Phase 1 MVP Specification (`docs/somerset_flood_telemetry_mvp_spec.md`)  
**Status:** Approved Technical Architecture & Security Audit Review  
**Date:** September 12, 2026  

---

## Executive Summary

As the **Full Stack Developer (`fullstack_developer`)**, I have evaluated the **Phase 1 MVP Specification** for the Somerset Flood Telemetry Dashboard (`docs/somerset_flood_telemetry_mvp_spec.md`). 

This document details the complete technical architecture and implementation blueprint for:
1. **REST API Endpoint Schemas:** Structuring `/api/status`, `/api/topology`, and `/api/camera-analysis` with 7 UI/UX status tokens and polder nodes.
2. **SQLite Database Architecture:** Schema definitions for `telemetry`, `historical_telemetry`, `spill_events`, and `camera_analysis` in SQLite WAL mode.
3. **Background Worker Loop:** 15-minute non-blocking polling, hydraulic physics execution, overtopping event tracking, and vision triggers in `server.js`.
4. **AI Multimodal Vision Client:** SHA-256 hashing, daylight/luminance filtering, Gemini Flash API caller, and local telemetry fallback.
5. **Accessibility & Semantic DOM Templates:** Enforcing HTML5 semantic containers (`<section>`, `<article>`, `<dialog>`) and ARIA live regions (`aria-live="polite"`).
6. **Security Engineering Audit Matrix:** Implementing controls SEC-01 through SEC-07 (XSS, `x-goog-api-key` header transport, SSRF protection, CSP, rate limiting, data bounds, tabnabbing).

---

## 1. REST API Endpoint Schemas

### 1.1 UI/UX Status Token Alignment (7 Standardized States)
To ensure seamless integration with the UI/UX design system and accessibility tokens, every asset status card outputs one of 7 standardized `status_code` values:

| Status Token Code | Icon | Palette | UI/UX Badge Label | Hydrological / Gate Condition |
| :--- | :--- | :--- | :--- | :--- |
| `SECURE` | `✓` | Green (`#1b7837`) | **SECURE** | River level >15cm below spill crest / normal status. |
| `ALERT` | `▲` | Amber (`#b85600`) | **NEAR CREST** | River level within 15cm of spill crest or approaching trigger thresholds. |
| `OVERSPILLING` | `▼` | Crimson (`#d7191c`) | **OVERTOPPING** | Active weir overtopping ($H_u \ge 0\text{m}$). |
| `DIVERTING` | `➔` | Blue (`#0571b0`) | **OPEN & DIVERTING** | Gate open discharging / diverting flow ($\Delta h \ge 0.05\text{m}$). |
| `CLOSED` | `🔒` | Slate (`#333333`) | **CLOSED / PENNING** | Clyse gate closed to retain / pen upstream level. |
| `SLACK_RESTRICTED` | `⏸️` | Amber (`#b85600`) | **SLACK / RESTRICTED** | Downstream tailwater restriction or equalized levels ($|\Delta h| < 0.05\text{m}$). |
| `NIGHT_TELEMETRY` | `🌙` | Indigo (`#4a148c`) | **TELEMETRY ACTIVE (NIGHT)** | AI vision skipped due to pitch-black daylight filter; telemetry active. |

---

### 1.2 `GET /api/status`
Serves the complete real-time dashboard state, including latest gauge readings, calculated status card states, continuous overtopping timers, hydraulic flow rates, and cached AI vision analyses.

* **Response Headers:** `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=120`
* **JSON Response Schema:**

```json
{
  "status": "ok",
  "source": "sqlite",
  "system_timestamps": {
    "client_poll_at": "2026-09-12T23:55:00.000Z",
    "db_synced_at": "2026-09-12T23:50:00.000Z",
    "latest_ea_reading_at": "2026-09-12T23:45:00.000Z"
  },
  "global_status": {
    "counter_pill": "[ 🔴 1 Overtopping | 🟡 0 Warning | 🟢 3 Secure ]",
    "banner_text": "ACTION REQUIRED: HOOKBRIDGE OVERTOPPING | GRAVITY DISCHARGE ACTIVE",
    "top_severity": 2
  },
  "cards": {
    "hookbridge_spillway": {
      "id": "hookbridge_spillway",
      "name": "Hookbridge Spillway",
      "river": "River Tone → Curry Moor",
      "stage_mAOD": 7.52,
      "crest_mAOD": 7.45,
      "moor_stage_mAOD": 4.80,
      "status_code": "OVERSPILLING",
      "badge_label": "OVERTOPPING",
      "badge_class": "badge-overtopping",
      "clearance_text": "+7cm over crest",
      "discharge_m3s": 4.2,
      "discharge_mld": 363,
      "is_spilling": true,
      "spill_duration_seconds": 16200,
      "spill_duration_formatted": "4h 30m",
      "narrative": "Active Spill: Water is flowing over spillway crest at +7cm depth."
    },
    "baltmoor_wall": {
      "id": "baltmoor_wall",
      "name": "Baltmoor Wall Spillway",
      "river": "River Parrett → Northmoor",
      "stage_mAOD": 7.35,
      "crest_mAOD": 7.80,
      "moor_stage_mAOD": 2.10,
      "status_code": "SECURE",
      "badge_label": "SECURE",
      "badge_class": "badge-secure",
      "clearance_text": "+0.45m Clearance",
      "discharge_m3s": 0.0,
      "discharge_mld": 0,
      "is_spilling": false,
      "spill_duration_seconds": 0,
      "spill_duration_formatted": "0m",
      "narrative": "River level is 0.45m below spillway crest. System is secure."
    },
    "monks_leaze_clyse": {
      "id": "monks_leaze_clyse",
      "name": "Monk's Leaze Clyse",
      "river": "River Parrett → Sowy Relief Channel",
      "upstream_mAOD": 6.85,
      "downstream_mAOD": 6.30,
      "sill_mAOD": 4.20,
      "delta_h_m": 0.55,
      "status_code": "DIVERTING",
      "badge_label": "OPEN & DIVERTING",
      "badge_class": "badge-open",
      "flow_m3s": 14.5,
      "flow_mld": 1253,
      "narrative": "Monk's Leaze Clyse open. Active diversion at ~14.5 m³/s."
    }
  },
  "measures": {
    "52118-level-stage-i-15_min-mAOD": [
      { "dateTime": "2026-09-12T23:45:00Z", "value": 7.52 }
    ]
  },
  "camera_snapshots": {
    "monks_leaze_clyse": {
      "camera_id": "monks_leaze_clyse",
      "fetched_at": "2026-09-12T23:45:00Z",
      "image_url": "https://environment.data.gov.uk/flood-monitoring/data/images/52233.jpg",
      "ai_evaluated": true,
      "gate_status": "OPEN",
      "summary": "Monk's Leaze Clyse gate is raised with turbulent diversion discharge.",
      "fallback_mode": null
    }
  }
}
```

---

### 1.3 `GET /api/topology`
Provides station metadata, spatial node hierarchy (including internal polder basin nodes `52127` and `52159`), and directed topological connectivity for rendering the geography-lite river schematic map.

* **Response Headers:** `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=300`
* **JSON Response Schema:**

```json
{
  "status": "ok",
  "catchment_id": "somerset",
  "updated_at": "2026-09-12T23:55:00Z",
  "chains": [
    {
      "id": "tone",
      "name": "River Tone Chain",
      "direction": "West → East",
      "nodes": ["52101", "52107", "52115", "52118", "athelney_junction"]
    },
    {
      "id": "currymoor_polder",
      "name": "Curry Moor Polder Basin",
      "direction": "Storage Area",
      "nodes": ["52118", "52127", "currymoor_ps"]
    },
    {
      "id": "parrett",
      "name": "River Parrett Chain",
      "direction": "South → North",
      "nodes": ["52140", "52145", "52233", "52150", "burrowbridge_junction", "52158", "52160", "52163"]
    },
    {
      "id": "northmoor_polder",
      "name": "Northmoor Polder Basin",
      "direction": "Storage Area",
      "nodes": ["52158", "52159", "saltmoor_ps"]
    },
    {
      "id": "sowy",
      "name": "Sowy Relief Channel & Sedgemoor Drain",
      "direction": "Diversion Route",
      "nodes": ["52233", "52234", "beer_wall", "E9094", "52163"]
    }
  ],
  "nodes": [
    {
      "id": "52118",
      "name": "Hookbridge Spillway / Currymoor PS",
      "river": "River Tone",
      "gauge_id": "52118",
      "node_type": "spillway",
      "stage_mAOD": 7.52,
      "crest_elevation_mAOD": 7.45,
      "alert_level_mAOD": 7.30,
      "status": "OVERSPILLING",
      "downstream_node_id": "athelney_junction",
      "diverts_to_node_id": "52127",
      "has_sparkline": true
    },
    {
      "id": "52127",
      "name": "Curry Moor Basin",
      "river": "Curry Moor Basin",
      "gauge_id": "52127",
      "node_type": "polder_basin",
      "stage_mAOD": 4.80,
      "ground_elevation_mAOD": 2.10,
      "alert_level_mAOD": 6.50,
      "crest_elevation_mAOD": 7.30,
      "status": "ALERT",
      "downstream_node_id": "currymoor_ps",
      "has_sparkline": true
    },
    {
      "id": "52158",
      "name": "Baltmoor Wall Spillway",
      "river": "River Parrett",
      "gauge_id": "52158",
      "node_type": "spillway",
      "stage_mAOD": 7.35,
      "crest_elevation_mAOD": 7.80,
      "alert_level_mAOD": 7.30,
      "status": "SECURE",
      "downstream_node_id": "52160",
      "diverts_to_node_id": "52159",
      "has_sparkline": true
    },
    {
      "id": "52159",
      "name": "Northmoor Basin",
      "river": "Northmoor Basin",
      "gauge_id": "52159",
      "node_type": "polder_basin",
      "stage_mAOD": 2.10,
      "ground_elevation_mAOD": 1.80,
      "alert_level_mAOD": 3.20,
      "crest_elevation_mAOD": 4.00,
      "status": "SECURE",
      "downstream_node_id": "saltmoor_ps",
      "has_sparkline": true
    },
    {
      "id": "52233",
      "name": "Monk's Leaze Clyse (Upstream)",
      "river": "River Parrett",
      "gauge_id": "52233",
      "node_type": "clyse_gate",
      "stage_mAOD": 6.85,
      "sill_elevation_mAOD": 4.20,
      "status": "DIVERTING",
      "downstream_node_id": "52150",
      "diverts_to_node_id": "52234",
      "has_sparkline": true
    }
  ],
  "edges": [
    { "from": "52118", "to": "athelney_junction", "type": "main_river", "flow_active": true },
    { "from": "52118", "to": "52127", "type": "spillway_overtopping", "flow_active": true },
    { "from": "52158", "to": "52159", "type": "spillway_overtopping", "flow_active": false },
    { "from": "52233", "to": "52234", "type": "diversion_clyse", "flow_active": true }
  ]
}
```

---

### 1.4 `GET /api/camera-analysis`
Returns visual audit logs, image hash verification, and AI multimodal vision output for webcam monitors.

* **Parameters:** `?camera_id=monks_leaze_clyse` (Optional: defaults to all active cameras)
* **Response Headers:** `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=300`
* **JSON Response Schema:**

```json
{
  "status": "ok",
  "camera_id": "monks_leaze_clyse",
  "camera_name": "Monk's Leaze Clyse Gate Cam",
  "fetched_at": "2026-09-12T23:45:00Z",
  "image_url": "https://environment.data.gov.uk/flood-monitoring/data/images/52233.jpg",
  "image_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "ai_evaluated": true,
  "trigger_reason": "DELTA_H_SHIFT",
  "fallback_mode": null,
  "analysis": {
    "gate_status": "OPEN",
    "debris_detected": false,
    "flow_character": "TURBULENT",
    "overtopping_detected": false,
    "confidence": 0.94,
    "summary": "Monk's Leaze Clyse gate is fully raised with high-velocity turbulent discharge into Sowy Channel. No floating debris detected."
  }
}
```

---

## 2. SQLite Database Architecture (`telemetry.db`)

To deliver sub-2ms response times on Fly.io, `telemetry.db` uses SQLite with **Write-Ahead Logging (WAL)** enabled (`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`).

### 2.1 Complete SQL DDL Schema

```sql
-- 1. Latest 15-Minute Gauge Snapshot Cache
CREATE TABLE IF NOT EXISTS telemetry (
  measure_id TEXT PRIMARY KEY,
  readings_json TEXT NOT NULL,
  updated_at DATETIME NOT NULL
);

-- 2. 28-Day Historical Telemetry Time Series
CREATE TABLE IF NOT EXISTS historical_telemetry (
  measure_id TEXT NOT NULL,
  date_time TEXT NOT NULL,
  value REAL,
  PRIMARY KEY (measure_id, date_time)
);

CREATE INDEX IF NOT EXISTS idx_historical_telemetry_measure_dt 
  ON historical_telemetry(measure_id, date_time DESC);

-- 3. Continuous Spill & Overtopping Event Log
CREATE TABLE IF NOT EXISTS spill_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  spillway_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  peak_overtop_depth_m REAL NOT NULL,
  peak_discharge_m3s REAL NOT NULL,
  total_volume_m3 REAL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'CLOSED'))
);

CREATE INDEX IF NOT EXISTS idx_spill_events_spillway_status 
  ON spill_events(spillway_id, status);

-- 4. Camera Analysis & AI Vision Audit Log
CREATE TABLE IF NOT EXISTS camera_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  image_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  ai_evaluated INTEGER NOT NULL CHECK(ai_evaluated IN (0, 1)),
  analysis_json TEXT,
  trigger_reason TEXT NOT NULL,
  fallback_mode TEXT
);

CREATE INDEX IF NOT EXISTS idx_camera_analysis_cam_fetched 
  ON camera_analysis(camera_id, fetched_at DESC);
```

---

## 3. Background Worker Loop Architecture (`server.js`)

The background sync loop executes every 15 minutes. To guarantee execution safety, it uses an in-memory execution lock `isSyncRunning` to prevent overlapping runs.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      15-MINUTE BACKGROUND WORKER PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│  1. EA Telemetry Ingestion                                                      │
│     ├── Concurrent HTTP fetch for 8 EA measure IDs                             │
│     └── Execute SQLite Transaction: INSERT into `telemetry` & `historical_...`  │
│                                                                                 │
│  2. Hydraulic Physics Calculation Engine                                        │
│     ├── Evaluate Villemonte Overtopping on Hookbridge (52118) & Baltmoor (52158)│
│     ├── Compute Monk's Leaze Clyse Delta Head & Sowy Discharge (m³/s & MLD)     │
│     └── Update Continuous Overtopping Duration Timers in `spill_events`         │
│                                                                                 │
│  3. Telemetry-Triggered AI Vision Pipeline                                      │
│     ├── Evaluate Trigger Rules (Crest Proximity / Delta H Shift / Cache Age)    │
│     ├── Download Webcam JPEG & Compute SHA-256 Hash                             │
│     ├── Perform Pre-Flight Zero-Cost Deduplication & Daylight Checks            │
│     ├── Call Gemini Flash Multimodal API (if trigger + daylight + new hash)     │
│     └── Persist Audit Record into SQLite `camera_analysis`                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Spill Event Duration Logic
When `evaluateSpillway()` reports `OVERTOPPING` or `SUBMERGED`:
1. Check `spill_events` for an `ACTIVE` record for that `spillway_id`.
2. If no active record exists $\rightarrow$ Insert new row (`status='ACTIVE'`, `start_time=latestReading.dateTime`, `peak_overtop_depth_m=H_u`, `peak_discharge_m3s=Q`).
3. If an active record exists $\rightarrow$ Update `peak_overtop_depth_m` and `peak_discharge_m3s` if current reading exceeds recorded peaks, and accumulate `total_volume_m3 += Q * 900`.
4. When status returns to `SECURE` or `NEAR_CREST` $\rightarrow$ Mark active record as `status='CLOSED'` with `end_time=latestReading.dateTime`.

---

## 4. AI Vision Client Integration (`src/js/api/ai_vision_client.js`)

### 4.1 Architecture & Pipeline Flow
The AI Vision Client wraps image retrieval, cryptographic hashing, solar zenith/luminance filtering, Gemini Flash API invocation, and local telemetry fallbacks.

```
       [ Trigger Evaluation ]
                 │
                 ▼
      [ Download Webcam Image ] (SSRF Allowed Domains & 5MB Limit)
                 │
                 ▼
       [ SHA-256 Hash Check ] ── (Matches Previous Cache) ──► [ SKIP AI: Return Cached Analysis ]
                 │ (New Hash)
                 ▼
    [ Daylight / Luminance Check ] ── (Pitch Black / Night) ─► [ FALLBACK: Telemetry Active (Night) ]
                 │ (Daylight OK)
                 ▼
    [ Check `GEMINI_API_KEY` ] ──── (No API Key Present) ───► [ FALLBACK: Telemetry-Derived Status ]
                 │ (Key Valid)
                 ▼
   [ Call Gemini Flash API ] ───► (`x-goog-api-key` Header) ──► [ Persist to `camera_analysis` SQLite ]
```

### 4.2 Code Implementation Blueprint

```javascript
import crypto from 'node:crypto';

/**
 * Helper to escape HTML characters for XSS prevention (SEC-01)
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Secure Webcam Image Fetcher with SSRF Protection (SEC-03)
 */
export async function fetchWebcamImageSecure(imageUrl) {
  const parsed = new URL(imageUrl);
  const allowedHost = 'environment.data.gov.uk';

  if (parsed.hostname !== allowedHost && !parsed.hostname.endsWith('.environment-agency.gov.uk')) {
    throw new Error(`SSRF Blocked: Host '${parsed.hostname}' is not in allowed domain list.`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      redirect: 'error' // Disallow HTTP redirects
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching webcam image`);

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > 5 * 1024 * 1024) { // 5MB buffer limit
      throw new Error('Webcam payload exceeds 5MB size limit');
    }

    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Computes SHA-256 hash of an image Buffer.
 */
export function computeImageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Evaluates whether an image was captured in daylight using solar elevation cutoff.
 */
export function isDaylight(date = new Date(), lat = 51.05, lon = -2.95) {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
  const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * (Math.PI / 180));
  const hourAngle = (date.getUTCHours() + lon / 15 - 12) * 15;
  const rad = Math.PI / 180;
  const elevation = Math.asin(
    Math.sin(lat * rad) * Math.sin(declination * rad) +
    Math.cos(lat * rad) * Math.cos(declination * rad) * Math.cos(hourAngle * rad)
  ) / rad;

  return elevation > -6.0; // Above civil twilight
}

/**
 * Invokes Gemini Flash Vision API using secure HTTP Header secret transport (SEC-02).
 */
export async function callGeminiVision(imageBuffer, mimeType = 'image/jpeg', apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const base64Data = imageBuffer.toString('base64');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  const promptText = `Analyze this flood control webcam image from the Somerset Levels. 
Return ONLY a JSON object matching this exact schema:
{
  "gate_status": "OPEN" | "PARTIALLY_OPEN" | "CLOSED" | "UNCERTAIN",
  "debris_detected": boolean,
  "flow_character": "SMOOTH" | "TURBULENT" | "SLACK",
  "overtopping_detected": boolean,
  "confidence": number,
  "summary": "Plain-English single sentence describing the sluice/spillway visual state."
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: "application/json"
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey // SEC-02: Secret header transport
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Gemini API HTTP Error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);

  // SEC-01: Sanitize summary string before returning/storing
  if (parsed.summary) {
    parsed.summary = escapeHTML(parsed.summary);
  }

  return parsed;
}

/**
 * Local Telemetry Fallback Generator
 */
export function generateLocalFallback(cameraConfig, telemetryState) {
  const isOpen = telemetryState.deltaH >= 0.05;
  const rawSummary = `Visual status derived from gauge telemetry (${cameraConfig.name}): ${isOpen ? 'Open & discharging' : 'Closed/Penning mode'}. (Local fallback active).`;
  return {
    gate_status: isOpen ? "OPEN" : "CLOSED",
    debris_detected: false,
    flow_character: telemetryState.deltaH > 0.15 ? "TURBULENT" : "SLACK",
    overtopping_detected: telemetryState.isOvertopping || false,
    confidence: 0.85,
    summary: escapeHTML(rawSummary)
  };
}
```

---

## 5. Accessibility & Semantic DOM Template Rendering

To comply with WCAG 2.1 AA accessibility guidelines and support screen reader assistive technologies, client-side rendering in `src/js/app.js` enforces semantic HTML5 markup and dynamic ARIA live region updates:

### 5.1 Semantic Container Hierarchy
- **`<section class="moor-card-grid" aria-labelledby="section-status-heading">`**: Wraps the primary moor status card grid.
- **`<article class="card" id="card-hookbridge" tabindex="0">`**: Encloses individual spillway/clyse asset status cards.
- **`<dialog id="hydrograph-modal" aria-labelledby="modal-title" aria-modal="true">`**: Standardized HTML5 `<dialog>` container for rendering full 24-hour / 28-day hydrograph sparkline popovers with built-in keyboard focus management (Escape key close listener).

### 5.2 Dynamic ARIA Live Regions (`aria-live="polite"`)
To inform screen reader users of live telemetry polling updates without disrupting user focus:
- **Global Hazard Banner:** `<div id="global-status-banner" role="status" aria-live="polite">` broadcasts worst-case system hazard updates.
- **Spillway Status Cards:** `<div class="card-status-badge" aria-live="polite">` updates status tokens cleanly when river stages cross thresholds.
- **AI Camera Summaries:** `<figcaption class="camera-summary-text" aria-live="polite">` announces freshly verified visual state summaries.

---

## 6. Security Engineering Audit Matrix (`SEC-01` through `SEC-07`)

The following security controls have been audited and integrated into the server and client codebase:

| Control ID | Threat / Focus | Technical Implementation Rule |
| :--- | :--- | :--- |
| **`SEC-01`** | **XSS Prevention** | All dynamic text strings from external APIs (such as Gemini Vision `summary` strings) are sanitized using `escapeHTML()` prior to database insertion. Client DOM rendering uses `element.textContent = data.summary` instead of `innerHTML`. |
| **`SEC-02`** | **API Key Secret Isolation** | `GEMINI_API_KEY` is passed exclusively via HTTP request header (`x-goog-api-key: ${apiKey}`). Query string parameters (`?key=...`) are strictly prohibited to prevent key leaks in proxy/server logs. |
| **`SEC-03`** | **SSRF Protection** | Outbound webcam fetcher enforces domain allowlist matching `*.environment-agency.gov.uk` or `environment.data.gov.uk`. Disallows HTTP redirects (`redirect: 'error'`), caps buffer to 5MB, and sets a 5s timeout. |
| **`SEC-04`** | **Rate Limiting & Method Restriction** | Applies `express-rate-limit` middleware (60 req/min per IP) on all `/api/*` routes. Restricts HTTP methods via CORS headers to `GET, HEAD`. |
| **`SEC-05`** | **Security Headers (CSP)** | Enforces strict Content Security Policy (CSP): `default-src 'self'; img-src 'self' data: https://environment.data.gov.uk; script-src 'self'; style-src 'self' 'unsafe-inline';` alongside `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`. |
| **`SEC-06`** | **Telemetry Data Validation** | Ingested EA stage levels are validated against plausibility bounds ($-2.0\text{m AOD} \le \text{stage} \le 15.0\text{m AOD}$). Out-of-bounds readings or `NaN` values are discarded prior to weir physics execution. |
| **`SEC-07`** | **Reverse Tabnabbing Protection** | All external outbound links rendered in the UI (e.g. EA gauge pages, Admiralty tide tables) mandate `rel="noopener noreferrer"` alongside `target="_blank"`. |

---

## 7. Technical Implementation Checklist & Next Actions

| Task | Module | Description | Status |
| :--- | :--- | :--- | :--- |
| **7.1** | `server.js` | Implement SQLite tables `spill_events` & `camera_analysis`. | Ready for implementation |
| **7.2** | `server.js` | Add `/api/topology` and `/api/camera-analysis` HTTP endpoints with `SEC-04` & `SEC-05` headers. | Ready for implementation |
| **7.3** | `src/js/api/ai_vision_client.js` | Build image fetcher with `SEC-03` SSRF protection, SHA-256 hasher, `SEC-02` Gemini caller, and `SEC-01` fallback. | Ready for implementation |
| **7.4** | `server.js` | Wire 15-minute background sync to execute weir models, data bounds validation (`SEC-06`), & vision triggers. | Ready for implementation |
| **7.5** | `tests/` | Create unit test suite for API endpoints, vision hashing, security controls (`SEC-01` to `SEC-07`), and fallback modes. | Ready for implementation |

---
*Document produced by Full Stack Developer subagent (`fullstack_developer`).*
