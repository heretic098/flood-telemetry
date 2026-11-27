#!/usr/bin/env node
/**
 * Issue #25 Closing Check 2: Extreme-Surge Tail Stress-Test for Hinkley Point (hink / 52106)
 * using UNESCO IOC Public Multi-Year 15-Minute Data + Open-Meteo ERA5 Archive.
 *
 * Strictly offline PoC:
 *   - Does NOT modify src/, server.js, tests/, telemetry.db, docs/, or spike_tidal_height_v2.js.
 *   - Trains ALL harmonic coefficients (POL-42/45) and Ridge weights (Model D, Ilfracombe nowcast)
 *     strictly on 2025-2026 EA archive (ea_somerset_archive.db + tidal_poc_offshore_weather.json).
 *   - Evaluates completely out-of-sample on 2022-2025 extreme UK storms fetched from UNESCO IOC
 *     and Open-Meteo ERA5 Archive.
 *
 * Modes:
 *   node scripts/spike_extreme_surge_tail.js --fetch   # Fetch & cache IOC + ERA5 storm data only
 *   node scripts/spike_extreme_surge_tail.js           # Offline calibration & out-of-sample analysis
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const DB_PATH = path.resolve(ROOT_DIR, 'ea_somerset_archive.db');
const TRAIN_WEATHER_PATH = path.resolve(ROOT_DIR, 'data/tidal_poc_cache/tidal_poc_offshore_weather.json');
const IOC_CACHE_PATH = path.resolve(ROOT_DIR, 'data/tidal_poc_cache/tidal_poc_ioc_storms.json');
const STORM_WEATHER_CACHE_PATH = path.resolve(ROOT_DIR, 'data/tidal_poc_cache/tidal_poc_ioc_storm_weather.json');

const FETCH_MODE = process.argv.includes('--fetch');

const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const STEP_15M_MS = 15 * 60000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

// Exact 3 offshore fetch points matching scripts/spike_tidal_height_v2.js & docs/estuarine_tidal_forecasting_methods.md
const OFFSHORE_POINTS = {
  bridgwater_bay: { lat: 51.21, lon: -3.13 },
  outer_bristol_channel: { lat: 51.30, lon: -4.20 },
  celtic_sea: { lat: 51.00, lon: -6.00 }
};

// Calibration overlap window (exact ACD -> mAOD verification vs ea_somerset_archive.db)
const CALIBRATION_WINDOW = {
  id: 'calibration_2026_01',
  name: 'Datum Calibration Overlap (2026-01-07..10)',
  fetchStart: '2026-01-07',
  fetchEnd: '2026-01-10'
};

// Extreme UK storm windows to probe & evaluate (evalStart..evalEnd; fetch adds pre-storm padding)
const STORM_WINDOWS = [
  {
    id: 'eunice_franklin_2022',
    name: 'Storm Eunice & Franklin (Feb 2022)',
    evalStart: '2022-02-17',
    evalEnd: '2022-02-22',
    isProbe: true
  },
  {
    id: 'ciaran_2023',
    name: 'Storm Ciaran (Nov 2023)',
    evalStart: '2023-10-31',
    evalEnd: '2023-11-05'
  },
  {
    id: 'isha_jocelyn_2024',
    name: 'Storm Isha & Jocelyn (Jan 2024)',
    evalStart: '2024-01-19',
    evalEnd: '2024-01-26'
  },
  {
    id: 'kathleen_pierrick_2024',
    name: 'Storm Kathleen & Pierrick (Apr 2024)',
    evalStart: '2024-04-05',
    evalEnd: '2024-04-12'
  },
  {
    id: 'bert_2024',
    name: 'Storm Bert (Nov 2024)',
    evalStart: '2024-11-22',
    evalEnd: '2024-11-26'
  },
  {
    id: 'darragh_2024',
    name: 'Storm Darragh (Dec 2024)',
    evalStart: '2024-12-05',
    evalEnd: '2024-12-10'
  },
  {
    id: 'eowyn_herminia_2025',
    name: 'Storm Eowyn & Herminia (Jan 2025)',
    evalStart: '2025-01-22',
    evalEnd: '2025-01-29'
  }
];

function shiftDate(ymd, deltaDays) {
  const ms = new Date(`${ymd}T00:00:00Z`).getTime() + deltaDays * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 1. Network Fetch Mode (--fetch): UNESCO IOC + Open-Meteo ERA5 Archive
// ---------------------------------------------------------------------------

async function fetchJsonWithRetry(url, label, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'somerset-flood-telemetry-poc/1.0' }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      if (!text.trim()) return [];
      return JSON.parse(text);
    } catch (err) {
      if (attempt === retries) {
        console.error(`[FETCH FAIL] ${label}: ${err.message}`);
        return null;
      }
      await sleep(800 * attempt);
    }
  }
  return null;
}

/**
 * Fetch UNESCO IOC data in <= 6-day chunks to avoid any server-side row cap.
 */
async function fetchIocRange(code, startDate, endDate) {
  const allRows = [];
  let curMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const stopMs = new Date(`${endDate}T23:59:59Z`).getTime();

  while (curMs <= stopMs) {
    const chunkEndMs = Math.min(stopMs, curMs + 6 * DAY_MS - 1000);
    const tStart = new Date(curMs).toISOString().slice(0, 19);
    const tStop = new Date(chunkEndMs).toISOString().slice(0, 19);
    const url =
      `https://www.ioc-sealevelmonitoring.org/service.php?query=data` +
      `&code=${encodeURIComponent(code)}&timestart=${tStart}&timestop=${tStop}`;
    const rows = await fetchJsonWithRetry(url, `IOC ${code} ${tStart}..${tStop}`);
    if (Array.isArray(rows)) {
      for (const r of rows) allRows.push(r);
    }
    curMs = chunkEndMs + 1000;
    await sleep(250);
  }
  return allRows;
}

async function probeEarliestHinkYear() {
  const probes = [
    { label: '2020-06', start: '2020-06-01', end: '2020-06-03' },
    { label: '2021-06', start: '2021-06-01', end: '2021-06-03' },
    { label: '2022-02', start: '2022-02-18', end: '2022-02-20' },
    { label: '2022-09', start: '2022-09-01', end: '2022-09-03' },
    { label: '2023-01', start: '2023-01-01', end: '2023-01-03' },
    { label: '2023-06', start: '2023-06-01', end: '2023-06-03' }
  ];
  const results = {};
  for (const p of probes) {
    const rows = await fetchIocRange('hink', p.start, p.end);
    results[p.label] = rows.length;
  }
  return results;
}

async function fetchEra5Window(startDate, endDate) {
  const out = {};
  for (const [ptName, coords] of Object.entries(OFFSHORE_POINTS)) {
    const url =
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&hourly=pressure_msl,wind_speed_10m,wind_direction_10m&timezone=UTC`;
    const data = await fetchJsonWithRetry(url, `ERA5 ${ptName} ${startDate}..${endDate}`);
    if (data && data.hourly) {
      out[ptName] = { lat: coords.lat, lon: coords.lon, hourly: data.hourly };
    } else {
      out[ptName] = { lat: coords.lat, lon: coords.lon, hourly: null };
    }
    await sleep(250);
  }
  return out;
}

async function runFetch() {
  fs.mkdirSync(path.dirname(IOC_CACHE_PATH), { recursive: true });

  console.log('=== FETCHING UNESCO IOC CALIBRATION & STORM WINDOWS ===');
  const iocOut = {
    fetchedAt: new Date().toISOString(),
    calibration: {
      ...CALIBRATION_WINDOW,
      hink: [],
      ilfa: []
    },
    earliestProbe: null,
    storms: {}
  };

  console.log(`Fetching calibration overlap ${CALIBRATION_WINDOW.fetchStart}..${CALIBRATION_WINDOW.fetchEnd}...`);
  iocOut.calibration.hink = await fetchIocRange('hink', CALIBRATION_WINDOW.fetchStart, CALIBRATION_WINDOW.fetchEnd);
  iocOut.calibration.ilfa = await fetchIocRange('ilfa', CALIBRATION_WINDOW.fetchStart, CALIBRATION_WINDOW.fetchEnd);
  console.log(`  Calibration rows: hink=${iocOut.calibration.hink.length}, ilfa=${iocOut.calibration.ilfa.length}`);

  const weatherOut = {
    fetchedAt: new Date().toISOString(),
    points: OFFSHORE_POINTS,
    storms: {}
  };

  for (const st of STORM_WINDOWS) {
    // 24h pre-storm padding for IOC AR(1) prev_skew; 48h pre-storm padding for ERA5 lags
    const iocStart = shiftDate(st.evalStart, -1);
    const iocEnd = shiftDate(st.evalEnd, 1);
    const wxStart = shiftDate(st.evalStart, -2);
    const wxEnd = shiftDate(st.evalEnd, 1);

    console.log(`\nFetching ${st.name} (IOC ${iocStart}..${iocEnd}, ERA5 ${wxStart}..${wxEnd})...`);
    const hinkRows = await fetchIocRange('hink', iocStart, iocEnd);
    const ilfaRows = await fetchIocRange('ilfa', iocStart, iocEnd);
    console.log(`  IOC rows: hink=${hinkRows.length}, ilfa=${ilfaRows.length}`);

    iocOut.storms[st.id] = {
      ...st,
      iocStart,
      iocEnd,
      hink: hinkRows,
      ilfa: ilfaRows
    };

    if (hinkRows.length > 0) {
      const wx = await fetchEra5Window(wxStart, wxEnd);
      const counts = Object.entries(wx)
        .map(([k, v]) => `${k}=${v.hourly?.time?.length ?? 0}h`)
        .join(', ');
      console.log(`  ERA5 rows: ${counts}`);
      weatherOut.storms[st.id] = {
        evalStart: st.evalStart,
        evalEnd: st.evalEnd,
        wxStart,
        wxEnd,
        points: wx
      };
    } else {
      console.log(`  Skipping ERA5 for ${st.id} (no hink IOC rows available).`);
    }
  }

  // If Eunice 2022 had no hink data, probe earliest available year for hink
  if (!iocOut.storms.eunice_franklin_2022 || iocOut.storms.eunice_franklin_2022.hink.length === 0) {
    console.log('\nProbing earliest available hink year on UNESCO IOC...');
    iocOut.earliestProbe = await probeEarliestHinkYear();
    console.log('  Earliest hink probe:', JSON.stringify(iocOut.earliestProbe));
  }

  fs.writeFileSync(IOC_CACHE_PATH, JSON.stringify(iocOut));
  fs.writeFileSync(STORM_WEATHER_CACHE_PATH, JSON.stringify(weatherOut));
  console.log(`\nSaved IOC cache     -> ${IOC_CACHE_PATH}`);
  console.log(`Saved Weather cache -> ${STORM_WEATHER_CACHE_PATH}`);
}

// ---------------------------------------------------------------------------
// 2. Exact Harmonic & Ridge Math (Parity with scripts/spike_tidal_height_v2.js)
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

  const rA =
    1.0 -
    0.2505 * Math.cos(2 * prad) -
    0.1102 * Math.cos(2 * prad - Nrad) -
    0.0156 * Math.cos(2 * prad - 2 * Nrad) -
    0.037 * Math.cos(Nrad);
  const fL2 = Math.max(0.5, fM2 * Math.sqrt(Math.max(0.25, rA)));
  const uL2 =
    uM2 -
    Math.atan2(
      0.2505 * Math.sin(2 * prad) +
        0.1102 * Math.sin(2 * prad - Nrad) +
        0.0156 * Math.sin(2 * prad - 2 * Nrad),
      1.0 -
        0.2505 * Math.cos(2 * prad) -
        0.1102 * Math.cos(2 * prad - Nrad) -
        0.0156 * Math.cos(2 * prad - 2 * Nrad)
    ) /
      DEG;

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
    L2_2MN2: { f: fM2_3, u: uM2 },
    MU2: { f: fM2, u: uM2 },
    NU2: { f: fM2, u: uM2 },
    LDA2: { f: fM2, u: uM2 },
    '2N2': { f: fM2, u: uM2 },
    '2SM2': { f: fM2, u: -uM2 },
    T2: { f: 1.0, u: 0.0 },
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

const FULL_TIER3_32 = [
  { name: 'M2', speed: 28.9841042 },
  { name: 'S2', speed: 30.0 },
  { name: 'K1', speed: 15.0410686 },
  { name: 'O1', speed: 13.9430356 },
  { name: 'M4', speed: 57.9682084 },
  { name: 'MS4', speed: 58.9841042 },
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
  { name: 'M8', speed: 115.9364169 },
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

const POL_COMPOUND_10 = [
  { name: 'MSN2', speed: 30.5443747 },
  { name: 'SKM2', speed: 31.0980331 },
  { name: 'MNS2', speed: 27.4238337 },
  { name: 'MKS2', speed: 29.0662415 },
  { name: '3M2S2', speed: 26.9523126 },
  { name: 'MSK2', speed: 28.9019669 },
  { name: 'M3', speed: 43.4761563 },
  { name: 'OQ2', speed: 27.3416964 },
  { name: 'MNUS2', speed: 27.4966873 },
  { name: '3MS4', speed: 56.9523127 }
];

function selectPolConstituents(trainDays) {
  const base = trainDays >= 365 ? FULL_TIER4_35 : FULL_TIER3_32;
  return [
    ...base.map(c => (c.name === 'L2' ? { ...c, nodalKey: 'L2_2MN2' } : c)),
    ...POL_COMPOUND_10
  ];
}

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
    for (let j = 0; j < k; j++) row[j + 1] = (X[i][j] - means[j]) / stds[j];
    const yi = y[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * yi;
      for (let b = a; b < p; b++) XtX[a][b] += row[a] * row[b];
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

function fitHarmonics(series, t0Ms, constituents, { useNodal = true, ridge = 0.5 } = {}) {
  const m = constituents.length;
  const p = 1 + 2 * m;
  const XtX = Array.from({ length: p }, () => new Float64Array(p));
  const Xty = new Float64Array(p);
  const row = new Float64Array(p);
  row[0] = 1.0;

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
      for (let b = a; b < p; b++) rowA[b] += ra * row[b];
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

  const fitted = constituents.map((c, idx) => ({
    name: c.name,
    nodalKey: c.nodalKey || c.name,
    speed: c.speed,
    a: beta[1 + 2 * idx],
    b: beta[2 + 2 * idx],
    amplitude: Math.hypot(beta[1 + 2 * idx], beta[2 + 2 * idx])
  }));

  return {
    t0Ms,
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
// 3. Series QC, Peak Extraction, Weather Feature Extraction
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

function toFiniteNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function parseIsoTimeMs(rawT) {
  if (typeof rawT === 'number') return rawT;
  if (typeof rawT !== 'string') return NaN;
  const s = rawT.trim().replace(' ', 'T');
  const iso =
    s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s)
      ? s
      : s.length === 16
        ? `${s}:00Z`
        : `${s}Z`;
  return new Date(iso).getTime();
}

function loadSqliteSeries(db, measureId, minVal = -8.0, maxVal = 7.5) {
  const rows = db
    .prepare(
      `SELECT date_time, value FROM historical_telemetry
       WHERE measure_id = ? AND value IS NOT NULL AND value > ? AND value < ?
       ORDER BY date_time ASC`
    )
    .all(measureId, minVal, maxVal);
  return rows.map(r => ({
    ms: toNearest15Min(new Date(r.date_time).getTime()),
    value: Number(r.value)
  }));
}

function qcTidalSeries(series, { minDailyRange = 1.0, maxDailyMin = 2.5, label = null } = {}) {
  // 1. Strip sub-day stuck/flatlined blocks (>= 4 consecutive samples within 5 mm)
  const badIdx = new Set();
  let flatBlocks = 0;
  let i = 0;
  while (i < series.length) {
    let j = i + 1;
    let minV = series[i].value;
    let maxV = series[i].value;
    while (j < series.length && series[j].ms - series[j - 1].ms <= 30 * 60000) {
      const nMin = Math.min(minV, series[j].value);
      const nMax = Math.max(maxV, series[j].value);
      if (nMax - nMin <= 0.005) {
        minV = nMin;
        maxV = nMax;
        j++;
      } else {
        break;
      }
    }
    if (j - i >= 4) {
      flatBlocks++;
      // Strip the flatlined block and immediate transition samples (±1)
      for (let k = Math.max(0, i - 1); k <= Math.min(series.length - 1, j); k++) {
        badIdx.add(k);
      }
      i = j;
    } else {
      i++;
    }
  }

  // 2. Strip physically impossible 15-min step jumps (> 1.5m in <= 15min) & isolated spikes
  let stepFaults = 0;
  for (let idx = 1; idx < series.length; idx++) {
    if (badIdx.has(idx)) continue;
    const prev = series[idx - 1];
    const cur = series[idx];
    if (cur.ms - prev.ms <= STEP_15M_MS && Math.abs(cur.value - prev.value) > 1.5) {
      stepFaults++;
      badIdx.add(idx);
      badIdx.add(idx - 1);
    }
  }

  const despiked = [];
  for (let idx = 0; idx < series.length; idx++) {
    if (badIdx.has(idx)) continue;
    const cur = series[idx];
    if (idx > 0 && idx < series.length - 1) {
      const prev = series[idx - 1];
      const next = series[idx + 1];
      if (
        cur.ms - prev.ms <= 30 * 60000 &&
        next.ms - cur.ms <= 30 * 60000 &&
        Math.abs(prev.value - next.value) < 1.5 &&
        Math.abs(cur.value - prev.value) > 2.5 &&
        Math.abs(cur.value - next.value) > 2.5
      ) {
        continue;
      }
    }
    despiked.push(cur);
  }

  if (label && (flatBlocks > 0 || stepFaults > 0)) {
    console.log(
      `  [QC] ${label}: stripped ${flatBlocks} stuck/flatline block(s) and ${stepFaults} impossible >1.5m/15m step jump(s) (${badIdx.size} pts)`
    );
  }

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
    if (s.count >= 12 && (s.max - s.min < minDailyRange || (maxDailyMin !== null && s.min > maxDailyMin))) {
      badDays.add(d);
    }
  }
  return despiked.filter(pt => !badDays.has(fmtDate(pt.ms)));
}

function findParabolicPeaks(series, minPeakVal = 1.5, minSepMs = 8 * HOUR_MS) {
  const peaks = [];
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
      if (tCur - prev.ms > MAX_ADJ_GAP_MS || next.ms - tCur > MAX_ADJ_GAP_MS) continue;

      let winCount = 1;
      for (let j = i - 1; j >= 0 && tCur - series[j].ms <= DENSITY_HALF_WIN_MS; j--) winCount++;
      for (let j = i + 1; j < series.length && series[j].ms - tCur <= DENSITY_HALF_WIN_MS; j++) winCount++;
      if (winCount < MIN_WINDOW_SAMPLES) continue;

      let trueMs = tCur;
      let trueValue = v;
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

      const cand = { ms: tCur, trueMs, rawValue: v, value: trueValue };
      const last = peaks[peaks.length - 1];
      if (!last || cand.trueMs - last.trueMs >= minSepMs) {
        peaks.push(cand);
      } else if (cand.value > last.value) {
        peaks[peaks.length - 1] = cand;
      }
    }
  }
  return peaks;
}

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
    return { ms: bestT + delta * stepMs, value: y1 - 0.25 * (y0 - y2) * delta };
  }
  return { ms: bestT, value: bestY };
}

function normalizeHourlyPointSeries(node) {
  const map = new Map();
  if (!node) return map;
  const hourly = node.hourly || (Array.isArray(node.time) ? node : null);
  if (hourly && Array.isArray(hourly.time)) {
    const pArr = hourly.pressure_msl || hourly.mslp || [];
    const wsArr = hourly.wind_speed_10m || hourly.windSpeedKmh || [];
    const wdArr = hourly.wind_direction_10m || hourly.windDirDeg || [];
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
  if (Array.isArray(node)) {
    for (const r of node) {
      const ms = parseIsoTimeMs(r.ms ?? r.dateTime ?? r.time);
      if (!Number.isFinite(ms)) continue;
      map.set(Math.round(ms / HOUR_MS) * HOUR_MS, {
        mslp: toFiniteNum(r.mslp ?? r.pressure_msl),
        windSpeedKmh: toFiniteNum(r.windSpeedKmh ?? r.wind_speed_10m),
        windDirDeg: toFiniteNum(r.windDirDeg ?? r.wind_direction_10m)
      });
    }
  }
  return map;
}

function loadWeatherContainer(pointsObj) {
  return {
    bayMap: normalizeHourlyPointSeries(pointsObj.bridgwater_bay),
    outerMap: normalizeHourlyPointSeries(pointsObj.outer_bristol_channel),
    celticMap: normalizeHourlyPointSeries(pointsObj.celtic_sea)
  };
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
  const lerp = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? a + f * (b - a) : Number.isFinite(a) ? a : b);
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

function extractMetFeatures(weatherObj, ms) {
  if (!weatherObj) return null;
  const wBay0 = interpHourly(weatherObj.bayMap, ms);
  const wBay6 = interpHourly(weatherObj.bayMap, ms - 6 * HOUR_MS);
  const wCel6 = interpHourly(weatherObj.celticMap, ms - 6 * HOUR_MS);
  const wCel3 = interpHourly(weatherObj.celticMap, ms - 3 * HOUR_MS);
  const wOut3 = interpHourly(weatherObj.outerMap, ms - 3 * HOUR_MS);
  const wOut0 = interpHourly(weatherObj.outerMap, ms);
  const ws3 = onshoreWindStress(wOut3);
  const ws0 = onshoreWindStress(wOut0);

  if (
    wBay0 && wBay6 && wCel6 && wCel3 &&
    Number.isFinite(wBay0.mslp) && Number.isFinite(wBay6.mslp) &&
    Number.isFinite(wCel6.mslp) && Number.isFinite(wCel3.mslp) &&
    ws3 !== null && ws0 !== null
  ) {
    return [
      1013.25 - wBay0.mslp,
      1013.25 - wCel6.mslp,
      1013.25 - wCel3.mslp,
      (wBay0.mslp - wBay6.mslp) / 6.0,
      ws3,
      ws0
    ];
  }
  return null;
}

function calcStats(errsCm) {
  if (!errsCm.length) return { n: 0, mae: NaN, rmse: NaN, p95: NaN, max: NaN, bias: NaN };
  const abs = errsCm.map(e => Math.abs(e)).sort((a, b) => a - b);
  const n = errsCm.length;
  const mae = abs.reduce((s, v) => s + v, 0) / n;
  const rmse = Math.sqrt(errsCm.reduce((s, v) => s + v * v, 0) / n);
  const bias = errsCm.reduce((s, v) => s + v, 0) / n;
  const p95 = abs[Math.min(n - 1, Math.floor(0.95 * (n - 1)))];
  return { n, mae, rmse, p95, max: abs[n - 1], bias };
}

function fmtStatRow(label, s) {
  if (!s.n) return `  ${label.padEnd(44)} | n=  0`;
  const f = v => v.toFixed(1).padStart(6);
  return (
    `  ${label.padEnd(44)} | n=${String(s.n).padStart(3)} | ` +
    `MAE=${f(s.mae)} cm | RMSE=${f(s.rmse)} cm | P95=${f(s.p95)} cm | ` +
    `Max=${f(s.max)} cm | Bias=${(s.bias >= 0 ? '+' : '') + s.bias.toFixed(1)} cm`
  );
}

// ---------------------------------------------------------------------------
// 4. IOC Sensor Normalization & Exact Datum Calibration
// ---------------------------------------------------------------------------

function groupIocBySensor(rows) {
  const bySensor = new Map();
  for (const r of rows || []) {
    const sensor = r.sensor || 'default';
    const ms = parseIsoTimeMs(r.stime);
    const val = toFiniteNum(r.slevel);
    if (!Number.isFinite(ms) || !Number.isFinite(val)) continue;
    // Snap to 15-min grid only if within 2 min of a 15-min mark
    const snapped = toNearest15Min(ms);
    if (Math.abs(ms - snapped) > 2 * 60000) continue;
    let m = bySensor.get(sensor);
    if (!m) {
      m = new Map();
      bySensor.set(sensor, m);
    }
    m.set(snapped, val);
  }
  return bySensor;
}

function calibrateDatum(iocRows, eaSeries, label) {
  const eaMap = new Map(eaSeries.map(p => [p.ms, p.value]));
  const bySensor = groupIocBySensor(iocRows);
  const summaries = [];

  for (const [sensor, sMap] of bySensor.entries()) {
    const diffs = [];
    for (const [ms, acdVal] of sMap.entries()) {
      const eaVal = eaMap.get(ms);
      if (eaVal !== undefined) {
        diffs.push(eaVal - acdVal);
      }
    }
    if (diffs.length === 0) continue;
    diffs.sort((a, b) => a - b);
    const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    const median = diffs[Math.floor(diffs.length / 2)];
    const variance = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / diffs.length;
    const stdMm = Math.sqrt(variance) * 1000;
    const maxDiffMm = Math.max(...diffs.map(d => Math.abs(d - mean))) * 1000;
    summaries.push({ sensor, n: diffs.length, mean, median, stdMm, maxDiffMm });
  }

  summaries.sort((a, b) => a.stdMm - b.stdMm || b.n - a.n);
  console.log(`\n[DATUM CALIBRATION] ${label}:`);
  for (const s of summaries) {
    console.log(
      `  sensor=${s.sensor.padEnd(5)} | n=${String(s.n).padStart(3)} | ` +
        `offset(mAOD - ACD) mean=${s.mean.toFixed(4)} m, median=${s.median.toFixed(4)} m | ` +
        `std=${s.stdMm.toFixed(2)} mm | maxDiff=${s.maxDiffMm.toFixed(2)} mm`
    );
  }
  return summaries[0] || null;
}

function extractIocSeries(iocRows, preferredSensor, datumOffsetM, label = null) {
  const bySensor = groupIocBySensor(iocRows);
  let chosen = bySensor.get(preferredSensor);
  let chosenName = preferredSensor;
  if (!chosen || chosen.size === 0) {
    // Fallback to sensor with most points
    let bestSize = 0;
    for (const [k, m] of bySensor.entries()) {
      if (m.size > bestSize) {
        bestSize = m.size;
        chosen = m;
        chosenName = k;
      }
    }
  }
  if (!chosen || chosen.size === 0) return { sensor: null, series: [] };
  const raw = [...chosen.entries()]
    .map(([ms, val]) => ({ ms, value: val + datumOffsetM }))
    .filter(pt => pt.value > -8.0 && pt.value < 8.5)
    .sort((a, b) => a.ms - b.ms);
  return { sensor: chosenName, series: qcTidalSeries(raw, { minDailyRange: 1.0, maxDailyMin: 3.0, label }) };
}

function findNearestPeak(list, targetMs, minOffMs, maxOffMs) {
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
}

// ---------------------------------------------------------------------------
// 5. Offline Calibration, Training (2025-2026) & Out-of-Sample Storm Audit
// ---------------------------------------------------------------------------

function runAnalysis() {
  console.log('='.repeat(114));
  console.log('ISSUE #25 CLOSING CHECK 2: EXTREME-SURGE TAIL STRESS-TEST (HINKLEY POINT hink/52106, 2022-2025 OUT-OF-SAMPLE)');
  console.log('='.repeat(114));

  if (!fs.existsSync(IOC_CACHE_PATH) || !fs.existsSync(STORM_WEATHER_CACHE_PATH)) {
    console.error('[ERROR] Storm cache files missing. Run with --fetch first.');
    process.exit(1);
  }

  const iocCache = JSON.parse(fs.readFileSync(IOC_CACHE_PATH, 'utf8'));
  const stormWeatherCache = JSON.parse(fs.readFileSync(STORM_WEATHER_CACHE_PATH, 'utf8'));
  const trainWeatherRaw = JSON.parse(fs.readFileSync(TRAIN_WEATHER_PATH, 'utf8'));
  const trainWeather = loadWeatherContainer(trainWeatherRaw.points);

  // 1. Load 2025-2026 EA training archive (strictly read-only)
  const db = new Database(DB_PATH, { readonly: true });
  const hinkTrainSeries = qcTidalSeries(loadSqliteSeries(db, '52106-level-tidal_level-i-15_min-mAOD'));
  const ilfaTrainSeries = qcTidalSeries(loadSqliteSeries(db, 'E72439-level-tidal_level-i-15_min-mAOD'));
  db.close();

  const hinkTrainPeaks = findParabolicPeaks(hinkTrainSeries, 2.0, 8 * HOUR_MS);
  const ilfaTrainPeaks = findParabolicPeaks(ilfaTrainSeries, 1.5, 8 * HOUR_MS);
  const trainSpanDays = (hinkTrainSeries[hinkTrainSeries.length - 1].ms - hinkTrainSeries[0].ms) / DAY_MS;

  console.log(
    `\nTraining Archive (2025-2026 EA): 52106=${hinkTrainSeries.length} pts (${hinkTrainPeaks.length} HW) | ` +
      `E72439=${ilfaTrainSeries.length} pts (${ilfaTrainPeaks.length} HW) | Span=${trainSpanDays.toFixed(1)}d ` +
      `(${fmtDate(hinkTrainSeries[0].ms)}..${fmtDate(hinkTrainSeries[hinkTrainSeries.length - 1].ms)})`
  );

  // 2. Exact ACD -> mAOD Datum Calibration
  const hinkCal = calibrateDatum(iocCache.calibration.hink, hinkTrainSeries, 'Hinkley Point (IOC hink vs EA 52106)');
  const ilfaCal = calibrateDatum(iocCache.calibration.ilfa, ilfaTrainSeries, 'Ilfracombe (IOC ilfa vs EA E72439)');
  if (!hinkCal || !ilfaCal) {
    console.error('[ERROR] Datum calibration failed.');
    process.exit(1);
  }
  if (iocCache.earliestProbe) {
    console.log('\n[IOC COVERAGE] Earliest hink probe counts:', JSON.stringify(iocCache.earliestProbe));
  }

  // 3. Train POL Harmonic Models, Model D, and Ilfracombe Nowcast STRICTLY on 2025-2026
  const polConst = selectPolConstituents(trainSpanDays);
  const t0Ms = hinkTrainSeries[0].ms;
  const hinkAstroModel = fitHarmonics(hinkTrainSeries, t0Ms, polConst, { useNodal: true, ridge: 0.5 });
  const ilfaAstroModel = fitHarmonics(ilfaTrainSeries, ilfaTrainSeries[0].ms, polConst, { useNodal: true, ridge: 0.5 });

  console.log(
    `\nFitted POL-${polConst.length} Harmonics (nodal=true, ridge=0.5) strictly on 2025-2026: ` +
      `Hinkley z0=${hinkAstroModel.z0.toFixed(3)}m | Ilfracombe z0=${ilfaAstroModel.z0.toFixed(3)}m`
  );

  // Build 2025-2026 training cycles for Model D and Ilfracombe canary
  const MAX_TRAIN_SKEW_M = 1.5;
  const trainCycles = [];
  for (let i = 0; i < hinkTrainPeaks.length; i++) {
    const pk = hinkTrainPeaks[i];
    const astro = findAstroHighWater(ms => hinkAstroModel.predict(ms), pk.trueMs);
    const skew = pk.value - astro.value;
    const isOutlier = Math.abs(skew) > MAX_TRAIN_SKEW_M;
    let prevSkew = null;
    if (i > 0) {
      const prev = trainCycles[i - 1];
      const dt = pk.trueMs - prev.pk.trueMs;
      if (!prev.isOutlier && dt >= 10 * HOUR_MS && dt <= 15 * HOUR_MS) {
        prevSkew = prev.skew;
      }
    }
    const metFeats = extractMetFeatures(trainWeather, pk.trueMs);
    trainCycles.push({ pk, astro: astro.value, skew, isOutlier, prevSkew, metFeats });
  }

  const maxTrainPosSkew = Math.max(...trainCycles.filter(c => !c.isOutlier).map(c => c.skew)) * 100;
  const minTrainNegSkew = Math.min(...trainCycles.filter(c => !c.isOutlier).map(c => c.skew)) * 100;
  console.log(
    `Training Archive Skew Range: min=${minTrainNegSkew.toFixed(1)} cm, max=+${maxTrainPosSkew.toFixed(1)} cm`
  );

  // Train Model D (AR1 + Offshore Met Forcing, ridge=5.0)
  const metTrainX = [];
  const metTrainY = [];
  for (const r of trainCycles) {
    if (!r.isOutlier && r.prevSkew !== null && r.metFeats !== null) {
      metTrainX.push([r.prevSkew, ...r.metFeats]);
      metTrainY.push(r.skew);
    }
  }
  const modelD = fitRidgeOLS(metTrainX, metTrainY, 5.0);
  console.log(
    `Model D Fit (2025-2026 train n=${metTrainX.length}): prev_skew=${modelD.coefs[0].toFixed(3)}, ` +
      `ib_bay=${(modelD.coefs[1] * 100).toFixed(2)}cm/hPa, ib_cel6=${(modelD.coefs[2] * 100).toFixed(2)}, ` +
      `ib_cel3=${(modelD.coefs[3] * 100).toFixed(2)}, dP/dt=${(modelD.coefs[4] * 100).toFixed(2)}, ` +
      `wind3h=${(modelD.coefs[5] * 1000).toFixed(2)}mm/(m/s)^2, wind0h=${(modelD.coefs[6] * 1000).toFixed(2)}`
  );

  // Train Ilfracombe -> Hinkley Nowcast (Skew-only + Skew + Local 2D Wind)
  const ilfTrainMatched = [];
  for (const r of trainCycles) {
    if (r.isOutlier) continue;
    const cPk = findNearestPeak(ilfaTrainPeaks, r.pk.trueMs, -4 * HOUR_MS, 15 * 60000);
    if (!cPk) continue;
    const cAstro = findAstroHighWater(ms => ilfaAstroModel.predict(ms), cPk.trueMs);
    const cSkew = cPk.value - cAstro.value;
    if (Math.abs(cSkew) > 1.5) continue;
    const wBay = interpHourly(trainWeather.bayMap, cPk.trueMs);
    const wsA = onshoreWindStress(wBay);
    const wsC = crossChannelWindStress(wBay);
    const localWind = wsA !== null && wsC !== null ? [wsA / 100.0, wsC / 100.0] : null;
    ilfTrainMatched.push({ hSkew: r.skew, cSkew, localWind });
  }
  const ilfSkewModel = fitRidgeOLS(
    ilfTrainMatched.map(m => [m.cSkew]),
    ilfTrainMatched.map(m => m.hSkew),
    1e-4
  );
  const ilfWindRows = ilfTrainMatched.filter(m => m.localWind !== null);
  const ilfWindModel = fitRidgeOLS(
    ilfWindRows.map(m => [m.cSkew, m.localWind[0], m.localWind[1]]),
    ilfWindRows.map(m => m.hSkew),
    1.0
  );
  console.log(
    `Ilfracombe Nowcast Fit (2025-2026 train n=${ilfWindRows.length}): ` +
      `SkewOnly=${ilfSkewModel.intercept.toFixed(4)}+${ilfSkewModel.coefs[0].toFixed(3)}*cSkew | ` +
      `Skew+2DWind: cSkew=${ilfWindModel.coefs[0].toFixed(3)}, along=${(ilfWindModel.coefs[1] * 100).toFixed(2)}cm, cross=${(ilfWindModel.coefs[2] * 100).toFixed(2)}cm`
  );

  // 4. Evaluate Out-of-Sample on Each Extreme Storm Window (2022-2025)
  console.log('\n' + '='.repeat(114));
  console.log('PER-STORM OUT-OF-SAMPLE SUMMARY (TRAINED STRICTLY ON 2025-2026, TESTED ON 2022-2025 EXTREME STORMS)');
  console.log('='.repeat(114));
  console.log(
    '  Storm Window                         | HW | PeakHW | MaxSkew  | MinSkew  | Astro MAE | ModD MAE (Bias)  | Ilfa+W MAE (Bias)'
  );
  console.log(
    '  -------------------------------------+----+--------+----------+----------+-----------+------------------+------------------'
  );

  const allEvents = [];

  for (const st of STORM_WINDOWS) {
    const rawSt = iocCache.storms[st.id];
    if (!rawSt || !rawSt.hink || rawSt.hink.length === 0) {
      console.log(`  ${st.name.padEnd(36)} | -- | (no IOC hink data available for this window)`);
      continue;
    }

    const { sensor: hSens, series: hSeries } = extractIocSeries(
      rawSt.hink,
      hinkCal.sensor,
      hinkCal.mean,
      `${st.id} hink`
    );
    const { series: iSeries } = extractIocSeries(
      rawSt.ilfa,
      ilfaCal.sensor,
      ilfaCal.mean,
      `${st.id} ilfa`
    );
    const hPeaks = findParabolicPeaks(hSeries, 2.0, 8 * HOUR_MS);
    const iPeaks = findParabolicPeaks(iSeries, 1.5, 8 * HOUR_MS);

    const stWxNode = stormWeatherCache.storms[st.id];
    const stWx = stWxNode ? loadWeatherContainer(stWxNode.points) : null;

    const evalStartMs = new Date(`${st.evalStart}T00:00:00Z`).getTime();
    const evalEndMs = new Date(`${st.evalEnd}T23:59:59Z`).getTime();

    const stAstroErr = [];
    const stModDErr = [];
    const stIlfSkewErr = [];
    const stIlfWindErr = [];
    let peakHw = -Infinity;
    let maxSkewCm = -Infinity;
    let minSkewCm = Infinity;
    let prevSkew = null;
    let prevMs = null;

    for (const pk of hPeaks) {
      const astro = findAstroHighWater(ms => hinkAstroModel.predict(ms), pk.trueMs);
      const skew = pk.value - astro.value;
      const curPrevSkew =
        prevMs !== null && pk.trueMs - prevMs >= 10 * HOUR_MS && pk.trueMs - prevMs <= 15 * HOUR_MS
          ? prevSkew
          : null;

      prevSkew = skew;
      prevMs = pk.trueMs;

      if (pk.trueMs < evalStartMs || pk.trueMs > evalEndMs) continue;

      const metFeats = stWx ? extractMetFeatures(stWx, pk.trueMs) : null;
      const predSkewD = curPrevSkew !== null && metFeats ? modelD.predict([curPrevSkew, ...metFeats]) : null;
      const predD = predSkewD !== null ? astro.value + predSkewD : null;

      const cPk = findNearestPeak(iPeaks, pk.trueMs, -4 * HOUR_MS, 15 * 60000);
      let cSkew = null;
      let leadMin = null;
      let predSkewIlf = null;
      let predSkewIlfW = null;
      if (cPk) {
        const cAstro = findAstroHighWater(ms => ilfaAstroModel.predict(ms), cPk.trueMs);
        cSkew = cPk.value - cAstro.value;
        leadMin = (pk.trueMs - cPk.trueMs) / 60000;
        predSkewIlf = ilfSkewModel.predict([cSkew]);
        if (stWx) {
          const wBay = interpHourly(stWx.bayMap, cPk.trueMs);
          const wsA = onshoreWindStress(wBay);
          const wsC = crossChannelWindStress(wBay);
          if (wsA !== null && wsC !== null) {
            predSkewIlfW = ilfWindModel.predict([cSkew, wsA / 100.0, wsC / 100.0]);
          }
        }
      }

      const skewCm = skew * 100;
      const errAstroCm = (astro.value - pk.value) * 100;
      const errDCm = predD !== null ? (predD - pk.value) * 100 : null;
      const errIlfCm = predSkewIlf !== null ? (astro.value + predSkewIlf - pk.value) * 100 : null;
      const errIlfWCm = predSkewIlfW !== null ? (astro.value + predSkewIlfW - pk.value) * 100 : null;

      if (pk.value > peakHw) peakHw = pk.value;
      if (skewCm > maxSkewCm) maxSkewCm = skewCm;
      if (skewCm < minSkewCm) minSkewCm = skewCm;

      stAstroErr.push(errAstroCm);
      if (errDCm !== null) stModDErr.push(errDCm);
      if (errIlfCm !== null) stIlfSkewErr.push(errIlfCm);
      if (errIlfWCm !== null) stIlfWindErr.push(errIlfWCm);

      allEvents.push({
        stormId: st.id,
        stormName: st.name,
        sensor: hSens,
        ms: pk.trueMs,
        hObs: pk.value,
        astro: astro.value,
        skewCm,
        prevSkewCm: curPrevSkew !== null ? curPrevSkew * 100 : null,
        predSkewDCm: predSkewD !== null ? predSkewD * 100 : null,
        errAstroCm,
        errDCm,
        ilfSkewCm: cSkew !== null ? cSkew * 100 : null,
        predSkewIlfCm: predSkewIlf !== null ? predSkewIlf * 100 : null,
        predSkewIlfWCm: predSkewIlfW !== null ? predSkewIlfW * 100 : null,
        errIlfCm,
        errIlfWCm,
        leadMin
      });
    }

    const sA = calcStats(stAstroErr);
    const sD = calcStats(stModDErr);
    const sIW = calcStats(stIlfWindErr);
    const fS = v => ((v >= 0 ? '+' : '') + v.toFixed(1) + 'cm').padStart(8);
    const fMB = s =>
      s.n ? `${s.mae.toFixed(1).padStart(4)}cm (${(s.bias >= 0 ? '+' : '') + s.bias.toFixed(1)}cm)`.padEnd(16) : 'n/a'.padEnd(16);

    console.log(
      `  ${st.name.padEnd(36)} | ${String(stAstroErr.length).padStart(2)} | ${peakHw.toFixed(2).padStart(6)} | ` +
        `${fS(maxSkewCm)} | ${fS(minSkewCm)} | ${sA.mae.toFixed(1).padStart(6)} cm | ` +
        `${fMB(sD)} | ${fMB(sIW)}`
    );
  }

  // 5. Aggregate Metrics: All Storm Cycles vs Extreme Tail (|skew| >= 50cm and skew >= +50cm)
  const subsets = [
    { label: 'ALL STORM WINDOW CYCLES', list: allEvents },
    { label: 'EXTREME SURGE TAIL (|skew| >= 50 cm)', list: allEvents.filter(e => Math.abs(e.skewCm) >= 50) },
    { label: 'EXTREME POSITIVE SURGES (skew >= +50 cm)', list: allEvents.filter(e => e.skewCm >= 50) },
    { label: 'EXTREME NEGATIVE SURGES (skew <= -50 cm)', list: allEvents.filter(e => e.skewCm <= -50) }
  ];

  for (const sub of subsets) {
    console.log(`\n--- ${sub.label} (n=${sub.list.length}) ---`);
    if (sub.list.length === 0) {
      console.log('  (no events in this subset)');
      continue;
    }
    console.log(fmtStatRow('1. Pure POL Astro (no surge)', calcStats(sub.list.map(e => e.errAstroCm))));
    console.log(
      fmtStatRow(
        '2. Model D (12h Offshore Weather + AR1)',
        calcStats(sub.list.filter(e => e.errDCm !== null).map(e => e.errDCm))
      )
    );
    console.log(
      fmtStatRow(
        '3a. Ilfracombe ilfa ~42m Nowcast (Skew)',
        calcStats(sub.list.filter(e => e.errIlfCm !== null).map(e => e.errIlfCm))
      )
    );
    console.log(
      fmtStatRow(
        '3b. Ilfracombe ilfa ~42m Nowcast (Skew+2DW)',
        calcStats(sub.list.filter(e => e.errIlfWCm !== null).map(e => e.errIlfWCm))
      )
    );

    // Capture ratio on extreme positive surges
    if (sub.label.includes('POSITIVE')) {
      const withD = sub.list.filter(e => e.predSkewDCm !== null);
      const withIW = sub.list.filter(e => e.predSkewIlfWCm !== null);
      if (withD.length) {
        const meanObs = withD.reduce((s, e) => s + e.skewCm, 0) / withD.length;
        const meanPredD = withD.reduce((s, e) => s + e.predSkewDCm, 0) / withD.length;
        console.log(
          `  -> Model D Extreme Positive Tail Capture: meanObs=+${meanObs.toFixed(1)} cm, ` +
            `meanPred=+${meanPredD.toFixed(1)} cm (capture=${((meanPredD / meanObs) * 100).toFixed(1)}%)`
        );
      }
      if (withIW.length) {
        const meanObs = withIW.reduce((s, e) => s + e.skewCm, 0) / withIW.length;
        const meanPredIW = withIW.reduce((s, e) => s + e.predSkewIlfWCm, 0) / withIW.length;
        console.log(
          `  -> Ilfa+2DW Extreme Positive Tail Capture: meanObs=+${meanObs.toFixed(1)} cm, ` +
            `meanPred=+${meanPredIW.toFixed(1)} cm (capture=${((meanPredIW / meanObs) * 100).toFixed(1)}%)`
        );
      }
    }
  }

  // 6. Top 12 Largest Extreme Skew Surges Table (sorted by |skew| descending)
  const topExtreme = [...allEvents]
    .sort((a, b) => Math.abs(b.skewCm) - Math.abs(a.skewCm))
    .slice(0, 12);

  console.log('\n' + '='.repeat(126));
  console.log('TOP 12 LARGEST EXTREME SKEW SURGES (OUT-OF-SAMPLE 2022-2025 STORMS, SORTED BY |OBS SKEW|)');
  console.log('='.repeat(126));
  console.log(
    '  UTC High Water   | Storm                 | H_obs  | Astro  | ObsSkew | ModD Prd / Err    | Ilfa+2DW Prd / Err | Lead'
  );
  console.log(
    '  -----------------+-----------------------+--------+--------+---------+-------------------+--------------------+-----'
  );
  const fCm = v => (v === null ? '    n/a' : ((v >= 0 ? '+' : '') + v.toFixed(1)).padStart(7));
  for (const e of topExtreme) {
    const modDStr = e.predSkewDCm !== null ? `${fCm(e.predSkewDCm)} / ${fCm(e.errDCm)}` : '      n/a /     n/a';
    const ilfStr =
      e.predSkewIlfWCm !== null ? `${fCm(e.predSkewIlfWCm)} / ${fCm(e.errIlfWCm)}` : '      n/a /     n/a';
    const leadStr = e.leadMin !== null ? `${Math.round(e.leadMin)}m`.padStart(4) : ' n/a';
    console.log(
      `  ${fmtDateTime(e.ms)} | ${e.stormId.padEnd(21)} | ${e.hObs.toFixed(2).padStart(6)} | ` +
        `${e.astro.toFixed(2).padStart(6)} | ${fCm(e.skewCm)} | ${modDStr} | ${ilfStr}  | ${leadStr}`
    );
  }
}

if (FETCH_MODE) {
  runFetch().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
} else {
  runAnalysis();
}
