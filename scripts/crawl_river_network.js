import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWN_SEQUENCES = {
  "River Tone": ["52108", "52109", "52111", "52162", "52118"],
  "River Parrett": ["52116", "52119", "52233", "52158", "52124", "52163"],
  "River Yeo": ["52121", "52117", "52112", "52120"],
  "River Isle": ["52115", "52114", "52153"],
  "River Cary": ["52156"],
  "Kings Sedgemoor Drain": ["E9531", "E9094"],
  "Sowy Relief Channel": ["52234", "52157"]
};

async function fetchStation(id) {
  const url = `https://environment.data.gov.uk/flood-monitoring/id/stations/${id}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const st = data.items;
    if (!st) return null;

    const ms = Array.isArray(st.measures) ? st.measures : (st.measures ? [st.measures] : []);
    return {
      id: st.notation || st.stationReference,
      name: st.label,
      rloiId: st.RLOIid || null,
      riverName: st.riverName || null,
      catchmentName: st.catchmentName || null,
      town: st.town || null,
      lat: st.lat || null,
      long: st.long || null,
      easting: st.easting || null,
      northing: st.northing || null,
      gridReference: st.gridReference || null,
      measures: ms.map(m => ({
        id: m['@id'] ? m['@id'].split('/').pop() : null,
        parameter: m.parameterName || m.parameter,
        qualifier: m.qualifier,
        unit: m.unitName
      }))
    };
  } catch (e) {
    console.error(`Error fetching station ${id}:`, e);
    return null;
  }
}

async function main() {
  console.log("=========================================");
  console.log("PARSING FULL SOMERSET RIVER GAUGE NETWORK");
  console.log("=========================================");

  const allIds = new Set();
  Object.values(KNOWN_SEQUENCES).forEach(list => list.forEach(id => allIds.add(id)));

  const fetchPromises = Array.from(allIds).map(id => fetchStation(id));
  const results = await Promise.all(fetchPromises);

  const stationMap = {};
  results.forEach(st => {
    if (st) stationMap[st.id] = st;
  });

  const fullNetwork = {};
  for (const [river, idList] of Object.entries(KNOWN_SEQUENCES)) {
    fullNetwork[river] = idList.map(id => stationMap[id]).filter(Boolean);
    console.log(`✔ River: "${river}" — Saved ${fullNetwork[river].length} stations`);
  }

  const outputPath = path.join(__dirname, 'full_river_network.json');
  fs.writeFileSync(outputPath, JSON.stringify(fullNetwork, null, 2));
  console.log(`\n✔ Saved complete network topology to ${outputPath}`);
}

main();
