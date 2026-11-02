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
  assert.equal(bicknells.clearance_m, 0.62, 'Clearance to 7.30m crown must be 0.62m');
  assert.equal(bicknells.status, 'PASSABLE');

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

