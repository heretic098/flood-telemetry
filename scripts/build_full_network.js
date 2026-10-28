import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATIONS_MANUAL = [
  // River Tone sequence
  { id: "52108", river: "River Tone" },
  { id: "52109", river: "River Tone" },
  { id: "52111", river: "River Tone" },
  { id: "52162", river: "River Tone" },
  { id: "52118", river: "River Tone" },

  // River Parrett sequence
  { id: "52116", river: "River Parrett" },
  { id: "52119", river: "River Parrett" },
  { id: "52233", river: "River Parrett" },
  { id: "52158", river: "River Parrett" },
  { id: "52124", river: "River Parrett" },
  { id: "52163", river: "River Parrett" },

  // River Yeo sequence
  { id: "52121", river: "River Yeo" },
  { id: "52117", river: "River Yeo" },
  { id: "52112", river: "River Yeo" },
  { id: "52120", river: "River Yeo" },

  // River Isle sequence
  { id: "52115", river: "River Isle" },
  { id: "52114", river: "River Isle" },
  { id: "52153", river: "River Isle" },

  // Sowy & KSD conveyance path
  { id: "52234", river: "Sowy Relief Channel" },
  { id: "52157", river: "Sowy Relief Channel" },
  { id: "E9531", river: "Kings Sedgemoor Drain" },
  { id: "E9094", river: "Kings Sedgemoor Drain" }
];

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
    console.error(`Error fetching ${id}:`, e);
    return null;
  }
}

async function main() {
  console.log("Fetching stations in parallel...");
  const fetchPromises = STATIONS_MANUAL.map(s => fetchStation(s.id));
  const results = await Promise.all(fetchPromises);

  const stationMap = {};
  results.forEach(st => {
    if (st) stationMap[st.id] = st;
  });

  const fullNetwork = {
    "River Tone": [
      stationMap["52108"],
      stationMap["52109"],
      stationMap["52111"],
      stationMap["52162"],
      stationMap["52118"]
    ].filter(Boolean),
    "River Parrett": [
      stationMap["52116"],
      stationMap["52119"],
      stationMap["52233"],
      stationMap["52158"],
      stationMap["52124"],
      stationMap["52163"]
    ].filter(Boolean),
    "River Yeo": [
      stationMap["52121"],
      stationMap["52117"],
      stationMap["52112"],
      stationMap["52120"]
    ].filter(Boolean),
    "River Isle": [
      stationMap["52115"],
      stationMap["52114"],
      stationMap["52153"]
    ].filter(Boolean),
    "River Cary": [],
    "Kings Sedgemoor Drain": [
      stationMap["E9531"],
      stationMap["E9094"]
    ].filter(Boolean),
    "Sowy Relief Channel": [
      stationMap["52234"],
      stationMap["52157"]
    ].filter(Boolean)
  };

  const outputPath = path.join(__dirname, 'full_river_network.json');
  fs.writeFileSync(outputPath, JSON.stringify(fullNetwork, null, 2));
  console.log(`✔ Saved full river network to ${outputPath}`);
}

main();
