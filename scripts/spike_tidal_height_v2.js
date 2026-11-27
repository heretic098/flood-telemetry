#!/usr/bin/env node
/**
 * Issue #25 Tidal Harmonic, Skew-Surge & Estuarine Cascade PoC (v2)
 *
 * Standalone, strictly read-only benchmark script.
 * Evaluates:
 *   1. Sensor QC & 3-point parabolic sub-15-min High Water peak extraction
 *   2. Full Bristol Channel harmonic model (Rayleigh-gated up to 35 constituents)
 *      with 18.6-year lunar nodal (f, u) corrections & ridge regularization (1e-4)
 *   3. Strictly causal Hinkley (52106) skew-surge forecasting at ~12h lead:
 *        Model A:  Baseline 10-constituent Astro (v1 parity, no nodal)
 *        Model B:  Full 32/35-constituent Astro + Nodal
 *        Model B2: POL-42 Bristol Channel Shallow-Water Compound Astro + Compound L2 Nodal
 *        Model C:  Full Astro + Nodal + AR(1) previous-HW skew surge
 *        Model D:  Full Astro + Nodal + AR(1) + Offshore Met Forcing (if cache present)
 *        Model E1: Bias-corrected Open-Meteo Marine HW directly (if marine cache present)
 *        Model E2: Full Astro + AR(1) + Offshore Met + Raw Marine Diff (v2.1 baseline)
 *        Model E3: POL-42 + De-tided Marine Surge + Innovation AR(1,2) + 2D Wind + Tide-Surge (v2.2)
 *        Model E4: Model E3 + Onshore Wave Setup & Swell (v2.3, if waves cache present)
 *      + Honest Day-1 Forecast Degradation Audit (Hindcast vs Open-Meteo previous_runs, if cache present)
 *   4. Two-Horizon Estuarine Cascade (52106 -> 52163 -> 52124 -> 52118):
 *        Horizon 1 (12h Forecast) & Horizon 2 (1-2h Wave-in-Channel Nowcast)
 *        including 1-feature vs 2-feature (headDiff + hPre) Hookbridge models
 *   5. Full-Year Coastal Canary ~1h Nowcast Benchmark (E72439 Ilfracombe & E73039 Milford Haven -> 52106 -> 52163)
 *      including 2026-10-09 07:47 Hinkley outage healing verification (if full-year canary series in DB)
 *   6. Top 10 Worst Out-of-Sample Storm/Error Tides inspection table
 *   7. Targeted Storm-Day & Outage Canary Gauge Cross-Check (if canary cache present)
 *
 * Governance:
 *   - [RULE-HUM-01] / [RULE-SUB-01] / [RULE-CALC-01]: Strictly stage (mAOD),
 *     wave height (m), clearance (m), and timing (min/h). Zero discharge/cumec calculations.
 *   - Strict chronological train/test splits across Summer/Autumn and Winter Storm regimes.
 *   - Read-only on SQLite databases ({ readonly: true }).
 *
 * CLI flags:
 *   --db=ea_somerset_archive.db
 *   --merge-db=telemetry.db         (or --merge-db=none)
 *   --weather=data/tidal_poc_cache/tidal_poc_offshore_weather.json
 *   --prev-weather=data/tidal_poc_cache/tidal_poc_previous_runs_weather.json
 *   --marine=data/tidal_poc_cache/tidal_poc_marine_archive.json
 *   --waves=data/tidal_poc_cache/tidal_poc_marine_waves.json
 *   --canary=data/tidal_poc_cache/tidal_poc_canary_gauges.json
 *   --split=YYYY-MM-DD              (optional explicit chronological split date)
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);

function getArg(prefix, defaultVal) {
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : defaultVal;
}

const DB_PATH = path.resolve(ROOT_DIR, getArg('--db=', 'ea_somerset_archive.db'));
const MERGE_ARG = getArg('--merge-db=', 'telemetry.db');
const MERGE_DB_PATH =
  MERGE_ARG && MERGE_ARG.toLowerCase() !== 'none'
    ? path.resolve(ROOT_DIR, MERGE_ARG)
    : null;
const WEATHER_PATH = getArg('--weather=', 'data/tidal_poc_cache/tidal_poc_offshore_weather.json');
const PREV_WEATHER_PATH = getArg('--prev-weather=', 'data/tidal_poc_cache/tidal_poc_previous_runs_weather.json');
const MARINE_PATH = getArg('--marine=', 'data/tidal_poc_cache/tidal_poc_marine_archive.json');
const WAVES_PATH = getArg('--waves=', 'data/tidal_poc_cache/tidal_poc_marine_waves.json');
const CANARY_PATH = getArg('--canary=', 'data/tidal_poc_cache/tidal_poc_canary_gauges.json');
const SPLIT_ARG = getArg('--split=', '');

const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const STEP_15M_MS = 15 * 60000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

// Surveyed vertical datum adjustments (mASD -> mAOD Newlyn) per somerset-hydrology-validation SKILL
const STATION_DATUMS = {
  '52106': 0.0,
  '52163': 0.0,
  '52124': 0.0,
  '52118': 0.0,
  '52119': 10.0, // Gaw Bridge: +10.00 m AOD
  'E9094': 0.0,
  'E72439': 0.0, // Ilfracombe (NTSLF/EA tidal)
  'E73039': 0.0  // Milford Haven (NTSLF/EA tidal)
};

// Physical plausibility bounds (mAOD) to strip sensor sentinels (e.g. -99 on 52106, 244514 on 52124, 7.5-7.9m stuck-high fault on 52163)
const STATION_BOUNDS = {
  '52106': { min: -8.0, max: 7.5 },
  '52163': { min: -3.0, max: 7.35 }, // Max on record 7.09m; 7.45-7.93m readings are known sensor faults
  '52124': { min: -3.0, max: 8.5 },
  '52118': { min: 1.0, max: 9.0 },
  '52119': { min: 9.0, max: 16.0 }, // in mAOD (+10.0m applied)
  'E9094': { min: -2.0, max: 6.0 },
  'E72439': { min: -8.0, max: 7.5 },
  'E73039': { min: -8.0, max: 7.5 }
};

// ---------------------------------------------------------------------------
// 1. Astronomical Arguments & Nodal Corrections (18.6-year lunar cycle)
// ---------------------------------------------------------------------------

function astroArgs(ms) {
  const d = (ms - J2000_MS) / DAY_MS;
  const T = d / 36525.0;
  const s = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const h = 280.4664567 + 36000.76982779 * T + 0.0003032 * T * T;
  const p = 83.3532465 + 4069.0137287 * T - 0.01032 * T * T;
  const N = 125.044555 - 1934.1362608 * T + 0.0020754 * T * T;
  return { s, h, p, N };
}

/**
 * Compute standard 18.6-year lunar nodal amplitude factor f(t) and phase shift u(t) (deg)
 * for all supported Bristol Channel tidal constituents (Schureman 1958 / Foreman 1977).
 */
function computeNodalFactors(ms) {
  const { N, p } = astroArgs(ms);
  const Nrad = N * DEG;
  const prad = p * DEG;

  const fM2 = 1.0004 - 0.0373 * Math.cos(Nrad) + 0.0002 * Math.cos(2 * Nrad);
  const uM2 = -2.14 * Math.sin(Nrad);

  const fK2 =
    1.0241 +
    0.2863 * Math.cos(Nrad) +
    0.0083 * Math.cos(2 * Nrad) -
    0.0015 * Math.cos(3 * Nrad);
  const uK2 =
    -17.74 * Math.sin(Nrad) +
    0.68 * Math.sin(2 * Nrad) -
    0.04 * Math.sin(3 * Nrad);

  // L2 nodal modulation (Schureman Eq. 215/216 approximation)
  const rA =
    1.0 -
    0.2505 * Math.cos(2 * prad) -
    0.1102 * Math.cos(2 * prad - Nrad) -
    0.0156 * Math.cos(2 * prad - 2 * Nrad) -
    0.037 * Math.cos(Nrad);
  const fL2 = Math.max(0.5, fM2 * Math.sqrt(Math.max(0.25, rA)));
  const uL2 =
    uM2 -
    (Math.atan2(
      0.2505 * Math.sin(2 * prad) +
        0.1102 * Math.sin(2 * prad - Nrad) +
        0.0156 * Math.sin(2 * prad - 2 * Nrad),
      1.0 -
        0.2505 * Math.cos(2 * prad) -
        0.1102 * Math.cos(2 * prad - Nrad) -
        0.0156 * Math.cos(2 * prad - 2 * Nrad)
    ) /
      DEG);

  const fK1 =
    1.006 +
    0.115 * Math.cos(Nrad) -
    0.0088 * Math.cos(2 * Nrad) +
    0.0006 * Math.cos(3 * Nrad);
  const uK1 =
    -8.86 * Math.sin(Nrad) +
    0.68 * Math.sin(2 * Nrad) -
    0.07 * Math.sin(3 * Nrad);

  const fO1 =
    1.0089 +
    0.1871 * Math.cos(Nrad) -
    0.0147 * Math.cos(2 * Nrad) +
    0.0014 * Math.cos(3 * Nrad);
  const uO1 =
    10.8 * Math.sin(Nrad) -
    1.34 * Math.sin(2 * Nrad) +
    0.19 * Math.sin(3 * Nrad);

  const fJ1 =
    1.0129 +
    0.1676 * Math.cos(Nrad) -
    0.017 * Math.cos(2 * Nrad) +
    0.0016 * Math.cos(3 * Nrad);
  const uJ1 =
    -12.94 * Math.sin(Nrad) +
    1.34 * Math.sin(2 * Nrad) -
    0.19 * Math.sin(3 * Nrad);

  const fOO1 =
    1.1027 +
    0.6504 * Math.cos(Nrad) +
    0.0317 * Math.cos(2 * Nrad) -
    0.0014 * Math.cos(3 * Nrad);
  const uOO1 =
    -36.68 * Math.sin(Nrad) +
    4.02 * Math.sin(2 * Nrad) -
    0.57 * Math.sin(3 * Nrad);

  const fMm = 1.0 - 0.13 * Math.cos(Nrad);
  const fMf = 1.043 + 0.414 * Math.cos(Nrad);
  const uMf = -23.7 * Math.sin(Nrad) + 2.7 * Math.sin(2 * Nrad);

  const fM2_2 = fM2 * fM2;
  const fM2_3 = fM2_2 * fM2;
  const fM2_4 = fM2_2 * fM2_2;

  return {
    M2: { f: fM2, u: uM2 },
    S2: { f: 1.0, u: 0.0 },
    N2: { f: fM2, u: uM2 },
    K2: { f: fK2, u: uK2 },
    L2: { f: fL2, u: uL2 },
    L2_2MN2: { f: fM2_3, u: uM2 }, // Shallow-water compound 2MN2 dominance at L2 frequency
    MU2: { f: fM2, u: uM2 },
    NU2: { f: fM2, u: uM2 },
    LDA2: { f: fM2, u: uM2 },
    '2N2': { f: fM2, u: uM2 },
    '2SM2': { f: fM2, u: -uM2 },
    T2: { f: 1.0, u: 0.0 },
    // Proudman (POL) Bristol Channel shallow-water compound constituents
    MSN2: { f: fM2_2, u: 0.0 },
    MNS2: { f: fM2_2, u: 2 * uM2 },
    SKM2: { f: fK2 * fM2, u: uK2 - uM2 },
    MKS2: { f: fM2 * fK2, u: uM2 + uK2 },
    MSK2: { f: fM2 * fK2, u: uM2 - uK2 },
    '3M2S2': { f: fM2_3, u: 3 * uM2 },
    MNUS2: { f: fM2_2, u: 2 * uM2 },
    OQ2: { f: fO1 * fO1, u: 2 * uO1 },
    K1: { f: fK1, u: uK1 },
    O1: { f: fO1, u: uO1 },
    P1: { f: 1.0, u: 0.0 },
    Q1: { f: fO1, u: uO1 },
    J1: { f: fJ1, u: uJ1 },
    OO1: { f: fOO1, u: uOO1 },
    MK3: { f: fM2 * fK1, u: uM2 + uK1 },
    MO3: { f: fM2 * fO1, u: uM2 + uO1 },
    M3: { f: Math.pow(fM2, 1.5), u: 1.5 * uM2 },
    M4: { f: fM2_2, u: 2 * uM2 },
    MS4: { f: fM2, u: uM2 },
    MN4: { f: fM2_2, u: 2 * uM2 },
    SN4: { f: fM2, u: uM2 },
    S4: { f: 1.0, u: 0.0 },
    '3MS4': { f: fM2_3, u: 3 * uM2 },
    M6: { f: fM2_3, u: 3 * uM2 },
    '2MS6': { f: fM2_2, u: 2 * uM2 },
    '2MN6': { f: fM2_3, u: 3 * uM2 },
    '2SM6': { f: fM2, u: uM2 },
    M8: { f: fM2_4, u: 4 * uM2 },
    '3MS8': { f: fM2_3, u: 3 * uM2 },
    Mm: { f: fMm, u: 0.0 },
    MSf: { f: fM2, u: -uM2 },
    Mf: { f: fMf, u: uMf },
    Sa: { f: 1.0, u: 0.0 },
    Ssa: { f: 1.0, u: 0.0 }
  };
}

// ---------------------------------------------------------------------------
// 2. Rayleigh-Gated Constituent Sets
// ---------------------------------------------------------------------------

// Baseline v1 constituents (up to 10)
const BASELINE_6 = [
  { name: 'M2', speed: 28.9841042 },
  { name: 'S2', speed: 30.0 },
  { name: 'K1', speed: 15.0410686 },
  { name: 'O1', speed: 13.9430356 },
  { name: 'M4', speed: 57.9682084 },
  { name: 'MS4', speed: 58.9841042 }
];
const BASELINE_8 = [
  ...BASELINE_6,
  { name: 'N2', speed: 28.4397295 },
  { name: 'MN4', speed: 57.4238337 }
];
const BASELINE_10 = [
  ...BASELINE_8,
  { name: 'K2', speed: 30.0821373 },
  { name: 'P1', speed: 14.9589314 }
];

function selectBaselineConstituents(trainDays) {
  if (trainDays >= 183) return BASELINE_10;
  if (trainDays >= 28) return BASELINE_8;
  return BASELINE_6;
}

// Full Bristol Channel constituent hierarchy (up to 35)
const FULL_TIER1_6 = [...BASELINE_6];

const FULL_TIER2_22 = [
  ...FULL_TIER1_6,
  { name: 'N2', speed: 28.4397295 },
  { name: 'MU2', speed: 27.9682084 },
  { name: 'L2', speed: 29.5284789 },
  { name: 'NU2', speed: 28.5125831 },
  { name: 'LDA2', speed: 29.4556253 },
  { name: '2SM2', speed: 31.0158958 },
  { name: '2N2', speed: 27.8953548 },
  { name: 'Q1', speed: 13.3986609 },
  { name: 'MK3', speed: 44.0251729 },
  { name: 'MO3', speed: 42.9271398 },
  { name: 'MN4', speed: 57.4238337 },
  { name: 'S4', speed: 60.0 },
  { name: 'M6', speed: 86.9523127 },
  { name: '2MS6', speed: 87.9682084 },
  { name: '2MN6', speed: 86.407938 },
  { name: 'M8', speed: 115.9364169 }
];

const FULL_TIER3_32 = [
  ...FULL_TIER2_22,
  { name: 'K2', speed: 30.0821373 },
  { name: 'P1', speed: 14.9589314 },
  { name: 'J1', speed: 15.5854433 },
  { name: 'OO1', speed: 16.1391017 },
  { name: 'SN4', speed: 58.4397295 },
  { name: '2SM6', speed: 88.9841042 },
  { name: '3MS8', speed: 116.9523127 },
  { name: 'Mm', speed: 0.5443747 },
  { name: 'MSf', speed: 1.0158958 },
  { name: 'Mf', speed: 1.0980331 }
];

const FULL_TIER4_35 = [
  ...FULL_TIER3_32,
  { name: 'T2', speed: 29.9589333 },
  { name: 'Sa', speed: 0.0410686 },
  { name: 'Ssa', speed: 0.0821373 }
];

function selectFullConstituents(trainDays) {
  if (trainDays >= 365) return FULL_TIER4_35;
  if (trainDays >= 183) return FULL_TIER3_32;
  if (trainDays >= 28) return FULL_TIER2_22;
  return FULL_TIER1_6;
}

// Proudman (POL) Bristol Channel shallow-water compound constituents (all Rayleigh-resolvable >= 183d)
const POL_COMPOUND_10 = [
  { name: 'MSN2', speed: 30.5443747 },  // M2 + S2 - N2 (~9.1 cm at Hinkley)
  { name: 'SKM2', speed: 31.0980331 },  // S2 + K2 - M2 (~7.7 cm)
  { name: 'MNS2', speed: 27.4238337 },  // M2 + N2 - S2 (~6.1 cm)
  { name: 'MKS2', speed: 29.0662415 },  // M2 + K2 - S2 (~6.1 cm, equinoctial sideband)
  { name: '3M2S2', speed: 26.9523126 }, // 3*M2 - 2*S2  (~5.6 cm)
  { name: 'MSK2', speed: 28.9019669 },  // M2 + S2 - K2 (~5.6 cm, equinoctial sideband)
  { name: 'M3', speed: 43.4761563 },    // Lunar terdiurnal (~4.4 cm)
  { name: 'OQ2', speed: 27.3416964 },   // O1 + Q1 (~4.1 cm)
  { name: 'MNUS2', speed: 27.4966873 }, // M2 + NU2 - S2 (~4.0 cm)
  { name: '3MS4', speed: 56.9523127 }   // 3*M2 - S2 (~2.6 cm)
];

function selectPolConstituents(trainDays) {
  const base = selectFullConstituents(trainDays);
  if (trainDays >= 183) {
    return [
      ...base.map(c => (c.name === 'L2' ? { ...c, nodalKey: 'L2_2MN2' } : c)),
      ...POL_COMPOUND_10
    ];
  }
  return base.map(c => (c.name === 'L2' ? { ...c, nodalKey: 'L2_2MN2' } : c));
}

// ---------------------------------------------------------------------------
// 3. Linear Algebra & Regression Helpers
// ---------------------------------------------------------------------------

function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = col; j <= n; j++) M[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map(row => row[n]);
}

/**
 * Ridge-regularized OLS on feature matrix X (each row excludes intercept) and target y.
 * Standardizes features internally so ridge penalty is scale-invariant.
 */
function fitRidgeOLS(X, y, lambda = 1e-2) {
  const n = X.length;
  const k = X[0].length;
  const means = new Array(k).fill(0);
  const stds = new Array(k).fill(1);
  for (let j = 0; j < k; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    means[j] = s / n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = X[i][j] - means[j];
      v += d * d;
    }
    stds[j] = Math.sqrt(v / n) || 1.0;
  }

  const p = k + 1;
  const XtX = Array.from({ length: p }, () => new Float64Array(p));
  const Xty = new Float64Array(p);
  const row = new Float64Array(p);
  row[0] = 1.0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      row[j + 1] = (X[i][j] - means[j]) / stds[j];
    }
    const yi = y[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * yi;
      for (let b = a; b < p; b++) {
        XtX[a][b] += row[a] * row[b];
      }
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    if (a >= 1) XtX[a][a] += lambda;
  }

  const betaStd = solveLinearSystem(
    XtX.map(r => Array.from(r)),
    Array.from(Xty)
  );

  // Convert back to raw feature scale for transparent reporting
  const coefs = new Array(k).fill(0);
  let intercept = betaStd[0];
  for (let j = 0; j < k; j++) {
    coefs[j] = betaStd[j + 1] / stds[j];
    intercept -= coefs[j] * means[j];
  }

  return {
    intercept,
    coefs,
    predict(xRow) {
      let out = intercept;
      for (let j = 0; j < k; j++) out += coefs[j] * xRow[j];
      return out;
    }
  };
}

/**
 * Fit harmonic regression with optional 18.6-year lunar nodal factors (f, u)
 * and ridge regularization on non-intercept terms.
 */
function fitHarmonics(series, t0Ms, constituents, { useNodal = true, ridge = 1e-4 } = {}) {
  const m = constituents.length;
  const p = 1 + 2 * m;
  const XtX = Array.from({ length: p }, () => new Float64Array(p));
  const Xty = new Float64Array(p);
  const row = new Float64Array(p);
  row[0] = 1.0;

  // Cache daily nodal factors (N changes by ~0.053 deg/day, completely smooth within a day)
  const nodalDayCache = new Map();
  const getNodal = ms => {
    const dayKey = Math.floor(ms / DAY_MS);
    let nf = nodalDayCache.get(dayKey);
    if (!nf) {
      nf = computeNodalFactors((dayKey + 0.5) * DAY_MS);
      nodalDayCache.set(dayKey, nf);
    }
    return nf;
  };

  for (let idx = 0; idx < series.length; idx++) {
    const pt = series[idx];
    const tHr = (pt.ms - t0Ms) / HOUR_MS;
    const nf = useNodal ? getNodal(pt.ms) : null;

    for (let c = 0; c < m; c++) {
      const con = constituents[c];
      let f = 1.0;
      let uDeg = 0.0;
      const nKey = con.nodalKey || con.name;
      if (nf && nf[nKey]) {
        f = nf[nKey].f;
        uDeg = nf[nKey].u;
      }
      const rad = (con.speed * tHr + uDeg) * DEG;
      row[1 + 2 * c] = f * Math.cos(rad);
      row[2 + 2 * c] = f * Math.sin(rad);
    }

    const yi = pt.value;
    for (let a = 0; a < p; a++) {
      const ra = row[a];
      Xty[a] += ra * yi;
      const rowA = XtX[a];
      for (let b = a; b < p; b++) {
        rowA[b] += ra * row[b];
      }
    }
  }

  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    if (a >= 1) XtX[a][a] += ridge;
  }

  const beta = solveLinearSystem(
    XtX.map(r => Array.from(r)),
    Array.from(Xty)
  );

  const fitted = constituents.map((c, idx) => {
    const a = beta[1 + 2 * idx];
    const b = beta[2 + 2 * idx];
    return {
      name: c.name,
      nodalKey: c.nodalKey || c.name,
      speed: c.speed,
      a,
      b,
      amplitude: Math.hypot(a, b)
    };
  });

  return {
    t0Ms,
    useNodal,
    z0: beta[0],
    constituents: fitted,
    predict(ms) {
      const tHr = (ms - t0Ms) / HOUR_MS;
      const nf = useNodal ? getNodal(ms) : null;
      let y = beta[0];
      for (let c = 0; c < m; c++) {
        const con = fitted[c];
        let f = 1.0;
        let uDeg = 0.0;
        if (nf && nf[con.nodalKey]) {
          f = nf[con.nodalKey].f;
          uDeg = nf[con.nodalKey].u;
        }
        const rad = (con.speed * tHr + uDeg) * DEG;
        y += f * (con.a * Math.cos(rad) + con.b * Math.sin(rad));
      }
      return y;
    }
  };
}

// ---------------------------------------------------------------------------
// 4. Sensor QC, Data Loading & Parabolic Peak Extraction
// ---------------------------------------------------------------------------

function toNearest15Min(ms) {
  return Math.round(ms / STEP_15M_MS) * STEP_15M_MS;
}

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtDateTime(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function loadSqliteSeries(db, stationId, measureId) {
  const datum = STATION_DATUMS[stationId] || 0.0;
  const bounds = STATION_BOUNDS[stationId] || { min: -10, max: 30 };
  const rawMin = bounds.min - datum;
  const rawMax = bounds.max - datum;

  const rows = db
    .prepare(
      `SELECT date_time, value FROM historical_telemetry
       WHERE measure_id = ? AND value IS NOT NULL AND value > ? AND value < ?
       ORDER BY date_time ASC`
    )
    .all(measureId, rawMin, rawMax);

  return rows.map(r => ({
    ms: toNearest15Min(new Date(r.date_time).getTime()),
    value: Number(r.value) + datum
  }));
}

function mergeSeriesByMs(baseSeries, extraSeries) {
  const byMs = new Map();
  for (const pt of baseSeries) byMs.set(pt.ms, pt);
  for (const pt of extraSeries) byMs.set(pt.ms, pt);
  return [...byMs.values()].sort((a, b) => a.ms - b.ms);
}

/**
 * Strip isolated single-sample spikes and flatlined/stuck tidal days.
 */
function qcTidalSeries(series, label, { minDailyRange = 1.0, maxDailyMin = 2.5 } = {}) {
  // 1. Isolated spike filter (|v[i] - neighbors| > 2.5m while neighbors agree within 1.5m)
  let spikeCount = 0;
  const despiked = [];
  for (let i = 0; i < series.length; i++) {
    const cur = series[i];
    if (i > 0 && i < series.length - 1) {
      const prev = series[i - 1];
      const next = series[i + 1];
      if (
        cur.ms - prev.ms <= 30 * 60000 &&
        next.ms - cur.ms <= 30 * 60000 &&
        Math.abs(prev.value - next.value) < 1.5 &&
        Math.abs(cur.value - prev.value) > 2.5 &&
        Math.abs(cur.value - next.value) > 2.5
      ) {
        spikeCount++;
        continue;
      }
    }
    despiked.push(cur);
  }

  // 2. Stuck / flatlined UTC day filter
  const byDay = new Map();
  for (const pt of despiked) {
    const d = fmtDate(pt.ms);
    let stat = byDay.get(d);
    if (!stat) {
      stat = { min: pt.value, max: pt.value, count: 0 };
      byDay.set(d, stat);
    }
    if (pt.value < stat.min) stat.min = pt.value;
    if (pt.value > stat.max) stat.max = pt.value;
    stat.count++;
  }
  const badDays = new Set();
  for (const [d, s] of byDay) {
    if (
      s.count >= 12 &&
      (s.max - s.min < minDailyRange || (maxDailyMin !== null && s.min > maxDailyMin))
    ) {
      badDays.add(d);
    }
  }
  if (spikeCount > 0 || badDays.size > 0) {
    const sampleDays = [...badDays].slice(0, 4).join(', ');
    console.log(
      `[QC] ${label}: stripped ${spikeCount} isolated spikes, ${badDays.size} stuck/anomalous days` +
        (badDays.size ? ` (e.g. ${sampleDays})` : '')
    );
  }
  return despiked.filter(pt => !badDays.has(fmtDate(pt.ms)));
}

/**
 * Extract High Water peaks with 3-point parabolic vertex interpolation for
 * exact sub-15-min HW height (mAOD) and timestamp (trueMs).
 *
 * Continuity guardrails (fixes partial-outage false peaks like 2026-10-09 07:47):
 *   - Rejects any candidate peak if gap to previous or next sample > 30 min
 *   - Rejects any candidate peak if fewer than 5 valid samples lie within [t - 60m, t + 60m]
 */
function findParabolicPeaks(series, minPeakVal = 2.0, minSepMs = 8 * HOUR_MS, label = null) {
  const peaks = [];
  let rejectedGap = 0;
  let rejectedDensity = 0;
  const MAX_ADJ_GAP_MS = 30 * 60000;
  const DENSITY_HALF_WIN_MS = 60 * 60000;
  const MIN_WINDOW_SAMPLES = 5;

  for (let i = 2; i < series.length - 2; i++) {
    const v = series[i].value;
    if (v < minPeakVal) continue;
    if (
      v >= series[i - 1].value &&
      v >= series[i + 1].value &&
      v >= series[i - 2].value &&
      v >= series[i + 2].value
    ) {
      const prev = series[i - 1];
      const next = series[i + 1];
      const tCur = series[i].ms;

      // Guardrail 1: adjacent continuity (gap <= 30 min on both sides)
      if (tCur - prev.ms > MAX_ADJ_GAP_MS || next.ms - tCur > MAX_ADJ_GAP_MS) {
        rejectedGap++;
        continue;
      }

      // Guardrail 2: local density (>= 5 valid samples within [t - 60m, t + 60m])
      let winCount = 1;
      for (let j = i - 1; j >= 0 && tCur - series[j].ms <= DENSITY_HALF_WIN_MS; j--) {
        winCount++;
      }
      for (let j = i + 1; j < series.length && series[j].ms - tCur <= DENSITY_HALF_WIN_MS; j++) {
        winCount++;
      }
      if (winCount < MIN_WINDOW_SAMPLES) {
        rejectedDensity++;
        continue;
      }

      let trueMs = tCur;
      let trueValue = v;

      // 3-point parabolic vertex interpolation if adjacent 15-min points exist
      if (tCur - prev.ms === STEP_15M_MS && next.ms - tCur === STEP_15M_MS) {
        const y0 = prev.value;
        const y1 = v;
        const y2 = next.value;
        const denom = y0 - 2 * y1 + y2;
        if (denom < -1e-9) {
          const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
          trueMs = tCur + delta * STEP_15M_MS;
          trueValue = y1 - 0.25 * (y0 - y2) * delta;
        }
      }

      const cand = {
        ms: tCur,
        trueMs,
        rawValue: v,
        value: trueValue
      };

      const last = peaks[peaks.length - 1];
      if (!last || cand.trueMs - last.trueMs >= minSepMs) {
        peaks.push(cand);
      } else if (cand.value > last.value) {
        peaks[peaks.length - 1] = cand;
      }
    }
  }

  if (label && (rejectedGap > 0 || rejectedDensity > 0)) {
    console.log(
      `[QC-PEAK] ${label}: kept ${peaks.length} HW peaks, rejected ${rejectedGap + rejectedDensity} partial-outage candidates (gap>30m: ${rejectedGap}, <5 pts in ±60m: ${rejectedDensity})`
    );
  }
  return peaks;
}

/**
 * Find exact astronomical High Water peak (height + timestamp) around a target timestamp
 * by scanning a 5-min grid in [-90m, +90m] and applying 3-point parabolic refinement.
 */
function findAstroHighWater(predictFn, approxMs) {
  const stepMs = 5 * 60000;
  let bestT = approxMs;
  let bestY = -Infinity;
  for (let dt = -90 * 60000; dt <= 90 * 60000; dt += stepMs) {
    const t = approxMs + dt;
    const y = predictFn(t);
    if (y > bestY) {
      bestY = y;
      bestT = t;
    }
  }
  const y0 = predictFn(bestT - stepMs);
  const y1 = bestY;
  const y2 = predictFn(bestT + stepMs);
  const denom = y0 - 2 * y1 + y2;
  if (denom < -1e-9) {
    const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
    return {
      ms: bestT + delta * stepMs,
      value: y1 - 0.25 * (y0 - y2) * delta
    };
  }
  return { ms: bestT, value: bestY };
}

// ---------------------------------------------------------------------------
// 5. Offshore Weather Loader (Defensive against multiple cache schemas)
// ---------------------------------------------------------------------------

function toFiniteNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function parseIsoTimeMs(rawT) {
  if (typeof rawT === 'number') return rawT;
  if (typeof rawT !== 'string') return NaN;
  const iso =
    rawT.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawT)
      ? rawT
      : rawT.length === 16
        ? `${rawT}:00Z`
        : `${rawT}Z`;
  return new Date(iso).getTime();
}

function normalizeHourlyPointSeries(node) {
  const map = new Map();
  if (!node) return map;

  // Format A: Open-Meteo raw { hourly: { time: [...], pressure_msl: [...], ... } }
  // Also supports Open-Meteo previous_runs *_previous_day1 keys seamlessly.
  const hourly = node.hourly || (Array.isArray(node.time) ? node : null);
  if (hourly && Array.isArray(hourly.time)) {
    const pArr =
      hourly.pressure_msl || hourly.pressure_msl_previous_day1 || hourly.mslp || [];
    const wsArr =
      hourly.wind_speed_10m || hourly.wind_speed_10m_previous_day1 || hourly.windSpeedKmh || [];
    const wdArr =
      hourly.wind_direction_10m ||
      hourly.wind_direction_10m_previous_day1 ||
      hourly.windDirDeg ||
      [];
    for (let i = 0; i < hourly.time.length; i++) {
      const ms = parseIsoTimeMs(hourly.time[i]);
      if (!Number.isFinite(ms)) continue;
      map.set(Math.round(ms / HOUR_MS) * HOUR_MS, {
        mslp: toFiniteNum(pArr[i]),
        windSpeedKmh: toFiniteNum(wsArr[i]),
        windDirDeg: toFiniteNum(wdArr[i])
      });
    }
    return map;
  }

  // Format B: Array of objects [{ ms / time / dateTime, mslp / pressure_msl, ... }]
  if (Array.isArray(node)) {
    for (const r of node) {
      const ms = parseIsoTimeMs(r.ms ?? r.dateTime ?? r.time ?? r.date_time);
      if (!Number.isFinite(ms)) continue;
      map.set(Math.round(ms / HOUR_MS) * HOUR_MS, {
        mslp: toFiniteNum(r.mslp ?? r.pressure_msl ?? r.pressure_msl_previous_day1),
        windSpeedKmh: toFiniteNum(
          r.windSpeedKmh ?? r.wind_speed_10m ?? r.wind_speed_10m_previous_day1 ?? r.windSpeed
        ),
        windDirDeg: toFiniteNum(
          r.windDirDeg ?? r.wind_direction_10m ?? r.wind_direction_10m_previous_day1 ?? r.windDir
        )
      });
    }
  }
  return map;
}

function loadOffshoreWeather(weatherPath) {
  if (!weatherPath || !fs.existsSync(weatherPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(weatherPath, 'utf8'));
    const container = raw.points || raw.locations || raw.stations || raw;

    const pick = keys => {
      for (const k of keys) {
        if (container && container[k]) return container[k];
      }
      return null;
    };

    const bayNode = pick(['bay', 'bridgwater_bay', 'bridgwaterBay', 'hinkley', 'inner']);
    const celticNode = pick(['celtic', 'celtic_sea', 'celticSea', 'offshore', 'atlantic']);
    const outerNode = pick([
      'outer_channel',
      'outerChannel',
      'outer_bristol_channel',
      'outerBristolChannel',
      'bristol_channel',
      'outer',
      'channel'
    ]);

    let bayMap = normalizeHourlyPointSeries(bayNode);
    let celticMap = normalizeHourlyPointSeries(celticNode);
    let outerMap = normalizeHourlyPointSeries(outerNode);

    // Format C: flat array of combined records
    if (bayMap.size === 0 && Array.isArray(raw)) {
      for (const r of raw) {
        const ms =
          typeof r.ms === 'number' ? r.ms : new Date(r.time || r.dateTime).getTime();
        if (!Number.isFinite(ms)) continue;
        const hMs = Math.round(ms / HOUR_MS) * HOUR_MS;
        bayMap.set(hMs, {
          mslp: Number(r.mslp_bay ?? r.pressure_msl_bay ?? r.mslp),
          windSpeedKmh: Number(r.wind_speed_bay ?? r.windSpeedKmh),
          windDirDeg: Number(r.wind_dir_bay ?? r.windDirDeg)
        });
        celticMap.set(hMs, {
          mslp: Number(r.mslp_celtic ?? r.pressure_msl_celtic ?? r.mslp),
          windSpeedKmh: Number(r.wind_speed_celtic ?? r.windSpeedKmh),
          windDirDeg: Number(r.wind_dir_celtic ?? r.windDirDeg)
        });
        outerMap.set(hMs, {
          mslp: Number(r.mslp_outer ?? r.mslp_bay ?? r.mslp),
          windSpeedKmh: Number(
            r.wind_speed_outer ?? r.wind_speed_channel ?? r.windSpeedKmh
          ),
          windDirDeg: Number(r.wind_dir_outer ?? r.wind_dir_channel ?? r.windDirDeg)
        });
      }
    }

    // Fallback if only a single location exists
    if (celticMap.size === 0) celticMap = bayMap;
    if (outerMap.size === 0) outerMap = bayMap;

    if (bayMap.size === 0) return null;
    return { bayMap, celticMap, outerMap };
  } catch (err) {
    console.log(`[WARN] Failed to parse weather cache at ${weatherPath}: ${err.message}`);
    return null;
  }
}

function interpHourly(map, ms) {
  if (!map || map.size === 0) return null;
  const h0 = Math.floor(ms / HOUR_MS) * HOUR_MS;
  const h1 = h0 + HOUR_MS;
  const w0 = map.get(h0);
  const w1 = map.get(h1);
  if (!w0 && !w1) return null;
  if (!w0) return w1;
  if (!w1) return w0;
  const f = (ms - h0) / HOUR_MS;
  const lerp = (a, b) =>
    Number.isFinite(a) && Number.isFinite(b)
      ? a + f * (b - a)
      : Number.isFinite(a)
        ? a
        : b;
  // Circular interpolation for wind direction
  let windDirDeg = NaN;
  if (Number.isFinite(w0.windDirDeg) && Number.isFinite(w1.windDirDeg)) {
    const dDiff = ((w1.windDirDeg - w0.windDirDeg + 540) % 360) - 180;
    windDirDeg = (w0.windDirDeg + f * dDiff + 360) % 360;
  } else if (Number.isFinite(w0.windDirDeg)) {
    windDirDeg = w0.windDirDeg;
  } else if (Number.isFinite(w1.windDirDeg)) {
    windDirDeg = w1.windDirDeg;
  }
  return {
    mslp: lerp(w0.mslp, w1.mslp),
    windSpeedKmh: lerp(w0.windSpeedKmh, w1.windSpeedKmh),
    windDirDeg
  };
}

/**
 * Quadratic wind stress |U| * U * cos(dir - axisDeg) in m^2/s^2.
 * 255 deg (WSW) blows directly up the Bristol Channel into Bridgwater Bay;
 * 345 deg (NNW) captures cross-channel / Ekman set-down across Bridgwater Bay.
 */
function directionalWindStress(w, axisDeg) {
  if (!w || !Number.isFinite(w.windSpeedKmh) || !Number.isFinite(w.windDirDeg)) return null;
  const uMs = w.windSpeedKmh / 3.6;
  return Math.abs(uMs) * uMs * Math.cos((w.windDirDeg - axisDeg) * DEG);
}

function onshoreWindStress(w) {
  return directionalWindStress(w, 255);
}

function crossChannelWindStress(w) {
  return directionalWindStress(w, 345);
}

/**
 * Extract offshore meteorological feature vectors (Model D `metFeats` and Model E3/E4 `met2D`)
 * from either hindcast archive weather or Open-Meteo `previous_runs` Day-1 forecast weather.
 */
function extractMetFeatures(weatherObj, ms) {
  if (!weatherObj) return { metFeats: null, met2D: null };
  const wBay0 = interpHourly(weatherObj.bayMap, ms);
  const wBay6 = interpHourly(weatherObj.bayMap, ms - 6 * HOUR_MS);
  const wCel6 = interpHourly(weatherObj.celticMap, ms - 6 * HOUR_MS);
  const wCel3 = interpHourly(weatherObj.celticMap, ms - 3 * HOUR_MS);
  const wOut3 = interpHourly(weatherObj.outerMap, ms - 3 * HOUR_MS);
  const wOut0 = interpHourly(weatherObj.outerMap, ms);
  const ws3 = onshoreWindStress(wOut3);
  const ws0 = onshoreWindStress(wOut0);
  const wc3 = crossChannelWindStress(wOut3);
  const wc0 = crossChannelWindStress(wOut0);

  if (
    wBay0 &&
    wBay6 &&
    wCel6 &&
    wCel3 &&
    Number.isFinite(wBay0.mslp) &&
    Number.isFinite(wBay6.mslp) &&
    Number.isFinite(wCel6.mslp) &&
    Number.isFinite(wCel3.mslp) &&
    ws3 !== null &&
    ws0 !== null &&
    wc3 !== null &&
    wc0 !== null
  ) {
    return {
      metFeats: [
        1013.25 - wBay0.mslp, // Bridgwater Bay inverted barometer (hPa)
        1013.25 - wCel6.mslp, // Celtic Sea pressure drop at t - 6h (hPa)
        1013.25 - wCel3.mslp, // Celtic Sea pressure drop at t - 3h (hPa)
        (wBay0.mslp - wBay6.mslp) / 6.0, // 6h pressure tendency dP/dt (hPa/h)
        ws3, // Outer Bristol Channel quadratic onshore wind stress at t - 3h
        ws0 // Outer Bristol Channel quadratic onshore wind stress at t
      ],
      met2D: {
        ibBay: (1013.25 - wBay0.mslp) / 100.0,
        wsAlong0: ws0 / 100.0,
        wsCross0: wc0 / 100.0,
        wsAlong3: ws3 / 100.0,
        wsCross3: wc3 / 100.0
      }
    };
  }
  return { metFeats: null, met2D: null };
}

// ---------------------------------------------------------------------------
// 5a-waves. Marine Wave-Setup Loader (Open-Meteo Marine Waves)
// ---------------------------------------------------------------------------

function normalizeWavePointSeries(node) {
  const map = new Map();
  if (!node) return map;

  const hourly = node.hourly || (Array.isArray(node.time) ? node : null);
  if (hourly && Array.isArray(hourly.time)) {
    const hsArr = hourly.wave_height || hourly.waveHeight || [];
    const swArr = hourly.swell_wave_height || hourly.swellHeight || [];
    const tpArr = hourly.wave_period || hourly.wavePeriod || [];
    const wdArr = hourly.wave_direction || hourly.waveDir || [];
    for (let i = 0; i < hourly.time.length; i++) {
      const ms = parseIsoTimeMs(hourly.time[i]);
      if (!Number.isFinite(ms)) continue;
      const waveHeight = toFiniteNum(hsArr[i]);
      const swellHeight = toFiniteNum(swArr[i]);
      const wavePeriod = toFiniteNum(tpArr[i]);
      const waveDir = toFiniteNum(wdArr[i]);
      if (!Number.isFinite(waveHeight) && !Number.isFinite(swellHeight)) continue;
      map.set(Math.round(ms / HOUR_MS) * HOUR_MS, {
        waveHeight,
        swellHeight,
        wavePeriod,
        waveDir
      });
    }
    return map;
  }

  if (Array.isArray(node)) {
    for (const r of node) {
      const ms = parseIsoTimeMs(r.ms ?? r.dateTime ?? r.time ?? r.date_time);
      if (!Number.isFinite(ms)) continue;
      map.set(Math.round(ms / HOUR_MS) * HOUR_MS, {
        waveHeight: toFiniteNum(r.waveHeight ?? r.wave_height),
        swellHeight: toFiniteNum(r.swellHeight ?? r.swell_wave_height),
        wavePeriod: toFiniteNum(r.wavePeriod ?? r.wave_period),
        waveDir: toFiniteNum(r.waveDir ?? r.wave_direction)
      });
    }
  }
  return map;
}

function loadMarineWaves(wavesPath) {
  if (!wavesPath || !fs.existsSync(wavesPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(wavesPath, 'utf8'));
    const container = raw.points || raw.locations || raw.stations || raw;
    const pick = keys => {
      for (const k of keys) {
        if (container && container[k]) return container[k];
      }
      return null;
    };

    const bayNode = pick(['bridgwater_bay', 'bridgwaterBay', 'bay', 'hinkley', 'inner']);
    const outerNode = pick([
      'outer_bristol_channel',
      'outerBristolChannel',
      'outer_channel',
      'outerChannel',
      'outer',
      'channel'
    ]);

    let bayMap = normalizeWavePointSeries(bayNode);
    let outerMap = normalizeWavePointSeries(outerNode);

    if (bayMap.size === 0 && outerMap.size === 0) return null;
    if (bayMap.size === 0) bayMap = outerMap;
    if (outerMap.size === 0) outerMap = bayMap;

    return { bayMap, outerMap };
  } catch (err) {
    console.log(`[WARN] Failed to parse marine waves cache at ${wavesPath}: ${err.message}`);
    return null;
  }
}

function interpWaveHourly(map, ms) {
  if (!map || map.size === 0) return null;
  const h0 = Math.floor(ms / HOUR_MS) * HOUR_MS;
  const h1 = h0 + HOUR_MS;
  const w0 = map.get(h0);
  const w1 = map.get(h1);
  if (!w0 && !w1) return null;
  if (!w0) return w1;
  if (!w1) return w0;
  const f = (ms - h0) / HOUR_MS;
  const lerp = (a, b) =>
    Number.isFinite(a) && Number.isFinite(b)
      ? a + f * (b - a)
      : Number.isFinite(a)
        ? a
        : b;
  let waveDir = NaN;
  if (Number.isFinite(w0.waveDir) && Number.isFinite(w1.waveDir)) {
    const dDiff = ((w1.waveDir - w0.waveDir + 540) % 360) - 180;
    waveDir = (w0.waveDir + f * dDiff + 360) % 360;
  } else if (Number.isFinite(w0.waveDir)) {
    waveDir = w0.waveDir;
  } else if (Number.isFinite(w1.waveDir)) {
    waveDir = w1.waveDir;
  }
  return {
    waveHeight: lerp(w0.waveHeight, w1.waveHeight),
    swellHeight: lerp(w0.swellHeight, w1.swellHeight),
    wavePeriod: lerp(w0.wavePeriod, w1.wavePeriod),
    waveDir
  };
}

/**
 * Strictly causal onshore wave-setup features at t_HW and t_HW - 3h
 * from outer_bristol_channel & bridgwater_bay (units: m).
 */
function extractWaveFeatures(wavesObj, ms) {
  if (!wavesObj) return null;
  const out0 = interpWaveHourly(wavesObj.outerMap, ms);
  const out3 = interpWaveHourly(wavesObj.outerMap, ms - 3 * HOUR_MS);
  const bay0 = interpWaveHourly(wavesObj.bayMap, ms);
  const bay3 = interpWaveHourly(wavesObj.bayMap, ms - 3 * HOUR_MS);
  if (!out0 || !out3 || !bay0 || !bay3) return null;

  const onshoreProxy = w =>
    Number.isFinite(w.waveHeight) && Number.isFinite(w.waveDir)
      ? w.waveHeight * Math.max(0, Math.cos((w.waveDir - 255) * DEG))
      : NaN;

  const outHs0 = out0.waveHeight;
  const outOn0 = onshoreProxy(out0);
  const outSw0 = Number.isFinite(out0.swellHeight) ? out0.swellHeight : 0.0;
  const outOn3 = onshoreProxy(out3);
  const bayHs0 = bay0.waveHeight;
  const bayOn0 = onshoreProxy(bay0);
  const bayOn3 = onshoreProxy(bay3);

  const feats = [outHs0, outOn0, outSw0, outOn3, bayHs0, bayOn0, bayOn3];
  return feats.every(Number.isFinite) ? feats : null;
}

// ---------------------------------------------------------------------------
// 5b. Open-Meteo Marine Loader & Parabolic Marine HW Extractor
// ---------------------------------------------------------------------------

function normalizeMarinePointSeries(node) {
  const map = new Map();
  if (!node) return map;

  const parseTimeMs = rawT => {
    if (typeof rawT === 'number') return rawT;
    if (typeof rawT !== 'string') return NaN;
    const iso = rawT.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawT) ? rawT : `${rawT}:00Z`;
    return new Date(iso).getTime();
  };

  // Format A: Open-Meteo raw { hourly: { time: [...], sea_level_height_msl: [...] } }
  const hourly = node.hourly || (Array.isArray(node.time) ? node : null);
  if (hourly && Array.isArray(hourly.time)) {
    const slArr =
      hourly.sea_level_height_msl ||
      hourly.seaLevelHeightMsl ||
      hourly.sea_level ||
      hourly.value ||
      [];
    for (let i = 0; i < hourly.time.length; i++) {
      const ms = parseTimeMs(hourly.time[i]);
      const val = Number(slArr[i]);
      if (!Number.isFinite(ms) || !Number.isFinite(val)) continue;
      map.set(Math.round(ms / HOUR_MS) * HOUR_MS, val);
    }
    return map;
  }

  // Format B: Array of objects [{ time / dateTime / ms, seaLevelMsl / sea_level_height_msl / ... }]
  if (Array.isArray(node)) {
    for (const r of node) {
      const ms = parseTimeMs(r.ms ?? r.dateTime ?? r.time ?? r.date_time);
      const val = Number(
        r.seaLevelMsl ??
          r.sea_level_height_msl ??
          r.seaLevelHeightMsl ??
          r.sea_level ??
          r.value
      );
      if (!Number.isFinite(ms) || !Number.isFinite(val)) continue;
      map.set(Math.round(ms / HOUR_MS) * HOUR_MS, val);
    }
  }
  return map;
}

function loadMarineArchive(marinePath) {
  if (!marinePath || !fs.existsSync(marinePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(marinePath, 'utf8'));
    const container = raw.points || raw.locations || raw.stations || raw;
    const pick = keys => {
      for (const k of keys) {
        if (container && container[k]) return container[k];
      }
      return null;
    };

    const bayNode = pick(['bridgwater_bay', 'bridgwaterBay', 'bay', 'hinkley', 'inner']);
    const celticNode = pick(['celtic_sea', 'celticSea', 'celtic', 'offshore', 'atlantic']);
    const bayMap = normalizeMarinePointSeries(bayNode);
    const celticMap = normalizeMarinePointSeries(celticNode);

    if (bayMap.size === 0) return null;
    return { bayMap, celticMap: celticMap.size > 0 ? celticMap : null };
  } catch (err) {
    console.log(`[WARN] Failed to parse marine cache at ${marinePath}: ${err.message}`);
    return null;
  }
}

/**
 * Find local Open-Meteo Marine High Water peak using 3-point parabolic interpolation
 * on hourly sea_level_height_msl within ±3h of predicted astronomical HW time.
 */
function findMarineHighWater(marineMap, approxMs) {
  if (!marineMap || marineMap.size === 0) return null;
  const centerHr = Math.round(approxMs / HOUR_MS) * HOUR_MS;
  let bestT = null;
  let bestY = -Infinity;
  let count = 0;

  for (let dh = -3; dh <= 3; dh++) {
    const t = centerHr + dh * HOUR_MS;
    const y = marineMap.get(t);
    if (y !== undefined && Number.isFinite(y)) {
      count++;
      if (y > bestY) {
        bestY = y;
        bestT = t;
      }
    }
  }
  if (bestT === null || count < 3) return null;

  const y0 = marineMap.get(bestT - HOUR_MS);
  const y1 = bestY;
  const y2 = marineMap.get(bestT + HOUR_MS);
  if (y0 !== undefined && y2 !== undefined) {
    const denom = y0 - 2 * y1 + y2;
    if (denom < -1e-9) {
      const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
      return {
        ms: bestT + delta * HOUR_MS,
        value: y1 - 0.25 * (y0 - y2) * delta
      };
    }
  }
  return { ms: bestT, value: bestY };
}

// ---------------------------------------------------------------------------
// 5c. Canary Gauge Loader & Storm-Day / Outage Cross-Check
// ---------------------------------------------------------------------------

const CANARY_TARGET_DATES = [
  '2025-12-05',
  '2026-01-08',
  '2026-01-09',
  '2026-02-05',
  '2026-02-06',
  '2026-10-09'
];

function normalizeCanarySeries(node) {
  if (!node) return [];
  const rawArr = Array.isArray(node)
    ? node
    : node.readings || node.items || node.series || node.data || [];
  if (!Array.isArray(rawArr)) return [];

  const byMs = new Map();
  for (const r of rawArr) {
    const rawT = r.ms ?? r.dateTime ?? r.date_time ?? r.time;
    const ms = typeof rawT === 'number' ? rawT : new Date(rawT).getTime();
    const val = Number(r.value ?? r.stage ?? r.level);
    if (!Number.isFinite(ms) || !Number.isFinite(val)) continue;
    if (val < -10 || val > 12) continue;
    const snapped = toNearest15Min(ms);
    byMs.set(snapped, { ms: snapped, value: val });
  }
  return [...byMs.values()].sort((a, b) => a.ms - b.ms);
}

function loadCanaryGauges(canaryPath) {
  if (!canaryPath || !fs.existsSync(canaryPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(canaryPath, 'utf8'));
    const container = raw.series || raw.stations || raw.gauges || raw.data || raw;
    const pick = keys => {
      for (const k of keys) {
        if (container && container[k]) return container[k];
      }
      return null;
    };

    const e72539 = normalizeCanarySeries(pick(['E72539', 'e72539', 'hinkley_ntslf', 'hinkley_mirror']));
    const e72439 = normalizeCanarySeries(pick(['E72439', 'e72439', 'ilfracombe']));
    const e73039 = normalizeCanarySeries(pick(['E73039', 'e73039', 'milford_haven', 'milford']));

    if (!e72539.length && !e72439.length && !e73039.length) return null;
    return {
      E72539: e72539,
      E72439: e72439,
      E73039: e73039
    };
  } catch (err) {
    console.log(`[WARN] Failed to parse canary gauge cache at ${canaryPath}: ${err.message}`);
    return null;
  }
}

function runCanaryCrossCheck({ canary, hinkleyPeaks, dunballPeaks }) {
  console.log('\n' + '='.repeat(118));
  console.log('TARGETED STORM-DAY & OUTAGE CANARY GAUGE CROSS-CHECK (E72539 Hinkley NTSLF | E72439 Ilfracombe | E73039 Milford Haven)');
  console.log('='.repeat(118));

  const e72539Peaks = findParabolicPeaks(canary.E72539, 1.5, 8 * HOUR_MS, 'E72539 Hinkley NTSLF');
  const e72439Peaks = findParabolicPeaks(canary.E72439, 1.5, 8 * HOUR_MS, 'E72439 Ilfracombe');
  const e73039Peaks = findParabolicPeaks(canary.E73039, 1.5, 8 * HOUR_MS, 'E73039 Milford Haven');

  console.log(
    `Canary Series Loaded: E72539=${canary.E72539.length} pts (${e72539Peaks.length} HW) | ` +
      `E72439=${canary.E72439.length} pts (${e72439Peaks.length} HW) | ` +
      `E73039=${canary.E73039.length} pts (${e73039Peaks.length} HW)`
  );

  const findNearest = (list, targetMs, minOffMs, maxOffMs) => {
    let best = null;
    let bestAbs = Infinity;
    for (const p of list) {
      const dt = p.trueMs - targetMs;
      if (dt < minOffMs || dt > maxOffMs) continue;
      const a = Math.abs(dt);
      if (a < bestAbs) {
        bestAbs = a;
        best = p;
      }
    }
    return best;
  };

  const targetDateSet = new Set(CANARY_TARGET_DATES);

  // Build union of reference Hinkley HW events on target dates from 52106 and E72539
  const refEvents = [];
  for (const p of hinkleyPeaks) {
    if (targetDateSet.has(fmtDate(p.trueMs))) {
      refEvents.push({ refMs: p.trueMs, p52106: p, pE72539: null });
    }
  }
  for (const p of e72539Peaks) {
    if (!targetDateSet.has(fmtDate(p.trueMs))) continue;
    const existing = refEvents.find(e => Math.abs(e.refMs - p.trueMs) <= 2 * HOUR_MS);
    if (existing) {
      existing.pE72539 = p;
    } else {
      refEvents.push({ refMs: p.trueMs, p52106: null, pE72539: p });
    }
  }
  refEvents.sort((a, b) => a.refMs - b.refMs);

  console.log(
    '\n  UTC HW Ref       | 52106  | E72539 | Diff(cm) | Dunball | Ilfracombe HW (lead ->52106 / ->52163) | Milford HW (lead ->52106 / ->52163)'
  );
  console.log(
    '  -----------------+--------+--------+----------+---------+----------------------------------------+--------------------------------------'
  );

  const ilfLeadH = [];
  const ilfLeadD = [];
  const milLeadH = [];
  const milLeadD = [];
  const mirrorDiffs = [];
  let outageHealed = 0;

  const fM = v => (v === null ? '   n/a' : v.toFixed(2).padStart(6));
  const fLead = v => (v === null ? ' n/a' : `${Math.round(v)}m`.padStart(4));

  for (const ev of refEvents) {
    const pH = ev.p52106;
    const pM = ev.pE72539 || findNearest(e72539Peaks, ev.refMs, -2 * HOUR_MS, 2 * HOUR_MS);
    const hTime = pH ? pH.trueMs : pM.trueMs;
    const pD = findNearest(dunballPeaks, hTime, -15 * 60000, 150 * 60000);
    const pIlf = findNearest(e72439Peaks, hTime, -4 * HOUR_MS, 60 * 60000);
    const pMil = findNearest(e73039Peaks, hTime, -4 * HOUR_MS, 60 * 60000);

    const diffCm = pH && pM ? (pM.value - pH.value) * 100 : null;
    if (diffCm !== null) mirrorDiffs.push(diffCm);
    if (!pH && pM && fmtDate(hTime) === '2026-10-09') outageHealed++;

    const ilfHMin = pIlf ? (hTime - pIlf.trueMs) / 60000 : null;
    const ilfDMin = pIlf && pD ? (pD.trueMs - pIlf.trueMs) / 60000 : null;
    const milHMin = pMil ? (hTime - pMil.trueMs) / 60000 : null;
    const milDMin = pMil && pD ? (pD.trueMs - pMil.trueMs) / 60000 : null;

    if (ilfHMin !== null) ilfLeadH.push(ilfHMin);
    if (ilfDMin !== null) ilfLeadD.push(ilfDMin);
    if (milHMin !== null) milLeadH.push(milHMin);
    if (milDMin !== null) milLeadD.push(milDMin);

    const diffStr =
      diffCm !== null
        ? ((diffCm >= 0 ? '+' : '') + diffCm.toFixed(1)).padStart(8)
        : !pH && pM
          ? '  HEALED'
          : '     n/a';

    const ilfStr = pIlf
      ? `${fmtDateTime(pIlf.trueMs).slice(11)} ${pIlf.value.toFixed(2)}m (${fLead(ilfHMin)} / ${fLead(ilfDMin)})`
      : 'n/a';
    const milStr = pMil
      ? `${fmtDateTime(pMil.trueMs).slice(11)} ${pMil.value.toFixed(2)}m (${fLead(milHMin)} / ${fLead(milDMin)})`
      : 'n/a';

    console.log(
      `  ${fmtDateTime(hTime)} | ${fM(pH ? pH.value : null)} | ${fM(pM ? pM.value : null)} | ${diffStr} | ${fM(pD ? pD.value : null)}  | ${ilfStr.padEnd(38)} | ${milStr}`
    );
  }

  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  console.log('\n  Canary Summary:');
  if (mirrorDiffs.length) {
    const s = calcStats(mirrorDiffs);
    console.log(
      `    - E72539 vs 52106 Mirror Parity (n=${s.n}): MAE=${s.mae.toFixed(1)} cm, Bias=${s.bias >= 0 ? '+' : ''}${s.bias.toFixed(1)} cm, Max=${s.max.toFixed(1)} cm`
    );
  }
  console.log(
    `    - 2026-10-09 Outage Healing by E72539: ${outageHealed > 0 ? `YES (${outageHealed} missing 52106 HW peak(s) recovered)` : 'No missing 52106 HW recovered on 2026-10-09'}`
  );
  if (ilfLeadH.length) {
    console.log(
      `    - Ilfracombe (E72439) Median Lead Time: ${median(ilfLeadH).toFixed(0)} min ahead of Hinkley (52106) | ${ilfLeadD.length ? median(ilfLeadD).toFixed(0) + ' min ahead of Dunball (52163)' : 'n/a'}`
    );
  }
  if (milLeadH.length) {
    console.log(
      `    - Milford Haven (E73039) Median Lead Time: ${median(milLeadH).toFixed(0)} min ahead of Hinkley (52106) | ${milLeadD.length ? median(milLeadD).toFixed(0) + ' min ahead of Dunball (52163)' : 'n/a'}`
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Statistics & Formatting Helpers
// ---------------------------------------------------------------------------

function calcStats(errsCm) {
  if (!errsCm.length) {
    return { n: 0, mae: NaN, rmse: NaN, p95: NaN, max: NaN, bias: NaN };
  }
  const abs = errsCm.map(e => Math.abs(e)).sort((a, b) => a - b);
  const n = errsCm.length;
  const mae = abs.reduce((s, v) => s + v, 0) / n;
  const rmse = Math.sqrt(errsCm.reduce((s, v) => s + v * v, 0) / n);
  const bias = errsCm.reduce((s, v) => s + v, 0) / n;
  const p95Idx = Math.min(n - 1, Math.floor(0.95 * (n - 1)));
  return { n, mae, rmse, p95: abs[p95Idx], max: abs[n - 1], bias };
}

function fmtStatRow(label, stats) {
  if (!stats.n) return `  ${label.padEnd(48)} | n=  0 | (insufficient data)`;
  const f = v => v.toFixed(1).padStart(6);
  return (
    `  ${label.padEnd(48)} | n=${String(stats.n).padStart(3)} | ` +
    `MAE=${f(stats.mae)} cm | RMSE=${f(stats.rmse)} cm | P95=${f(stats.p95)} cm | ` +
    `Max=${f(stats.max)} cm | Bias=${(stats.bias >= 0 ? '+' : '') + stats.bias.toFixed(1)} cm`
  );
}

// ---------------------------------------------------------------------------
// 6b. Full-Year Coastal Canary ~1h Nowcast Benchmark (E72439 / E73039 -> 52106 -> 52163)
// ---------------------------------------------------------------------------

function runCoastalCanaryBenchmark({
  canaryName,
  stationCode,
  canarySeries,
  canaryPeaks,
  trainFilter,
  testFilter,
  cycleRecords,
  dunballPeaks,
  dunQuad,
  weather,
  hinkleyModelB2,
  canaryMirrorPeaks
}) {
  if (!canaryPeaks || canaryPeaks.length < 100) return null;

  const cTrain = canarySeries.filter(pt => trainFilter(pt.ms));
  if (cTrain.length < 500) {
    console.log(
      `\n[SKIP] Coastal Canary ${stationCode} (${canaryName}): insufficient train samples (${cTrain.length}).`
    );
    return null;
  }

  const cTrainSpanDays = (cTrain[cTrain.length - 1].ms - cTrain[0].ms) / DAY_MS;
  const cConst = selectPolConstituents(cTrainSpanDays);
  const cAstroModel = fitHarmonics(cTrain, cTrain[0].ms, cConst, { useNodal: true, ridge: 0.5 });

  const findNearest = (list, targetMs, minOffMs, maxOffMs) => {
    let best = null;
    let bestAbs = Infinity;
    for (const p of list) {
      const dt = p.trueMs - targetMs;
      if (dt < minOffMs || dt > maxOffMs) continue;
      const a = Math.abs(dt);
      if (a < bestAbs) {
        bestAbs = a;
        best = p;
      }
    }
    return best;
  };

  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const matched = [];
  for (const r of cycleRecords) {
    if (r.isOutlierSkew) continue;
    const cPk = findNearest(canaryPeaks, r.pk.trueMs, -4 * HOUR_MS, 15 * 60000);
    if (!cPk) continue;
    const cAstro = findAstroHighWater(ms => cAstroModel.predict(ms), cPk.trueMs);
    const cSkew = cPk.value - cAstro.value;
    if (Math.abs(cSkew) > 1.5) continue; // physical sanity gate

    const dPk = findNearest(dunballPeaks, r.pk.trueMs, -15 * 60000, 150 * 60000);
    const leadHMin = (r.pk.trueMs - cPk.trueMs) / 60000;
    const leadDMin = dPk ? (dPk.trueMs - cPk.trueMs) / 60000 : null;

    // Strictly causal local Bridgwater Bay 2D wind observed at the canary HW timestamp
    let localWind = null;
    if (weather) {
      const wBay = interpHourly(weather.bayMap, cPk.trueMs);
      const wsA = onshoreWindStress(wBay);
      const wsC = crossChannelWindStress(wBay);
      if (wsA !== null && wsC !== null) {
        localWind = [wsA / 100.0, wsC / 100.0];
      }
    }

    matched.push({
      r,
      cPk,
      cSkew,
      dPk,
      leadHMin,
      leadDMin,
      localWind
    });
  }

  const trainM = matched.filter(m => m.r.isTrain);
  const testM = matched.filter(m => m.r.isTest);
  if (trainM.length < 30 || testM.length < 15) {
    console.log(
      `\n[SKIP] Coastal Canary ${stationCode} (${canaryName}): insufficient matched peaks (train=${trainM.length}, test=${testM.length}).`
    );
    return null;
  }

  // (a1) Direct Peak-to-Peak Quadratic Transfer: H_hinkley = b0 + b1*c_HW + b2*c_HW^2
  const hDirectQuad = fitRidgeOLS(
    trainM.map(m => [m.cPk.value, m.cPk.value * m.cPk.value]),
    trainM.map(m => m.r.pk.value),
    1e-4
  );
  // (a2) Skew-Surge Transfer on top of Hinkley POL-42 Astro: h_skew = b0 + b1*c_skew
  const hSkewModel = fitRidgeOLS(
    trainM.map(m => [m.cSkew]),
    trainM.map(m => m.r.skewB2),
    1e-4
  );
  // (b) Combined Canary Skew + Local Bridgwater Bay 2D Wind -> Hinkley
  const trainWind = trainM.filter(m => m.localWind !== null);
  const hWindModel =
    trainWind.length >= 30
      ? fitRidgeOLS(
          trainWind.map(m => [m.cSkew, m.localWind[0], m.localWind[1]]),
          trainWind.map(m => m.r.skewB2),
          1.0
        )
      : null;

  // Direct Peak-to-Peak Quadratic Transfer -> Dunball (52163)
  const trainDun = trainM.filter(m => m.dPk !== null);
  const dDirectQuad =
    trainDun.length >= 30
      ? fitRidgeOLS(
          trainDun.map(m => [m.cPk.value, m.cPk.value * m.cPk.value]),
          trainDun.map(m => m.dPk.value),
          1e-4
        )
      : null;

  const errHDirect = [];
  const errHDirectHigh = [];
  const errHSkew = [];
  const errHSkewHigh = [];
  const errHWind = [];
  const errHWindHigh = [];

  const errDDirect = [];
  const errDDirectHigh = [];
  const errDSkew = [];
  const errDSkewHigh = [];
  const errDWind = [];
  const errDWindHigh = [];

  const leadHAll = [];
  const leadDAll = [];

  for (const m of testM) {
    const isHigh = m.r.pk.value >= 4.5;
    leadHAll.push(m.leadHMin);
    if (m.leadDMin !== null) leadDAll.push(m.leadDMin);

    const pHDirect = hDirectQuad.predict([m.cPk.value, m.cPk.value * m.cPk.value]);
    const pHSkew = m.r.astroB2 + hSkewModel.predict([m.cSkew]);
    const pHWind =
      hWindModel && m.localWind
        ? m.r.astroB2 + hWindModel.predict([m.cSkew, m.localWind[0], m.localWind[1]])
        : null;

    const eHD = (pHDirect - m.r.pk.value) * 100;
    const eHS = (pHSkew - m.r.pk.value) * 100;
    errHDirect.push(eHD);
    errHSkew.push(eHS);
    if (isHigh) {
      errHDirectHigh.push(eHD);
      errHSkewHigh.push(eHS);
    }
    if (pHWind !== null) {
      const eHW = (pHWind - m.r.pk.value) * 100;
      errHWind.push(eHW);
      if (isHigh) errHWindHigh.push(eHW);
    }

    if (m.dPk) {
      if (dDirectQuad) {
        const pDD = dDirectQuad.predict([m.cPk.value, m.cPk.value * m.cPk.value]);
        const eDD = (pDD - m.dPk.value) * 100;
        errDDirect.push(eDD);
        if (isHigh) errDDirectHigh.push(eDD);
      }
      if (dunQuad) {
        const pDS = dunQuad.predict([pHSkew, pHSkew * pHSkew]);
        const eDS = (pDS - m.dPk.value) * 100;
        errDSkew.push(eDS);
        if (isHigh) errDSkewHigh.push(eDS);

        if (pHWind !== null) {
          const pDW = dunQuad.predict([pHWind, pHWind * pHWind]);
          const eDW = (pDW - m.dPk.value) * 100;
          errDWind.push(eDW);
          if (isHigh) errDWindHigh.push(eDW);
        }
      }
    }
  }

  const medLeadH = median(leadHAll);
  const medLeadD = median(leadDAll);

  console.log(
    `\n--- FULL-YEAR COASTAL CANARY NOWCAST: ${stationCode} ${canaryName.toUpperCase()} -> 52106 HINKLEY -> 52163 DUNBALL ---`
  );
  console.log(
    `  Canary POL-${cConst.length} Train: ${cTrain.length} pts (span=${cTrainSpanDays.toFixed(1)}d) | ` +
      `Matched HW: train=${trainM.length}, test=${testM.length}`
  );
  console.log(
    `  Median Lead Time : ${medLeadH !== null ? medLeadH.toFixed(0) : 'n/a'} min ahead of Hinkley (52106) | ` +
      `${medLeadD !== null ? medLeadD.toFixed(0) : 'n/a'} min ahead of Dunball (52163)`
  );
  console.log(
    `  Skew Transfer Fit: hinkley_skew = ${hSkewModel.intercept.toFixed(4)} + ${hSkewModel.coefs[0].toFixed(3)} * ${stationCode}_skew` +
      (hWindModel
        ? ` | +2D Wind: skew=${hWindModel.coefs[0].toFixed(3)}, along=${(hWindModel.coefs[1] * 100).toFixed(2)}cm, cross=${(hWindModel.coefs[2] * 100).toFixed(2)}cm`
        : '')
  );

  console.log('\n  [All Out-of-Sample Tides]');
  console.log(fmtStatRow(`${stationCode} -> 52106 (a1) Direct Peak Quad`, calcStats(errHDirect)));
  console.log(fmtStatRow(`${stationCode} -> 52106 (a2) POL-42 + Canary Skew`, calcStats(errHSkew)));
  if (errHWind.length) {
    console.log(fmtStatRow(`${stationCode} -> 52106 (b)  Skew + Local 2D Wind`, calcStats(errHWind)));
  }
  if (errDDirect.length) {
    console.log(fmtStatRow(`${stationCode} -> 52163 (a1) Direct Peak Quad`, calcStats(errDDirect)));
  }
  if (errDSkew.length) {
    console.log(fmtStatRow(`${stationCode} -> 52163 (a2) Skew -> 52106 -> Dunball`, calcStats(errDSkew)));
  }
  if (errDWind.length) {
    console.log(fmtStatRow(`${stationCode} -> 52163 (b)  Skew+Wind -> 52106 -> Dunball`, calcStats(errDWind)));
  }

  if (errHSkewHigh.length) {
    console.log('\n  [Flood-Relevant High/Spring Tides Only: Hinkley H_obs >= 4.50 mAOD]');
    console.log(fmtStatRow(`${stationCode} -> 52106 (a1) Direct Peak Quad >=4.5m`, calcStats(errHDirectHigh)));
    console.log(fmtStatRow(`${stationCode} -> 52106 (a2) POL-42 + Skew    >=4.5m`, calcStats(errHSkewHigh)));
    if (errHWindHigh.length) {
      console.log(fmtStatRow(`${stationCode} -> 52106 (b)  Skew + 2D Wind   >=4.5m`, calcStats(errHWindHigh)));
    }
    if (errDDirectHigh.length) {
      console.log(fmtStatRow(`${stationCode} -> 52163 (a1) Direct Peak Quad >=4.5m`, calcStats(errDDirectHigh)));
    }
    if (errDSkewHigh.length) {
      console.log(fmtStatRow(`${stationCode} -> 52163 (a2) Skew -> Dunball  >=4.5m`, calcStats(errDSkewHigh)));
    }
    if (errDWindHigh.length) {
      console.log(fmtStatRow(`${stationCode} -> 52163 (b)  Skew+Wind->Dun   >=4.5m`, calcStats(errDWindHigh)));
    }
  }

  // Verify 2026-10-09 07:47 Hinkley outage healing by Ilfracombe (E72439)
  // Note: 52106's false peak was at 07:47 UTC during recovery; the true missed morning HW occurred ~05:39 UTC (Ilfracombe ~04:50 UTC).
  const outageTargetMs = Date.UTC(2026, 9, 9, 5, 40, 0);
  if (stationCode === 'E72439' && testFilter(outageTargetMs)) {
    const ilfOutagePk = findNearest(canaryPeaks, outageTargetMs, -3 * HOUR_MS, 2 * HOUR_MS);
    console.log('\n  [2026-10-09 07:47 Hinkley Outage Healing Verification via E72439 Ilfracombe]');
    if (!ilfOutagePk) {
      console.log('    - No E72439 Ilfracombe HW peak found around 2026-10-09 07:47 UTC.');
    } else {
      const ilfAstro = findAstroHighWater(ms => cAstroModel.predict(ms), ilfOutagePk.trueMs);
      const ilfSkew = ilfOutagePk.value - ilfAstro.value;
      const estHinkMs = ilfOutagePk.trueMs + (medLeadH ?? 49) * 60000;
      const hAstro = findAstroHighWater(ms => hinkleyModelB2.predict(ms), estHinkMs);

      const hPredDirect = hDirectQuad.predict([
        ilfOutagePk.value,
        ilfOutagePk.value * ilfOutagePk.value
      ]);
      const hPredSkew = hAstro.value + hSkewModel.predict([ilfSkew]);
      let hPredWind = null;
      if (hWindModel && weather) {
        const wBay = interpHourly(weather.bayMap, ilfOutagePk.trueMs);
        const wsA = onshoreWindStress(wBay);
        const wsC = crossChannelWindStress(wBay);
        if (wsA !== null && wsC !== null) {
          hPredWind = hAstro.value + hWindModel.predict([ilfSkew, wsA / 100.0, wsC / 100.0]);
        }
      }

      const obsMirror = canaryMirrorPeaks
        ? findNearest(canaryMirrorPeaks, estHinkMs, -90 * 60000, 90 * 60000)
        : null;
      const obsDun = findNearest(dunballPeaks, estHinkMs, -15 * 60000, 150 * 60000);

      console.log(
        `    - Observed E72439 Ilfracombe HW: ${fmtDateTime(ilfOutagePk.trueMs)} UTC = ${ilfOutagePk.value.toFixed(3)} mAOD ` +
          `(astro=${ilfAstro.value.toFixed(3)}m, skew=${(ilfSkew * 100 >= 0 ? '+' : '') + (ilfSkew * 100).toFixed(1)} cm)`
      );
      const fmtErr = (pred, obs) =>
        obs !== null
          ? ` (err=${((pred - obs) * 100 >= 0 ? '+' : '') + ((pred - obs) * 100).toFixed(1)} cm vs ${obs.toFixed(3)}m)`
          : '';
      const refH = obsMirror ? obsMirror.value : null;
      console.log(
        `    - Healed Hinkley (52106) HW    : Direct=${hPredDirect.toFixed(3)}m${fmtErr(hPredDirect, refH)} | ` +
          `Skew=${hPredSkew.toFixed(3)}m${fmtErr(hPredSkew, refH)}` +
          (hPredWind !== null ? ` | Skew+Wind=${hPredWind.toFixed(3)}m${fmtErr(hPredWind, refH)}` : '') +
          (obsMirror ? ` [Ground truth: E72539 mirror @ ${fmtDateTime(obsMirror.trueMs)} UTC]` : ' [E72539 mirror not loaded]')
      );
      if (obsDun && dunQuad) {
        const dPredSkew = dunQuad.predict([hPredSkew, hPredSkew * hPredSkew]);
        const dPredDirect = dDirectQuad
          ? dDirectQuad.predict([ilfOutagePk.value, ilfOutagePk.value * ilfOutagePk.value])
          : null;
        console.log(
          `    - Propagated Dunball (52163) HW: Skew->Dun=${dPredSkew.toFixed(3)}m${fmtErr(dPredSkew, obsDun.value)}` +
            (dPredDirect !== null ? ` | Direct=${dPredDirect.toFixed(3)}m${fmtErr(dPredDirect, obsDun.value)}` : '') +
            ` [Observed 52163 @ ${fmtDateTime(obsDun.trueMs)} UTC]`
        );
      }
    }
  }

  const matchedByCycleMs = new Map();
  for (const m of matched) {
    const predSkewIlf =
      hWindModel && m.localWind
        ? hWindModel.predict([m.cSkew, m.localWind[0], m.localWind[1]])
        : hSkewModel.predict([m.cSkew]);
    matchedByCycleMs.set(m.r.pk.trueMs, {
      cPk: m.cPk,
      cSkew: m.cSkew,
      localWind: m.localWind,
      predSkewIlf
    });
  }

  return {
    stationCode,
    medLeadH,
    medLeadD,
    hDirect: calcStats(errHDirect),
    hSkew: calcStats(errHSkew),
    hWind: calcStats(errHWind),
    hSkewHigh: calcStats(errHSkewHigh),
    dSkew: calcStats(errDSkew),
    dSkewHigh: calcStats(errDSkewHigh),
    matchedByCycleMs
  };
}

// ---------------------------------------------------------------------------
// 6c. Dunball Tide-Lock Timing Benchmark (t_close, t_open, duration in min)
// ---------------------------------------------------------------------------

/**
 * Extract tide-lock intervals where sea >= threshold (with sub-15-min linear crossing interpolation).
 * Requires a genuine upward crossing (prev.value < prevThresh) to avoid truncated boundary locks,
 * and never bridges sensor gaps > 60 min.
 */
function extractTideLockIntervals(seaSeries, getThreshold, deadband = 0.03) {
  const intervals = [];
  let locked = false;
  let startMs = null;
  let maxSea = -Infinity;
  let maxSeaMs = null;
  let closeThresh = null;
  let prev = null;
  let prevThresh = null;

  for (const pt of seaSeries) {
    const thresh = getThreshold(pt.ms);
    if (thresh === null || thresh === undefined || !Number.isFinite(thresh)) {
      if (locked && prev !== null && pt.ms - prev.ms > 60 * 60000) {
        locked = false;
        startMs = null;
        maxSea = -Infinity;
        maxSeaMs = null;
      }
      continue;
    }
    if (locked && prev !== null && pt.ms - prev.ms > 60 * 60000) {
      locked = false;
      startMs = null;
      maxSea = -Infinity;
      maxSeaMs = null;
    }
    const canInterp = prev !== null && pt.ms - prev.ms > 0 && pt.ms - prev.ms <= 30 * 60000;

    if (!locked) {
      if (pt.value >= thresh && prev !== null && prevThresh !== null && prev.value < prevThresh) {
        locked = true;
        startMs = pt.ms;
        if (canInterp) {
          const d0 = prev.value - prevThresh;
          const d1 = pt.value - thresh;
          if (d1 - d0 > 1e-9) {
            const frac = Math.max(0, Math.min(1, -d0 / (d1 - d0)));
            startMs = prev.ms + frac * (pt.ms - prev.ms);
          }
        }
        maxSea = pt.value;
        maxSeaMs = pt.ms;
        closeThresh = thresh;
      }
    } else {
      if (pt.value > maxSea) {
        maxSea = pt.value;
        maxSeaMs = pt.ms;
      }
      const exitThresh = thresh - deadband;
      if (pt.value < exitThresh) {
        let endMs = pt.ms;
        if (canInterp && prev.value >= prevThresh - deadband) {
          const d0 = prev.value - (prevThresh - deadband);
          const d1 = pt.value - exitThresh;
          if (d0 - d1 > 1e-9) {
            const frac = Math.max(0, Math.min(1, d0 / (d0 - d1)));
            endMs = prev.ms + frac * (pt.ms - prev.ms);
          }
        }
        if (endMs > startMs) {
          intervals.push({
            startMs,
            endMs,
            durationMin: (endMs - startMs) / 60000,
            maxSea,
            maxSeaMs,
            closeThresh
          });
        }
        locked = false;
      }
    }
    prev = pt;
    prevThresh = thresh;
  }
  return intervals;
}

/**
 * v1-style causal 25-hour low-pass residual surge at `leadHrs` before `ms` + inverted barometer.
 */
function getLowPassSurgeV1(ms, obsMap, predictFn, bayWeatherMap, leadHrs = 6) {
  const endMs = toNearest15Min(ms - leadHrs * HOUR_MS);
  const startMs = endMs - 25 * HOUR_MS;
  let sum = 0;
  let count = 0;
  for (let t = startMs; t <= endMs; t += STEP_15M_MS) {
    const obs = obsMap.get(t);
    if (obs === undefined) continue;
    const w = bayWeatherMap ? interpHourly(bayWeatherMap, t) : null;
    const ib = w && Number.isFinite(w.mslp) ? (1013.25 - w.mslp) * 0.01 : 0;
    sum += obs - predictFn(t) - ib;
    count++;
  }
  const wNow = bayWeatherMap ? interpHourly(bayWeatherMap, ms) : null;
  const ibNow = wNow && Number.isFinite(wNow.mslp) ? (1013.25 - wNow.mslp) * 0.01 : 0;
  const subTidal = count >= 12 ? sum / count : 0;
  return subTidal + ibNow;
}

/**
 * Linear interpolation of a 15-min observation map at arbitrary timestamp `ms`
 * (only if bracketing 15-min samples exist).
 */
function interp15MinMap(map, ms) {
  const t0 = Math.floor(ms / STEP_15M_MS) * STEP_15M_MS;
  if (ms === t0) {
    const v = map.get(t0);
    return v !== undefined ? v : null;
  }
  const v0 = map.get(t0);
  const v1 = map.get(t0 + STEP_15M_MS);
  if (v0 === undefined || v1 === undefined) return null;
  const f = (ms - t0) / STEP_15M_MS;
  return v0 + f * (v1 - v0);
}

/**
 * Fit strictly causal directional Hinkley (52106) -> Dunball (52163) coast-to-estuary transfer
 * on the training split only:
 *   - Mid-tide flood limb (1.5..4.0 mAOD Dunball, Hinkley rising): optimal 5-min lag + linear fit
 *   - Mid-tide ebb limb   (1.5..4.0 mAOD Dunball, Hinkley falling): optimal 5-min lag + linear fit
 *   - High-water (>4.0 mAOD Dunball): optimal 5-min lag + quadratic fit
 */
function fitDirectionalDunballTransfer(dunball, hinkleyMap, trainFilter) {
  const dTrain = dunball.filter(pt => trainFilter(pt.ms));

  function fitLimb(isFlood) {
    let best = { lagMin: 15, model: null, rmse: Infinity, n: 0 };
    for (let lagMin = 0; lagMin <= 45; lagMin += 5) {
      const xs = [];
      const ys = [];
      for (const pt of dTrain) {
        if (pt.value < 1.5 || pt.value > 4.0) continue;
        const tLag = pt.ms - lagMin * 60000;
        const hVal = interp15MinMap(hinkleyMap, tLag);
        const hPrev = interp15MinMap(hinkleyMap, tLag - STEP_15M_MS);
        if (hVal === null || hPrev === null) continue;
        if ((hVal >= hPrev) !== isFlood) continue;
        xs.push([hVal]);
        ys.push(pt.value);
      }
      if (xs.length < 30) continue;
      const model = fitRidgeOLS(xs, ys, 1e-4);
      let ss = 0;
      for (let i = 0; i < xs.length; i++) {
        const e = model.predict(xs[i]) - ys[i];
        ss += e * e;
      }
      const r = Math.sqrt(ss / xs.length);
      if (r < best.rmse) {
        best = { lagMin, model, rmse: r, n: xs.length };
      }
    }
    return best;
  }

  function fitHighWater() {
    let best = { lagMin: 15, model: null, rmse: Infinity, n: 0 };
    for (let lagMin = 0; lagMin <= 45; lagMin += 5) {
      const xs = [];
      const ys = [];
      for (const pt of dTrain) {
        if (pt.value <= 4.0) continue;
        const tLag = pt.ms - lagMin * 60000;
        const hVal = interp15MinMap(hinkleyMap, tLag);
        if (hVal === null) continue;
        xs.push([hVal, hVal * hVal]);
        ys.push(pt.value);
      }
      if (xs.length < 30) continue;
      const model = fitRidgeOLS(xs, ys, 1e-4);
      let ss = 0;
      for (let i = 0; i < xs.length; i++) {
        const e = model.predict(xs[i]) - ys[i];
        ss += e * e;
      }
      const r = Math.sqrt(ss / xs.length);
      if (r < best.rmse) {
        best = { lagMin, model, rmse: r, n: xs.length };
      }
    }
    return best;
  }

  const floodFit = fitLimb(true);
  const ebbFit = fitLimb(false);
  const hwFit = fitHighWater();

  return {
    floodFit,
    ebbFit,
    hwFit,
    predictAt(ms, hAstroFn, hTotalFn) {
      const isRising = hAstroFn(ms) >= hAstroFn(ms - STEP_15M_MS);
      const limb = isRising ? floodFit : ebbFit;
      const hMid = hTotalFn(ms - limb.lagMin * 60000);
      const dMid = limb.model.predict([hMid]);

      const hHw = hTotalFn(ms - hwFit.lagMin * 60000);
      const dHw = hwFit.model.predict([hHw, hHw * hHw]);

      const wHw = Math.max(0, Math.min(1, (dMid - 3.5) / 1.0));
      return Math.max(0.5, (1 - wHw) * dMid + wHw * dHw);
    }
  };
}

function fmtMinStatRow(label, nStr, closeS, openS, durS) {
  const f = s => {
    if (!s || !s.n) return '        n/a        ';
    const bStr = (s.bias >= 0 ? '+' : '') + s.bias.toFixed(1);
    return `${s.mae.toFixed(1).padStart(4)}/${s.p95.toFixed(1).padStart(4)}/${s.max.toFixed(0).padStart(3)} (${bStr.padStart(5)})`;
  };
  return `  ${label.padEnd(36)} | ${nStr.padStart(12)} | ${f(closeS)} | ${f(openS)} | ${f(durS)}`;
}

function runDunballTideLockBenchmark({
  dunball,
  hinkley,
  ksdMap,
  trainFilter,
  testFilter,
  modelA,
  modelB2,
  metModelB2,
  e3Model,
  e3UsesMet,
  cycleRecords,
  weather,
  prevWeather,
  ilfCanaryRes
}) {
  if (!dunball.length || !ksdMap || ksdMap.size < 500) {
    console.log('\n[SKIP] Dunball Tide-Lock Timing Benchmark: missing 52163 or E9094 series.');
    return null;
  }

  const hinkleyMap = new Map(hinkley.map(p => [p.ms, p.value]));
  const transfer = fitDirectionalDunballTransfer(dunball, hinkleyMap, trainFilter);
  if (!transfer.floodFit.model || !transfer.ebbFit.model || !transfer.hwFit.model) {
    console.log('\n[SKIP] Dunball Tide-Lock Timing Benchmark: insufficient train overlap for directional transfer.');
    return null;
  }

  // Ground-truth observed Dunball lock windows across full series, then strictly filter to testFilter
  const allObsLocks = extractTideLockIntervals(
    dunball,
    ms => ksdMap.get(ms) ?? null,
    0.03
  );
  const testObsLocks = allObsLocks.filter(iv => testFilter(iv.startMs));
  if (!testObsLocks.length) {
    console.log('\n[SKIP] Dunball Tide-Lock Timing Benchmark: 0 observed locks in test split.');
    return null;
  }

  console.log('\n--- DUNBALL (52163 vs E9094) TIDE-LOCK TIMING BENCHMARK (OUT-OF-SAMPLE, MINUTES) ---');
  console.log(
    `  Directional Transfer (train only): Flood lag=${transfer.floodFit.lagMin}m (n=${transfer.floodFit.n}, RMSE=${(transfer.floodFit.rmse * 100).toFixed(1)}cm) | ` +
      `Ebb lag=${transfer.ebbFit.lagMin}m (n=${transfer.ebbFit.n}, RMSE=${(transfer.ebbFit.rmse * 100).toFixed(1)}cm) | ` +
      `HW(>4m) lag=${transfer.hwFit.lagMin}m (n=${transfer.hwFit.n}, RMSE=${(transfer.hwFit.rmse * 100).toFixed(1)}cm)`
  );

  // Build test cycles index & attach strictly causal Day-1 predicted skew surges for Models D (POL-42) and E3
  const testCycleList = cycleRecords.filter(r => r.isTest && !r.isOutlierSkew);
  const testDunballPts = dunball.filter(pt => testFilter(pt.ms));
  const dunballByMs = new Map(dunball.map(pt => [pt.ms, pt.value]));

  // Precompute per-cycle predicted skew surges
  const cycleSkewMap = new Map(); // r.pk.trueMs -> { skewD, skewE3, skewIlf, cPkMs }
  for (const r of cycleRecords) {
    if (r.isOutlierSkew) continue;
    let skewD = null;
    if (metModelB2 && r.prevSkewB2 !== null) {
      const mf = r.prevMetFeats ?? r.metFeats;
      if (mf) skewD = metModelB2.predict([r.prevSkewB2, ...mf]);
    }
    let skewE3 = null;
    if (
      e3Model &&
      r.pureMarineSkew !== null &&
      r.cmemsCausal25 !== null &&
      r.prev1Rec &&
      r.prev1Rec.pureMarineSkew !== null
    ) {
      const innov1 = r.prev1Rec.skewB2 - r.prev1Rec.pureMarineSkew;
      const innov2 =
        r.prev2Rec && r.prev2Rec.pureMarineSkew !== null
          ? r.prev2Rec.skewB2 - r.prev2Rec.pureMarineSkew
          : innov1;
      const row = [
        r.pureMarineSkew,
        r.cmemsCausal25,
        innov1,
        innov2,
        (r.astroB2 - 4.3) * r.pureMarineSkew
      ];
      let ok = true;
      if (e3UsesMet) {
        const curMet = r.prevMet2D ?? r.met2D;
        const p1Met = r.prev1Rec.prevMet2D ?? r.prev1Rec.met2D;
        if (curMet && p1Met) {
          row.push(
            curMet.ibBay - p1Met.ibBay,
            curMet.wsAlong0,
            curMet.wsCross0,
            curMet.wsAlong3,
            curMet.wsCross3
          );
        } else {
          ok = false;
        }
      }
      if (ok) skewE3 = e3Model.predict(row);
    }
    const ilfInfo = ilfCanaryRes?.matchedByCycleMs?.get(r.pk.trueMs) ?? null;
    cycleSkewMap.set(r.pk.trueMs, {
      skewD,
      skewE3,
      skewIlf: ilfInfo ? ilfInfo.predSkewIlf : null,
      cPkMs: ilfInfo ? ilfInfo.cPk.trueMs : null
    });
  }

  // Helper: find matching Hinkley cycle for a given Dunball timestamp (within ±4.5h of HW)
  function findCycleForMs(targetMs) {
    let best = null;
    let bestAbs = Infinity;
    for (const r of cycleRecords) {
      const dt = Math.abs(r.pk.trueMs - targetMs);
      if (dt <= 4.5 * HOUR_MS && dt < bestAbs) {
        bestAbs = dt;
        best = r;
      }
    }
    return best;
  }

  // Check how many test cycles have NO observed lock (for false-lock detection)
  const nonLockedTestCycles = [];
  for (const r of testCycleList) {
    // Only count cycles where both Dunball and E9094 have continuous observations around HW
    const hwSnap = toNearest15Min(r.pk.trueMs + 30 * 60000);
    if (dunballByMs.get(hwSnap) === undefined || ksdMap.get(hwSnap) === undefined) continue;
    const hasObsLock = testObsLocks.some(
      iv => Math.abs(iv.maxSeaMs - r.pk.trueMs) <= 4.5 * HOUR_MS
    );
    if (!hasObsLock) nonLockedTestCycles.push(r);
  }

  const predAFn = ms => modelA.predict(ms);
  const predB2Fn = ms => modelB2.predict(ms);
  const bayWeatherV1 = prevWeather ? prevWeather.bayMap : weather ? weather.bayMap : null;

  // Memoize v1 25h boxcar surge & Dunball prediction by timestamp (avoids recomputing 101-pt loop across modes/subsets)
  const lpV1Cache = new Map();
  const getCachedLpV1 = tm => {
    let v = lpV1Cache.get(tm);
    if (v === undefined) {
      v = getLowPassSurgeV1(tm, hinkleyMap, predAFn, bayWeatherV1, 6);
      lpV1Cache.set(tm, v);
    }
    return v;
  };
  const v1DunballCache = new Map();
  const predictV1Dunball = t => {
    let v = v1DunballCache.get(t);
    if (v === undefined) {
      v = transfer.predictAt(t, predAFn, tm => predAFn(tm) + getCachedLpV1(tm));
      v1DunballCache.set(t, v);
    }
    return v;
  };

  /**
   * Evaluate one model across all observed test locks + non-locked cycles under a given E9094 mode.
   */
  function evaluateModel(modelKey, e9094Mode, filterFn = null) {
    const closeErrs = [];
    const openErrs = [];
    const durErrs = [];
    const peakErrsCm = [];
    let totalObs = 0;
    let missed = 0;
    let falseLocks = 0;
    let ilfClosedBeforeCrest = 0;

    for (const act of testObsLocks) {
      if (filterFn && !filterFn(act)) continue;
      const cyc = findCycleForMs(act.maxSeaMs);
      if (!cyc || cyc.isOutlierSkew) continue;
      const skews = cycleSkewMap.get(cyc.pk.trueMs);
      if (!skews) continue;

      if (modelKey === 'D' && skews.skewD === null) continue;
      if (modelKey === 'E3' && skews.skewE3 === null) continue;
      if (modelKey === 'ILF' && skews.skewIlf === null) continue;

      const startSnap = toNearest15Min(act.startMs);
      const frozenE9094 = ksdMap.get(startSnap - 3 * HOUR_MS) ?? ksdMap.get(startSnap);
      if (frozenE9094 === undefined) continue;

      totalObs++;

      const winStart = toNearest15Min(act.startMs - 3 * HOUR_MS);
      const winEnd = toNearest15Min(act.endMs + 3 * HOUR_MS);
      const winPred = [];
      for (let t = winStart; t <= winEnd; t += STEP_15M_MS) {
        let dPred;
        if (modelKey === 'V1') {
          dPred = predictV1Dunball(t);
        } else {
          const skewVal =
            modelKey === 'D' ? skews.skewD : modelKey === 'E3' ? skews.skewE3 : skews.skewIlf;
          dPred = transfer.predictAt(t, predB2Fn, tm => predB2Fn(tm) + skewVal);
        }
        winPred.push({ ms: t, value: dPred });
      }

      const getThresh =
        e9094Mode === 'frozen'
          ? () => frozenE9094
          : ms => ksdMap.get(toNearest15Min(ms - 12.5 * HOUR_MS)) ?? frozenE9094;

      const predLocks = extractTideLockIntervals(winPred, getThresh, 0.03);
      if (!predLocks.length) {
        missed++;
        continue;
      }

      // Pick the predicted lock closest in midpoint to actual lock
      const actMid = 0.5 * (act.startMs + act.endMs);
      let pred = predLocks[0];
      let bestDist = Math.abs(0.5 * (pred.startMs + pred.endMs) - actMid);
      for (let i = 1; i < predLocks.length; i++) {
        const d = Math.abs(0.5 * (predLocks[i].startMs + predLocks[i].endMs) - actMid);
        if (d < bestDist) {
          bestDist = d;
          pred = predLocks[i];
        }
      }

      const openErr = (pred.endMs - act.endMs) / 60000;
      openErrs.push(openErr);
      peakErrsCm.push((pred.maxSea - act.maxSea) * 100);

      if (modelKey === 'ILF') {
        // Strictly causal: if gates already closed before Ilfracombe HW, t_close is observed!
        const alreadyClosed = skews.cPkMs !== null && act.startMs <= skews.cPkMs;
        if (alreadyClosed) ilfClosedBeforeCrest++;
        const causalStartMs = alreadyClosed ? act.startMs : pred.startMs;
        const causalDurMin = (pred.endMs - causalStartMs) / 60000;
        closeErrs.push((pred.startMs - act.startMs) / 60000);
        durErrs.push(causalDurMin - act.durationMin);
      } else {
        closeErrs.push((pred.startMs - act.startMs) / 60000);
        durErrs.push(pred.durationMin - act.durationMin);
      }
    }

    // False-lock check on non-locked test cycles (only for full-set evaluation)
    if (!filterFn) {
      for (const cyc of nonLockedTestCycles) {
        const skews = cycleSkewMap.get(cyc.pk.trueMs);
        if (!skews) continue;
        if (modelKey === 'D' && skews.skewD === null) continue;
        if (modelKey === 'E3' && skews.skewE3 === null) continue;
        if (modelKey === 'ILF' && skews.skewIlf === null) continue;

        const hwSnap = toNearest15Min(cyc.pk.trueMs + 30 * 60000);
        const frozenE9094 = ksdMap.get(hwSnap - 5 * HOUR_MS) ?? ksdMap.get(hwSnap);
        if (frozenE9094 === undefined) continue;

        const winPred = [];
        for (let t = hwSnap - 4 * HOUR_MS; t <= hwSnap + 4 * HOUR_MS; t += STEP_15M_MS) {
          let dPred;
          if (modelKey === 'V1') {
            dPred = predictV1Dunball(t);
          } else {
            const skewVal =
              modelKey === 'D' ? skews.skewD : modelKey === 'E3' ? skews.skewE3 : skews.skewIlf;
            dPred = transfer.predictAt(t, predB2Fn, tm => predB2Fn(tm) + skewVal);
          }
          winPred.push({ ms: t, value: dPred });
        }
        const getThresh =
          e9094Mode === 'frozen'
            ? () => frozenE9094
            : ms => ksdMap.get(toNearest15Min(ms - 12.5 * HOUR_MS)) ?? frozenE9094;
        const pl = extractTideLockIntervals(winPred, getThresh, 0.03);
        if (pl.length > 0) falseLocks++;
      }
    }

    return {
      totalObs,
      matched: openErrs.length,
      missed,
      falseLocks,
      ilfClosedBeforeCrest,
      closeStats: calcStats(closeErrs),
      openStats: calcStats(openErrs),
      durStats: calcStats(durErrs),
      peakStats: calcStats(peakErrsCm)
    };
  }

  const models = [
    { key: 'V1', label: 'A. v1 Baseline (10c+25hLP)' },
    { key: 'D', label: 'B. PoC v2.3 Model D (12h, Day-1)' },
    { key: 'E3', label: 'C. PoC v2.3 Model E3 (12h, Day-1)' },
    { key: 'ILF', label: 'D. PoC v2.3 E72439 Nowcast (~50m)' }
  ];

  const printTable = (title, filterFn = null) => {
    console.log(`\n  [${title}]`);
    console.log(
      '  Model                                |  n (mis/fls) | t_close MAE/P95/Max(Bias) | t_open  MAE/P95/Max(Bias) | Dur     MAE/P95/Max(Bias)'
    );
    console.log(
      '  -------------------------------------+--------------+---------------------------+---------------------------+--------------------------'
    );
    for (const e9094Mode of ['frozen', 'prior']) {
      const modeTag = e9094Mode === 'frozen' ? 'E9094: Frozen (t_close-3h)' : 'E9094: Prior-Cycle (t-12.5h)';
      console.log(`  -- ${modeTag} --`);
      for (const m of models) {
        const res = evaluateModel(m.key, e9094Mode, filterFn);
        if (res.totalObs === 0) continue;
        const nStr = `${res.matched}/${res.totalObs}(${res.missed}/${res.falseLocks})`;
        console.log(fmtMinStatRow(m.label, nStr, res.closeStats, res.openStats, res.durStats));
        if (m.key === 'ILF' && e9094Mode === 'prior' && res.matched > 0) {
          console.log(
            `     (Note: E72439 crests after observed t_close on ${res.ilfClosedBeforeCrest}/${res.matched} locks; Dur uses causal obs t_close when already closed)`
          );
        }
      }
    }
  };

  printTable(`All Out-of-Sample Dunball Locks (obs n=${testObsLocks.length}, non-locked test cycles=${nonLockedTestCycles.length})`);

  const floodRelevantLocks = testObsLocks.filter(
    iv => (iv.closeThresh !== null && iv.closeThresh >= 3.0) || iv.maxSea >= 4.5
  );
  if (floodRelevantLocks.length >= 5) {
    printTable(
      `Flood-Relevant / High-Drain Locks (E9094 >= 3.0m OR 52163 HW >= 4.5m, obs n=${floodRelevantLocks.length})`,
      iv => (iv.closeThresh !== null && iv.closeThresh >= 3.0) || iv.maxSea >= 4.5
    );
  }

  const highDrainOnly = testObsLocks.filter(iv => iv.closeThresh !== null && iv.closeThresh >= 3.0);
  if (highDrainOnly.length >= 5 && highDrainOnly.length < floodRelevantLocks.length) {
    printTable(
      `High-Drain KSD Only (E9094 >= 3.0 mAOD, obs n=${highDrainOnly.length})`,
      iv => iv.closeThresh !== null && iv.closeThresh >= 3.0
    );
  }

  return { testObsCount: testObsLocks.length };
}

// ---------------------------------------------------------------------------
// 7. Split Benchmark Runner
// ---------------------------------------------------------------------------

function runRegimeBenchmark({
  regimeName,
  trainFilter,
  testFilter,
  hinkley,
  hinkleyPeaks,
  dunball,
  dunballPeaks,
  bridgwaterPeaks,
  ksdMap,
  hookMap,
  gawMap,
  weather,
  prevWeather,
  marine,
  waves,
  ilfracombe,
  ilfracombePeaks,
  milford,
  milfordPeaks,
  canary
}) {
  console.log('\n' + '='.repeat(108));
  console.log(`REGIME: ${regimeName}`);
  console.log('='.repeat(108));

  const hTrain = hinkley.filter(pt => trainFilter(pt.ms));
  const hTest = hinkley.filter(pt => testFilter(pt.ms));

  if (hTrain.length < 500 || hTest.length < 200) {
    console.log(
      `[SKIP] Insufficient Hinkley samples (train=${hTrain.length}, test=${hTest.length}).`
    );
    return null;
  }

  const trainSpanDays = (hTrain[hTrain.length - 1].ms - hTrain[0].ms) / DAY_MS;
  const testSpanDays = (hTest[hTest.length - 1].ms - hTest[0].ms) / DAY_MS;
  const t0Ms = hTrain[0].ms;

  const baseConst = selectBaselineConstituents(trainSpanDays);
  const fullConst = selectFullConstituents(trainSpanDays);
  const polConst = selectPolConstituents(trainSpanDays);

  console.log(
    `Hinkley Train: ${hTrain.length} pts (${fmtDate(hTrain[0].ms)} .. ${fmtDate(hTrain[hTrain.length - 1].ms)}, span=${trainSpanDays.toFixed(1)}d)`
  );
  console.log(
    `Hinkley Test : ${hTest.length} pts (${fmtDate(hTest[0].ms)} .. ${fmtDate(hTest[hTest.length - 1].ms)}, span=${testSpanDays.toFixed(1)}d)`
  );
  console.log(
    `Constituents : Baseline=${baseConst.length} (no nodal) | Full=${fullConst.length} (ridge=1e-4) | POL=${polConst.length} (+10 compound, 2MN2 L2, ridge=0.5)`
  );

  // Fit Model A (Baseline 10-constituent parity), Model B (32-const), and Model B2 (POL-42)
  const modelA = fitHarmonics(hTrain, t0Ms, baseConst, { useNodal: false, ridge: 1e-6 });
  const modelB = fitHarmonics(hTrain, t0Ms, fullConst, { useNodal: true, ridge: 1e-4 });
  const modelB2 = fitHarmonics(hTrain, t0Ms, polConst, { useNodal: true, ridge: 0.5 });

  // Fit Open-Meteo Marine's OWN astronomical tide (on train split only) to extract pure de-tided CMEMS surge
  let marineBayAstro = null;
  if (marine && marine.bayMap.size >= 500) {
    const mBayTrain = [];
    for (const [ms, value] of marine.bayMap) {
      if (trainFilter(ms)) mBayTrain.push({ ms, value });
    }
    mBayTrain.sort((a, b) => a.ms - b.ms);
    if (mBayTrain.length >= 300) {
      marineBayAstro = fitHarmonics(mBayTrain, t0Ms, polConst, { useNodal: true, ridge: 0.5 });
    }
  }

  // Build per-HW-cycle records for Hinkley with strictly causal prev_skew & physical sanity gate
  const MAX_ABS_SKEW_M = 1.5;
  let rejectedTrainSkew = 0;
  let rejectedTestSkew = 0;
  let prevSkewFallbacks = 0;
  const cycleRecords = [];

  for (let i = 0; i < hinkleyPeaks.length; i++) {
    const pk = hinkleyPeaks[i];
    const astroA = findAstroHighWater(ms => modelA.predict(ms), pk.trueMs);
    const astroB = findAstroHighWater(ms => modelB.predict(ms), pk.trueMs);
    const astroB2 = findAstroHighWater(ms => modelB2.predict(ms), pk.trueMs);
    const skewB = pk.value - astroB.value;
    const skewB2 = pk.value - astroB2.value;
    const isOutlierSkew = Math.abs(skewB) > MAX_ABS_SKEW_M;
    const isTrain = trainFilter(pk.trueMs);
    const isTest = testFilter(pk.trueMs);

    if (isOutlierSkew) {
      if (isTrain) rejectedTrainSkew++;
      if (isTest) rejectedTestSkew++;
    }

    let prevSkewB = null;
    let prevSkewB2 = null;
    let prev1Rec = null;
    let prev2Rec = null;
    if (i > 0) {
      const prevRec = cycleRecords[i - 1];
      const dtPrev = pk.trueMs - prevRec.pk.trueMs;
      if (dtPrev >= 10 * HOUR_MS && dtPrev <= 15 * HOUR_MS) {
        if (!prevRec.isOutlierSkew) {
          prevSkewB = prevRec.skewB;
          prevSkewB2 = prevRec.skewB2;
          prev1Rec = prevRec;
        } else {
          // Physical sanity fallback: never feed a rejected >1.50m artifact into AR(1)
          const prev2 = i > 1 ? cycleRecords[i - 2] : null;
          if (
            prev2 &&
            !prev2.isOutlierSkew &&
            pk.trueMs - prev2.pk.trueMs <= 28 * HOUR_MS
          ) {
            prevSkewB = prev2.skewB;
            prevSkewB2 = prev2.skewB2;
            prev1Rec = prev2;
          } else {
            prevSkewB = 0.0;
            prevSkewB2 = 0.0;
          }
          prevSkewFallbacks++;
        }
      }
    }
    if (i > 1) {
      const p2 = cycleRecords[i - 2];
      const dt2 = pk.trueMs - p2.pk.trueMs;
      if (!p2.isOutlierSkew && dt2 >= 21 * HOUR_MS && dt2 <= 28 * HOUR_MS) {
        prev2Rec = p2;
      }
    }

    // Extract offshore meteorological features (hindcast + optional Day-1 previous_runs) & marine waves
    const { metFeats, met2D } = extractMetFeatures(weather, pk.trueMs);
    const { metFeats: prevMetFeats, met2D: prevMet2D } = extractMetFeatures(prevWeather, pk.trueMs);
    const waveFeats = extractWaveFeatures(waves, pk.trueMs);

    // Extract Open-Meteo Marine HW peak, raw diff (v2.1), and pure de-tided CMEMS surge (v2.2)
    let marineHW = null;
    let marineSurge = null;
    let celticMarineSurge = null;
    let pureMarineSkew = null;
    let cmemsCausal25 = null;
    if (marine) {
      const mBay = findMarineHighWater(marine.bayMap, astroB.ms);
      if (mBay) {
        marineHW = mBay.value;
        marineSurge = mBay.value - astroB.value;
        if (marineBayAstro) {
          const mOwnAstro = findAstroHighWater(ms => marineBayAstro.predict(ms), astroB2.ms);
          pureMarineSkew = mBay.value - mOwnAstro.value;
          // Strictly causal [t_HW - 24h, t_HW] sub-tidal marine non-tidal residual
          const h0 = Math.round(astroB2.ms / HOUR_MS) * HOUR_MS;
          let sumNtr = 0;
          let cntNtr = 0;
          for (let dh = -24; dh <= 0; dh++) {
            const t = h0 + dh * HOUR_MS;
            const v = marine.bayMap.get(t);
            if (v !== undefined) {
              sumNtr += v - marineBayAstro.predict(t);
              cntNtr++;
            }
          }
          if (cntNtr >= 12) cmemsCausal25 = sumNtr / cntNtr;
        }
      }
      if (marine.celticMap) {
        const mCel = findMarineHighWater(marine.celticMap, astroB.ms);
        if (mCel) {
          celticMarineSurge = mCel.value - astroB.value;
        }
      }
    }

    cycleRecords.push({
      pk,
      astroA: astroA.value,
      astroB: astroB.value,
      astroB2: astroB2.value,
      astroBMs: astroB.ms,
      skewB,
      skewB2,
      isOutlierSkew,
      prevSkewB,
      prevSkewB2,
      prev1Rec,
      prev2Rec,
      metFeats,
      met2D,
      prevMetFeats,
      prevMet2D,
      waveFeats,
      marineHW,
      marineSurge,
      celticMarineSurge,
      pureMarineSkew,
      cmemsCausal25,
      isTrain,
      isTest
    });
  }

  console.log(
    `[QC-SKEW] Sanity gate (|skew| <= ${MAX_ABS_SKEW_M.toFixed(2)}m): rejected ${rejectedTrainSkew} train + ${rejectedTestSkew} test cycles; ${prevSkewFallbacks} AR(1) prev_skew fallbacks`
  );

  // Fit Model C: AR(1) skew surge on valid train cycles only
  const arTrainX = [];
  const arTrainY = [];
  for (const r of cycleRecords) {
    if (r.isTrain && !r.isOutlierSkew && r.prevSkewB !== null) {
      arTrainX.push([r.prevSkewB]);
      arTrainY.push(r.skewB);
    }
  }
  const arModel = arTrainX.length >= 20 ? fitRidgeOLS(arTrainX, arTrainY, 1e-4) : null;

  // Fit Model D: AR(1) + Offshore Met Forcing on valid train cycles only
  const metTrainX = [];
  const metTrainY = [];
  const metTrainB2X = [];
  const metTrainB2Y = [];
  for (const r of cycleRecords) {
    if (r.isTrain && !r.isOutlierSkew && r.prevSkewB !== null && r.metFeats !== null) {
      metTrainX.push([r.prevSkewB, ...r.metFeats]);
      metTrainY.push(r.skewB);
    }
    if (r.isTrain && !r.isOutlierSkew && r.prevSkewB2 !== null && r.metFeats !== null) {
      metTrainB2X.push([r.prevSkewB2, ...r.metFeats]);
      metTrainB2Y.push(r.skewB2);
    }
  }
  const metModel = metTrainX.length >= 30 ? fitRidgeOLS(metTrainX, metTrainY, 5.0) : null;
  const metModelB2 = metTrainB2X.length >= 30 ? fitRidgeOLS(metTrainB2X, metTrainB2Y, 5.0) : null;

  // Fit Model E1: Bias-corrected Open-Meteo Marine HW directly (H_pred = b0 + b1 * marine_HW)
  const e1TrainX = [];
  const e1TrainY = [];
  for (const r of cycleRecords) {
    if (r.isTrain && !r.isOutlierSkew && r.marineHW !== null) {
      e1TrainX.push([r.marineHW]);
      e1TrainY.push(r.pk.value);
    }
  }
  const e1Model = e1TrainX.length >= 20 ? fitRidgeOLS(e1TrainX, e1TrainY, 1e-4) : null;

  // Fit Model E2: Full Astro + AR(1) + Offshore Met + Marine Surge (+ Celtic Marine Surge if present)
  const useCelticMarine =
    marine &&
    marine.celticMap &&
    cycleRecords.filter(
      r => r.isTrain && !r.isOutlierSkew && r.marineSurge !== null && r.celticMarineSurge !== null
    ).length >= 30;
  const e2UsesMet = metModel !== null;
  const buildE2Row = r => {
    if (r.prevSkewB === null || r.marineSurge === null) return null;
    if (e2UsesMet && r.metFeats === null) return null;
    if (useCelticMarine && r.celticMarineSurge === null) return null;
    const row = [r.prevSkewB];
    if (e2UsesMet) row.push(...r.metFeats);
    row.push(r.marineSurge);
    if (useCelticMarine) row.push(r.celticMarineSurge);
    return row;
  };

  const e2TrainX = [];
  const e2TrainY = [];
  for (const r of cycleRecords) {
    if (!r.isTrain || r.isOutlierSkew) continue;
    const row = buildE2Row(r);
    if (row) {
      e2TrainX.push(row);
      e2TrainY.push(r.skewB);
    }
  }
  const e2Model = e2TrainX.length >= 30 ? fitRidgeOLS(e2TrainX, e2TrainY, 5.0) : null;

  // Fit Model E3 (PoC v2.2): POL-42 + De-tided Marine Surge + Innovation AR(1,2) + 2D Wind + Tide-Surge Interaction
  const e3UsesMet = metModel !== null;
  const buildE3Row = r => {
    if (
      r.pureMarineSkew === null ||
      r.cmemsCausal25 === null ||
      !r.prev1Rec ||
      r.prev1Rec.pureMarineSkew === null
    ) {
      return null;
    }
    if (e3UsesMet && (!r.met2D || !r.prev1Rec.met2D)) return null;
    const innov1 = r.prev1Rec.skewB2 - r.prev1Rec.pureMarineSkew;
    const innov2 =
      r.prev2Rec && r.prev2Rec.pureMarineSkew !== null
        ? r.prev2Rec.skewB2 - r.prev2Rec.pureMarineSkew
        : innov1;
    const row = [
      r.pureMarineSkew,
      r.cmemsCausal25,
      innov1,
      innov2,
      (r.astroB2 - 4.3) * r.pureMarineSkew // Shallow-water tide-surge depth interaction
    ];
    if (e3UsesMet) {
      row.push(
        r.met2D.ibBay - r.prev1Rec.met2D.ibBay,
        r.met2D.wsAlong0,
        r.met2D.wsCross0,
        r.met2D.wsAlong3,
        r.met2D.wsCross3
      );
    }
    return row;
  };

  const e3TrainX = [];
  const e3TrainY = [];
  for (const r of cycleRecords) {
    if (!r.isTrain || r.isOutlierSkew) continue;
    const row = buildE3Row(r);
    if (row) {
      e3TrainX.push(row);
      e3TrainY.push(r.skewB2);
    }
  }
  const e3Model = e3TrainX.length >= 30 ? fitRidgeOLS(e3TrainX, e3TrainY, 2.0) : null;

  // Fit Model E4 (PoC v2.3): Model E3 + Strictly Causal Onshore Wave Setup & Swell (t_HW and t_HW - 3h)
  const buildE4Row = r => {
    const base = buildE3Row(r);
    if (!base || !r.waveFeats) return null;
    return [...base, ...r.waveFeats];
  };
  const e4TrainX = [];
  const e4TrainY = [];
  for (const r of cycleRecords) {
    if (!r.isTrain || r.isOutlierSkew) continue;
    const row = buildE4Row(r);
    if (row) {
      e4TrainX.push(row);
      e4TrainY.push(r.skewB2);
    }
  }
  const e4Model = e4TrainX.length >= 30 ? fitRidgeOLS(e4TrainX, e4TrainY, 3.0) : null;

  if (arModel) {
    console.log(
      `AR(1) Skew-Surge Fit (train n=${arTrainX.length}): skew(k) = ${arModel.intercept.toFixed(4)} + ${arModel.coefs[0].toFixed(3)} * skew(k-1)`
    );
  }
  if (metModel) {
    console.log(
      `Model D Met-Surge Fit (train n=${metTrainX.length}): prev_skew=${metModel.coefs[0].toFixed(3)}, ib_bay=${(metModel.coefs[1] * 100).toFixed(2)}cm/hPa, ib_cel6=${(metModel.coefs[2] * 100).toFixed(2)}, ib_cel3=${(metModel.coefs[3] * 100).toFixed(2)}, dP/dt=${(metModel.coefs[4] * 100).toFixed(2)}, wind3h=${(metModel.coefs[5] * 1000).toFixed(2)}mm/(m/s)^2, wind0h=${(metModel.coefs[6] * 1000).toFixed(2)}`
    );
  } else if (!weather) {
    console.log(
      `[INFO] Weather cache not found at ${WEATHER_PATH}; skipping Model D (Offshore Met Forcing).`
    );
  } else {
    console.log(
      `[INFO] Insufficient overlapping weather records in train split (n=${metTrainX.length}); skipping Model D.`
    );
  }
  if (e1Model) {
    console.log(
      `Model E1 Marine-HW Fit (train n=${e1TrainX.length}): H_pred = ${e1Model.intercept.toFixed(3)} + ${e1Model.coefs[0].toFixed(3)} * marine_HW`
    );
  }
  if (e2Model) {
    const mIdx = e2UsesMet ? 7 : 1;
    const celPart = useCelticMarine ? `, celtic_marine_surge=${e2Model.coefs[mIdx + 1].toFixed(3)}` : '';
    console.log(
      `Model E2 Full+Marine Fit (train n=${e2TrainX.length}): prev_skew=${e2Model.coefs[0].toFixed(3)}, marine_surge=${e2Model.coefs[mIdx].toFixed(3)}${celPart}`
    );
  } else if (!marine) {
    console.log(
      `[INFO] Marine cache not found at ${MARINE_PATH}; skipping Models E1/E2/E3/E4 (Open-Meteo Marine).`
    );
  }
  if (e3Model) {
    console.log(
      `Model E3 PoC v2.2 Fit (train n=${e3TrainX.length}): pure_marine=${e3Model.coefs[0].toFixed(3)}, ntr25=${e3Model.coefs[1].toFixed(3)}, innov1=${e3Model.coefs[2].toFixed(3)}, innov2=${e3Model.coefs[3].toFixed(3)}, depth_x_surge=${e3Model.coefs[4].toFixed(3)}`
    );
  }
  if (e4Model) {
    const wOff = e3UsesMet ? 10 : 5;
    console.log(
      `Model E4 Wave-Setup Fit (train n=${e4TrainX.length}): outHs0=${(e4Model.coefs[wOff] * 100).toFixed(2)}cm/m, outOn0=${(e4Model.coefs[wOff + 1] * 100).toFixed(2)}, outSw0=${(e4Model.coefs[wOff + 2] * 100).toFixed(2)}, bayHs0=${(e4Model.coefs[wOff + 4] * 100).toFixed(2)}, bayOn0=${(e4Model.coefs[wOff + 5] * 100).toFixed(2)}`
    );
  } else if (!waves) {
    console.log(
      `[INFO] Marine waves cache not found at ${WAVES_PATH}; skipping Model E4 (Wave Setup).`
    );
  }

  // Strictly causal selection of best 12h driver (E3 vs E2 vs D vs C) based on train RMSE
  const calcTrainRmse = (model, X, y) => {
    if (!model || !X.length) return Infinity;
    let s = 0;
    for (let i = 0; i < X.length; i++) {
      const e = model.predict(X[i]) - y[i];
      s += e * e;
    }
    return Math.sqrt(s / X.length);
  };
  const trainRmseD = calcTrainRmse(metModel, metTrainX, metTrainY);
  const trainRmseE2 = calcTrainRmse(e2Model, e2TrainX, e2TrainY);
  const trainRmseE3 = calcTrainRmse(e3Model, e3TrainX, e3TrainY);
  const preferE3 = e3Model !== null && trainRmseE3 <= Math.min(trainRmseE2, trainRmseD);
  const preferE2 = !preferE3 && e2Model !== null && trainRmseE2 <= trainRmseD;
  const h1DriverName = preferE3
    ? 'Model E3 (POL-42 + De-tided Marine + Innovation AR + 2D Wind)'
    : preferE2
      ? 'Model E2 (Astro+AR1+Met+Marine)'
      : metModel
        ? 'Model D (Astro+AR1+Met)'
        : 'Model C (Astro+AR1)';
  console.log(`[Cascade H1 Driver] Propagating ${h1DriverName} into Dunball/Bridgwater/Hookbridge`);

  // Evaluate Models A, B, B2, C, D, E1, E2, E3, E4 on out-of-sample Hinkley HW peaks (~12h lead)
  const errA = [];
  const errB = [];
  const errB2 = [];
  const errC = [];
  const errD = [];
  const errDHigh = [];
  const errE1 = [];
  const errE2 = [];
  const errE3 = [];
  const errE4 = [];
  const errE2High = [];
  const errE3High = [];
  const errE4High = [];
  const testCycles = [];

  // Matched Hindcast vs Open-Meteo previous_runs Day-1 Forecast Degradation Audit buckets
  const degBuckets = {
    D: { hindAll: [], prevAll: [], hindHigh: [], prevHigh: [] },
    E2: { hindAll: [], prevAll: [], hindHigh: [], prevHigh: [] },
    E3: { hindAll: [], prevAll: [], hindHigh: [], prevHigh: [] }
  };

  for (const r of cycleRecords) {
    // Compute best 12h predicted Hinkley HW for downstream cascade chaining
    const predA = r.astroA;
    const predB = r.astroB;
    const predB2 = r.astroB2;
    const predSkewC =
      arModel && r.prevSkewB !== null ? arModel.predict([r.prevSkewB]) : 0.0;
    const predC = r.astroB + predSkewC;
    const predSkewD =
      metModel && r.prevSkewB !== null && r.metFeats !== null
        ? metModel.predict([r.prevSkewB, ...r.metFeats])
        : null;
    const predD = predSkewD !== null ? r.astroB + predSkewD : null;

    const predE1 = e1Model && r.marineHW !== null ? e1Model.predict([r.marineHW]) : null;
    const e2Row = e2Model ? buildE2Row(r) : null;
    const predSkewE2 = e2Row ? e2Model.predict(e2Row) : null;
    const predE2 = predSkewE2 !== null ? r.astroB + predSkewE2 : null;

    const e3Row = e3Model ? buildE3Row(r) : null;
    const predSkewE3 = e3Row ? e3Model.predict(e3Row) : null;
    const predE3 = predSkewE3 !== null ? r.astroB2 + predSkewE3 : null;

    const e4Row = e4Model ? buildE4Row(r) : null;
    const predSkewE4 = e4Row ? e4Model.predict(e4Row) : null;
    const predE4 = predSkewE4 !== null ? r.astroB2 + predSkewE4 : null;

    if (preferE3 && predE3 !== null) {
      r.predBest12h = predE3;
      r.predSkewBest12h = predSkewE3;
      r.bestActSkew = r.skewB2;
    } else if (preferE2 && predE2 !== null) {
      r.predBest12h = predE2;
      r.predSkewBest12h = predSkewE2;
      r.bestActSkew = r.skewB;
    } else if (predD !== null) {
      r.predBest12h = predD;
      r.predSkewBest12h = predSkewD;
      r.bestActSkew = r.skewB;
    } else {
      r.predBest12h = predC;
      r.predSkewBest12h = predSkewC;
      r.bestActSkew = r.skewB;
    }

    if (!r.isTest || r.isOutlierSkew) continue;
    const isHigh = r.pk.value >= 4.5;
    errA.push((predA - r.pk.value) * 100);
    errB.push((predB - r.pk.value) * 100);
    errB2.push((predB2 - r.pk.value) * 100);
    if (r.prevSkewB !== null) {
      errC.push((predC - r.pk.value) * 100);
    }
    if (predD !== null) {
      const eCm = (predD - r.pk.value) * 100;
      errD.push(eCm);
      if (isHigh) errDHigh.push(eCm);
    }
    if (predE1 !== null) {
      errE1.push((predE1 - r.pk.value) * 100);
    }
    if (predE2 !== null) {
      const eCm = (predE2 - r.pk.value) * 100;
      errE2.push(eCm);
      if (isHigh) errE2High.push(eCm);
    }
    if (predE3 !== null) {
      const eCm = (predE3 - r.pk.value) * 100;
      errE3.push(eCm);
      if (isHigh) errE3High.push(eCm);
    }
    if (predE4 !== null) {
      const eCm = (predE4 - r.pk.value) * 100;
      errE4.push(eCm);
      if (isHigh) errE4High.push(eCm);
    }

    // Honest Day-1 Forecast Degradation Audit: evaluate trained D, E2, E3 with previous_runs weather
    if (prevWeather) {
      if (predD !== null && metModel && r.prevSkewB !== null && r.prevMetFeats !== null) {
        const pDPrev = r.astroB + metModel.predict([r.prevSkewB, ...r.prevMetFeats]);
        const eH = (predD - r.pk.value) * 100;
        const eP = (pDPrev - r.pk.value) * 100;
        degBuckets.D.hindAll.push(eH);
        degBuckets.D.prevAll.push(eP);
        if (isHigh) {
          degBuckets.D.hindHigh.push(eH);
          degBuckets.D.prevHigh.push(eP);
        }
      }
      if (predE2 !== null && e2Model && e2UsesMet && r.prevMetFeats !== null) {
        const e2PrevRow = [r.prevSkewB, ...r.prevMetFeats, r.marineSurge];
        if (useCelticMarine) e2PrevRow.push(r.celticMarineSurge);
        const pE2Prev = r.astroB + e2Model.predict(e2PrevRow);
        const eH = (predE2 - r.pk.value) * 100;
        const eP = (pE2Prev - r.pk.value) * 100;
        degBuckets.E2.hindAll.push(eH);
        degBuckets.E2.prevAll.push(eP);
        if (isHigh) {
          degBuckets.E2.hindHigh.push(eH);
          degBuckets.E2.prevHigh.push(eP);
        }
      }
      if (predE3 !== null && e3Model && e3UsesMet && r.prevMet2D !== null && r.prev1Rec) {
        const prev1Met = r.prev1Rec.prevMet2D ?? r.prev1Rec.met2D;
        if (prev1Met) {
          const innov1 = r.prev1Rec.skewB2 - r.prev1Rec.pureMarineSkew;
          const innov2 =
            r.prev2Rec && r.prev2Rec.pureMarineSkew !== null
              ? r.prev2Rec.skewB2 - r.prev2Rec.pureMarineSkew
              : innov1;
          const e3PrevRow = [
            r.pureMarineSkew,
            r.cmemsCausal25,
            innov1,
            innov2,
            (r.astroB2 - 4.3) * r.pureMarineSkew,
            r.prevMet2D.ibBay - prev1Met.ibBay,
            r.prevMet2D.wsAlong0,
            r.prevMet2D.wsCross0,
            r.prevMet2D.wsAlong3,
            r.prevMet2D.wsCross3
          ];
          const pE3Prev = r.astroB2 + e3Model.predict(e3PrevRow);
          const eH = (predE3 - r.pk.value) * 100;
          const eP = (pE3Prev - r.pk.value) * 100;
          degBuckets.E3.hindAll.push(eH);
          degBuckets.E3.prevAll.push(eP);
          if (isHigh) {
            degBuckets.E3.hindHigh.push(eH);
            degBuckets.E3.prevHigh.push(eP);
          }
        }
      }
    }

    testCycles.push(r);
  }

  console.log('\n--- HINKLEY POINT (52106) HIGH-WATER PEAK BENCHMARK (~12h LEAD, OUT-OF-SAMPLE) ---');
  const sA = calcStats(errA);
  const sB = calcStats(errB);
  const sB2 = calcStats(errB2);
  const sC = calcStats(errC);
  const sD = calcStats(errD);
  const sDHigh = calcStats(errDHigh);
  const sE1 = calcStats(errE1);
  const sE2 = calcStats(errE2);
  const sE3 = calcStats(errE3);
  const sE4 = calcStats(errE4);
  const sE2High = calcStats(errE2High);
  const sE3High = calcStats(errE3High);
  const sE4High = calcStats(errE4High);
  console.log(fmtStatRow('A. Baseline 10-const Astro (v1 parity)', sA));
  console.log(fmtStatRow('B. Full 32/35-const Astro + Nodal', sB));
  console.log(fmtStatRow('B2. POL-42 Bristol Channel Compound Astro', sB2));
  console.log(fmtStatRow('C. Full Astro + Nodal + AR(1) Skew Surge', sC));
  if (errD.length) {
    console.log(fmtStatRow('D. Full Astro + AR(1) + Offshore Met Forcing', sD));
  }
  if (errE1.length) {
    console.log(fmtStatRow('E1. Bias-Corrected Open-Meteo Marine HW', sE1));
  }
  if (errE2.length) {
    console.log(fmtStatRow('E2. v2.1: 32c + AR(1) + Met + Raw Marine Diff', sE2));
  }
  if (errE3.length) {
    console.log(fmtStatRow('E3. v2.2: POL-42 + De-tided Mar + InnovAR + 2DW', sE3));
  }
  if (errE4.length) {
    console.log(fmtStatRow('E4. v2.3: E3 + Onshore Wave Setup & Swell', sE4));
  }
  if (errDHigh.length || errE2High.length || errE3High.length || errE4High.length) {
    console.log('\n  [Flood-Relevant High/Spring Tides Only: H_obs >= 4.50 mAOD]');
    if (errDHigh.length) {
      console.log(fmtStatRow('D  (Met)  High Tides >= 4.5m', sDHigh));
    }
    if (errE2High.length) {
      console.log(fmtStatRow('E2 (v2.1) High Tides >= 4.5m', sE2High));
    }
    if (errE3High.length) {
      console.log(fmtStatRow('E3 (v2.2) High Tides >= 4.5m', sE3High));
    }
    if (errE4High.length) {
      console.log(fmtStatRow('E4 (v2.3) High Tides >= 4.5m', sE4High));
    }
  }

  // Print Honest Day-1 Forecast Degradation Audit side-by-side table if previous_runs weather is present
  const hasPrevAudit =
    degBuckets.D.prevAll.length > 0 ||
    degBuckets.E2.prevAll.length > 0 ||
    degBuckets.E3.prevAll.length > 0;
  if (hasPrevAudit) {
    console.log(
      '\n--- HONEST DAY-1 FORECAST DEGRADATION AUDIT (Hindcast Archive vs Open-Meteo previous_runs Day-1) ---'
    );
    console.log(
      '  Model                          | Tide Subset  |   n | Hindcast MAE / RMSE / P95  | Day-1 Fcst MAE / RMSE / P95 | Delta MAE'
    );
    console.log(
      '  -------------------------------+--------------+-----+----------------------------+-----------------------------+----------'
    );
    const fmtTriple = s =>
      `${s.mae.toFixed(1).padStart(5)} / ${s.rmse.toFixed(1).padStart(5)} / ${s.p95.toFixed(1).padStart(5)} cm`;
    const printDegRow = (label, subset, hErrs, pErrs) => {
      if (!pErrs.length) return;
      const sh = calcStats(hErrs);
      const sp = calcStats(pErrs);
      const dMae = sp.mae - sh.mae;
      const dStr = `${dMae >= 0 ? '+' : ''}${dMae.toFixed(2)} cm`.padStart(9);
      console.log(
        `  ${label.padEnd(30)} | ${subset.padEnd(12)} | ${String(sp.n).padStart(3)} | ` +
          `${fmtTriple(sh).padEnd(26)} | ${fmtTriple(sp).padEnd(27)} | ${dStr}`
      );
    };
    printDegRow('Model D  (32c+AR1+Met)', 'All tides', degBuckets.D.hindAll, degBuckets.D.prevAll);
    printDegRow('Model D  (32c+AR1+Met)', 'High >=4.5m', degBuckets.D.hindHigh, degBuckets.D.prevHigh);
    printDegRow('Model E2 (v2.1+RawMar)', 'All tides', degBuckets.E2.hindAll, degBuckets.E2.prevAll);
    printDegRow('Model E2 (v2.1+RawMar)', 'High >=4.5m', degBuckets.E2.hindHigh, degBuckets.E2.prevHigh);
    printDegRow('Model E3 (v2.2+DetMar)', 'All tides', degBuckets.E3.hindAll, degBuckets.E3.prevAll);
    printDegRow('Model E3 (v2.2+DetMar)', 'High >=4.5m', degBuckets.E3.hindHigh, degBuckets.E3.prevHigh);
  } else if (!prevWeather) {
    console.log(
      `\n[INFO] Day-1 forecast weather cache not found at ${PREV_WEATHER_PATH}; skipping previous_runs degradation audit.`
    );
  }

  // -------------------------------------------------------------------------
  // Estuarine Cascade Matching: 52106 -> 52163 -> 52124 -> 52118
  // -------------------------------------------------------------------------
  function findClosestPeak(peakList, targetMs, minOffsetMs, maxOffsetMs) {
    let best = null;
    let bestAbs = Infinity;
    for (const p of peakList) {
      const dt = p.trueMs - targetMs;
      if (dt < minOffsetMs || dt > maxOffsetMs) continue;
      const a = Math.abs(dt);
      if (a < bestAbs) {
        bestAbs = a;
        best = p;
      }
    }
    return best;
  }

  function getWindowStat(map, centerMs, startOffsetMs, endOffsetMs, mode = 'min') {
    const vals = [];
    const t0 = toNearest15Min(centerMs + startOffsetMs);
    const t1 = toNearest15Min(centerMs + endOffsetMs);
    for (let t = t0; t <= t1; t += STEP_15M_MS) {
      const v = map.get(t);
      if (v !== undefined) vals.push(v);
    }
    if (!vals.length) return null;
    if (mode === 'min') return Math.min(...vals);
    if (mode === 'max') return Math.max(...vals);
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  const cascadeRows = [];
  for (const r of cycleRecords) {
    if (r.isOutlierSkew) continue;
    const dPk = findClosestPeak(dunballPeaks, r.pk.trueMs, -15 * 60000, 150 * 60000);
    const bPk = findClosestPeak(bridgwaterPeaks, r.pk.trueMs, 0, 210 * 60000);

    // Causal river stage inputs at 12h lead (for Horizon 1) and 2-4h lead (for Horizon 2)
    const gawPre12h = getWindowStat(gawMap, r.pk.trueMs, -14 * HOUR_MS, -12 * HOUR_MS, 'mean');
    const gawPre2h = getWindowStat(gawMap, r.pk.trueMs, -4 * HOUR_MS, -2 * HOUR_MS, 'mean');

    const refMs = dPk ? dPk.trueMs : r.pk.trueMs + 30 * 60000;
    const hookPre12h = getWindowStat(hookMap, refMs, -15 * HOUR_MS, -12 * HOUR_MS, 'min');
    const hookPre2h = getWindowStat(hookMap, refMs, -3 * HOUR_MS, -2 * HOUR_MS, 'min');
    const hookPostMax = dPk
      ? getWindowStat(hookMap, dPk.trueMs, 45 * 60000, 180 * 60000, 'max')
      : null;

    cascadeRows.push({
      r,
      hObs: r.pk.value,
      hPred12h: r.predBest12h,
      dPk,
      bPk,
      gawPre12h,
      gawPre2h,
      hookPre12h,
      hookPre2h,
      hookPostMax
    });
  }

  // --- Stage 1: Hinkley (52106) -> Dunball (52163) ---
  const dTrain = cascadeRows.filter(c => c.r.isTrain && c.dPk);

  const dunLin =
    dTrain.length >= 20
      ? fitRidgeOLS(
          dTrain.map(c => [c.hObs]),
          dTrain.map(c => c.dPk.value),
          1e-4
        )
      : null;
  const dunQuad =
    dTrain.length >= 20
      ? fitRidgeOLS(
          dTrain.map(c => [c.hObs, c.hObs * c.hObs]),
          dTrain.map(c => c.dPk.value),
          1e-4
        )
      : null;

  const dunH1LinErr = [];
  const dunH1QuadErr = [];
  const dunH2LinErr = [];
  const dunH2QuadErr = [];

  for (const c of cascadeRows) {
    if (dunQuad) {
      c.dPredH1 = dunQuad.predict([c.hPred12h, c.hPred12h * c.hPred12h]);
      c.dPredH2 = dunQuad.predict([c.hObs, c.hObs * c.hObs]);
    }
    if (!c.r.isTest || !c.dPk || !dunLin || !dunQuad) continue;
    dunH1LinErr.push((dunLin.predict([c.hPred12h]) - c.dPk.value) * 100);
    dunH1QuadErr.push((c.dPredH1 - c.dPk.value) * 100);
    dunH2LinErr.push((dunLin.predict([c.hObs]) - c.dPk.value) * 100);
    dunH2QuadErr.push((c.dPredH2 - c.dPk.value) * 100);
  }

  // --- Stage 2: Dunball (52163) -> Bridgwater West Quay (52124) ---
  const bTrainSea = cascadeRows.filter(c => c.r.isTrain && c.dPk && c.bPk);
  const bTrainRiv = cascadeRows.filter(
    c => c.r.isTrain && c.dPk && c.bPk && c.gawPre2h !== null && c.hookPre2h !== null
  );

  const bSeaModel =
    bTrainSea.length >= 20
      ? fitRidgeOLS(
          bTrainSea.map(c => [c.dPk.value, c.dPk.value * c.dPk.value]),
          bTrainSea.map(c => c.bPk.value),
          1e-3
        )
      : null;
  const bRivModel =
    bTrainRiv.length >= 20
      ? fitRidgeOLS(
          bTrainRiv.map(c => [c.dPk.value, c.dPk.value * c.dPk.value, c.gawPre2h, c.hookPre2h]),
          bTrainRiv.map(c => c.bPk.value),
          1e-2
        )
      : null;

  const bH1SeaErr = [];
  const bH1RivErr = [];
  const bH2SeaErr = [];
  const bH2RivErr = [];

  for (const c of cascadeRows) {
    if (!c.r.isTest || !c.bPk || c.dPredH1 === undefined) continue;
    if (bSeaModel) {
      bH1SeaErr.push((bSeaModel.predict([c.dPredH1, c.dPredH1 * c.dPredH1]) - c.bPk.value) * 100);
      bH2SeaErr.push((bSeaModel.predict([c.dPredH2, c.dPredH2 * c.dPredH2]) - c.bPk.value) * 100);
    }
    if (bRivModel && c.gawPre12h !== null && c.hookPre12h !== null) {
      bH1RivErr.push(
        (bRivModel.predict([c.dPredH1, c.dPredH1 * c.dPredH1, c.gawPre12h, c.hookPre12h]) -
          c.bPk.value) *
          100
      );
    }
    if (bRivModel && c.gawPre2h !== null && c.hookPre2h !== null) {
      bH2RivErr.push(
        (bRivModel.predict([c.dPredH2, c.dPredH2 * c.dPredH2, c.gawPre2h, c.hookPre2h]) -
          c.bPk.value) *
          100
      );
    }
  }

  // --- Stage 3: Dunball (52163) -> Hookbridge (52118) Upriver Crest ---
  // Regime 2: Dunball HW > Hookbridge pre-tide + 0.30m (direct upriver tidal wave intrusion).
  // Compare 1-feature (headDiff only) vs 2-feature (headDiff + pre-tide river baseflow hPre).
  const hkTrain = cascadeRows.filter(
    c =>
      c.r.isTrain &&
      c.dPk &&
      c.hookPre2h !== null &&
      c.hookPostMax !== null &&
      c.dPk.value - c.hookPre2h >= 0.3
  );
  let hkSlope = null;
  let hkModel2 = null;
  if (hkTrain.length >= 5) {
    let sxx = 0;
    let sxy = 0;
    for (const c of hkTrain) {
      const hd = c.dPk.value - c.hookPre2h;
      const rise = Math.max(0, c.hookPostMax - c.hookPre2h);
      sxx += hd * hd;
      sxy += hd * rise;
    }
    hkSlope = sxx > 1e-6 ? sxy / sxx : 0.56;
    hkModel2 = fitRidgeOLS(
      hkTrain.map(c => [c.dPk.value - c.hookPre2h, c.hookPre2h]),
      hkTrain.map(c => Math.max(0, c.hookPostMax - c.hookPre2h)),
      1e-2
    );
    console.log(
      `Hookbridge Regime 2 Fit (train n=${hkTrain.length}): 1-feat rise=${hkSlope.toFixed(3)}*hd | ` +
        `2-feat rise=${hkModel2.coefs[0].toFixed(3)}*hd + ${hkModel2.coefs[1].toFixed(3)}*hPre + ${hkModel2.intercept.toFixed(3)}`
    );
  }

  const hkH1Err1 = [];
  const hkH1Err2 = [];
  const hkH2Err1 = [];
  const hkH2Err2 = [];
  for (const c of cascadeRows) {
    if (!c.r.isTest || !c.dPk || c.hookPre2h === null || c.hookPostMax === null) continue;
    if (c.dPk.value - c.hookPre2h < 0.3) continue; // Regime 2 events only
    if (hkSlope !== null && hkModel2 !== null) {
      // Horizon 1 (12h forecast) using predicted Dunball HW and causal Hookbridge pre-stage
      const pre12 = c.hookPre12h ?? c.hookPre2h;
      const hd1 = Math.max(0, c.dPredH1 - pre12);
      const predCrest1_1f = pre12 + hkSlope * hd1;
      const predCrest1_2f = pre12 + Math.max(0, hkModel2.predict([hd1, pre12]));
      hkH1Err1.push((predCrest1_1f - c.hookPostMax) * 100);
      hkH1Err2.push((predCrest1_2f - c.hookPostMax) * 100);

      // Horizon 2 (1-2h nowcast) using Hinkley-nowcast Dunball HW + Hookbridge pre-tide stage
      const hd2 = Math.max(0, c.dPredH2 - c.hookPre2h);
      const predCrest2_1f = c.hookPre2h + hkSlope * hd2;
      const predCrest2_2f = c.hookPre2h + Math.max(0, hkModel2.predict([hd2, c.hookPre2h]));
      hkH2Err1.push((predCrest2_1f - c.hookPostMax) * 100);
      hkH2Err2.push((predCrest2_2f - c.hookPostMax) * 100);
    }
  }

  console.log('\n--- HORIZON 1: 12h FORECAST CASCADE (Pred Hinkley -> Dunball -> Bridgwater -> Hookbridge) ---');
  console.log(fmtStatRow('52106 -> 52163 Dunball HW (Linear)', calcStats(dunH1LinErr)));
  console.log(fmtStatRow('52106 -> 52163 Dunball HW (Quadratic)', calcStats(dunH1QuadErr)));
  console.log(fmtStatRow('52163 -> 52124 Bridgwater HW (Sea-only)', calcStats(bH1SeaErr)));
  console.log(fmtStatRow('52163 -> 52124 Bridgwater HW (Sea + River)', calcStats(bH1RivErr)));
  console.log(fmtStatRow('52163 -> 52118 Hookbridge (1-feat: headDiff)', calcStats(hkH1Err1)));
  console.log(fmtStatRow('52163 -> 52118 Hookbridge (2-feat: headDiff+hPre)', calcStats(hkH1Err2)));

  console.log('\n--- HORIZON 2: 1-2h WAVE-IN-CHANNEL NOWCAST (Obs Hinkley -> Dunball -> Bridgwater -> Hookbridge) ---');
  console.log(fmtStatRow('52106 -> 52163 Dunball HW (Linear)', calcStats(dunH2LinErr)));
  console.log(fmtStatRow('52106 -> 52163 Dunball HW (Quadratic)', calcStats(dunH2QuadErr)));
  console.log(fmtStatRow('52163 -> 52124 Bridgwater HW (Sea-only)', calcStats(bH2SeaErr)));
  console.log(fmtStatRow('52163 -> 52124 Bridgwater HW (Sea + River)', calcStats(bH2RivErr)));
  console.log(fmtStatRow('52163 -> 52118 Hookbridge (1-feat: headDiff)', calcStats(hkH2Err1)));
  console.log(fmtStatRow('52163 -> 52118 Hookbridge (2-feat: headDiff+hPre)', calcStats(hkH2Err2)));

  // --- Full-Year Coastal Canary ~1h Nowcast Benchmark (E72439 Ilfracombe & E73039 Milford Haven) ---
  const canaryMirrorPeaks =
    canary && canary.E72539 && canary.E72539.length
      ? findParabolicPeaks(canary.E72539, 1.5, 8 * HOUR_MS)
      : null;

  const ilfCanaryRes = runCoastalCanaryBenchmark({
    canaryName: 'Ilfracombe',
    stationCode: 'E72439',
    canarySeries: ilfracombe,
    canaryPeaks: ilfracombePeaks,
    trainFilter,
    testFilter,
    cycleRecords,
    dunballPeaks,
    dunQuad,
    weather,
    hinkleyModelB2: modelB2,
    canaryMirrorPeaks
  });

  const milCanaryRes = runCoastalCanaryBenchmark({
    canaryName: 'Milford Haven',
    stationCode: 'E73039',
    canarySeries: milford,
    canaryPeaks: milfordPeaks,
    trainFilter,
    testFilter,
    cycleRecords,
    dunballPeaks,
    dunQuad,
    weather,
    hinkleyModelB2: modelB2,
    canaryMirrorPeaks
  });

  // --- Dunball Tide-Lock Timing Benchmark (t_close, t_open, duration in min) ---
  runDunballTideLockBenchmark({
    dunball,
    hinkley,
    ksdMap,
    trainFilter,
    testFilter,
    modelA,
    modelB2,
    metModelB2,
    e3Model,
    e3UsesMet,
    cycleRecords,
    weather,
    prevWeather,
    ilfCanaryRes
  });

  // --- Top 10 Worst Out-of-Sample Storm/Error Tides Table ---
  const worst = cascadeRows
    .filter(c => c.r.isTest && c.r.prevSkewB !== null)
    .map(c => ({
      ms: c.r.pk.trueMs,
      hObs: c.hObs,
      hPred: c.hPred12h,
      actSkewCm: (c.r.bestActSkew ?? c.r.skewB) * 100,
      predSkewCm: c.r.predSkewBest12h * 100,
      hErrCm: (c.hPred12h - c.hObs) * 100,
      dObs: c.dPk ? c.dPk.value : null,
      dPred: c.dPredH1 ?? null,
      dErrCm: c.dPk && c.dPredH1 !== undefined ? (c.dPredH1 - c.dPk.value) * 100 : null
    }))
    .sort((a, b) => Math.abs(b.hErrCm) - Math.abs(a.hErrCm))
    .slice(0, 10);

  console.log('\n--- TOP 10 WORST OUT-OF-SAMPLE STORM / ERROR TIDES (12h FORECAST) ---');
  console.log(
    '  UTC High Water   | H_obs  | H_pred | ActSkew | PrdSkew | H_err   | D_obs  | D_pred | D_err'
  );
  console.log(
    '  -----------------+--------+--------+---------+---------+---------+--------+--------+--------'
  );
  for (const w of worst) {
    const fM = v => (v === null ? '   n/a' : v.toFixed(2).padStart(6));
    const fCm = v =>
      v === null ? '    n/a' : ((v >= 0 ? '+' : '') + v.toFixed(1)).padStart(7);
    console.log(
      `  ${fmtDateTime(w.ms)} | ${fM(w.hObs)} | ${fM(w.hPred)} | ${fCm(w.actSkewCm)} | ${fCm(w.predSkewCm)} | ${fCm(w.hErrCm)} | ${fM(w.dObs)} | ${fM(w.dPred)} | ${fCm(w.dErrCm)}`
    );
  }

  return {
    regimeName,
    hinkley: {
      A: sA,
      B: sB,
      B2: sB2,
      C: sC,
      D: sD,
      DHigh: sDHigh,
      E1: sE1,
      E2: sE2,
      E3: sE3,
      E4: sE4,
      E2High: sE2High,
      E3High: sE3High,
      E4High: sE4High
    },
    ilfCanary: ilfCanaryRes,
    milCanary: milCanaryRes,
    dunballH1: calcStats(dunH1QuadErr),
    dunballH2: calcStats(dunH2QuadErr),
    bridgwaterH1: calcStats(bH1RivErr.length ? bH1RivErr : bH1SeaErr),
    bridgwaterH2: calcStats(bH2RivErr.length ? bH2RivErr : bH2SeaErr),
    hookbridgeH1_1f: calcStats(hkH1Err1),
    hookbridgeH1_2f: calcStats(hkH1Err2),
    hookbridgeH2_1f: calcStats(hkH2Err1),
    hookbridgeH2_2f: calcStats(hkH2Err2)
  };
}

// ---------------------------------------------------------------------------
// 8. Main Entrypoint
// ---------------------------------------------------------------------------

function main() {
  console.log('Somerset Levels Tidal Height, Skew-Surge & Estuarine Cascade PoC (v2.3)');
  console.log(`Primary DB   : ${DB_PATH}`);
  console.log(`Merge DB     : ${MERGE_DB_PATH && fs.existsSync(MERGE_DB_PATH) ? MERGE_DB_PATH : '(none)'}`);
  console.log(`Weather      : ${WEATHER_PATH} (${fs.existsSync(WEATHER_PATH) ? 'FOUND' : 'not present'})`);
  console.log(`Prev-Weather : ${PREV_WEATHER_PATH} (${fs.existsSync(PREV_WEATHER_PATH) ? 'FOUND' : 'not present'})`);
  console.log(`Marine       : ${MARINE_PATH} (${fs.existsSync(MARINE_PATH) ? 'FOUND' : 'not present'})`);
  console.log(`Marine Waves : ${WAVES_PATH} (${fs.existsSync(WAVES_PATH) ? 'FOUND' : 'not present'})`);
  console.log(`Canary Cache : ${CANARY_PATH} (${fs.existsSync(CANARY_PATH) ? 'FOUND' : 'not present'})`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`[ERROR] Primary database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  const mergeDb =
    MERGE_DB_PATH && fs.existsSync(MERGE_DB_PATH)
      ? new Database(MERGE_DB_PATH, { readonly: true })
      : null;

  const loadMerged = (stationId, measureId) => {
    const base = loadSqliteSeries(db, stationId, measureId);
    if (!mergeDb) return base;
    return mergeSeriesByMs(base, loadSqliteSeries(mergeDb, stationId, measureId));
  };

  const hinkley = qcTidalSeries(
    loadMerged('52106', '52106-level-tidal_level-i-15_min-mAOD'),
    '52106 Hinkley',
    { minDailyRange: 1.0, maxDailyMin: 2.5 }
  );
  const dunball = qcTidalSeries(
    loadMerged('52163', '52163-level-tidal_level-i-15_min-mAOD'),
    '52163 Dunball',
    { minDailyRange: 1.0, maxDailyMin: 2.5 }
  );
  // 52124 can have elevated fluvial low-water floors during winter floods, so only check range
  const bridgwater = qcTidalSeries(
    loadMerged('52124', '52124-level-tidal_level-i-15_min-mAOD'),
    '52124 Bridgwater',
    { minDailyRange: 0.8, maxDailyMin: null }
  );
  const hookbridge = loadMerged('52118', '52118-level-stage-i-15_min-mAOD');
  const gawBridge = loadMerged('52119', '52119-level-stage-i-15_min-mASD');
  // E9094 (Dunball Inland KSD): normalize both -mAOD and legacy -m suffix if present
  const ksdInland = mergeSeriesByMs(
    loadMerged('E9094', 'E9094-level-stage-i-15_min-mAOD'),
    loadMerged('E9094', 'E9094-level-stage-i-15_min-m')
  );

  // Optional full-year coastal canary gauges in ea_somerset_archive.db (v2.3)
  const rawIlfracombe = loadMerged('E72439', 'E72439-level-tidal_level-i-15_min-mAOD');
  const ilfracombe = rawIlfracombe.length
    ? qcTidalSeries(rawIlfracombe, 'E72439 Ilfracombe', { minDailyRange: 1.0, maxDailyMin: 2.5 })
    : [];
  const rawMilford = loadMerged('E73039', 'E73039-level-tidal_level-i-15_min-mAOD');
  const milford = rawMilford.length
    ? qcTidalSeries(rawMilford, 'E73039 Milford Haven', { minDailyRange: 1.0, maxDailyMin: 2.5 })
    : [];

  db.close();
  if (mergeDb) mergeDb.close();

  const hinkleyPeaks = findParabolicPeaks(hinkley, 2.0, 8 * HOUR_MS, '52106 Hinkley');
  const dunballPeaks = findParabolicPeaks(dunball, 2.5, 8 * HOUR_MS, '52163 Dunball');
  const bridgwaterPeaks = findParabolicPeaks(bridgwater, 2.5, 8 * HOUR_MS, '52124 Bridgwater');
  const ilfracombePeaks = ilfracombe.length
    ? findParabolicPeaks(ilfracombe, 1.5, 8 * HOUR_MS, 'E72439 Ilfracombe')
    : [];
  const milfordPeaks = milford.length
    ? findParabolicPeaks(milford, 1.0, 8 * HOUR_MS, 'E73039 Milford Haven')
    : [];

  const ksdMap = new Map(ksdInland.map(p => [p.ms, p.value]));
  const hookMap = new Map(hookbridge.map(p => [p.ms, p.value]));
  const gawMap = new Map(gawBridge.map(p => [p.ms, p.value]));

  console.log(
    `\nLoaded QC Series: 52106=${hinkley.length} pts (${hinkleyPeaks.length} HW) | ` +
      `52163=${dunball.length} pts (${dunballPeaks.length} HW) | ` +
      `52124=${bridgwater.length} pts (${bridgwaterPeaks.length} HW) | ` +
      `E9094=${ksdInland.length} pts | 52118=${hookbridge.length} pts | 52119=${gawBridge.length} pts`
  );
  if (ilfracombe.length || milford.length) {
    console.log(
      `Loaded DB Canaries: E72439 Ilfracombe=${ilfracombe.length} pts (${ilfracombePeaks.length} HW) | ` +
        `E73039 Milford Haven=${milford.length} pts (${milfordPeaks.length} HW)`
    );
  }
  console.log(
    `Hinkley Span: ${fmtDate(hinkley[0].ms)} .. ${fmtDate(hinkley[hinkley.length - 1].ms)} ` +
      `(${((hinkley[hinkley.length - 1].ms - hinkley[0].ms) / DAY_MS).toFixed(1)} days)`
  );

  const weather = loadOffshoreWeather(WEATHER_PATH);
  if (weather) {
    console.log(
      `Offshore Weather Loaded: bay=${weather.bayMap.size}h, celtic=${weather.celticMap.size}h, outer=${weather.outerMap.size}h`
    );
  }

  const prevWeather = loadOffshoreWeather(PREV_WEATHER_PATH);
  if (prevWeather) {
    console.log(
      `Day-1 Forecast Weather Loaded (previous_runs): bay=${prevWeather.bayMap.size}h, celtic=${prevWeather.celticMap.size}h, outer=${prevWeather.outerMap.size}h`
    );
  }

  const marine = loadMarineArchive(MARINE_PATH);
  if (marine) {
    console.log(
      `Open-Meteo Marine Loaded: bay=${marine.bayMap.size}h` +
        (marine.celticMap ? `, celtic=${marine.celticMap.size}h` : '')
    );
  }

  const waves = loadMarineWaves(WAVES_PATH);
  if (waves) {
    console.log(
      `Open-Meteo Marine Waves Loaded: bay=${waves.bayMap.size}h, outer=${waves.outerMap.size}h`
    );
  }

  const canary = loadCanaryGauges(CANARY_PATH);

  const shared = {
    hinkley,
    hinkleyPeaks,
    dunball,
    dunballPeaks,
    bridgwaterPeaks,
    ksdMap,
    hookMap,
    gawMap,
    weather,
    prevWeather,
    marine,
    waves,
    ilfracombe,
    ilfracombePeaks,
    milford,
    milfordPeaks,
    canary
  };

  if (SPLIT_ARG) {
    const splitMs = new Date(`${SPLIT_ARG}T00:00:00Z`).getTime();
    if (!Number.isFinite(splitMs)) {
      console.error(`[ERROR] Invalid --split date: ${SPLIT_ARG} (expected YYYY-MM-DD)`);
      process.exit(1);
    }
    runRegimeBenchmark({
      ...shared,
      regimeName: `Custom Chronological Split (Train < ${SPLIT_ARG} | Test >= ${SPLIT_ARG})`,
      trainFilter: ms => ms < splitMs,
      testFilter: ms => ms >= splitMs
    });
    if (canary) {
      runCanaryCrossCheck({ canary, hinkleyPeaks, dunballPeaks });
    }
    return;
  }

  // Default: Run BOTH Summer/Autumn Chronological Split AND Winter Storm/Flood (Dec-Feb) Split
  const startMs = hinkley[0].ms;
  const endMs = hinkley[hinkley.length - 1].ms;
  const totalDays = (endMs - startMs) / DAY_MS;

  // Regime 1: Summer/Autumn forward chronological split (ensure >= 183d train if feasible for K2/P1 Rayleigh)
  const jun3Ms = Date.UTC(2026, 5, 3, 0, 0, 0);
  const summerSplitMs =
    jun3Ms > startMs + 90 * DAY_MS && jun3Ms < endMs - 45 * DAY_MS
      ? jun3Ms
      : startMs + totalDays * 0.7 * DAY_MS;

  runRegimeBenchmark({
    ...shared,
    regimeName: `1. SUMMER / AUTUMN CHRONOLOGICAL SPLIT (Train < ${fmtDate(summerSplitMs)} | Test >= ${fmtDate(summerSplitMs)})`,
    trainFilter: ms => ms < summerSplitMs,
    testFilter: ms => ms >= summerSplitMs
  });

  // Regime 2: Winter Storm / Flood (Dec-Feb) stress test
  // Check if >= 90d precede 2025-12-01 (true forward-chronological winter split on 15-month backfill);
  // otherwise use a strict non-overlapping seasonal holdout (train Mar-Nov, test Dec-Feb with 48h buffer).
  const dec1Ms = Date.UTC(2025, 11, 1, 0, 0, 0);
  const mar1Ms = Date.UTC(2026, 2, 1, 0, 0, 0);
  const preWinterDays = (dec1Ms - startMs) / DAY_MS;

  if (preWinterDays >= 90) {
    runRegimeBenchmark({
      ...shared,
      regimeName: `2. WINTER STORM / FLOOD FORWARD SPLIT (Train < 2025-12-01 | Test 2025-12-01..2026-02-28)`,
      trainFilter: ms => ms < dec1Ms,
      testFilter: ms => ms >= dec1Ms && ms < mar1Ms
    });
  } else {
    const bufferMs = 48 * HOUR_MS;
    runRegimeBenchmark({
      ...shared,
      regimeName: `2. WINTER STORM / FLOOD STRESS-TEST HOLDOUT (Train >= 2026-03-03 | Test 2025-12-01..2026-02-28)`,
      trainFilter: ms => ms >= mar1Ms + bufferMs,
      testFilter: ms => ms >= dec1Ms && ms < mar1Ms
    });
  }

  if (canary) {
    runCanaryCrossCheck({ canary, hinkleyPeaks, dunballPeaks });
  } else {
    console.log(`\n[INFO] Canary gauge cache not found at ${CANARY_PATH}; skipping storm-day/outage canary cross-check.`);
  }
}

main();
