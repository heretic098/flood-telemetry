import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_STATIONS = [
  { id: '52118', name: 'Curry Moor (Hookbridge / River Tone)', measure: '52118-level-stage-i-15_min-mAOD' },
  { id: '52127', name: 'Curry Moor Basin', measure: '52127-level-stage-i-15_min-mAOD' },
  { id: '52158', name: 'Northmoor (Baltmoor Wall / River Parrett)', measure: '52158-level-stage-i-15_min-mAOD' },
  { id: '52159', name: 'Northmoor Moor Basin', measure: '52159-level-stage-i-15_min-mAOD' },
  { id: '52233', name: 'Monk\'s Leaze Clyse (Upstream Sowy)', measure: '52233-level-stage-i-15_min-mAOD' },
  { id: '52234', name: 'Monk\'s Leaze Clyse (Downstream Sowy)', measure: '52234-level-downstage-i-15_min-mAOD' },
  { id: 'E9094', name: 'Dunball (Inland Sedgemoor Drain)', measure: 'E9094-level-stage-i-15_min-mAOD' },
  { id: '52163', name: 'Dunball Tidal (Parrett Estuary)', measure: '52163-level-tidal_level-i-15_min-mAOD' }
];

function fetchJsonCurl(url) {
  try {
    const raw = execSync(`curl -sL --max-time 10 "${url}"`, { encoding: 'utf8' });
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function fetchHtmlCurl(url) {
  try {
    return execSync(`curl -sL --max-time 10 "${url}"`, { encoding: 'utf8' });
  } catch (e) {
    return null;
  }
}

function extractStationMetadata(station) {
  console.log(`[Extracting] Processing station ${station.id}...`);
  const apiUrl = `https://environment.data.gov.uk/flood-monitoring/id/stations/${station.id}.json`;
  
  const apiRes = fetchJsonCurl(apiUrl);
  const apiData = apiRes?.items || null;

  const rloiId = apiData?.RLOIid;
  let webData = null;

  if (rloiId) {
    console.log(`  -> Fetching web state for RLOI ${rloiId}...`);
    const webUrl = `https://check-for-flooding.service.gov.uk/station/${rloiId}`;
    const html = fetchHtmlCurl(webUrl);
    if (html) {
      const modelMatch = html.match(/window\.flood\.model\s*=\s*(\{[\s\S]*?\});\s*\n/);
      if (modelMatch) {
        try {
          webData = JSON.parse(modelMatch[1]);
        } catch (e) {
          console.warn(`  [Parse Warn] Could not parse window.flood.model for ${station.id}`);
        }
      }
    }
  }

  // Extract measures list
  const measuresList = [];
  if (apiData?.measures) {
    const ms = Array.isArray(apiData.measures) ? apiData.measures : [apiData.measures];
    ms.forEach(m => {
      measuresList.push({
        notation: m.notation,
        parameter: m.parameter,
        qualifier: m.qualifier,
        unitName: m.unitName
      });
    });
  }

  return {
    appId: station.id,
    appName: station.name,
    appMeasure: station.measure,
    label: apiData?.label || null,
    notation: apiData?.notation || null,
    rloiId: apiData?.RLOIid || null,
    riverName: apiData?.riverName || webData?.station?.river || null,
    catchmentName: apiData?.catchmentName || webData?.station?.catchment || null,
    town: apiData?.town || null,
    lat: apiData?.lat || null,
    long: apiData?.long || null,
    easting: apiData?.easting || null,
    northing: apiData?.northing || null,
    gridReference: apiData?.gridReference || null,
    typicalRangeLow: apiData?.stageScale?.typicalRangeLow ?? null,
    typicalRangeHigh: apiData?.stageScale?.typicalRangeHigh ?? null,
    maxOnRecord: apiData?.stageScale?.maxOnRecord?.value ?? null,
    maxOnRecordDate: apiData?.stageScale?.maxOnRecord?.dateTime ?? null,
    measures: measuresList,
    webTopology: webData ? {
      navigationLink: webData.navigationLink || null,
      isUpstream: webData.station?.isUpstream ?? null,
      isDownstream: webData.station?.isDownstream ?? null,
      direction: webData.station?.direction || null
    } : null
  };
}

function main() {
  console.log("=========================================");
  console.log("GAUGE TOPOLOGY & METADATA EXTRACTION");
  console.log("=========================================");

  const results = [];
  for (const st of APP_STATIONS) {
    const data = extractStationMetadata(st);
    results.push(data);
  }

  const outputPath = path.join(__dirname, 'gauge_topology.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✔ Saved topology extraction to ${outputPath}`);
}

main();
