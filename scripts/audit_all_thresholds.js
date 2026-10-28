import Database from 'better-sqlite3';

const MEASURES = [
  '52108-level-stage-i-15_min-mASD',
  '52109-level-stage-i-15_min-mASD',
  '52111-level-stage-i-15_min-mASD',
  '52162-level-stage-i-15_min-mAOD',
  '52118-level-stage-i-15_min-mAOD',
  '52127-level-stage-i-15_min-mAOD',
  '52116-level-stage-i-15_min-m',
  '52119-level-stage-i-15_min-mASD',
  '52233-level-stage-i-15_min-mAOD',
  '52234-level-downstage-i-15_min-mAOD',
  '52158-level-stage-i-15_min-mAOD',
  '52159-level-stage-i-15_min-mAOD',
  '52124-level-tidal_level-i-15_min-mAOD',
  '52163-level-tidal_level-i-15_min-mAOD',
  '52157-level-stage-i-15_min-mAOD',
  'E9531-level-stage-i-15_min-mAOD',
  'E9094-level-stage-i-15_min-mAOD'
];

const STATIONS = [
  '52108', '52109', '52111', '52162', '52118', '52127',
  '52116', '52119', '52233', '52234', '52158', '52159',
  '52124', '52163', '52157', 'E9531', 'E9094'
];

async function main() {
  console.log('Auditing Environment Agency Station Metadata & Calibration Envelopes...\n');
  const results = [];

  for (const stId of STATIONS) {
    try {
      const url = `https://environment.data.gov.uk/flood-monitoring/id/stations/${stId}.json`;
      const res = await fetch(url);
      if (!res.ok) {
        results.push({ id: stId, error: `HTTP ${res.status}` });
        continue;
      }
      const data = await res.json();
      const item = data.items;
      
      // Look for stageScale in item
      const stageScale = item.stageScale || null;
      let typLow = stageScale?.typicalRange?.low ?? null;
      let typHigh = stageScale?.typicalRange?.high ?? null;
      let maxOnRecord = stageScale?.maxOnRecord?.value ?? null;
      let minOnRecord = stageScale?.minOnRecord?.value ?? null;
      let scaleDatum = stageScale?.datum ?? null;

      // Look at measures
      let measuresArr = Array.isArray(item.measures) ? item.measures : (item.measures ? [item.measures] : []);
      let measureDetails = [];

      for (const m of measuresArr) {
        const mNotation = m.notation || m['@id']?.split('/').pop();
        const mDatum = m.datum ?? null;
        let latest = m.latestReading?.value ?? null;
        
        // Also fetch measure json directly if stageScale was null on station
        let mScale = null;
        if (!stageScale && mNotation) {
          try {
            const mRes = await fetch(`https://environment.data.gov.uk/flood-monitoring/id/measures/${mNotation}.json`);
            if (mRes.ok) {
              const mData = await mRes.json();
              mScale = mData.items?.stageScale || null;
              if (mScale) {
                typLow = mScale.typicalRange?.low ?? typLow;
                typHigh = mScale.typicalRange?.high ?? typHigh;
                maxOnRecord = mScale.maxOnRecord?.value ?? maxOnRecord;
                minOnRecord = mScale.minOnRecord?.value ?? minOnRecord;
                scaleDatum = mScale.datum ?? scaleDatum;
              }
            }
          } catch (e) {}
        }

        measureDetails.push({
          notation: mNotation,
          qualifier: m.qualifier,
          unitName: m.unitName,
          latest: latest
        });
      }

      results.push({
        id: stId,
        label: item.label,
        river: item.riverName,
        rloiId: item.rloiId,
        typLow,
        typHigh,
        minOnRecord,
        maxOnRecord,
        scaleDatum,
        measures: measureDetails
      });
    } catch (err) {
      results.push({ id: stId, error: err.message });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
