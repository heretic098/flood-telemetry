import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../server.js';

let testPort;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server.listen(0, () => {
      testPort = server.address().port;
      baseUrl = `http://localhost:${testPort}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${baseUrl}${path}`);
    const req = http.request(parsed, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Master EA calibration matrix surveyed from Environment Agency open stageScale API
const EA_STATION_CALIBRATIONS = {
  '52108': { name: 'Greenham', datum: 75.69, minOnRecord: 75.72, typLow: 75.84, typHigh: 76.99, maxOnRecord: 77.89 },
  '52109': { name: 'Bishops Hull', datum: 16.58, minOnRecord: 16.60, typLow: 16.67, typHigh: 17.48, maxOnRecord: 19.17 },
  '52111': { name: 'Taunton Market', datum: 12.47, minOnRecord: 12.67, typLow: 13.29, typHigh: 14.24, maxOnRecord: 14.31 },
  '52162': { name: 'Bathpool Outfall', datum: 0.00, minOnRecord: 7.56, typLow: 8.50, typHigh: 9.50, maxOnRecord: 11.03 },
  '52118': { name: 'Hookbridge Spillway', datum: 0.00, minOnRecord: 3.33, typLow: 4.71, typHigh: 7.30, maxOnRecord: 8.10 },
  '52127': { name: 'Curry Moor Basin', datum: 0.00, minOnRecord: 0.00, typLow: 3.92, typHigh: 6.50, maxOnRecord: 8.05 },
  '52116': { name: 'Chiselborough', datum: 20.70, minOnRecord: 20.70, typLow: 20.75, typHigh: 22.50, maxOnRecord: 23.63 },
  '52119': { name: 'Gaw Bridge', datum: 10.00, minOnRecord: 10.16, typLow: 10.23, typHigh: 12.80, maxOnRecord: 13.84 },
  '52233': { name: "Monk's Leaze Clyse Upstream", datum: 0.00, minOnRecord: 4.20, typLow: 6.01, typHigh: 7.41, maxOnRecord: 8.50 },
  '52234': { name: "Monk's Leaze Clyse Downstream", datum: 0.00, minOnRecord: 4.05, typLow: 6.01, typHigh: 7.41, maxOnRecord: 7.90 },
  '52158': { name: 'Baltmoor Wall Spillway', datum: 0.00, minOnRecord: 3.60, typLow: 3.55, typHigh: 3.97, maxOnRecord: 7.80 },
  '52159': { name: 'Northmoor Basin', datum: 0.00, minOnRecord: 2.03, typLow: 2.50, typHigh: 3.42, maxOnRecord: 5.89 },
  '52124': { name: 'West Quay Bridgwater', datum: 0.00, minOnRecord: 0.50, typLow: 1.20, typHigh: 5.50, maxOnRecord: 8.09 },
  '52163': { name: 'Dunball Tidal', datum: 0.00, minOnRecord: -2.00, typLow: -1.50, typHigh: 6.30, maxOnRecord: 7.09 },
  '52157': { name: 'Beerwall Upstream', datum: 0.00, minOnRecord: 2.30, typLow: 2.33, typHigh: 4.16, maxOnRecord: 5.07 },
  'E9531': { name: 'Bradney', datum: 0.00, minOnRecord: 1.14, typLow: 1.00, typHigh: 3.50, maxOnRecord: 4.44 },
  'E9094': { name: 'Dunball Inland KSD', datum: 0.00, minOnRecord: 0.42, typLow: 1.00, typHigh: 3.50, maxOnRecord: 4.07 },
  '52120': { name: 'Huish Episcopi PS', datum: 5.00, minOnRecord: 5.80, typLow: 6.44, typHigh: 8.48, maxOnRecord: 9.92 },
  '52153': { name: 'Midelney', datum: 5.185, minOnRecord: 5.50, typLow: 6.10, typHigh: 8.20, maxOnRecord: 9.12 }
};

// ---------------------------------------------------------------------------
// 1. Station Calibration & Scale Invariants
// ---------------------------------------------------------------------------

test('HYDRO-01: Station stages in /api/topology must fall within physical Somerset geodetic bounds (-2.0m to 100.0m AOD)', async () => {
  const res = await httpGet('/api/topology');
  assert.equal(res.status, 200);
  const topology = JSON.parse(res.body);

  for (const node of topology.nodes) {
    assert.ok(typeof node.stage_mAOD === 'number', `Node ${node.id} must define numerical stage_mAOD`);
    assert.ok(
      node.stage_mAOD >= -2.0 && node.stage_mAOD <= 100.0,
      `[RULE-EA-03] Node ${node.id} (${node.name}) stage ${node.stage_mAOD}mAOD is outside physical geodetic bounds`
    );
  }
});

test('HYDRO-02: Alert levels must strictly satisfy typicalRangeLow < alert_level <= maxOnRecord', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);

  for (const node of topology.nodes) {
    const cal = EA_STATION_CALIBRATIONS[node.id];
    if (cal && node.alert_level_mAOD !== undefined) {
      assert.ok(
        node.alert_level_mAOD > cal.typLow,
        `[RULE-ALT-01] Station ${node.id} (${node.name}) alert level (${node.alert_level_mAOD}mAOD) must be > typicalRangeLow (${cal.typLow}mAOD)`
      );
      assert.ok(
        node.alert_level_mAOD <= cal.maxOnRecord,
        `[RULE-ALT-01] Station ${node.id} (${node.name}) alert level (${node.alert_level_mAOD}mAOD) must be <= maxOnRecord (${cal.maxOnRecord}mAOD)`
      );
    }
  }
});

test('HYDRO-03: Alert levels must NEVER fall below or equal channel bed invert or minOnRecord', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);

  for (const node of topology.nodes) {
    const cal = EA_STATION_CALIBRATIONS[node.id];
    if (cal && node.alert_level_mAOD !== undefined) {
      assert.ok(
        node.alert_level_mAOD > cal.minOnRecord,
        `[RULE-ALT-02] Station ${node.id} (${node.name}) alert level (${node.alert_level_mAOD}mAOD) must be > minOnRecord (${cal.minOnRecord}mAOD)`
      );
      if (node.ground_elevation_mAOD !== undefined) {
        assert.ok(
          node.alert_level_mAOD > node.ground_elevation_mAOD,
          `[RULE-ALT-02] Station ${node.id} (${node.name}) alert level must exceed ground baseline (${node.ground_elevation_mAOD}mAOD)`
        );
      }
    }
  }
});

test('HYDRO-04: Polder basins follow strict threshold progression: Ground < Lead < Duty <= Alert <= Crest', async () => {
  const resCatchment = await httpGet('/api/catchments/somerset');
  assert.equal(resCatchment.status, 200);
  const somerset = JSON.parse(resCatchment.body);

  // Curry Moor validation
  const cmPumps = somerset.moors.curry_moor.pumping_stations[0].thresholds.winter;
  const cmGround = 2.10;
  const cmAlert = 6.50;
  const cmCrest = somerset.moors.curry_moor.spillway.baseline_crest_mAOD; // 7.45
  assert.ok(cmGround < cmPumps.lead, 'Curry Moor ground must be below lead pump threshold');
  assert.ok(cmPumps.lead < cmPumps.duty, 'Curry Moor lead pump must be below duty pump threshold');
  assert.ok(cmPumps.duty <= cmAlert, 'Curry Moor duty pump must be <= alert level');
  assert.ok(cmAlert <= cmCrest, 'Curry Moor alert level must be <= spillway crest elevation');

  // Northmoor validation
  const nmPumps = somerset.moors.northmoor.pumping_stations[0].thresholds.winter;
  const nmGround = 1.80;
  const nmAlert = 3.80;
  const nmCrest = somerset.moors.northmoor.spillway.baseline_crest_mAOD; // 7.80
  assert.ok(nmGround < nmPumps.lead, 'Northmoor ground must be below lead pump threshold');
  assert.ok(nmPumps.lead < nmPumps.duty, 'Northmoor lead pump must be below duty pump threshold');
  assert.ok(nmPumps.duty <= nmAlert, 'Northmoor duty pump must be <= alert level');
  assert.ok(nmAlert <= nmCrest, 'Northmoor alert level must be <= spillway crest elevation');
});

// ---------------------------------------------------------------------------
// 2. Structural Taxonomy & Terminology Invariants
// ---------------------------------------------------------------------------

test('HYDRO-05: Every topology node belongs strictly to the canonical 5-class taxonomy', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);

  const CANONICAL_TAXONOMY = ['spillway', 'gauge', 'clyse_gate', 'polder_basin', 'tidal_outfall'];

  for (const node of topology.nodes) {
    assert.ok(
      CANONICAL_TAXONOMY.includes(node.node_type),
      `[RULE-TAX-05] Node ${node.id} (${node.name}) has non-canonical node_type "${node.node_type}". Must be one of: ${CANONICAL_TAXONOMY.join(', ')}`
    );
  }
});

test('HYDRO-06: Standard in-channel river gauges MUST NEVER have crest heights or overtopping status', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);

  for (const node of topology.nodes) {
    if (node.node_type === 'gauge') {
      assert.equal(
        node.crest_elevation_mAOD,
        undefined,
        `[RULE-TAX-01] Gauge node ${node.id} (${node.name}) must NOT define a crest_elevation_mAOD`
      );
      assert.ok(
        !['OVERTOPPING', 'SUBMERGED', 'REVERSE_SPILL'].includes(node.status),
        `[RULE-TAX-02] Gauge node ${node.id} (${node.name}) cannot have overtopping status "${node.status}". Overtopping is reserved for spillways.`
      );
    }
  }
});

test('HYDRO-07: Engineered spillway nodes MUST define a valid numerical crest_elevation_mAOD', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);

  for (const node of topology.nodes) {
    if (node.node_type === 'spillway') {
      assert.ok(
        typeof node.crest_elevation_mAOD === 'number' && node.crest_elevation_mAOD > 0,
        `[RULE-TAX-03] Spillway node ${node.id} (${node.name}) must define a positive numerical crest_elevation_mAOD`
      );
    }
  }
});

test('HYDRO-08: Clyse gate nodes MUST define sill_elevation_mAOD and downstream diversion targets', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);

  for (const node of topology.nodes) {
    if (node.node_type === 'clyse_gate') {
      assert.ok(
        typeof node.sill_elevation_mAOD === 'number',
        `Clyse gate node ${node.id} (${node.name}) must define a numerical sill_elevation_mAOD`
      );
      assert.ok(
        node.diverts_to_node_id,
        `Clyse gate node ${node.id} (${node.name}) must specify a diverts_to_node_id`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Downhill Hydraulic Slope Invariants (The Downhill Invariant)
// ---------------------------------------------------------------------------

test('HYDRO-09: Inland non-tidal river reaches maintain downhill hydraulic gradient in mAOD (Δh >= -0.05m)', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);
  const nodeMap = new Map(topology.nodes.map(n => [n.id, n]));

  for (const edge of topology.edges) {
    // Only check open river channel edges that are not tidal, diversion, or polder storage
    if (edge.type === 'main_river') {
      const upstream = nodeMap.get(edge.from);
      const downstream = nodeMap.get(edge.to);

      // Skip tidal reaches (e.g. West Quay Bridgwater 52124) subject to macro-tidal reverse slope during high tide
      if (downstream && (downstream.id === '52124' || downstream.node_type === 'tidal_outfall')) {
        continue;
      }

      if (upstream && downstream && upstream.stage_mAOD !== undefined && downstream.stage_mAOD !== undefined) {
        const deltaH = upstream.stage_mAOD - downstream.stage_mAOD;
        assert.ok(
          deltaH >= -0.05,
          `[RULE-SLP-02] Negative hydraulic slope detected along edge ${edge.from} (${upstream.name}) -> ${edge.to} (${downstream.name}): Δh = ${deltaH.toFixed(2)}m (upstream=${upstream.stage_mAOD}mAOD, downstream=${downstream.stage_mAOD}mAOD)`
        );
      }
    }
  }
});

test('HYDRO-10: Steep upland river reaches must exhibit strictly positive hydraulic drop (Δh > 0.50m)', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);
  const nodeMap = new Map(topology.nodes.map(n => [n.id, n]));

  const UPLAND_REACHES = [
    { from: '52108', to: '52109', name: 'Upper Tone (Greenham -> Bishops Hull)' },
    { from: '52109', to: '52111', name: 'Mid Tone (Bishops Hull -> Taunton Market)' },
    { from: '52111', to: '52162', name: 'Urban Tone (Taunton Market -> Bathpool)' },
    { from: '52116', to: '52119', name: 'Upper Parrett (Chiselborough -> Gaw Bridge)' },
    { from: '52119', to: '52233', name: 'Mid Parrett (Gaw Bridge -> Monk Leaze)' }
  ];

  for (const reach of UPLAND_REACHES) {
    const upstream = nodeMap.get(reach.from);
    const downstream = nodeMap.get(reach.to);

    assert.ok(upstream && downstream, `Reach nodes ${reach.from} and ${reach.to} must exist`);
    const deltaH = upstream.stage_mAOD - downstream.stage_mAOD;
    assert.ok(
      deltaH > 0.50,
      `[RULE-SLP-01] Upland reach "${reach.name}" drop (${deltaH.toFixed(2)}m) must be > 0.50m (upstream=${upstream.stage_mAOD}mAOD, downstream=${downstream.stage_mAOD}mAOD)`
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Flow Network Topology & Polder Decoupling
// ---------------------------------------------------------------------------

test('HYDRO-11: Tone and Parrett flow chains route continuously without disconnected cycles', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);

  const toneChain = topology.chains.find(c => c.id === 'tone');
  assert.ok(toneChain, 'Tone flow chain must exist');
  assert.deepEqual(
    toneChain.nodes,
    ["52108", "52109", "52111", "52162", "52118", "52158"],
    'Tone chain must sequence from Greenham to Baltmoor Wall / Burrowbridge Confluence (52158)'
  );

  const parrettChain = topology.chains.find(c => c.id === 'parrett');
  assert.ok(parrettChain, 'Parrett flow chain must exist');
  assert.deepEqual(
    parrettChain.nodes,
    ["52116", "52119", "52233", "52158", "52124", "52163"],
    'Parrett chain must sequence from Chiselborough to Dunball Tidal Outfall'
  );

  const tribsChain = topology.chains.find(c => c.id === 'tributaries');
  assert.ok(tribsChain, 'Tributaries chain must exist');
  assert.deepEqual(
    tribsChain.nodes,
    ["52120", "52153", "52233"],
    'Tributaries chain must sequence Yeo and Isle to Monk\'s Leaze confluence (52233)'
  );

  // [RULE-NET-01] Graph Reachability Invariant:
  // Every river headwater (Greenham, Chiselborough, Huish Episcopi, Midelney) must have an unbroken directed path in edges
  // to the Dunball Sea Outfall (52163) using main_river, tributary_inflow, and sea_outfall edges (traversable during calm baseflow).
  function canReachEstuary(startNodeId) {
    const targetOutfall = '52163';
    const visited = new Set();
    const queue = [startNodeId];

    while (queue.length > 0) {
      const curr = queue.shift();
      if (curr === targetOutfall) return true;
      visited.add(curr);

      const nextEdges = topology.edges.filter(e => 
        e.from === curr && (e.type === 'main_river' || e.type === 'tributary_inflow' || e.type === 'sea_outfall')
      );
      for (const edge of nextEdges) {
        if (!visited.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }
    return false;
  }

  assert.ok(
    canReachEstuary('52108'),
    '[RULE-NET-01] River Tone at Greenham (52108) must reach Dunball Outfall (52163) via main river channel'
  );
  assert.ok(
    canReachEstuary('52116'),
    '[RULE-NET-01] River Parrett at Chiselborough (52116) must reach Dunball Outfall (52163) via main river channel'
  );
  assert.ok(
    canReachEstuary('52120'),
    '[RULE-NET-01] River Yeo at Huish Episcopi (52120) must reach Dunball Outfall (52163) via tributary channel'
  );
  assert.ok(
    canReachEstuary('52153'),
    '[RULE-NET-01] River Isle at Midelney (52153) must reach Dunball Outfall (52163) via tributary channel'
  );
});

test('HYDRO-12: Polder storage basins receive overtopping flows exclusively from designated spillways', async () => {
  const res = await httpGet('/api/topology');
  const topology = JSON.parse(res.body);

  // Curry Moor overtopping edge: Hookbridge (52118) -> Curry Moor (52127)
  const cmEdge = topology.edges.find(e => e.to === '52127');
  assert.ok(cmEdge, 'Curry Moor (52127) must have an incoming flow edge');
  assert.equal(cmEdge.from, '52118', 'Curry Moor must receive water from Hookbridge Spillway (52118)');
  assert.equal(cmEdge.type, 'spillway_overtopping');

  // Northmoor overtopping edge: Baltmoor Wall (52158) -> Northmoor (52159)
  const nmEdge = topology.edges.find(e => e.to === '52159' && e.type === 'spillway_overtopping');
  assert.ok(nmEdge, 'Northmoor (52159) must have an incoming spillway_overtopping flow edge');
  assert.equal(nmEdge.from, '52158', 'Northmoor must receive river overtopping water from Baltmoor Wall Spillway (52158)');

  // Inter-moor cascade edge: Curry Moor (52127) -> Northmoor (52159) via Athelney Spillway (7.35m)
  const cascadeEdge = topology.edges.find(e => e.from === '52127' && e.to === '52159');
  assert.ok(cascadeEdge, 'Curry Moor (52127) must connect to Northmoor (52159) via Athelney Spillway cascade edge');
  assert.equal(cascadeEdge.type, 'polder_overflow');
});

test('HYDRO-13: Penning regimes and calm baseflow never trigger false mobile pump orders or global flood warnings', async () => {
  const { evaluateMidelney } = await import('../src/js/hydro_engine.js');
  const resCatchment = await httpGet('/api/catchments/somerset');
  const somerset = JSON.parse(resCatchment.body);

  // 1. Curry Moor mobile pump order trigger must sit well above summer penning (~4.48m AOD)
  for (const ps of somerset.moors.curry_moor.pumping_stations) {
    assert.ok(
      ps.thresholds.winter.mobile_order >= 5.50 && ps.thresholds.summer.mobile_order >= 5.50,
      `[RULE-PUMP-01] ${ps.id} mobile_order (${ps.thresholds.winter.mobile_order}m) must be >= 5.50m AOD so normal ~4.48m penning never triggers mobile pump orders`
    );
  }

  // 2. Routine baseflow penning head-lock at Midelney (<7.30m AOD) must stay severity 5 (Nominal), not severity 4 (Warning)
  const midelneyBaseflowHeadlock = evaluateMidelney(6.63, 6.73);
  assert.equal(midelneyBaseflowHeadlock.code, 'HEAD_LOCKED');
  assert.equal(
    midelneyBaseflowHeadlock.severity,
    5,
    'Routine baseflow head-lock at Midelney (<7.30m AOD) must have severity 5 so it does not trigger a false global WARNING banner'
  );

  // High water head-lock (>=7.30m AOD) must escalate to severity 4 (Warning)
  const midelneyHighWaterHeadlock = evaluateMidelney(7.45, 7.60);
  assert.equal(midelneyHighWaterHeadlock.severity, 4);
});

test('HYDRO-14: All 19 network stations define structured 4-tier threshold provenance in STATION_REGISTRY and /api/topology', async () => {
  const { STATION_REGISTRY, PROVENANCE_TIERS } = await import('../src/js/hydro_engine.js');
  const res = await httpGet('/api/topology');
  assert.equal(res.status, 200);
  const topology = JSON.parse(res.body);

  const registeredStationIds = Object.keys(STATION_REGISTRY);
  assert.equal(registeredStationIds.length, 19, 'Must register exactly 19 canonical stations');

  for (const stId of registeredStationIds) {
    const station = STATION_REGISTRY[stId];
    assert.ok(station.provenance, `Station ${stId} must define a structured provenance record`);
    assert.ok(
      station.provenance.alert,
      `Station ${stId} must define alert threshold provenance`
    );
    assert.ok(
      [1, 2, 3, 4].includes(station.provenance.alert.tier),
      `Station ${stId} alert tier must be 1, 2, 3, or 4`
    );
    assert.ok(
      typeof station.provenance.alert.authority === 'string' && station.provenance.alert.authority.length > 0,
      `Station ${stId} must cite a non-empty authoritative source`
    );

    // If spillway, must have crest provenance
    if (station.node_type === 'spillway') {
      assert.ok(station.provenance.crest, `Spillway ${stId} must define crest provenance`);
      assert.equal(station.provenance.crest.tier, 1, `Spillway ${stId} crest must be Tier 1 (Surveyed Civil Geometry)`);
    }

    // If polder basin, must have operational pump trigger provenance
    if (station.node_type === 'polder_basin') {
      assert.ok(station.provenance.operational, `Polder basin ${stId} must define operational pump trigger provenance`);
      assert.equal(station.provenance.operational.tier, 2, `Polder basin ${stId} pump triggers must be Tier 2 (Statutory / Agency Trigger Plan)`);
    }
  }

  // Check /api/topology nodes reflect provenance
  for (const node of topology.nodes) {
    assert.ok(node.provenance, `Topology node ${node.id} must deliver provenance metadata`);
    assert.ok(node.provenance.alert, `Topology node ${node.id} must deliver alert provenance metadata`);
  }
});

test('HYDRO-15: Road passability model strictly applies surveyed geodetic datum offsets (mAOD Newlyn) to raw gauge telemetry', async () => {
  const { evaluateRoadNetwork } = await import('../src/js/hydro_engine.js');

  // Huish Episcopi (52120) raw stage in mASD: 1.68m
  // Surveyed datum offset: +5.000m ODN -> Expected stage: 6.68m AOD
  const mockMeasuresBaseflow = {
    '52120-level-stage-i-15_min-mASD': [{ value: 1.68, dateTime: new Date().toISOString() }],
    '52127-level-stage-i-15_min-mAOD': [{ value: 4.48, dateTime: new Date().toISOString() }]
  };

  const resBaseflow = evaluateRoadNetwork(mockMeasuresBaseflow);
  const muchelney = resBaseflow.corridors.muchelney_access;
  const bicknells = resBaseflow.corridors.bicknells_bridge_access;

  assert.equal(muchelney.stage_mAOD, 6.68, 'Muchelney stage must convert 1.68m mASD to 6.68m AOD');
  assert.equal(muchelney.clearance_m, 1.18, 'Clearance to 7.86m crown must be 1.18m (not 6.18m)');
  assert.equal(muchelney.status, 'PASSABLE');

  assert.equal(bicknells.stage_mAOD, 6.68, 'Bicknells bridge stage must convert 1.68m mASD to 6.68m AOD');
  assert.equal(bicknells.crown_elevation_mAOD, null, '[RULE-THRESH-01] Unsurveyed Bicknells bridge must set crown_elevation_mAOD: null');
  assert.equal(bicknells.caution_elevation_mAOD, null, '[RULE-THRESH-01] Unsurveyed Bicknells bridge must set caution_elevation_mAOD: null');
  assert.equal(bicknells.clearance_m, null, '[RULE-THRESH-01] Unsurveyed Bicknells bridge must report clearance_m: null');
  assert.equal(bicknells.status, 'PASSABLE');

  // Routine winter flow on 52120 (2.12m mASD = 7.12m AOD) must NOT trigger ENCROACHING on unsurveyed Bicknells bridge
  const mockMeasuresRoutineWinter = {
    '52120-level-stage-i-15_min-mASD': [{ value: 2.12, dateTime: new Date().toISOString() }],
    '52127-level-stage-i-15_min-mAOD': [{ value: 4.48, dateTime: new Date().toISOString() }]
  };
  const resRoutineWinter = evaluateRoadNetwork(mockMeasuresRoutineWinter);
  assert.equal(resRoutineWinter.corridors.bicknells_bridge_access.stage_mAOD, 7.12);
  assert.equal(resRoutineWinter.corridors.bicknells_bridge_access.status, 'PASSABLE', '[RULE-THRESH-01] Unsurveyed bicknells_bridge_access must not trigger ENCROACHING at 7.12m AOD routine winter flow');

  // Encroachment scenario: Huish stage 2.35m mASD = 7.35m AOD (exceeds 7.30m Lawyers Mill breach)
  const mockMeasuresEncroaching = {
    '52120-level-stage-i-15_min-mASD': [{ value: 2.35, dateTime: new Date().toISOString() }],
    '52127-level-stage-i-15_min-mAOD': [{ value: 4.48, dateTime: new Date().toISOString() }]
  };
  const resEncroaching = evaluateRoadNetwork(mockMeasuresEncroaching);
  assert.equal(resEncroaching.corridors.muchelney_access.stage_mAOD, 7.35);
  assert.equal(resEncroaching.corridors.muchelney_access.status, 'ENCROACHING');

  // Impassable scenario: Huish stage 2.90m mASD = 7.90m AOD (exceeds 7.86m SRA raised crown)
  const mockMeasuresImpassable = {
    '52120-level-stage-i-15_min-mASD': [{ value: 2.90, dateTime: new Date().toISOString() }],
    '52127-level-stage-i-15_min-mAOD': [{ value: 4.48, dateTime: new Date().toISOString() }]
  };
  const resImpassable = evaluateRoadNetwork(mockMeasuresImpassable);
  assert.equal(resImpassable.corridors.muchelney_access.stage_mAOD, 7.90);
  assert.equal(resImpassable.corridors.muchelney_access.status, 'IMPASSABLE');
});

test('HYDRO-16: Monk\'s Leaze Clyse baseflow tailwater impoundment does not trigger false REVERSE_LOCK', async () => {
  const { ASSET_DEFINITIONS, evaluateAssetTransition } = await import('../src/js/hydro_engine.js');
  const sluice = ASSET_DEFINITIONS.monks_leaze_clyse;

  // Parrett baseflow (6.70m) < 7.20m diversion trigger. Sowy ponded tailwater (6.73m).
  const readings = {
    upstream: [{ dateTime: '2026-11-07T12:00:00Z', value: 6.70 }],
    downstream: [{ dateTime: '2026-11-07T12:00:00Z', value: 6.73 }]
  };

  const res = evaluateAssetTransition(sluice, null, readings);
  assert.equal(res.to_state, 'CLOSED', 'Must evaluate to CLOSED during baseflow when upstream is below diversion trigger');
  assert.equal(res.severity_tier, 1, 'Severity must be nominal (Tier 1)');
  assert.equal(res.clearance_m, 0.50, 'Clearance must report distance to 7.20m trigger (7.20 - 6.70 = 0.50m)');
  assert.equal(res.clearance_text, '50cm below diversion trigger');
  assert.ok(res.narrative.includes('routine agricultural penning'), 'Narrative must indicate penning mode');
});

test('HYDRO-17: Monk\'s Leaze Clyse evaluates true REVERSE_LOCK during high flood stage when downstream exceeds upstream by >=10cm', async () => {
  const { ASSET_DEFINITIONS, evaluateAssetTransition } = await import('../src/js/hydro_engine.js');
  const sluice = ASSET_DEFINITIONS.monks_leaze_clyse;

  // Real flood scenario: Parrett 7.30m (elevated above 7.20m trigger), Sowy 7.45m (backpressure delta >= 0.10m)
  const sampleTime = '2026-11-07T12:15:00Z';
  const readings = {
    upstream: [{ dateTime: sampleTime, value: 7.30 }],
    downstream: [{ dateTime: sampleTime, value: 7.45 }]
  };

  const res = evaluateAssetTransition(sluice, null, readings, null, { nowMs: Date.parse(sampleTime) });
  assert.equal(res.to_state, 'REVERSE_LOCK', 'Must evaluate to REVERSE_LOCK when elevated Parrett is reverse-locked by Sowy tailwater');
  assert.equal(res.severity_tier, 3, 'Severity must be elevated alert (Tier 3)');
  assert.equal(res.clearance_m, -0.15, 'Clearance must reflect reverse head delta (7.30 - 7.45 = -0.15m)');
  assert.equal(res.clearance_text, '-15cm reverse head');
});

test('HYDRO-18: Zero-variance sensor flatline detector flags static readings (>=24h / 12h) and suppresses dual-gauge alerts', async () => {
  const { evaluateStationFreshness, ASSET_DEFINITIONS, evaluateAssetTransition } = await import('../src/js/hydro_engine.js');

  const baseTime = new Date('2026-11-07T12:00:00Z').getTime();

  // Create 96 consecutive readings of identical 6.729m (24h flatline)
  const flatlineReadings = Array.from({ length: 96 }, (_, i) => ({
    value: 6.729,
    dateTime: new Date(baseTime - i * 15 * 60 * 1000).toISOString()
  }));

  const freshness = evaluateStationFreshness(flatlineReadings);
  assert.equal(freshness.isFlatlined, true, 'Must detect flatline on 96 identical readings');
  assert.equal(freshness.isFresh, false, 'Flatlined sensor must NOT be considered fresh');
  assert.equal(freshness.isStale, true, 'Flatlined sensor must be marked stale');
  assert.equal(freshness.badgeClass, 'badge-flatlined');
  assert.ok(freshness.badgeText.includes('SENSOR FLATLINED'), 'Badge text must warn of sensor flatline');

  // Verify suppression on Monk's Leaze Clyse
  const sluice = ASSET_DEFINITIONS.monks_leaze_clyse;
  const readings = {
    upstream: [{ dateTime: '2026-11-07T12:00:00Z', value: 7.25 }],
    downstream: flatlineReadings // flatlined downstream gauge
  };

  const res = evaluateAssetTransition(sluice, null, readings);
  // Upstream 7.25m is >= 7.20m trigger, but downstream is flatlined: reverse lock / throttled suppressed!
  assert.equal(res.to_state, 'DIVERTING', 'Must divert normally when downstream sensor is flatlined, suppressing false REVERSE_LOCK');
  assert.equal(res.severity_tier, 2);
});

test('HYDRO-19: Dynamic sensor readings pass freshness evaluation without flatline false alarms', async () => {
  const { evaluateStationFreshness } = await import('../src/js/hydro_engine.js');

  const nowMs = Date.now();

  // Create 96 dynamic readings spanning 9cm (6.65m to 6.74m)
  const dynamicReadings = Array.from({ length: 96 }, (_, i) => ({
    value: Number((6.65 + 0.09 * Math.sin(i / 5)).toFixed(3)),
    dateTime: new Date(nowMs - i * 15 * 60 * 1000).toISOString()
  }));

  const freshness = evaluateStationFreshness(dynamicReadings, { nowMs });
  assert.equal(freshness.isFlatlined, false, 'Dynamic readings must not trigger flatline detector');
  assert.equal(freshness.isFresh, true, 'Recent dynamic readings must be fresh');
  assert.equal(freshness.isStale, false);
  assert.equal(freshness.badgeClass, 'badge-fresh');
});

test('HYDRO-20: Declarative topology_network.json maintains 100% SSOT parity and evaluates normal, overtopping, diverting, and tide-locked regimes', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    TOPOLOGY_NETWORK_CONFIG,
    evaluateTopologyNetwork,
    resolveThresholdRef
  } = await import('../src/js/hydro_engine.js');

  const jsonPath = path.resolve('src/js/config/topology_network.json');
  assert.equal(fs.existsSync(jsonPath), true, 'src/js/config/topology_network.json must exist');
  const fileConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // 1. 100% SSOT parity between topology_network.json and TOPOLOGY_NETWORK_CONFIG
  assert.deepEqual(
    fileConfig,
    TOPOLOGY_NETWORK_CONFIG,
    '[RULE-SSOT-01] topology_network.json must match TOPOLOGY_NETWORK_CONFIG in hydro_engine.js'
  );

  // 2. Verify all symbolic threshold_ref strings resolve to finite numbers in HYDRO_THRESHOLDS
  for (const rule of Object.values(fileConfig.coupled_rules)) {
    if (rule.sill_threshold_ref) assert.equal(typeof resolveThresholdRef(rule.sill_threshold_ref), 'number');
    if (rule.min_delta_h_ref) assert.equal(typeof resolveThresholdRef(rule.min_delta_h_ref), 'number');
  }
  for (const node of fileConfig.nodes) {
    if (node.status_rule?.crest_threshold_ref) {
      assert.equal(typeof resolveThresholdRef(node.status_rule.crest_threshold_ref), 'number');
    }
    if (node.status_rule?.alert_threshold_ref) {
      assert.equal(typeof resolveThresholdRef(node.status_rule.alert_threshold_ref), 'number');
    }
  }
  for (const edge of fileConfig.edges) {
    if (edge.flow_rule?.threshold_ref) {
      assert.equal(typeof resolveThresholdRef(edge.flow_rule.threshold_ref), 'number');
    }
  }

  // 3. Evaluate normal baseflow fallback regime
  const baseEval = evaluateTopologyNetwork({}, fileConfig);
  assert.equal(baseEval.status, 'ok');
  assert.equal(baseEval.nodes.length, 19);
  assert.equal(baseEval.edges.length, 20);
  const hookBase = baseEval.nodes.find(n => n.id === '52118');
  assert.equal(hookBase.status, 'SECURE');
  assert.equal(hookBase.downstream_node_id, 'athelney_junction');
  assert.equal(hookBase.telemetry_source, 'cached_fallback');
  const monksBase = baseEval.nodes.find(n => n.id === '52233');
  assert.equal(monksBase.status, 'CLOSED');
  const dunballBase = baseEval.nodes.find(n => n.id === '52163');
  assert.equal(dunballBase.is_tide_locked, false);
  assert.equal(dunballBase.status, 'SECURE');

  // 4. Evaluate spillway overtopping & polder cascade regime
  const overtoppingMeasures = {
    '52118-level-stage-i-15_min-mAOD': [{ value: 7.50, dateTime: '2026-11-15T12:00:00Z' }],
    '52127-level-stage-i-15_min-mAOD': [{ value: 7.40, dateTime: '2026-11-15T12:00:00Z' }],
    '52158-level-stage-i-15_min-mAOD': [{ value: 7.85, dateTime: '2026-11-15T12:00:00Z' }]
  };
  const spillEval = evaluateTopologyNetwork(overtoppingMeasures, fileConfig);
  assert.equal(spillEval.nodes.find(n => n.id === '52118').status, 'OVERSPILLING');
  assert.equal(spillEval.nodes.find(n => n.id === '52118').telemetry_source, 'live');
  assert.equal(spillEval.nodes.find(n => n.id === '52158').status, 'OVERSPILLING');
  assert.equal(spillEval.edges.find(e => e.from === '52118' && e.to === '52127').flow_active, true);
  assert.equal(spillEval.edges.find(e => e.from === '52158' && e.to === '52159').flow_active, true);
  assert.equal(spillEval.edges.find(e => e.from === '52127' && e.to === '52159').flow_active, true);

  // 5. Evaluate Monk's Leaze Clyse active diversion regime
  const divertingMeasures = {
    '52233-level-stage-i-15_min-mAOD': [{ value: 7.25, dateTime: '2026-11-15T12:00:00Z' }],
    '52234-level-downstage-i-15_min-mAOD': [{ value: 6.90, dateTime: '2026-11-15T12:00:00Z' }]
  };
  const divEval = evaluateTopologyNetwork(divertingMeasures, fileConfig);
  assert.equal(divEval.nodes.find(n => n.id === '52233').status, 'DIVERTING');
  assert.equal(divEval.nodes.find(n => n.id === '52234').status, 'DIVERTING');
  assert.equal(divEval.edges.find(e => e.from === '52233' && e.to === '52234').flow_active, true);
  assert.equal(divEval.edges.find(e => e.from === '52234' && e.to === '52157').flow_active, true);
  assert.equal(divEval.edges.find(e => e.from === '52157' && e.to === 'E9531').flow_active, true);

  // 6. Evaluate Dunball tide-locked & Huish river cut-off regime
  const tideLockMeasures = {
    '52163-level-tidal_level-i-15_min-mAOD': [{ value: 4.50, dateTime: '2026-11-15T12:00:00Z' }],
    'E9094-level-stage-i-15_min-mAOD': [{ value: 2.80, dateTime: '2026-11-15T12:00:00Z' }],
    '52124-level-tidal_level-i-15_min-mAOD': [{ value: 3.90, dateTime: '2026-11-15T12:00:00Z' }],
    '52120-level-stage-i-15_min-mASD': [{ value: 3.30, dateTime: '2026-11-15T12:00:00Z' }] // +5.00m = 8.30m AOD
  };
  const tideEval = evaluateTopologyNetwork(tideLockMeasures, fileConfig);
  const seaNode = tideEval.nodes.find(n => n.id === '52163');
  const ksdNode = tideEval.nodes.find(n => n.id === 'E9094');
  const huishNode = tideEval.nodes.find(n => n.id === '52120');
  assert.equal(seaNode.is_tide_locked, true);
  assert.equal(seaNode.inland_stage_mAOD, 2.80);
  assert.equal(seaNode.status, 'SLACK_RESTRICTED');
  assert.equal(ksdNode.is_tide_locked, true);
  assert.equal(ksdNode.sea_stage_mAOD, 4.50);
  assert.equal(ksdNode.status, 'SLACK_RESTRICTED');
  assert.equal(huishNode.stage_mAOD, 8.30);
  assert.equal(huishNode.status, 'ALERT');
  assert.equal(tideEval.edges.find(e => e.from === 'E9094' && e.to === '52163').flow_active, false);
  assert.equal(tideEval.edges.find(e => e.from === '52124' && e.to === '52163').flow_active, false);
  assert.equal(tideEval.edges.find(e => e.from === '52120' && e.to === '52233').flow_active, false);
});

test('HYDRO-26: Southern & Flanking Polders First-Class Basin Modeling & Seasonal Monotonic Order (Issue #52)', async () => {
  const {
    STATION_REGISTRY,
    ASSET_DEFINITIONS,
    CANONICAL_PUMP_THRESHOLDS,
    HYDRO_THRESHOLDS,
    evaluateAssetTransition,
    evaluateAllAssets
  } = await import('../src/js/hydro_engine.js');

  // 0. Every asset's primary_station and secondary_station MUST exist in STATION_REGISTRY [RULE-SSOT-01]
  for (const [assetKey, asset] of Object.entries(ASSET_DEFINITIONS)) {
    if (asset.primary_station) {
      assert.ok(
        STATION_REGISTRY[asset.primary_station],
        `ASSET_DEFINITIONS.${assetKey}.primary_station '${asset.primary_station}' must exist in STATION_REGISTRY`
      );
    }
    if (asset.secondary_station) {
      assert.ok(
        STATION_REGISTRY[asset.secondary_station],
        `ASSET_DEFINITIONS.${assetKey}.secondary_station '${asset.secondary_station}' must exist in STATION_REGISTRY`
      );
    }
  }

  // 0b. At calm fallback_stage_mAOD across all stations, ALL 6 polders MUST evaluate strictly to STANDBY (Tier 1) [RULE-PUMP-01]
  const fallbackReadingsMap = {};
  for (const [stationId, station] of Object.entries(STATION_REGISTRY)) {
    fallbackReadingsMap[stationId] = [{ value: station.fallback_stage_mAOD, dateTime: '2026-11-15T12:00:00Z' }];
  }
  const allPolderKeys = ['curry_moor', 'northmoor', 'wet_moor', 'west_sedgemoor', 'stanmoor', 'westonzoyland'];
  for (const isSummer of [false, true]) {
    const evaluated = evaluateAllAssets(fallbackReadingsMap, { isSummer });
    for (const pKey of allPolderKeys) {
      assert.ok(evaluated[pKey], `evaluateAllAssets must return evaluation for ${pKey}`);
      assert.equal(
        evaluated[pKey].status,
        'STANDBY',
        `Polder '${pKey}' must evaluate to STANDBY at calm fallback stage in ${isSummer ? 'summer' : 'winter'} (got ${evaluated[pKey].status})`
      );
      assert.equal(
        evaluated[pKey].severity_tier,
        1,
        `Polder '${pKey}' must have severity_tier === 1 at calm fallback stage in ${isSummer ? 'summer' : 'winter'}`
      );
    }
  }

  const polderKeys = ['wet_moor', 'west_sedgemoor', 'stanmoor', 'westonzoyland'];

  // 1. First-class polder asset verification & [RULE-THRESH-01] provenance gate
  for (const key of polderKeys) {
    const polder = ASSET_DEFINITIONS[key];
    assert.ok(polder, `ASSET_DEFINITIONS must define ${key}`);
    assert.equal(polder.asset_type, 'polder', `${key} must have asset_type: 'polder' [RULE-ENT-01]`);
    assert.equal(polder.asset_id, key, `${key} must have matching asset_id`);
    assert.equal(typeof polder.name, 'string');
    assert.equal(typeof polder.floor_elevation_mAOD, 'number');
    assert.equal(typeof polder.deadband_pump, 'number');

    if (polder.survey_tier === 'UNSURVEYED') {
      // Unsurveyed polders (west_sedgemoor, westonzoyland) must have null pump triggers and never trigger automated alerts
      assert.equal(polder.primary_station, null, `${key}: unsurveyed polder must have primary_station: null`);
      assert.equal(polder.lead_pump_winter_mAOD, null);
      assert.equal(polder.lead_pump_summer_mAOD, null);
      assert.equal(polder.duty_pump_winter_mAOD, null);
      assert.equal(polder.duty_pump_summer_mAOD, null);
      assert.equal(polder.mobile_ordered_mAOD, null);
      assert.equal(polder.mobile_active_mAOD, null);
      assert.equal(polder.critical_mAOD, null);
      assert.equal(polder.rapid_inrush_threshold_mh, null);
    } else {
      // Surveyed / Trigger Plan polders (stanmoor, wet_moor) must obey seasonal monotonic progression on fixed pump triggers
      assert.equal(typeof polder.lead_pump_winter_mAOD, 'number');
      assert.equal(typeof polder.lead_pump_summer_mAOD, 'number');
      assert.equal(typeof polder.duty_pump_winter_mAOD, 'number');
      assert.equal(typeof polder.duty_pump_summer_mAOD, 'number');
      assert.ok(
        polder.floor_elevation_mAOD < polder.lead_pump_winter_mAOD,
        `${key}: floor < winter lead pump trigger`
      );
      assert.ok(
        polder.lead_pump_winter_mAOD <= polder.duty_pump_winter_mAOD,
        `${key}: winter lead <= winter duty trigger`
      );
      assert.ok(
        polder.lead_pump_summer_mAOD <= polder.duty_pump_summer_mAOD,
        `${key}: summer lead <= summer duty trigger`
      );
      assert.ok(
        polder.lead_pump_winter_mAOD <= polder.lead_pump_summer_mAOD,
        `${key}: winter lead <= summer lead (penning storage)`
      );
      assert.ok(
        polder.duty_pump_winter_mAOD <= polder.duty_pump_summer_mAOD,
        `${key}: winter duty <= summer duty`
      );
      if (typeof polder.mobile_ordered_mAOD === 'number') {
        assert.ok(
          polder.duty_pump_summer_mAOD < polder.mobile_ordered_mAOD,
          `${key}: summer duty < mobile ordered trigger`
        );
        assert.ok(
          polder.mobile_ordered_mAOD <= polder.mobile_active_mAOD,
          `${key}: mobile ordered <= mobile active trigger`
        );
        assert.ok(
          polder.mobile_active_mAOD <= polder.critical_mAOD,
          `${key}: mobile active <= critical storage trigger`
        );
      }
    }
  }

  // 2. Wet Moor decoupled from River Yeo 52120 (no automated DUTY_PUMPING from receiving river baseflow)
  const wm = ASSET_DEFINITIONS.wet_moor;
  assert.equal(wm.primary_station, null, 'Wet Moor must be decoupled from receiving River Yeo gauge 52120');
  assert.equal(wm.receiving_river_station, '52120');
  assert.equal(wm.secondary_river_station, '52153');
  assert.equal(wm.survey_tier, 'UNSURVEYED');
  assert.equal(wm.lead_pump_winter_mAOD, null);
  assert.equal(wm.duty_pump_winter_mAOD, null);
  assert.equal(wm.lead_pump_summer_mAOD, null);
  assert.equal(wm.duty_pump_summer_mAOD, null);
  assert.equal(wm.mobile_ordered_mAOD, null, 'Wet Moor must not repurpose Muchelney 7.30m road breach as mobile_ordered_mAOD');
  assert.equal(wm.mobile_active_mAOD, null, 'Wet Moor must not repurpose Muchelney 7.86m road crown as mobile_active_mAOD');
  assert.equal(wm.critical_mAOD, null, 'Wet Moor must not repurpose 8.20m river cut-off as polder critical_mAOD');
  const wmReadings = [{ value: 6.80, dateTime: '2026-11-15T12:00:00Z' }];
  const wmWinter = evaluateAssetTransition(wm, null, wmReadings, { isSummer: false });
  assert.equal(wmWinter.to_state, 'STANDBY', '[RULE-THRESH-01] Wet Moor must remain STANDBY at 6.80m River Yeo winter baseflow');
  assert.equal(wmWinter.severity_tier, 1);
  assert.equal(wmWinter.action, 'NONE');
  const wmSummer = evaluateAssetTransition(wm, null, wmReadings, { isSummer: true });
  assert.equal(wmSummer.to_state, 'STANDBY');
  const wmHigh = evaluateAssetTransition(wm, null, [{ value: 7.90, dateTime: '2026-11-15T12:00:00Z' }], { isSummer: false });
  assert.equal(wmHigh.to_state, 'STANDBY');

  // 3. West Sedgemoor decoupled from River Parrett 52233 (no automated alerts until 52155 sump thresholds verified)
  const ws = ASSET_DEFINITIONS.west_sedgemoor;
  assert.equal(ws.primary_station, null, 'west_sedgemoor must be decoupled from River Parrett 52233');
  assert.equal(ws.sump_measure_id, '52155-level-sump_level-i-15_min-mAOD');
  const wsSurgeReadings = [
    { value: 7.45, dateTime: '2026-11-15T12:00:00Z' },
    { value: 7.15, dateTime: '2026-11-15T11:00:00Z' }
  ];
  const wsTransition = evaluateAssetTransition(ws, null, wsSurgeReadings, { isSummer: false });
  assert.equal(wsTransition.to_state, 'STANDBY', 'west_sedgemoor must remain STANDBY and never trigger POLDER_INRUSH or MOBILE_ORDERED from Parrett stage');
  assert.equal(wsTransition.severity_tier, 1);
  assert.equal(wsTransition.regime_signature, null);

  // 4. Stanmoor seasonal pump inference (verified EA Trigger Point Plan on 52127)
  const sm = ASSET_DEFINITIONS.stanmoor;
  const smReadings = [{ value: 4.60, dateTime: '2026-11-15T12:00:00Z' }];
  const smWinter = evaluateAssetTransition(sm, null, smReadings, { isSummer: false });
  assert.equal(smWinter.to_state, 'DUTY_PUMPING', 'Stanmoor 4.60m is DUTY_PUMPING in winter (>= 4.55m)');
  const smSummer = evaluateAssetTransition(sm, null, smReadings, { isSummer: true });
  assert.equal(smSummer.to_state, 'STANDBY', 'Stanmoor 4.60m is STANDBY under summer penning (< 4.90m)');

  // 5. Westonzoyland unsurveyed protection (no unverified +0.05m offsets on 52159)
  const wz = ASSET_DEFINITIONS.westonzoyland;
  assert.equal(wz.primary_station, null, 'westonzoyland must not drive automated alerts from unverified 52159 offsets');
  const wzReadings = [{ value: 5.00, dateTime: '2026-11-15T12:00:00Z' }];
  const wzWinter = evaluateAssetTransition(wz, null, wzReadings, { isSummer: false });
  assert.equal(wzWinter.to_state, 'STANDBY', 'Unsurveyed Westonzoyland must remain STANDBY without automated alerts');
  assert.equal(wzWinter.severity_tier, 1);

  // 6. Parity with CANONICAL_PUMP_THRESHOLDS and HYDRO_THRESHOLDS
  assert.equal(sm.lead_pump_winter_mAOD, CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.winter.lead);
  assert.equal(sm.duty_pump_winter_mAOD, CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.winter.duty);
  assert.equal(sm.lead_pump_summer_mAOD, CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.summer.lead);
  assert.equal(sm.duty_pump_summer_mAOD, CANONICAL_PUMP_THRESHOLDS.stanmoor_ps.summer.duty);

  assert.equal(CANONICAL_PUMP_THRESHOLDS.huish_episcopi_ps, undefined, 'Unsurveyed huish_episcopi_ps polder drain triggers must not appear in CANONICAL_PUMP_THRESHOLDS');
  assert.equal(CANONICAL_PUMP_THRESHOLDS.west_sedgemoor_ps, undefined, 'Unsurveyed west_sedgemoor_ps must not appear in CANONICAL_PUMP_THRESHOLDS');
  assert.equal(CANONICAL_PUMP_THRESHOLDS.westonzoyland_ps, undefined, 'Unsurveyed westonzoyland_ps must not appear in CANONICAL_PUMP_THRESHOLDS');

  assert.equal(wm.floor_elevation_mAOD, HYDRO_THRESHOLDS.WET_MOOR.GROUND_MAOD);
  assert.equal(sm.floor_elevation_mAOD, HYDRO_THRESHOLDS.STANMOOR.GROUND_MAOD);
  assert.equal(ws.floor_elevation_mAOD, HYDRO_THRESHOLDS.WEST_SEDGEMOOR.GROUND_MAOD);
  assert.equal(wz.floor_elevation_mAOD, HYDRO_THRESHOLDS.WESTONZOYLAND.GROUND_MAOD);

  // 7. HYDRO_THRESHOLDS.HUISH_EPISCOPI / 52120, somerset.json langport_confluence.huish_episcopi_ps,
  // and app.js getPumpEvaluation unloaded hydroConfig regression gate [RULE-SSOT-01, RULE-THRESH-01]
  assert.equal(HYDRO_THRESHOLDS.HUISH_EPISCOPI.LEAD_PUMP_WINTER, null);
  assert.equal(HYDRO_THRESHOLDS.HUISH_EPISCOPI.DUTY_PUMP_WINTER, null);
  assert.equal(HYDRO_THRESHOLDS.HUISH_EPISCOPI.LEAD_PUMP_SUMMER, null);
  assert.equal(HYDRO_THRESHOLDS.HUISH_EPISCOPI.DUTY_PUMP_SUMMER, null);
  assert.equal(HYDRO_THRESHOLDS.HUISH_EPISCOPI.RIVER_CUTOFF_MAOD, 8.20);
  assert.equal(HYDRO_THRESHOLDS.HUISH_EPISCOPI.ALERT_MAOD, 8.48);
  assert.equal(HYDRO_THRESHOLDS['52120'].LEAD_PUMP_WINTER, null);
  assert.equal(HYDRO_THRESHOLDS['52120'].DUTY_PUMP_WINTER, null);
  assert.equal(HYDRO_THRESHOLDS['52120'].LEAD_PUMP_SUMMER, null);
  assert.equal(HYDRO_THRESHOLDS['52120'].DUTY_PUMP_SUMMER, null);

  const fs = await import('node:fs');
  const path = await import('node:path');
  const somersetCfg = JSON.parse(fs.readFileSync(path.resolve('src/js/config/catchments/somerset.json'), 'utf8'));
  const langportHuish = somersetCfg.moors.langport_confluence.huish_episcopi_ps;
  assert.equal(langportHuish.survey_status, 'UNSURVEYED');
  assert.equal(langportHuish.thresholds.winter.lead, null);
  assert.equal(langportHuish.thresholds.winter.duty, null);
  assert.equal(langportHuish.thresholds.winter.river_cutoff, 8.20);
  assert.equal(langportHuish.thresholds.winter.alert_level, 8.48);
  assert.equal(langportHuish.thresholds.summer.lead, null);
  assert.equal(langportHuish.thresholds.summer.duty, null);
  assert.equal(langportHuish.thresholds.summer.river_cutoff, 8.20);
  assert.equal(langportHuish.thresholds.summer.alert_level, 8.48);

  const { getPumpEvaluation, renderPumpTriggerGauge } = await import('../src/js/app.js');
  // Unloaded hydroConfig (null) at calm 6.68m River Yeo baseflow MUST NEVER fall back to currymoor_ps (stage 3)
  const unloadedCalm = getPumpEvaluation('huish_episcopi_ps', 6.68, 'langport_confluence', 'Huish Episcopi PS', 4, null);
  assert.equal(unloadedCalm.stage, 0, 'Unloaded hydroConfig at 6.68m baseflow must evaluate stage: 0 (never currymoor_ps stage: 3)');
  assert.equal(unloadedCalm.mode, 'STANDBY');
  assert.equal(unloadedCalm.isPumpsCutoff, false);
  assert.equal(unloadedCalm.thresholds, null);
  assert.equal(renderPumpTriggerGauge(unloadedCalm), '');

  // Loaded hydroConfig at calm 6.68m and 7.35m must also remain stage: 0 (STANDBY) until 8.20m river cut-off
  const loadedCalm = getPumpEvaluation('huish_episcopi_ps', 6.68, 'langport_confluence', 'Huish Episcopi PS', 4, somersetCfg);
  assert.equal(loadedCalm.stage, 0);
  assert.equal(loadedCalm.mode, 'STANDBY');
  assert.equal(loadedCalm.isPumpsCutoff, false);

  const loadedCutoff = getPumpEvaluation('huish_episcopi_ps', 8.25, 'langport_confluence', 'Huish Episcopi PS', 4, somersetCfg);
  assert.equal(loadedCutoff.stage, 0);
  assert.equal(loadedCutoff.mode, 'CUT_OFF');
  assert.equal(loadedCutoff.isPumpsCutoff, true);
});

test('HYDRO-27: [RULE-THRESH-01] Threshold Provenance, Physical Operating Hierarchy, Baseflow Separation & Anti-Laundering Gate', async () => {
  const {
    STATION_REGISTRY,
    ASSET_DEFINITIONS,
    evaluateAllAssets
  } = await import('../src/js/hydro_engine.js');
  const { CAMERA_CATALOG } = await import('../src/js/api/camera_buffer.js');
  const { CAMERA_FIELD_GUIDES } = await import('../src/js/camera_guide.js');

  // 1. Canonical Fallback Stage Lock (Anti-Tampering Gate):
  // Agents are strictly forbidden from mutating fallback_stage_mAOD (e.g. lowering 52233 from 6.73 to 6.45)
  // to hide a collision with a newly proposed threshold.
  const PINNED_CALM_FALLBACKS = {
    '52108': 76.14,
    '52109': 16.93,
    '52111': 13.12,
    '52162': 7.54,
    '52118': 4.50,
    '52127': 4.47,
    '52116': 20.75,
    '52119': 10.42,
    '52120': 6.68,
    '52153': 6.63,
    '52233': 6.73,
    '52158': 3.78,
    '52159': 3.17,
    '52124': 3.10,
    '52163': 0.84,
    '52234': 6.72,
    '52157': 3.92,
    'E9531': 3.20,
    'E9094': 2.62
  };
  for (const [stId, expectedFallback] of Object.entries(PINNED_CALM_FALLBACKS)) {
    assert.equal(
      STATION_REGISTRY[stId]?.fallback_stage_mAOD,
      expectedFallback,
      `[RULE-THRESH-01] Station ${stId} fallback_stage_mAOD (${STATION_REGISTRY[stId]?.fallback_stage_mAOD}m) must match pinned baseline (${expectedFallback}m); never mutate fallbacks to dodge threshold collisions`
    );
  }

  // 2. Universal Calm State Invariant Across ALL Asset Classes:
  // At calm fallback_stage_mAOD across all 19 stations, EVERY asset in ASSET_DEFINITIONS must evaluate to Severity Tier 1.
  const fallbackReadingsMap = {};
  for (const [stationId, station] of Object.entries(STATION_REGISTRY)) {
    fallbackReadingsMap[stationId] = [{ value: station.fallback_stage_mAOD, dateTime: '2026-11-15T12:00:00Z' }];
  }
  const NOMINAL_STATES_BY_TYPE = {
    road: 'PASSABLE',
    spillway: 'SECURE',
    polder: 'STANDBY',
    tidal_gate: 'DISCHARGING',
    sluice: 'CLOSED',
    gauge: 'NORMAL'
  };
  for (const isSummer of [false, true]) {
    const evaluated = evaluateAllAssets(fallbackReadingsMap, { isSummer });
    for (const [assetKey, assetEval] of Object.entries(evaluated)) {
      const expectedNominal = NOMINAL_STATES_BY_TYPE[assetEval.asset_type];
      assert.equal(
        assetEval.status,
        expectedNominal,
        `[RULE-THRESH-01] Asset '${assetKey}' (${assetEval.asset_type}) must evaluate to '${expectedNominal}' at calm fallback stage in ${isSummer ? 'summer' : 'winter'} (got '${assetEval.status}')`
      );
      assert.equal(
        assetEval.severity_tier,
        1,
        `[RULE-THRESH-01] Asset '${assetKey}' must have severity_tier === 1 at calm fallback stage in ${isSummer ? 'summer' : 'winter'} (got ${assetEval.severity_tier})`
      );
    }
  }

  // 3. Spillway Baseflow Separation & typicalRange Envelope Gate:
  const sluicesByStation = {};
  for (const asset of Object.values(ASSET_DEFINITIONS)) {
    if (asset.asset_type === 'sluice' && asset.upstream_station) {
      sluicesByStation[asset.upstream_station] = asset;
    }
  }

  for (const [assetKey, asset] of Object.entries(ASSET_DEFINITIONS)) {
    if (asset.asset_type === 'spillway' && typeof asset.crest_elevation_mAOD === 'number') {
      const stId = asset.primary_station;
      const stReg = STATION_REGISTRY[stId];
      const stCal = EA_STATION_CALIBRATIONS[stId];
      assert.ok(stReg && stCal, `Spillway '${assetKey}' primary_station '${stId}' must exist in registry and calibrations`);

      assert.ok(
        asset.crest_elevation_mAOD >= stReg.fallback_stage_mAOD + 0.50,
        `[RULE-THRESH-01] Spillway '${assetKey}' crest (${asset.crest_elevation_mAOD}m) must sit >= 0.50m above station ${stId} calm fallback (${stReg.fallback_stage_mAOD}m)`
      );

      const midTypical = (stCal.typLow + stCal.typHigh) / 2;
      assert.ok(
        asset.crest_elevation_mAOD > midTypical,
        `[RULE-THRESH-01] Spillway '${assetKey}' crest (${asset.crest_elevation_mAOD}m) must exceed midpoint of typicalRange [${stCal.typLow}m, ${stCal.typHigh}m] (${midTypical.toFixed(2)}m)`
      );

      // 4. Shared-Reach Sluice vs. Spillway Physical Operating Hierarchy:
      const coLocatedSluice = sluicesByStation[stId];
      if (coLocatedSluice && typeof coLocatedSluice.trigger_elevation_mAOD === 'number') {
        assert.ok(
          asset.crest_elevation_mAOD > coLocatedSluice.trigger_elevation_mAOD,
          `[RULE-THRESH-01] Emergency spillway '${assetKey}' crest (${asset.crest_elevation_mAOD}m) must exceed co-located controlled sluice '${coLocatedSluice.asset_id}' diversion trigger (${coLocatedSluice.trigger_elevation_mAOD}m)`
        );
      }
    }

    // 3b. Road Corridor Invariants:
    if (asset.asset_type === 'road') {
      const stId = asset.primary_station;
      const stReg = STATION_REGISTRY[stId];
      assert.ok(stReg, `Road '${assetKey}' primary_station '${stId}' must exist in STATION_REGISTRY`);
      if (asset.survey_tier === 'UNSURVEYED') {
        assert.equal(
          asset.crown_elevation_mAOD,
          null,
          `[RULE-THRESH-01] Unsurveyed road '${assetKey}' must set crown_elevation_mAOD: null`
        );
        assert.equal(
          asset.caution_elevation_mAOD,
          null,
          `[RULE-THRESH-01] Unsurveyed road '${assetKey}' must set caution_elevation_mAOD: null`
        );
      } else {
        assert.ok(
          typeof asset.crown_elevation_mAOD === 'number',
          `[RULE-THRESH-01] Road '${assetKey}' must define numerical crown_elevation_mAOD`
        );
        assert.ok(
          typeof asset.caution_elevation_mAOD === 'number',
          `[RULE-THRESH-01] Road '${assetKey}' must define numerical caution_elevation_mAOD`
        );
        assert.ok(
          Number((asset.caution_elevation_mAOD - stReg.fallback_stage_mAOD).toFixed(3)) >= 0.15,
          `[RULE-THRESH-01] Road '${assetKey}' caution stage (${asset.caution_elevation_mAOD}m) must sit >= 0.15m above station ${stId} calm fallback (${stReg.fallback_stage_mAOD}m)`
        );
        assert.ok(
          Number((asset.crown_elevation_mAOD - asset.caution_elevation_mAOD).toFixed(3)) >= 0.15,
          `[RULE-THRESH-01] Road '${assetKey}' crown stage (${asset.crown_elevation_mAOD}m) must sit >= 0.15m above caution stage (${asset.caution_elevation_mAOD}m)`
        );
      }
    }

    // 3c. Sluice Gate Invariants:
    if (asset.asset_type === 'sluice') {
      const upStId = asset.upstream_station;
      const downStId = asset.downstream_station;
      const upReg = STATION_REGISTRY[upStId];
      const downReg = STATION_REGISTRY[downStId];
      assert.ok(upReg && downReg, `Sluice '${assetKey}' upstream/downstream stations must exist in registry`);
      assert.ok(
        asset.sill_elevation_mAOD <= upReg.fallback_stage_mAOD,
        `[RULE-THRESH-01] Sluice '${assetKey}' sill (${asset.sill_elevation_mAOD}m) must sit at or below upstream fallback stage (${upReg.fallback_stage_mAOD}m)`
      );
      assert.ok(
        asset.trigger_elevation_mAOD > upReg.fallback_stage_mAOD,
        `[RULE-THRESH-01] Sluice '${assetKey}' diversion trigger (${asset.trigger_elevation_mAOD}m) must sit strictly above upstream fallback stage (${upReg.fallback_stage_mAOD}m)`
      );
      assert.ok(
        asset.sowy_capacity_mAOD > asset.trigger_elevation_mAOD,
        `[RULE-THRESH-01] Sluice '${assetKey}' downstream capacity cap (${asset.sowy_capacity_mAOD}m) must sit above diversion trigger (${asset.trigger_elevation_mAOD}m)`
      );
    }

    // 3d. Tidal Gate Invariants:
    if (asset.asset_type === 'tidal_gate') {
      const inlandStId = asset.inland_station;
      const inlandReg = STATION_REGISTRY[inlandStId];
      assert.ok(inlandReg, `Tidal gate '${assetKey}' inland station '${inlandStId}' must exist in registry`);
      assert.ok(
        asset.elevated_inland_mAOD > inlandReg.fallback_stage_mAOD,
        `[RULE-THRESH-01] Tidal gate '${assetKey}' elevated inland trigger (${asset.elevated_inland_mAOD}m) must sit above inland calm fallback (${inlandReg.fallback_stage_mAOD}m)`
      );
    }

    // 3e. In-Channel River Gauge Invariants:
    if (asset.asset_type === 'gauge') {
      const stId = asset.station_id || asset.asset_id;
      const stReg = STATION_REGISTRY[stId];
      const stCal = EA_STATION_CALIBRATIONS[stId];
      assert.ok(stReg && stCal, `Gauge '${assetKey}' station '${stId}' must exist in registry and calibrations`);
      assert.ok(
        asset.alert_elevation_mAOD > stReg.fallback_stage_mAOD,
        `[RULE-THRESH-01] Gauge '${assetKey}' alert level (${asset.alert_elevation_mAOD}m) must sit above calm fallback (${stReg.fallback_stage_mAOD}m)`
      );
      assert.ok(
        asset.alert_elevation_mAOD <= stCal.maxOnRecord,
        `[RULE-THRESH-01] Gauge '${assetKey}' alert level (${asset.alert_elevation_mAOD}m) must not exceed station maxOnRecord (${stCal.maxOnRecord}m)`
      );
    }
  }

  // 5. Anti-Laundering String Audit (Allermoor 6.73m AOD Hallucination Guard):
  const allermoorCam = CAMERA_CATALOG.find(c => c.id === 'allermoor_spillway');
  assert.ok(allermoorCam, 'allermoor_spillway camera must exist in CAMERA_CATALOG');
  assert.ok(
    !allermoorCam.description.includes('6.73') && !allermoorCam.lookFor.includes('6.73'),
    '[RULE-THRESH-01] allermoor_spillway camera metadata must not launder 52233 fallback stage (6.73m) as a surveyed weir crest'
  );
  const monksGuideStr = JSON.stringify(CAMERA_FIELD_GUIDES.monksleaze || {});
  assert.ok(
    !monksGuideStr.includes('6.73'),
    '[RULE-THRESH-01] CAMERA_FIELD_GUIDES.monksleaze must not launder 52233 fallback stage (6.73m) as a surveyed weir crest'
  );
});

test('HYDRO-28: Sowy / KSD Control Chain Refinement (Allermoor Spillway, Oath Lock, Beer Wall Tilting Weirs & Beazeley Spillway) (Issue #53)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    STATION_REGISTRY,
    HYDRO_THRESHOLDS,
    TOPOLOGY_NETWORK_CONFIG,
    ASSET_DEFINITIONS,
    evaluateSowyChannel,
    evaluateOathLock,
    evaluateBeerWall,
    evaluateAssetTransition,
    evaluateTopologyNetwork
  } = await import('../src/js/hydro_engine.js');
  const { CAMERA_FIELD_GUIDES } = await import('../src/js/camera_guide.js');
  const { resolveCandidateCamerasForAsset } = await import('../src/js/event_camera_correlator.js');

  // 1. Config SSOT Parity & [RULE-CALC-01] Cumecs Purge
  const somersetJson = JSON.parse(fs.readFileSync(path.resolve('src/js/config/catchments/somerset.json'), 'utf8'));
  const hydroConfigJson = JSON.parse(fs.readFileSync(path.resolve('src/js/config/hydro_config.json'), 'utf8'));
  assert.deepEqual(somersetJson, hydroConfigJson, '[RULE-SSOT-01] somerset.json and hydro_config.json must be 100% identical');

  const sowyCfg = somersetJson.moors.sowy_channel;
  assert.ok(sowyCfg, 'sowy_channel must exist in catchment config');
  assert.equal(
    JSON.stringify(sowyCfg).includes('max_flow_m3s'),
    false,
    '[RULE-CALC-01] sowy_channel must not contain speculative max_flow_m3s cumecs property'
  );
  assert.equal(sowyCfg.measures.beerwall, '52157-level-stage-i-15_min-mAOD');
  assert.equal(sowyCfg.measures.bradney, 'E9531-level-stage-i-15_min-mAOD');
  assert.equal(sowyCfg.sluices[0].sill_elevation_mAOD, 4.20);
  assert.equal(sowyCfg.sluices[0].structure_height_mAOD, 6.70);
  assert.equal(sowyCfg.sluices[0].diversion_threshold_mAOD, 7.20);
  assert.equal(sowyCfg.sluices[0].sowy_capacity_mAOD, 7.60);
  assert.equal(sowyCfg.allermoor_spillway.baseline_crest_mAOD, null, '[RULE-THRESH-01] Unsurveyed Allermoor Spillway baseline_crest_mAOD must be null in catchment config');
  assert.equal(sowyCfg.allermoor_spillway.pre_overtopping_alert_mAOD, null);
  assert.equal(sowyCfg.allermoor_spillway.proxy_trigger_mAOD, 7.50);
  assert.equal(sowyCfg.allermoor_spillway.survey_status, 'UNSURVEYED');
  assert.equal(sowyCfg.allermoor_spillway.curtails_tributary_pumps, true);
  assert.ok(
    sowyCfg.allermoor_spillway.notes.includes("Beasley's Spillway") && sowyCfg.allermoor_spillway.notes.includes("not published"),
    'sowy_channel.allermoor_spillway.notes must state the Beasley\'s Spillway 7.50m proxy and that Allermoor\'s own crest level is not published'
  );
  assert.equal(sowyCfg.beer_wall_intake.ksd_conveyance_threshold_mAOD, 6.00);
  assert.equal(sowyCfg.beer_wall_intake.relief_crest_mAOD, 7.30);
  assert.equal(sowyCfg.beazeley_spillway.baseline_crest_mAOD, null, '[RULE-THRESH-01] Unsurveyed Beazeley Spillway baseline_crest_mAOD must be null in catchment config');
  assert.equal(sowyCfg.beazeley_spillway.survey_status, 'UNSURVEYED');

  // 1b. ASSET_DEFINITIONS.allermoor_spillway verification ([RULE-THRESH-01]: unsurveyed crest_elevation_mAOD: null)
  const allermoorDef = ASSET_DEFINITIONS.allermoor_spillway;
  assert.ok(allermoorDef, 'ASSET_DEFINITIONS must define allermoor_spillway');
  assert.equal(allermoorDef.asset_type, 'spillway');
  assert.equal(allermoorDef.primary_station, '52233');
  assert.equal(allermoorDef.crest_elevation_mAOD, null, '[RULE-THRESH-01] Unsurveyed Allermoor Spillway must set crest_elevation_mAOD: null');
  assert.equal(allermoorDef.pre_spill_elevation_mAOD, null);
  assert.equal(allermoorDef.proxy_trigger_mAOD, 7.50);
  assert.equal(allermoorDef.survey_tier, 'UNSURVEYED');
  assert.ok(
    allermoorDef.survey_tooltip.includes("Beasley's Spillway") && allermoorDef.survey_tooltip.includes("not published"),
    'allermoor_spillway.survey_tooltip must honestly state the Beasley\'s Spillway 7.50m proxy and that Allermoor\'s own crest level is not published'
  );
  // Automated OVERTOPPING event generation must be disabled for unsurveyed Allermoor Spillway
  const allermoorTransition = evaluateAssetTransition(allermoorDef, null, [{ value: 7.80, dateTime: '2026-11-15T12:00:00Z' }]);
  assert.equal(allermoorTransition.to_state, 'SECURE', '[RULE-THRESH-01] Unsurveyed allermoor_spillway must never generate automated OVERTOPPING events');
  assert.equal(allermoorTransition.severity_tier, 1);
  assert.equal(allermoorTransition.action, 'NONE');

  // 1c. STATION_REGISTRY['52157'].provenance.crest must cite surveyed Beer Wall Box Culverts without bundling unsurveyed Beazeley Spillway into Tier 1
  assert.ok(
    !STATION_REGISTRY['52157'].provenance.crest.authority.includes('Beazeley'),
    '[RULE-THRESH-01] STATION_REGISTRY[52157].provenance.crest (Tier 1) must not bundle unsurveyed Beazeley Spillway into Tier 1 surveyed geometry'
  );

  // 2. Coupled rule monks_leaze_diverting uses MONKS_LEAZE.TRIGGER_MAOD (7.20m), NOT SILL_MAOD (4.20m)
  assert.equal(
    TOPOLOGY_NETWORK_CONFIG.coupled_rules.monks_leaze_diverting.sill_threshold_ref,
    'MONKS_LEAZE.TRIGGER_MAOD',
    'monks_leaze_diverting coupled_rule must reference MONKS_LEAZE.TRIGGER_MAOD (7.20m)'
  );
  // At 6.80m upstream (> 4.20m sill, < 7.20m trigger) and 6.50m downstream, 52233 must remain CLOSED
  const penningEval = evaluateTopologyNetwork({
    '52233-level-stage-i-15_min-mAOD': [{ value: 6.80, dateTime: '2026-11-15T12:00:00Z' }],
    '52234-level-downstage-i-15_min-mAOD': [{ value: 6.50, dateTime: '2026-11-15T12:00:00Z' }]
  });
  assert.equal(penningEval.nodes.find(n => n.id === '52233').status, 'CLOSED', '52233 must remain CLOSED at 6.80m (< 7.20m trigger)');
  assert.equal(penningEval.edges.find(e => e.from === '52233' && e.to === '52234').flow_active, false);

  // 3. evaluateSowyChannel default 7.20m trigger, unsurveyed Allermoor Spillway & flatline wave verification
  const sowyCalm = evaluateSowyChannel(6.73, 6.72);
  assert.equal(sowyCalm.code, 'CLOSED', 'evaluateSowyChannel must default to 7.20m trigger and return CLOSED at 6.73m calm stage');
  assert.equal(sowyCalm.status, 'CLOSED');
  assert.equal(sowyCalm.allermoor_spillway.status, 'SECURE');
  assert.equal(sowyCalm.allermoor_spillway.crest_elevation_mAOD, null);
  assert.equal(sowyCalm.allermoor_spillway.survey_tier, 'UNSURVEYED');
  assert.equal(sowyCalm.allermoor_spillway.clearance_m, null);

  const sowyOvertopAllermoor = evaluateSowyChannel(7.52, 7.10);
  assert.equal(sowyOvertopAllermoor.allermoor_spillway.status, 'SECURE');
  assert.equal(sowyOvertopAllermoor.allermoor_spillway.crest_elevation_mAOD, null);
  assert.ok(sowyOvertopAllermoor.narrative.includes("Beasley's Spillway guidance proxy"));
  assert.ok(sowyOvertopAllermoor.narrative.includes('curtailed'));

  const sowyFlatlineDivert = evaluateSowyChannel(7.25, 6.72, 7.20, {
    isDownstreamFlatlined: true,
    beerwallRate1h: 0.04,
    beerwallStage: 4.35
  });
  assert.equal(sowyFlatlineDivert.code, 'GRAVITY_OPEN');
  assert.equal(sowyFlatlineDivert.isWaveConfirmed, true);
  assert.ok(sowyFlatlineDivert.narrative.includes('Beer Wall 52157'));

  // 4. evaluateOathLock & evaluateBeerWall canonical [RULE-ENT-01] properties
  const oathPen = evaluateOathLock(6.80, 6.40);
  assert.equal(oathPen.asset_type, 'sluice');
  assert.equal(oathPen.asset_id, 'oath_lock_sluice');
  assert.equal(oathPen.status, 'CLOSED');
  assert.ok(oathPen.narrative.includes('Inferred'));

  const bwWeirs = evaluateBeerWall(6.25, 7.30);
  assert.equal(bwWeirs.asset_type, 'spillway');
  assert.equal(bwWeirs.asset_id, 'beer_wall');
  assert.equal(bwWeirs.status, 'SECURE');
  assert.equal(bwWeirs.isTiltingWeirsActive, true);
  assert.equal(bwWeirs.beazeley_spillway.asset_id, 'beazeley_spillway');
  assert.equal(bwWeirs.beazeley_spillway.status, 'SECURE');
  assert.equal(bwWeirs.beazeley_spillway.crest_elevation_mAOD, null);
  assert.equal(bwWeirs.beazeley_spillway.survey_tier, 'UNSURVEYED');

  // 5. evaluateAssetTransition downstream wave verification on 52234 flatline
  const baseTime = new Date('2026-11-15T12:00:00Z').getTime();
  const flatline52234 = Array.from({ length: 96 }, (_, i) => ({
    value: 6.72,
    dateTime: new Date(baseTime - i * 15 * 60 * 1000).toISOString()
  }));
  const rising52157 = [
    { value: 4.35, dateTime: new Date(baseTime).toISOString() },
    { value: 4.30, dateTime: new Date(baseTime - 60 * 60 * 1000).toISOString() }
  ];
  const clyseTransition = evaluateAssetTransition(ASSET_DEFINITIONS.monks_leaze_clyse, null, {
    '52233': [{ value: 7.25, dateTime: new Date(baseTime).toISOString() }],
    '52234': flatline52234,
    '52157': rising52157
  }, null, { nowMs: baseTime });
  assert.equal(clyseTransition.to_state, 'DIVERTING');
  assert.equal(clyseTransition.regime_signature?.anomaly_type, 'DOWNSTREAM_WAVE_VERIFIED');
  assert.ok(clyseTransition.narrative.includes('Beer Wall 52157'));

  // 6. Camera Field Guides & Correlator Mappings
  assert.ok(CAMERA_FIELD_GUIDES.beerwall, 'CAMERA_FIELD_GUIDES must define dedicated beerwall guide');
  assert.equal(CAMERA_FIELD_GUIDES.beerwall.checklist.length, 3);
  assert.equal(CAMERA_FIELD_GUIDES.monksleaze.checklist.length, 3);
  assert.ok(resolveCandidateCamerasForAsset('52233').includes('oath_lock_sluice'));
  assert.ok(resolveCandidateCamerasForAsset('52157').includes('beazeley_spillway'));
  assert.ok(resolveCandidateCamerasForAsset('beazeley_spillway').includes('beazeley_spillway'));
});



