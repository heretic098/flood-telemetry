# Project Rules & Customizations: Somerset Flood Telemetry Platform

## Core Governance & Mandatory Domain Invariants

This document establishes the inviolable domain rules, physical invariants, visual guidelines, and review protocols for all autonomous agents and human developers collaborating on this platform.

### Foundational Project Philosophy: Community Stewardship & Epistemic Humility

The platform is a community-driven flood telemetry tool coded by autonomous AI agents with platform engineering oversight. The human overseer is **NOT** a civil engineer, hydrologist, or Environment Agency policymaker. All collaborating agents MUST strictly uphold these foundational rules:

0. **[RULE-MOD-01] Model Quality Floor (Not a Ceiling) for Agents & Subagents:**
   - **Floor:** Every agent and subagent MUST run on a model at or above the floor tier: Claude Sonnet 5.5 (Medium or higher), Claude Opus 5.5, Gemini 4 Hydrogen (any level) or Gemini 4 Argon (any level). Anything below the floor is banned for all work, including "trivial" tasks: Gemini 3.8 Flash (any level), `flash`, `flash_lite`, `pro` (maps to a 3.8 Flash slot) and GPT-OSS 120B.
   - **No ceiling:** Pick the best-fitting model at or above the floor for the task. Do not downgrade to save effort, and do not pin everything to the top tier when a cheaper floor-tier model suffices.
   - **Contextual selection (guidance):**
     - Implementation, refactors, test fixing, docs: Claude Sonnet 5.5 (High) or Gemini 4 Hydrogen (High).
     - Adversarial review and sign-off (`code_reviewer`, `security_auditor`, `climate_hydrology_scientist`, `legal_eagle`): Claude Opus 5.5 (High), Gemini 4 Argon or Gemini 4 Hydrogen (XHigh).
     - Threshold/provenance work under `[RULE-THRESH-01]`: top of the available range, never the floor.
     - Argon weekly quota: prefer other floor-tier models while it is exhausted, unless the task needs it.
   - **Mechanism:** `invoke_subagent` only accepts `inherit`, `pro`, `flash` and `flash_lite`. Use `Model: 'inherit'` (never `pro`/`flash`/`flash_lite`) and the session model must itself meet the floor. To pin a specific model per role, spawn via the `swarm` tool's `add` action with an explicit `model` name that meets the floor. If the session model is below the floor, stop and ask the user to switch before delegating.

1. **[RULE-HUM-01] Epistemic Humility & Ban on Simulated Authority:**
   - Do **NOT** posture as an authoritative civil engineering consultant, SCADA operator, or certified hydrologist.
   - Do **NOT** invent academic jargon, speculative differential equations, or uncalibrated mathematical models to "look smart".
   - Speak plainly, directly, and modestly. When data is unavailable or uncertain, state it transparently.

2. **[RULE-PROV-01] Third-Party Data Stewardship & Anti-Overinterpretation:**
   - All upstream telemetry belongs to third parties (Environment Agency under OGL v3.0, community webcam hosts).
   - We are a transparent community conduit for raw public sensor data.
   - **NEVER** over-interpret raw telemetry. Do **NOT** extrapolate unmeasured quantities, unobserved river velocities, unbroadcast gate openings, or unmeasured pump run-states.

3. **[RULE-SUB-01] Empirical Substantiation Invariant (The "Smell Test" Gate):**
   - Every metric displayed in the UI, stored in SQLite, or output in an event record **MUST be directly traceable to raw ingested fields** (stage in metres, timestamp) or surveyed physical geometry (surveyed weir crest in mAOD).
   - If computing a metric requires parameters we do **NOT** collect (gate aperture $w$, cross-section $A$, roughness $n$, pump motor electrical status), **calculating or asserting it is STRICTLY PROHIBITED**.
   - Inferred operational states (e.g. "Mobile Pumps Ordered") must be explicitly qualified: *"Inferred from moor water stage relative to the EA Somerset Levels Trigger Point Plan."*

4. **[RULE-CALC-01] Strict Ban on Volumetric & Discharge Speculation (No Cumecs):**
   - Environment Agency telemetry provides **water stage ($m$)**. It does **NOT** provide open-channel river rating curves ($Q(h)$), sluice gate apertures ($w$), or SCADA pump electrical run telemetry.
   - Any attempt to calculate, integrate, or store volumetric discharge ($m^3/s$, cumecs, Megalitres/day, or volume $m^3$) as authoritative ground-truth or event triggers is **STRICTLY PROHIBITED**.
   - All assets, event triggers, and alerts are governed strictly by **Water Stage ($mAOD$ / $m$ depth), Structural Clearance ($m$), Duration ($h$), and Normalized Entity States**.

5. **[RULE-ENT-01] Canonical Tripartite Entity Invariant (Asset Type -> Asset Name -> Status):**
   $$\forall \text{ entity, UI component, database record, or event } E, \quad E \equiv \langle \text{asset\_type}, \text{asset\_name}, \text{status} \rangle$$
   - `asset_type`: `road`, `spillway`, `polder`, `tidal_gate`, `sluice`, `gauge`
   - `asset_id`: e.g. `cuts_road`, `muchelney_access`, `hookbridge`, `curry_moor`, `dunball_outfall`, `monks_leaze_clyse`
   - Normalized finite `status`:
     - `road`: `PASSABLE`, `ENCROACHING` ("damp/margin water"), `IMPASSABLE` ("submerged")
     - `spillway`: `SECURE`, `NEAR_CREST`, `OVERTOPPING`
     - `polder`: `STANDBY`, `DUTY_PUMPING`, `MOBILE_ORDERED`, `MOBILE_ACTIVE`, `CRITICAL`
     - `tidal_gate`: `DISCHARGING`, `TIDE_LOCKED`
     - `sluice`: `CLOSED`, `DIVERTING`, `THROTTLED`, `REVERSE_LOCK`
     - `gauge`: `NORMAL`, `ALERT`
   - **STRICTLY FORBIDDEN** from inventing bespoke concatenated event names (e.g. `CUTS_ROAD_CASCADE_START`, `MUCHELNEY_ROAD_INUNDATION` are banned).

6. **[RULE-CAM-01] Optical Camera Ground-Truth Invariant (Field-of-View Fidelity):**
   - When linking to or describing third-party optical webcams (e.g. `thecfh.org` or EA feeds), user-facing microcopy, link text, tooltips, and accessibility labels **MUST strictly and accurately describe the physical field of view captured by the camera lens**.
   - If a camera frames an open-channel spillway weir crest, road carriageway, or water staff gauge, claiming that it displays internal sluice gate positions, penstock apertures, or pump impellers is **STRICTLY PROHIBITED**.
   - Never invent speculative optical capabilities (e.g., "AI Gate Analysis") or invite residents to visually verify concealed, submerged, or off-camera hydraulic infrastructure.

7. **[RULE-SSOT-01] Single Source of Truth for Stations & Invariants:**
   - `STATION_REGISTRY` in `src/js/hydro_engine.js` is the strict Single Source of Truth for datums, alert levels, crests, baselines, and fallback stages. Never hardcode numeric constants elsewhere.
   - Maintain 100% calculation and fallback parity across `/api/status`, `/api/topology`, and client renderers (`[RULE-PAR-01]`).

8. **[RULE-PROC-01] Spike to Consolidation to Extension Protocol:**
   - Any rapid prototype or UI spike MUST undergo an architectural consolidation pass before receiving new features. Unconsolidated provisional code is barred from production commits.

9. **[UI-VIS-01] Mandatory Headless Chrome Visual Inspection:**
   - After any frontend, CSS, SVG, or status evaluation change, run `npm run snapshot` (`node scripts/capture_views.js`) and visually inspect generated `/tmp/flood-snapshots/*.png` screenshots via `read_file` to verify zero overlapping badges, matching CSS selectors, and 100% cross-view visual parity before committing.

10. **[RULE-TEST-02] Hermetic Clean-Room Test Execution:**
    - All test suites MUST be hermetic and self-seeding. Tests are strictly forbidden from relying on pre-existing ambient SQLite data on developer machines or state mutated by earlier test suites.
    - Every test suite querying the database MUST either instantiate an isolated database (`DB_PATH`) or idempotently seed its required fixtures in setup hooks (`test.before()`), and pass `npm run test:clean`.

11. **[RULE-SEC-02] Cloud Resource Identifier & Bucket Isolation:**
    - Cloud storage bucket names (S3/Tigris), internal resource identifiers, and tenant URIs MUST NEVER be hardcoded or committed in source-controlled files (`fly.toml`, `litestream.yml`, tests, or documentation).
    - All cloud resource identifiers must be injected dynamically at runtime via encrypted secret stores (`fly secrets` / environment variables), using high-entropy random suffixes to prevent public namespace enumeration.

12. **[RULE-CONF-01] Declarative Configuration Syntax Hygiene:**
    - Unverified POSIX shell parameter expansions (such as `${VAR:-default}`) are strictly prohibited in non-shell declarative configuration files (YAML, TOML, JSON) unless explicitly verified against the target binary's parser specification (e.g., Go `os.ExpandEnv` only supports `${VAR}`).
    - Default fallback logic must be handled in the wrapping shell entrypoint or specified as tested literal values.

13. **[RULE-INFRA-01] Container Volume Writeability & Single-Writer Replication:**
    - Persistent volume mounts (such as `/data`) shadow build-time image directory permissions. Entrypoint scripts (`scripts/docker-entrypoint.sh`) MUST execute a pre-flight writeability probe as the runtime non-root user (`USER node`) and fail fast with an explicit diagnostic if root-shadowing occurs.
    - Replicated SQLite WAL deployments (`litestream`) MUST enforce a single-writer deployment strategy (`strategy = 'immediate'` in `fly.toml`) to prevent split-brain WAL generation divergence.

14. **[RULE-THRESH-01] Threshold Provenance, Physical Operating Hierarchy & Anti-Laundering Gate:**
    - **Ban on Self-Referential Provenance Laundering:** Numeric structural thresholds (`crest_elevation_mAOD`, `trigger_elevation_mAOD`, `crown_elevation_mAOD`, `sill_elevation_mAOD`, `alert_level_mAOD`) MUST NEVER be sourced from repo comments, camera descriptions, issue prose, or ambient `fallback_stage_mAOD` values. Assigning `Tier 1 (Surveyed)` or `Tier 2 (Trigger Plan)` provenance without a verifiable external primary citation (EA `stageScale` API field, published EA Somerset Levels Trigger Point Plan table, SRA engineering specification, or LiDAR DSM) is **STRICTLY PROHIBITED**.
    - **Unsurveyed Structure Handling:** If a physical structure (such as an un-gated grassed spillway or embankment) lacks a verifiable surveyed elevation in primary public records, its elevation MUST remain `null` / `UNSURVEYED` (`⚠️ Pending EA Asset Survey`) and MUST NOT be wired to automated `OVERTOPPING` or `IMPASSABLE` event triggers.
    - **Strict Physical Operating Hierarchy:** Along any shared reach or bifurcation, thresholds must strictly satisfy:
      $$Z_{\text{invert}} < Z_{\text{normal\_penning}} < Z_{\text{controlled\_sluice\_trigger}} < Z_{\text{emergency\_spillway\_crest}} \le Z_{\text{max\_on\_record}}$$
      An uncontrolled emergency overflow spillway (`OVERTOPPING`) can **NEVER** have a crest lower than or equal to a co-located controlled sluice diversion trigger (`DIVERTING`) or within `0.50m` of routine agricultural penning / baseflow (`fallback_stage_mAOD`).
    - **Ban on Fallback Tampering to Mask Falsified Thresholds:** If a proposed threshold collides with `fallback_stage_mAOD` or triggers alerts against historical non-flood median telemetry in `telemetry.db`, **the threshold hypothesis is falsified**. Agents are **STRICTLY FORBIDDEN** from lowering or mutating `fallback_stage_mAOD` (inventing synthetic baseflow numbers) to make a falsified threshold pass tests.

15. **[RULE-TOK-01] Token & Context Hygiene (Tree-Sitter MCP & Quiet Tests):**
    - **Prefer Tree-Sitter MCP for Code Structure:** For symbol lookups, AST inspection, and usage discovery in large files (`src/js/hydro_engine.js`, `src/js/app.js`, `src/js/topology.js`, `server.js`), use the `tree-sitter` MCP server (`get_symbols`, `find_usage`, `get_ast`, `find_text`) instead of dumping whole files or running broad, multi-hundred-line `grep` outputs into context.
    - **Targeted Tests During Iteration:** During active development, run only the relevant test file(s) (`node --test tests/<file>.test.js`). Reserve full clean-room verification for pre-commit sign-off, and use `npm run test:clean:quiet` (`--test-reporter=dot`) so passing test logs do not bloat the context window with ~46KB of checkmarks.
    - **Avoid Unnecessary Subagents:** Do not spawn subagents or swarm workers for single-file or straightforward edits that the coordinator can complete directly in 1–2 turns.

---

### Team Roles & On-Demand Skills Directory

Detailed domain guidelines, mathematical models, visual rules, and audit checklists are modularized into dedicated on-demand skills in `.agents/skills/`. Agents MUST invoke or consult their respective skill:

1. **Climate & Hydrology Scientist (`climate_hydrology_scientist`):**
   - **Mandate:** Lowland hydrology, open-channel hydraulics, vertical datum integrity (mAOD Newlyn), alert bounding inequality, 5-class structural taxonomy (`spillway`, `gauge`, `clyse_gate`, `polder_basin`, `tidal_outfall`), and downhill hydraulic slope invariants.
   - **Active Skill:** `.agents/skills/somerset-hydrology-validation/SKILL.md`
   - **Sign-Off Protocol:** Passes `tests/hydrological_network_audit.test.js`.

2. **UI/UX Design Specialist (`ui_ux_designer`):**
   - **Mandate:** Non-technical resident usability, cognitive clarity, strict trichromatic separation (UI-COL-01), estuarine low-tide blue rule (UI-COL-02), dynamic threshold semantic styling (UI-COL-03), spatial monotonicity (UI-DAT-01), interactive timeline scrubbing (UI-INT-01), and WCAG 2.1 AA / APCA contrast compliance (UI-ACC-01).
   - **Active Skill:** `.agents/skills/topology-ui-ux-design-standards/SKILL.md`
   - **Sign-Off Protocol:** Passes `tests/topology_ui_ux_audit.test.js` and `npm run snapshot` inspection.

3. **Cynical & Demanding Code Reviewer (`code_reviewer`):**
   - **Mandate:** Zero-trust code audit, instant rejection gates, memory leak detection, XSS prevention, defensive null-handling, and invariant enforcement.
   - **Active Skill:** `.agents/skills/cynical-code-auditor/SKILL.md`
   - **Sign-Off Protocol:** Formal Cynical Review Report with PASS/FAIL/WARN verdict.

4. **Security & Infrastructure Auditor (`security_auditor`):**
   - **Mandate:** Cloud secret and bucket name isolation (`[RULE-SEC-02]`), SSRF/XSS/CSP enforcement, non-root container privilege boundaries (`[RULE-INFRA-01]`), declarative configuration parser validation (`[RULE-CONF-01]`), and dependency vulnerability auditing (`npm audit`).
   - **Active Skill:** `.agents/skills/cynical-code-auditor/SKILL.md` (Rubric D & Infrastructure Security Gates)
   - **Sign-Off Protocol:** Formal Security & Infrastructure Audit Report with PASS/FAIL/WARN verdict.

5. **Legal & Compliance Specialist (`legal_eagle`):**
   - **Mandate:** Open Government Licence v3.0 attribution, Crown copyright, Apache 2.0 open-source compliance, and UK common law non-reliance legal insulation (*Hedley Byrne* doctrine).

6. **QA Test Engineer (`qa_test_engineer`):**
   - **Mandate:** Automated regression testing, hermetic clean-room test verification (`npm run test:clean`, `[RULE-TEST-02]`), physical invariant assertions, dual audit execution (`npm test`), and edge-case verification (sensor dropouts, flatlines, extreme floods).

7. **Full Stack Developer (`fullstack_developer`):**
   - **Mandate:** Modular HTML5/CSS/JavaScript components, Express endpoints, SQLite WAL cache integration, and real-time auto-refresh loops.
