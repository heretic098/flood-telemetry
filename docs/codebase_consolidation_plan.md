# Codebase Consolidation & Refactoring Plan

**Status:** Ready for Subagent Execution  
**Verification Gate:** Every work item MUST pass `npm test` (`81/81+` tests) AND visual inspection via `npm run snapshot` (`node scripts/capture_views.js` + `read_file` on `/tmp/flood-snapshots/*.png`).

---

## Work Item 1: Canonical 19-Station Registry & Unified Telemetry Extraction (`src/js/hydro_engine.js`, `server.js`, `src/js/app.js`, `src/js/topology.js`)

### Problem
- Surveyed gauge datums (`+75.69m`, `+20.70m`, `+16.58m`, `+12.47m`, `+10.00m`, `+5.00m`, `+5.185m`), channel bed baselines, alert levels, and fallback readings are duplicated across four files:
  1. `server.js` (`/api/topology`, lines 545–840)
  2. `server.js` (`/api/status`, lines 1046–1065) — *contains stale overtopping fallback defaults such as `hookbridgeStage ?? 7.52` while `/api/topology` uses `4.50`!*
  3. `src/js/topology.js` (`DEFAULT_TOPOLOGY_NODES`, `GAUGE_DATUMS`, `STATION_BASELINES`)
  4. `src/js/app.js` (`renderDashboard`, lines 380–425)
- `HYDRO_THRESHOLDS` in `src/js/hydro_engine.js` (lines 509–562) only covers 9 of the 19 stations.

### Actionable Requirements
1. **Expand `STATION_REGISTRY` & `HYDRO_THRESHOLDS` in `src/js/hydro_engine.js`:**
   - Define a canonical exported `STATION_REGISTRY` object keyed by all 19 station IDs (`52108`, `52109`, `52111`, `52162`, `52118`, `52127`, `52116`, `52119`, `52120`, `52153`, `52233`, `52158`, `52159`, `52124`, `52163`, `52234`, `52157`, `E9531`, `E9094`).
   - Each entry must include:
     - `id`, `name`, `river`, `catchment`, `node_type` (strictly one of the 5 canonical classes: `spillway`, `gauge`, `clyse_gate`, `polder_basin`, `tidal_outfall`)
     - `measure_id` (e.g. `'52120-level-stage-i-15_min-mASD'`)
     - `datum_offset_mAOD` (e.g. `5.000` for `52120`, `0.00` for native mAOD gauges)
     - `baseline_invert_mAOD` (replacing `STATION_BASELINES` in `topology.js`)
     - `alert_level_mAOD`
     - `crest_elevation_mAOD` (ONLY for `spillway` and `polder_basin` capacity reference; strictly `undefined` for `gauge`)
     - `sill_elevation_mAOD` (for `clyse_gate`)
     - `fallback_stage_mAOD` (calm baseflow fallback value)
2. **Add `extractStationStage(measures, stationId)` to `src/js/hydro_engine.js`:**
   - Looks up `STATION_REGISTRY[stationId].measure_id` in `measures`, applies `datum_offset_mAOD`, validates via `sanitizeStageValue()`, and falls back to `fallback_stage_mAOD`.
3. **Refactor Consumers:**
   - Update `server.js` (`/api/topology` and `/api/status`) to use `extractStationStage()` and `STATION_REGISTRY` so `/api/status` and `/api/topology` never use conflicting fallback numbers.
   - Update `src/js/topology.js` (`GAUGE_DATUMS`, `STATION_BASELINES`, `DEFAULT_TOPOLOGY_NODES`) and `src/js/app.js` to import from `hydro_engine.js`.

---

## Work Item 2: Eliminate Legacy Pump Defaults, Inline Evaluations & Duplicate Config JSON (`src/js/hydro_engine.js`, `src/js/topology.js`, `server.js`, `src/js/config/`)

### Problem
1. `evaluatePumpStatus()` in `src/js/hydro_engine.js` (lines 169–178) still has legacy uncalibrated default arguments (`mobileOrderTrigger = 4.40, mobileActiveTrigger = 4.60, criticalSpillTrigger = 4.85`) if a caller omits those parameters.
2. `inspectNode()` in `src/js/topology.js` (lines 1174–1263) uses inline `if (stage >= ...)` checks for Huish Episcopi (`52120`), Midelney (`52153`), Curry Moor (`52127`), and Northmoor (`52159`) instead of calling `evaluateHuishEpiscopi()`, `evaluateMidelney()`, and `evaluatePumpStatus()` from `src/js/hydro_engine.js`.
3. `src/js/config/hydro_config.json` is a duplicate copy of `src/js/config/catchments/somerset.json`.

### Actionable Requirements
1. Update the default parameter values in `evaluatePumpStatus()` (`src/js/hydro_engine.js`) to the calibrated EA Trigger Point Plan values (`mobileOrderTrigger = 5.80, mobileActiveTrigger = 6.10, criticalSpillTrigger = 6.50`).
2. Refactor `inspectNode()` in `src/js/topology.js` to call `evaluateHuishEpiscopi()`, `evaluateMidelney()`, and `evaluatePumpStatus()` from `src/js/hydro_engine.js` so the Topology Inspector and Main Dashboard share 100% identical evaluation logic.
3. In `server.js`, route requests for `/js/config/hydro_config.json` to serve `src/js/config/catchments/somerset.json` (and keep `hydro_config.json` synchronized or symlinked) so threshold edits only happen in one place.

---

## Work Item 3: Remove Unused `express` Dependency (`package.json`)

### Problem
- `package.json` lists `"express": "^4.21.2"` under `dependencies`, but `server.js` uses Node's native `node:http` module exclusively and never imports `express`.

### Actionable Requirements
1. Remove `"express"` from `package.json` and run `npm prune` / update `package-lock.json`.
2. Verify server startup and all 81+ tests via `npm test`.

---

## Work Item 4: Shared Sparkline Geometry & Interactive Scrubbing Module (`src/js/sparkline.js`, `src/js/app.js`, `src/js/topology.js`)

### Problem
- `src/js/app.js` (`renderSingleSparkline`, `bindSparklineEvents`, lines 1182–1580) and `src/js/topology.js` (`renderInspectorSparkline`, `bindInspectorSparklineEvents`, lines 1515–1820) duplicate ~250 lines of SVG coordinate projection, flat-line collapse logic (`isFlatStage`), and pointer/keyboard crosshair scrubbing.

### Actionable Requirements
1. Extract shared sparkline helpers (flat-stage detection, coordinate scaling, timestamp formatting, and pointer/touch/keyboard crosshair event binding) into a shared ES module `src/js/sparkline.js` (or shared exports in `src/js/hydro_engine.js`), while preserving all existing function signatures (`renderSingleSparkline`, `renderDualSparkline`, `bindSparklineEvents`, `renderInspectorSparkline`, `bindInspectorSparklineEvents`) and DOM markup so all existing unit and UI/UX audit tests pass without weakened assertions.
2. Run `npm test` and `npm run snapshot` (inspecting `/tmp/flood-snapshots/dashboard_main.png` and `/tmp/flood-snapshots/topology_52163.png` via `read_file`) to confirm zero visual or functional regressions.
