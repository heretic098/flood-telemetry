#!/usr/bin/env node
/**
 * Backend-Only Proof of Concept (Issue #25)
 * Tests:
 *   1. Hinkley Point (52106) harmonic baseline + Open-Meteo MSLP/wind surge
 *   2. Hinkley (52106) -> Dunball (52163) transfer & Tide-Lock [t_close, t_open] accuracy vs E9094
 *   3. Dunball (52163) -> Hookbridge (52118) upriver wave crest accuracy across 90 days
 *
 * Read-only on telemetry.db; caches external API fetches in /tmp/tidal_poc_cache.json.
 */

import fs from 'node:fs';
import Database from 'better-sqlite3';

const CACHE_PATH = '/tmp/tidal_poc_cache.json';
const dbArg = process.argv.find(a => a.startsWith('--db='));
const DB_PATH = dbArg
  ? dbArg.slice(5)
  : process.env.POC_DB_PATH || new URL('../telemetry.db', import.meta.url).pathname;

// Published multi-year Hinkley Point harmonic constants (Liverpool / Cardiff / NTSLF)
const PUBLISHED_HINKLEY = [
  { name: 'M2', H: 3.91, g: 182.6 },
  { name: 'S2', H: 1.40, g: 236.8 },
  { name: 'N2', H: 0.72, g: 167.5 },
  { name: 'K1', H: 0.08, g: 19.9 },
  { name: 'O1', H: 0.07, g: 355.9 }
];

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DEG = Math.PI / 180;

function astroArgs(ms) {
  const d = (ms - J2000_MS) / 86400000;
  const T = d / 36525.0;
  const s = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const h = 280.4664567 + 36000.76982779 * T + 0.0003032 * T * T;
  const p = 83.3532465 + 4069.0137287 * T - 0.01032 * T * T;
  const N = 125.044555 - 1934.1362608 * T + 0.0020754 * T * T;
  const utcHours = ((ms % 86400000) + 86400000) % 86400000 / 3600000;
  const tau = 15 * utcHours + h - s + 180;
  return { s, h, p, N, tau, utcHours };
}

function predictPublishedHinkley(ms, z0 = 0.0) {
  const { s, h, p, N, tau } = astroArgs(ms);
  const Nrad = N * DEG;
  const fM2 = 1.0004 - 0.0373 * Math.cos(Nrad) + 0.0002 * Math.cos(2 * Nrad);
  const uM2 = -2.14 * Math.sin(Nrad);
  const fK1 = 1.006 + 0.115 * Math.cos(Nrad) - 0.0088 * Math.cos(2 * Nrad);
  const uK1 = -8.86 * Math.sin(Nrad) + 0.68 * Math.sin(2 * Nrad);
  const fO1 = 1.0089 + 0.1871 * Math.cos(Nrad) - 0.0147 * Math.cos(2 * Nrad);
  const uO1 = 10.8 * Math.sin(Nrad) - 1.34 * Math.sin(2 * Nrad);

  const terms = {
    M2: { V: 2 * tau, f: fM2, u: uM2 },
    S2: { V: 2 * tau + 2 * s - 2 * h, f: 1.0, u: 0.0 },
    N2: { V: 2 * tau - s + p, f: fM2, u: uM2 },
    K1: { V: tau + s - 90, f: fK1, u: uK1 },
    O1: { V: tau - s + 90, f: fO1, u: uO1 }
  };

  let y = z0;
  for (const c of PUBLISHED_HINKLEY) {
    const t = terms[c.name];
    y += t.f * c.H * Math.cos((t.V + t.u - c.g) * DEG);
  }
  return y;
}
// Note: N2 (28.44 deg/h) requires ~28 days to separate from M2 (28.98 deg/h) via the Rayleigh criterion;
// on a 14-day window we omit N2 to avoid collinear overfitting, and include M4/MS4 for asymmetry.
const CONSTITUENTS_14D = [
  { name: 'M2', speedDegPerHr: 28.9841042 },
  { name: 'S2', speedDegPerHr: 30.0000000 },
  { name: 'K1', speedDegPerHr: 15.0410686 },
  { name: 'O1', speedDegPerHr: 13.9430356 },
  { name: 'M4', speedDegPerHr: 57.9682084 },
  { name: 'MS4', speedDegPerHr: 58.9841042 }
];
const CONSTITUENTS_45D = [
  { name: 'M2', speedDegPerHr: 28.9841042 },
  { name: 'S2', speedDegPerHr: 30.0000000 },
  { name: 'N2', speedDegPerHr: 28.4397295 },
  { name: 'K1', speedDegPerHr: 15.0410686 },
  { name: 'O1', speedDegPerHr: 13.9430356 },
  { name: 'M4', speedDegPerHr: 57.9682084 },
  { name: 'MS4', speedDegPerHr: 58.9841042 },
  { name: 'MN4', speedDegPerHr: 57.4238337 }
];
const CONSTITUENTS = CONSTITUENTS_14D;

// Causal 25-hour (two tidal cycles) low-pass residual surge at `leadHrs` before `ms`.
// Averaging over 25h cancels residual M2/S2/K1/O1 harmonic error instead of inverting it at 6h.
function getLowPassSurge(ms, obsMap, predictFn, weatherMap, leadHrs = 6, minObs = -Infinity) {
  const endMs = ms - leadHrs * 3600000;
  const startMs = endMs - 25 * 3600000;
  let sum = 0;
  let count = 0;
  for (let t = startMs; t <= endMs; t += 15 * 60000) {
    const obs = obsMap.get(t);
    if (obs === undefined || obs < minObs) continue;
    const w = interpWeather(weatherMap, t);
    const ib = w ? (1013.25 - w.mslp) * 0.01 : 0;
    sum += obs - predictFn(t) - ib;
    count++;
  }
  const wNow = interpWeather(weatherMap, ms);
  const ibNow = wNow ? (1013.25 - wNow.mslp) * 0.01 : 0;
  const subTidal = count >= 12 ? sum / count : 0;
  return subTidal + ibNow;
}

// Onshore wind component blowing from ~255 deg (WSW, up the Bristol Channel toward Bridgwater Bay)
function onshoreWindStress(w) {
  if (!w || !Number.isFinite(w.windSpeedKmh) || !Number.isFinite(w.windDirDeg)) return 0;
  const spdMs = w.windSpeedKmh / 3.6;
  // windDirDeg is meteorological "coming from"; 255 deg = WSW blowing toward ENE
  const cosOnshore = Math.cos((w.windDirDeg - 255) * DEG);
  return spdMs * Math.abs(spdMs) * cosOnshore;
}

function fitLinear1D(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 1, intercept: 0, rmse: Infinity };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = Math.abs(denom) > 1e-12 ? (n * sxy - sx * sy) / denom : 1;
  const intercept = (sy - slope * sx) / n;
  const errs = xs.map((x, i) => slope * x + intercept - ys[i]);
  return { slope, intercept, rmse: rmse(errs), n };
}

// Simple Gaussian elimination for normal equations (X^T X) beta = X^T y
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
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map(row => row[n]);
}

function fitHarmonics(series, t0Ms, constituents = CONSTITUENTS) {
  const p = 1 + 2 * constituents.length;
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty = Array(p).fill(0);

  for (const pt of series) {
    const tHr = (pt.ms - t0Ms) / 3600000;
    const row = [1];
    for (const c of constituents) {
      const rad = (c.speedDegPerHr * tHr * Math.PI) / 180;
      row.push(Math.cos(rad), Math.sin(rad));
    }
    for (let i = 0; i < p; i++) {
      Xty[i] += row[i] * pt.value;
      for (let j = 0; j < p; j++) {
        XtX[i][j] += row[i] * row[j];
      }
    }
  }

  const beta = solveLinearSystem(XtX, Xty);
  return {
    t0Ms,
    z0: beta[0],
    constituents: constituents.map((c, idx) => {
      const a = beta[1 + 2 * idx];
      const b = beta[2 + 2 * idx];
      return {
        name: c.name,
        speedDegPerHr: c.speedDegPerHr,
        a,
        b,
        amplitude: Math.hypot(a, b)
      };
    }),
    predict(ms) {
      const tHr = (ms - t0Ms) / 3600000;
      let y = this.z0;
      for (const c of this.constituents) {
        const rad = (c.speedDegPerHr * tHr * Math.PI) / 180;
        y += c.a * Math.cos(rad) + c.b * Math.sin(rad);
      }
      return y;
    }
  };
}

function rmse(errs) {
  if (!errs.length) return null;
  return Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
}

function mae(errs) {
  if (!errs.length) return null;
  return errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length;
}

// Find local high-water peaks (separated by at least 8 hours)
function findPeaks(series, minPeakVal = -999, minSepMs = 8 * 3600000) {
  const peaks = [];
  for (let i = 2; i < series.length - 2; i++) {
    const v = series[i].value;
    if (v < minPeakVal) continue;
    if (
      v >= series[i - 1].value &&
      v >= series[i + 1].value &&
      v >= series[i - 2].value &&
      v >= series[i + 2].value
    ) {
      const prev = peaks[peaks.length - 1];
      if (!prev || series[i].ms - prev.ms >= minSepMs) {
        peaks.push(series[i]);
      } else if (v > prev.value) {
        peaks[peaks.length - 1] = series[i];
      }
    }
  }
  return peaks;
}

function toNearest15Min(ms) {
  const q = 15 * 60000;
  return Math.round(ms / q) * q;
}

async function loadExternalData() {
  if (fs.existsSync(CACHE_PATH)) {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }

  console.log('Fetching EA 52106 (Hinkley Point) & Open-Meteo Bridgwater Bay weather...');
  const eaUrl =
    'https://environment.data.gov.uk/flood-monitoring/id/measures/52106-level-tidal_level-i-15_min-mAOD/readings?since=2026-10-20T00:00:00Z&_limit=10000';
  const eaRes = await fetch(eaUrl);
  if (!eaRes.ok) throw new Error(`EA 52106 fetch failed: ${eaRes.status}`);
  const eaJson = await eaRes.json();
  const hinkley = (eaJson.items || [])
    .map(r => ({
      dateTime: r.dateTime,
      ms: toNearest15Min(new Date(r.dateTime).getTime()),
      value: Number(r.value)
    }))
    .filter(r => Number.isFinite(r.value))
    .sort((a, b) => a.ms - b.ms);

  // Open-Meteo archive/forecast weather for Bridgwater Bay (51.2106, -3.1313)
  const omUrl =
    'https://api.open-meteo.com/v1/forecast?latitude=51.2106&longitude=-3.1313&hourly=pressure_msl,wind_speed_10m,wind_direction_10m&past_days=30&forecast_days=1&timezone=UTC';
  const omRes = await fetch(omUrl);
  if (!omRes.ok) throw new Error(`Open-Meteo fetch failed: ${omRes.status}`);
  const omJson = await omRes.json();
  const weather = (omJson.hourly?.time || []).map((t, i) => ({
    ms: new Date(t + ':00Z').getTime(),
    mslp: omJson.hourly.pressure_msl[i],
    windSpeedKmh: omJson.hourly.wind_speed_10m[i],
    windDirDeg: omJson.hourly.wind_direction_10m[i]
  }));

  const payload = { hinkley, weather };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload));
  return payload;
}

function loadSqliteSeries(db, measureId) {
  return db
    .prepare(
      `SELECT date_time, value FROM historical_telemetry WHERE measure_id = ? AND value IS NOT NULL ORDER BY date_time ASC`
    )
    .all(measureId)
    .map(r => ({
      dateTime: r.date_time,
      ms: toNearest15Min(new Date(r.date_time).getTime()),
      value: Number(r.value)
    }));
}

function interpWeather(weatherMap, ms) {
  const hr = 3600000;
  const h0 = Math.floor(ms / hr) * hr;
  const h1 = h0 + hr;
  const w0 = weatherMap.get(h0);
  const w1 = weatherMap.get(h1);
  if (!w0) return w1 || null;
  if (!w1) return w0;
  const f = (ms - h0) / hr;
  return {
    mslp: w0.mslp + f * (w1.mslp - w0.mslp),
    windSpeedKmh: w0.windSpeedKmh + f * (w1.windSpeedKmh - w0.windSpeedKmh),
    windDirDeg: w0.windDirDeg
  };
}

// Extract tide-lock intervals where sea >= threshold (with sub-15-min linear crossing interpolation)
function extractTideLockIntervals(seaSeries, getThreshold, deadband = 0.03) {
  const intervals = [];
  let locked = false;
  let startMs = null;
  let maxSea = -Infinity;
  let prev = null;
  let prevThresh = null;

  for (const pt of seaSeries) {
    const thresh = getThreshold(pt.ms);
    if (thresh === null) continue;
    const canInterp = prev !== null && pt.ms - prev.ms > 0 && pt.ms - prev.ms <= 30 * 60000;

    if (!locked) {
      if (pt.value >= thresh) {
        locked = true;
        startMs = pt.ms;
        if (canInterp && prev.value < prevThresh) {
          const d0 = prev.value - prevThresh;
          const d1 = pt.value - thresh;
          if (d1 - d0 > 1e-9) {
            const frac = Math.max(0, Math.min(1, -d0 / (d1 - d0)));
            startMs = prev.ms + frac * (pt.ms - prev.ms);
          }
        }
        maxSea = pt.value;
      }
    } else {
      if (pt.value > maxSea) maxSea = pt.value;
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
        intervals.push({ startMs, endMs, durationMin: (endMs - startMs) / 60000, maxSea });
        locked = false;
      }
    }
    prev = pt;
    prevThresh = thresh;
  }
  return intervals;
}

function mergeSeriesByMs(baseSeries, extraSeries) {
  const byMs = new Map();
  for (const pt of baseSeries) byMs.set(pt.ms, pt);
  for (const pt of extraSeries) byMs.set(pt.ms, pt);
  return [...byMs.values()].sort((a, b) => a.ms - b.ms);
}

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

async function main() {
  const { hinkley: hinkleyExt, weather } = await loadExternalData();
  const db = new Database(DB_PATH, { readonly: true });

  const hinkleyDb = loadSqliteSeries(db, '52106-level-tidal_level-i-15_min-mAOD');
  const hinkley = mergeSeriesByMs(hinkleyExt, hinkleyDb);
  const dunball = loadSqliteSeries(db, '52163-level-tidal_level-i-15_min-mAOD');
  const ksdInland = loadSqliteSeries(db, 'E9094-level-stage-i-15_min-mAOD');
  const hookbridge = loadSqliteSeries(db, '52118-level-stage-i-15_min-mAOD');

  const hinkleyMap = new Map(hinkley.map(p => [p.ms, p.value]));
  const dunballMap = new Map(dunball.map(p => [p.ms, p.value]));
  const ksdMap = new Map(ksdInland.map(p => [p.ms, p.value]));
  const hookMap = new Map(hookbridge.map(p => [p.ms, p.value]));
  const weatherMap = new Map(weather.map(w => [w.ms, w]));

  console.log('\n=== PART 1: HINKLEY POINT (52106) ASTRONOMICAL + SURGE BASELINE ===');
  const splitMs = hinkley[Math.floor(hinkley.length / 2)].ms;
  const hTrain = hinkley.filter(p => p.ms < splitMs);
  const hTest = hinkley.filter(p => p.ms >= splitMs);
  const hTrainDays = (hTrain[hTrain.length - 1].ms - hTrain[0].ms) / 86400000;
  const model = fitHarmonics(hTrain, hTrain[0].ms, hTrainDays >= 28 ? CONSTITUENTS_45D : CONSTITUENTS_14D);

  console.log(`Train: ${hTrain.length} pts (${fmtDate(hTrain[0].ms)} - ${fmtDate(splitMs)}) | Out-of-sample Test: ${hTest.length} pts (${fmtDate(splitMs)} - ${fmtDate(hTest[hTest.length - 1].ms)})`);
  console.log(
    'Fitted amplitudes (m):',
    model.constituents.map(c => `${c.name}=${c.amplitude.toFixed(3)}`).join(', ')
  );

  const astroErrs = [];
  const surgeAdjErrs = [];
  const persistErrs = [];

  for (const pt of hTest) {
    const astro = model.predict(pt.ms);
    const w = interpWeather(weatherMap, pt.ms);
    const ib = w ? (1013.25 - w.mslp) * 0.01 : 0;

    // 6h-ahead surge persistence: observed residual at (t - 6h) decayed by 0.75 + delta_IB
    const t6 = pt.ms - 6 * 3600000;
    const obs6 = hinkleyMap.get(t6);
    const w6 = interpWeather(weatherMap, t6);
    const ib6 = w6 ? (1013.25 - w6.mslp) * 0.01 : 0;
    const persistSurge =
      obs6 !== undefined ? 0.75 * (obs6 - model.predict(t6) - ib6) + ib : ib;

    astroErrs.push(pt.value - astro);
    surgeAdjErrs.push(pt.value - (astro + ib));
    persistErrs.push(pt.value - (astro + persistSurge));
  }

  console.log(`Out-of-sample RMSE (Astro only): ${(rmse(astroErrs) * 100).toFixed(1)} cm | MAE: ${(mae(astroErrs) * 100).toFixed(1)} cm`);
  console.log(`Out-of-sample RMSE (Astro + Inverted Barometer): ${(rmse(surgeAdjErrs) * 100).toFixed(1)} cm | MAE: ${(mae(surgeAdjErrs) * 100).toFixed(1)} cm`);
  console.log(`Out-of-sample RMSE (Astro + 6h Surge Persistence): ${(rmse(persistErrs) * 100).toFixed(1)} cm | MAE: ${(mae(persistErrs) * 100).toFixed(1)} cm`);

  // Check High Water peak error on test set
  const hTestPeaks = findPeaks(hTest, 2.5);
  const hwPeakErrAstro = [];
  const hwPeakErrPersist = [];
  for (const pk of hTestPeaks) {
    let maxAstro = -Infinity;
    let maxPersist = -Infinity;
    const t6 = pk.ms - 6 * 3600000;
    const obs6 = hinkleyMap.get(t6);
    const w6 = interpWeather(weatherMap, t6);
    const ib6 = w6 ? (1013.25 - w6.mslp) * 0.01 : 0;
    const res6 = obs6 !== undefined ? 0.75 * (obs6 - model.predict(t6) - ib6) : 0;

    for (let dt = -45 * 60000; dt <= 45 * 60000; dt += 15 * 60000) {
      const a = model.predict(pk.ms + dt);
      const w = interpWeather(weatherMap, pk.ms + dt);
      const ib = w ? (1013.25 - w.mslp) * 0.01 : 0;
      if (a > maxAstro) maxAstro = a;
      if (a + ib + res6 > maxPersist) maxPersist = a + ib + res6;
    }
    hwPeakErrAstro.push(pk.value - maxAstro);
    hwPeakErrPersist.push(pk.value - maxPersist);
  }
  console.log(`Test High-Water Peak MAE (Astro only): ${(mae(hwPeakErrAstro) * 100).toFixed(1)} cm | (Astro + 6h Surge Persistence): ${(mae(hwPeakErrPersist) * 100).toFixed(1)} cm across ${hTestPeaks.length} tides`);

  console.log('\n=== PART 1B: PUBLISHED HINKLEY CONSTANTS (M2,S2,N2,K1,O1) + DOODSON PHASES ===');
  const z0Pub = hTrain.reduce((s, pt) => s + (pt.value - predictPublishedHinkley(pt.ms, 0)), 0) / hTrain.length;
  const predPub = ms => predictPublishedHinkley(ms, z0Pub);

  // Fit onshore wind coefficient on hTrain sub-tidal residual
  const windTrainX = [];
  const windTrainY = [];
  for (const pt of hTrain) {
    const w = interpWeather(weatherMap, pt.ms);
    if (!w) continue;
    const ib = (1013.25 - w.mslp) * 0.01;
    windTrainX.push(onshoreWindStress(w));
    windTrainY.push(pt.value - predPub(pt.ms) - ib);
  }
  const windFit = fitLinear1D(windTrainX, windTrainY);

  const pubErrs = [];
  const pubPersistErrs = [];
  const pubLowPassErrs = [];
  const pubWindErrs = [];
  for (const pt of hTest) {
    const astro = predPub(pt.ms);
    const w = interpWeather(weatherMap, pt.ms);
    const ib = w ? (1013.25 - w.mslp) * 0.01 : 0;
    const t6 = pt.ms - 6 * 3600000;
    const obs6 = hinkleyMap.get(t6);
    const w6 = interpWeather(weatherMap, t6);
    const ib6 = w6 ? (1013.25 - w6.mslp) * 0.01 : 0;
    const persist = obs6 !== undefined ? 0.75 * (obs6 - predPub(t6) - ib6) + ib : ib;
    const lpSurge = getLowPassSurge(pt.ms, hinkleyMap, predPub, weatherMap, 6);
    const windTerm = w && windFit.n >= 20 ? windFit.slope * onshoreWindStress(w) : 0;

    pubErrs.push(pt.value - astro);
    pubPersistErrs.push(pt.value - (astro + persist));
    pubLowPassErrs.push(pt.value - (astro + lpSurge));
    pubWindErrs.push(pt.value - (astro + lpSurge + windTerm));
  }
  const pubHwErrs = [];
  const pubHwPersistErrs = [];
  const pubHwLowPassErrs = [];
  for (const pk of hTestPeaks) {
    let maxA = -Infinity, maxP = -Infinity, maxLP = -Infinity;
    const t6 = pk.ms - 6 * 3600000;
    const obs6 = hinkleyMap.get(t6);
    const w6 = interpWeather(weatherMap, t6);
    const ib6 = w6 ? (1013.25 - w6.mslp) * 0.01 : 0;
    const res6 = obs6 !== undefined ? 0.75 * (obs6 - predPub(t6) - ib6) : 0;
    for (let dt = -45 * 60000; dt <= 45 * 60000; dt += 15 * 60000) {
      const t = pk.ms + dt;
      const a = predPub(t);
      const w = interpWeather(weatherMap, t);
      const ib = w ? (1013.25 - w.mslp) * 0.01 : 0;
      const lp = getLowPassSurge(t, hinkleyMap, predPub, weatherMap, 6);
      if (a > maxA) maxA = a;
      if (a + ib + res6 > maxP) maxP = a + ib + res6;
      if (a + lp > maxLP) maxLP = a + lp;
    }
    pubHwErrs.push(pk.value - maxA);
    pubHwPersistErrs.push(pk.value - maxP);
    pubHwLowPassErrs.push(pk.value - maxLP);
  }
  console.log(`Published Z0 (mAOD from Oct 20-Nov 03 mean): ${z0Pub.toFixed(3)} m`);
  console.log(`Out-of-sample RMSE (Published Astro): ${(rmse(pubErrs) * 100).toFixed(1)} cm | (Astro + 6h Surge Persistence): ${(rmse(pubPersistErrs) * 100).toFixed(1)} cm`);
  console.log(`Out-of-sample RMSE (Published Astro + 25h Low-Pass Surge + IB): ${(rmse(pubLowPassErrs) * 100).toFixed(1)} cm | (+ Onshore Wind): ${(rmse(pubWindErrs) * 100).toFixed(1)} cm`);
  console.log(`Test HW Peak MAE (Published Astro): ${(mae(pubHwErrs) * 100).toFixed(1)} cm | (6h Persist): ${(mae(pubHwPersistErrs) * 100).toFixed(1)} cm | (25h Low-Pass + IB): ${(mae(pubHwLowPassErrs) * 100).toFixed(1)} cm`);

  console.log('\n=== PART 2: HINKLEY (52106) -> DUNBALL (52163) & TIDE-LOCK WINDOW ===');
  if (!dunball.length) {
    console.log('No Dunball (52163) rows in selected DB; skipping Parts 2, 2B, and 3.');
    return;
  }
  const overlapStart = Math.max(hinkley[0].ms, dunball[0].ms);
  const overlapEnd = Math.min(hinkley[hinkley.length - 1].ms, dunball[dunball.length - 1].ms);
  const overlapSplit = overlapStart + (overlapEnd - overlapStart) * 0.5;

  const dOverlap = dunball.filter(p => p.ms >= overlapStart && p.ms <= overlapEnd);
  const dPeaks = findPeaks(dOverlap, 3.0);
  const hOverlapPeaks = findPeaks(hinkley.filter(p => p.ms >= overlapStart && p.ms <= overlapEnd), 2.5);

  const lagsMin = [];
  const peakAmplifications = [];
  for (const dp of dPeaks) {
    const match = hOverlapPeaks.find(hp => Math.abs(dp.ms - hp.ms) <= 3 * 3600000 && dp.ms >= hp.ms - 15 * 60000);
    if (match) {
      lagsMin.push((dp.ms - match.ms) / 60000);
      peakAmplifications.push(dp.value - match.value);
    }
  }
  const avgLagMin = lagsMin.reduce((a, b) => a + b, 0) / lagsMin.length;
  const roundedLagMs = Math.round(avgLagMin / 15) * 15 * 60000;
  console.log(`Observed HW lag Hinkley -> Dunball: mean=${avgLagMin.toFixed(1)} min (min=${Math.min(...lagsMin)}, max=${Math.max(...lagsMin)}), using ${roundedLagMs / 60000} min`);
  console.log(`Observed HW height diff (Dunball - Hinkley): mean=${(peakAmplifications.reduce((a, b) => a + b, 0) / peakAmplifications.length).toFixed(2)} m`);

  // Fit separate mid-tide (1.5-4.0 mAOD Dunball) flood vs ebb transfers + optimal lag on train half (Oct 20 - Oct 31)
  function fitDirectionalMidTide(isFlood) {
    let best = { lagMin: 0, slope: 1, intercept: 0, rmse: Infinity, n: 0 };
    for (const lagMin of [0, 15, 30, 45]) {
      const xs = [], ys = [];
      for (const pt of dOverlap) {
        if (pt.ms >= overlapSplit) continue;
        if (pt.value < 1.5 || pt.value > 4.0) continue;
        const tLag = pt.ms - lagMin * 60000;
        const hVal = hinkleyMap.get(tLag);
        const hPrev = hinkleyMap.get(tLag - 15 * 60000);
        if (hVal === undefined || hPrev === undefined) continue;
        const rising = hVal >= hPrev;
        if (rising !== isFlood) continue;
        xs.push(hVal);
        ys.push(pt.value);
      }
      const fit = fitLinear1D(xs, ys);
      if (fit.n >= 10 && fit.rmse < best.rmse) {
        best = { lagMin, ...fit };
      }
    }
    return best;
  }

  const floodMidFit = fitDirectionalMidTide(true);
  const ebbMidFit = fitDirectionalMidTide(false);

  // Also fit high-water (> 4.0 mAOD) transfer for peak height prediction
  const hwXs = [], hwYs = [];
  for (const pt of dOverlap) {
    if (pt.ms >= overlapSplit || pt.value <= 4.0) continue;
    const hVal = hinkleyMap.get(pt.ms - roundedLagMs);
    if (hVal !== undefined) {
      hwXs.push(hVal);
      hwYs.push(pt.value);
    }
  }
  const hwFit = fitLinear1D(hwXs, hwYs);
  console.log(`Mid-tide flood fit (Oct 20-31, n=${floodMidFit.n}, lag=${floodMidFit.lagMin}m): Dunball = ${floodMidFit.slope.toFixed(3)} * Hinkley + ${floodMidFit.intercept.toFixed(3)}m`);
  console.log(`Mid-tide ebb   fit (Oct 20-31, n=${ebbMidFit.n}, lag=${ebbMidFit.lagMin}m): Dunball = ${ebbMidFit.slope.toFixed(3)} * Hinkley + ${ebbMidFit.intercept.toFixed(3)}m`);
  console.log(`High-tide (>4m) fit (Oct 20-31, n=${hwFit.n}, lag=${roundedLagMs / 60000}m): Dunball = ${hwFit.slope.toFixed(3)} * Hinkley + ${hwFit.intercept.toFixed(3)}m`);

  // Out-of-sample test (Nov 1 - Nov 10): Published Astro + 25h Low-Pass Surge + Directional Mid-Tide Transfer
  const dTest = dOverlap.filter(p => p.ms >= overlapSplit);
  const actualLocks = extractTideLockIntervals(dTest, ms => ksdMap.get(ms) ?? null, 0.03);

  const predDunballSeries = dTest.map(pt => {
    const isRising = predPub(pt.ms) >= predPub(pt.ms - 15 * 60000);
    const dirFit = isRising ? floodMidFit : ebbMidFit;
    const tMid = pt.ms - dirFit.lagMin * 60000;
    const hMid = predPub(tMid) + getLowPassSurge(tMid, hinkleyMap, predPub, weatherMap, 6);
    const dMid = dirFit.slope * hMid + dirFit.intercept;

    const tHw = pt.ms - roundedLagMs;
    const hHw = predPub(tHw) + getLowPassSurge(tHw, hinkleyMap, predPub, weatherMap, 6);
    const dHw = hwFit.slope * hHw + hwFit.intercept;

    // Smooth blend from mid-tide transfer (<=3.5 mAOD) to HW transfer (>=4.5 mAOD)
    const wHw = Math.max(0, Math.min(1, (dMid - 3.5) / 1.0));
    const dPred = Math.max(0.8, (1 - wHw) * dMid + wHw * dHw);
    return { ms: pt.ms, value: dPred };
  });

  const closeErrsMin = [];
  const openErrsMin = [];
  const durErrsMin = [];
  const peakErrsCm = [];

  for (const act of actualLocks) {
    const startSnap = toNearest15Min(act.startMs);
    const lookbackMs = startSnap - 3 * 3600000;
    const frozenE9094 = ksdMap.get(lookbackMs) ?? ksdMap.get(startSnap);
    if (frozenE9094 === undefined) continue;

    const winPred = predDunballSeries.filter(p => p.ms >= act.startMs - 3 * 3600000 && p.ms <= act.endMs + 3 * 3600000);
    // Use causal previous-tidal-cycle E9094 (t - 12.5h) to track KSD's drainage/fill cycle, falling back to frozen pre-lock E9094
    const predLocks = extractTideLockIntervals(
      winPred,
      ms => ksdMap.get(toNearest15Min(ms - 12.5 * 3600000)) ?? frozenE9094,
      0.03
    );
    if (!predLocks.length) {
      console.log(`  Missed lock at ${new Date(act.startMs).toISOString()}`);
      continue;
    }
    const pred = predLocks[0];
    closeErrsMin.push((pred.startMs - act.startMs) / 60000);
    openErrsMin.push((pred.endMs - act.endMs) / 60000);
    durErrsMin.push(pred.durationMin - act.durationMin);
    peakErrsCm.push((pred.maxSea - act.maxSea) * 100);
  }

  console.log(`Out-of-sample Tide-Lock Test (Nov 1-10, ${closeErrsMin.length}/${actualLocks.length} cycles matched):`);
  console.log(`  t_close MAE: ${mae(closeErrsMin).toFixed(1)} min (mean bias: ${(closeErrsMin.reduce((a, b) => a + b, 0) / closeErrsMin.length).toFixed(1)} min)`);
  console.log(`  t_open  MAE: ${mae(openErrsMin).toFixed(1)} min (mean bias: ${(openErrsMin.reduce((a, b) => a + b, 0) / openErrsMin.length).toFixed(1)} min)`);
  console.log(`  Duration MAE: ${mae(durErrsMin).toFixed(1)} min | Dunball Peak MAE: ${mae(peakErrsCm).toFixed(1)} cm`);

  console.log('\n=== PART 2B: 90-DAY DUNBALL (52163) DIRECT HARMONIC BENCHMARK ===');
  // 45d train separates M2 & N2 (27.55d beat) + captures local M4/MS4/MN4 overtides above river floor (>=1.8 mAOD)
  const dSplit90 = dunball[Math.floor(dunball.length / 2)].ms;
  const dTrain90 = dunball.filter(p => p.ms < dSplit90 && p.value >= 1.8);
  const dTest90 = dunball.filter(p => p.ms >= dSplit90);
  const dModel90 = fitHarmonics(dTrain90, dTrain90[0].ms, CONSTITUENTS_45D);
  const predDun90 = ms => dModel90.predict(ms);

  const actualLocks90 = extractTideLockIntervals(dTest90, ms => ksdMap.get(ms) ?? null, 0.03);
  const predDun90Astro = dTest90.map(pt => ({ ms: pt.ms, value: predDun90(pt.ms) }));
  const predDun90Surge = dTest90.map(pt => ({
    ms: pt.ms,
    value: predDun90(pt.ms) + getLowPassSurge(pt.ms, dunballMap, predDun90, weatherMap, 6, 1.8)
  }));

  function evalLockBenchmark(label, predSeries) {
    const cErr = [], oErr = [], dErr = [], pErr = [];
    for (const act of actualLocks90) {
      const startSnap = toNearest15Min(act.startMs);
      const frozenE9094 = ksdMap.get(startSnap - 3 * 3600000) ?? ksdMap.get(startSnap);
      if (frozenE9094 === undefined) continue;
      const win = predSeries.filter(p => p.ms >= act.startMs - 3 * 3600000 && p.ms <= act.endMs + 3 * 3600000);
      const pl = extractTideLockIntervals(
        win,
        ms => ksdMap.get(toNearest15Min(ms - 12.5 * 3600000)) ?? frozenE9094,
        0.03
      );
      if (!pl.length) continue;
      cErr.push((pl[0].startMs - act.startMs) / 60000);
      oErr.push((pl[0].endMs - act.endMs) / 60000);
      dErr.push(pl[0].durationMin - act.durationMin);
      pErr.push((pl[0].maxSea - act.maxSea) * 100);
    }
    const bias = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log(`  ${label} (${cErr.length}/${actualLocks90.length} cycles): t_close MAE=${mae(cErr).toFixed(1)}m (bias ${bias(cErr).toFixed(1)}m) | t_open MAE=${mae(oErr).toFixed(1)}m (bias ${bias(oErr).toFixed(1)}m) | Dur MAE=${mae(dErr).toFixed(1)}m | Peak MAE=${mae(pErr).toFixed(1)}cm`);
  }

  console.log(`Train: ${dTrain90.length} tidal pts >=1.8 mAOD (Aug 12 - Sep 26) | Test: ${actualLocks90.length} lock cycles (Sep 26 - Nov 10)`);
  evalLockBenchmark('45d Dunball Astro only', predDun90Astro);
  evalLockBenchmark('45d Dunball Astro + 25h Low-Pass Surge', predDun90Surge);

  console.log('\n=== PART 3: DUNBALL (52163) -> HOOKBRIDGE (52118) UPRIVER WAVE (90 DAYS) ===');
  const allDunballPeaks = findPeaks(dunball, 3.0);
  const regime1Backups = [];
  const regime2Ratios = [];
  const regime2PredErrsCm = [];
  const regime2LagsMin = [];

  const regime2Rows = [];
  for (const dp of allDunballPeaks) {
    // Baseline Hookbridge 2h to 3h before Dunball HW
    const preVals = [];
    for (let dt = -3 * 3600000; dt <= -2 * 3600000; dt += 15 * 60000) {
      const v = hookMap.get(dp.ms + dt);
      if (v !== undefined) preVals.push(v);
    }
    if (!preVals.length) continue;
    const hPre = Math.min(...preVals);

    // Peak Hookbridge 45m to 180m after Dunball HW
    let hPostMax = -Infinity;
    let hPostMs = null;
    for (let dt = 45 * 60000; dt <= 180 * 60000; dt += 15 * 60000) {
      const v = hookMap.get(dp.ms + dt);
      if (v !== undefined && v > hPostMax) {
        hPostMax = v;
        hPostMs = dp.ms + dt;
      }
    }
    if (hPostMs === null) continue;

    const headDiff = dp.value - hPre;
    const obsRise = hPostMax - hPre;

    if (headDiff <= 0) {
      regime1Backups.push(obsRise);
    } else if (headDiff >= 0.3) {
      regime2Ratios.push(obsRise / headDiff);
      regime2LagsMin.push((hPostMs - dp.ms) / 60000);
      const predRise = 0.56 * headDiff;
      regime2PredErrsCm.push((predRise - obsRise) * 100);
      regime2Rows.push({ ms: dp.ms, headDiff, hPre, obsRise });
    }
  }

  console.log(`Regime 1 (Dunball <= Hookbridge, n=${regime1Backups.length} tides): observed backup mean=${regime1Backups.length ? (regime1Backups.reduce((a, b) => a + b, 0) / regime1Backups.length * 100).toFixed(1) : 'n/a'} cm (max=${regime1Backups.length ? (Math.max(...regime1Backups) * 100).toFixed(1) : 'n/a'} cm)`);
  if (!regime2Rows.length) {
    console.log('Regime 2 (Dunball > Hookbridge +0.3m, n=0 tides): no upriver surge-over-river events in this window.');
    return;
  }
  const meanRatio = regime2Ratios.reduce((a, b) => a + b, 0) / regime2Ratios.length;
  console.log(`Regime 2 (Dunball > Hookbridge +0.3m, n=${regime2Ratios.length} tides):`);
  console.log(`  Transfer ratio (rise / headDiff): mean=${meanRatio.toFixed(3)} (min=${Math.min(...regime2Ratios).toFixed(3)}, max=${Math.max(...regime2Ratios).toFixed(3)})`);
  console.log(`  Peak lag: mean=${(regime2LagsMin.reduce((a, b) => a + b, 0) / regime2LagsMin.length).toFixed(1)} min`);
  console.log(`  Crest MAE using flat 0.56 ratio: ${mae(regime2PredErrsCm).toFixed(1)} cm | RMSE: ${rmse(regime2PredErrsCm).toFixed(1)} cm`);

  // Out-of-sample 50/50 train -> test linear fit: rise = a * headDiff + b
  const hookSplitMs = regime2Rows[Math.floor(regime2Rows.length / 2)].ms;
  const r2Train = regime2Rows.filter(r => r.ms < hookSplitMs);
  const r2Test = regime2Rows.filter(r => r.ms >= hookSplitMs);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const r of r2Train) {
    sx += r.headDiff;
    sy += r.obsRise;
    sxx += r.headDiff * r.headDiff;
    sxy += r.headDiff * r.obsRise;
  }
  const nR2 = r2Train.length;
  const rSlope = (nR2 * sxy - sx * sy) / (nR2 * sxx - sx * sx);
  const rInt = (sy - rSlope * sx) / nR2;
  const r2TestErrsCm = r2Test.map(r => (rSlope * r.headDiff + rInt - r.obsRise) * 100);
  console.log(`  Out-of-sample Linear Fit (Train n=${nR2} Aug-Sep -> Test n=${r2Test.length} Oct-Nov): rise = ${rSlope.toFixed(3)} * headDiff + ${(rInt * 100).toFixed(1)} cm`);
  console.log(`  Out-of-sample Hookbridge Crest MAE: ${mae(r2TestErrsCm).toFixed(1)} cm | RMSE: ${rmse(r2TestErrsCm).toFixed(1)} cm (max err: ${Math.max(...r2TestErrsCm.map(Math.abs)).toFixed(1)} cm)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
