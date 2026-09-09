# Somerset Levels & Moors Flood Monitoring Dashboard

An open-source, human-friendly real-time telemetry dashboard for tracking water levels, clyse/sluice gate operation, spillway overtopping states, and pumping station operational stages across the Somerset Levels and Moors (River Tone and Parrett catchments).

🌐 **Live Production App:** [https://somerset-flood-dashboard.fly.dev](https://somerset-flood-dashboard.fly.dev)

---

## Key Features

- **Moor-Centric Catchment Cards:** Intuitive, human-friendly status cards for Curry Moor, Northmoor & Saltmoor, Sowy Relief Channel, and Dunball Sea Outfall.
- **5-Stage Operational Pumping Model & Trigger Scale Bars:** Displays permanent and emergency mobile pumping station operational stages (`Stage 0: Standby`, `Stage 1: Duty`, `Stage 2: Mobile Ordered`, `Stage 3: Mobile Active`, `Stage 4: Critical Overspill`) with dynamic stage-colored fill tracks and staggered tick labels.
- **Seasonal Penning Regime Awareness:** Automatic calendar evaluation (`getSeasonalRegime`) distinguishing ☀️ **Summer Penning Regime** (April 15 – October 15) from ❄️ **Winter Flood Regime** (October 16 – April 14), dynamically adjusting pumping triggers and moor targets.
- **3-Tier Telemetry Accounting & Freshness Drawer:** Clear separation between Upstream EA Sensor Reading Time (`latest_ea_reading_at`), Database Ingest Time (`db_synced_at`), and Client Render Time (`client_poll_at`) with modal health drawer and status matrix.
- **Differential Head Analysis:** Hydraulic inference of clyse gate open/closed/tide-locked states from paired EA telemetry sensors.
- **Spillway Overtopping Monitor:** Real-time evaluation of river height relative to crest elevations via the Villemonte submergence weir equation.
- **Methodology & Data Provenance Page:** Complete reference page (`/methodology.html`) detailing physics equations, Environment Agency station metadata, SOP trigger tables, and public data disclaimers.

---

## Technical Architecture

- **Backend / Cache Layer:** Node.js server (`server.js`) with embedded SQLite database (`telemetry.db` in WAL mode). Runs a 5-minute background ingest worker syncing 8 Environment Agency telemetry measures into SQLite.
- **Frontend UI:** HTML5, CSS3 design system with glassmorphic cards, color-blind accessible badges, micro-sparklines with bounded y-axis windowing ($minSpan = 0.50\text{m}$), and responsive mobile layout.
- **Deployment:** Deployed on **Fly.io** (`lhr` region) via multi-stage Docker build (`Dockerfile`) with zero-downtime scaling (`min_machines_running = 0`).

---

## Project Structure

```
somerset-flood-dashboard/
├── server.js                   # Node.js backend & SQLite ingest server
├── Dockerfile                  # Production container build
├── fly.toml                    # Fly.io deployment configuration
├── PROJECT_OUTLINE.md          # Master architecture and design specification
├── README.md                   # Project summary & quickstart guide
├── src/
│   ├── index.html              # Main real-time flood monitoring dashboard
│   ├── methodology.html        # Engineering methodology & EA registry page
│   ├── css/
│   │   ├── tokens.css          # Design system variables & color palette
│   │   └── styles.css          # Card, scale bar, drawer, & footer styles
│   └── js/
│       ├── app.js              # UI render engine & modal drawer controller
│       ├── hydro_engine.js     # Hydraulic equations & seasonal SOP engine
│       └── config/
│           └── hydro_config.json # Structure crests & station metadata
└── tests/
    └── hydro_engine.test.js    # Unit test suite for hydraulic & seasonal logic
```

---

## Local Development & Testing

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Test Suite
```bash
npm test
```

### 3. Start Local Server
```bash
npm start
```
Open `http://localhost:3000` in your browser.

---

## Deployment (Fly.io)

Deploy updates using `flyctl`:
```bash
/home/jonathan/.fly/bin/flyctl deploy
```
