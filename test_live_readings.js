async function fetchLatest(measureId) {
  const url = `http://environment.data.gov.uk/flood-monitoring/id/measures/${measureId}/readings?_sorted&_limit=5`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(`\n=== Measure: ${measureId} ===`);
  if (data.items && data.items.length > 0) {
    data.items.slice(0, 3).forEach(item => {
      console.log(`   Time: ${item.dateTime} | Value: ${item.value} mAOD`);
    });
  } else {
    console.log("   No readings found");
  }
}

// 52118 = Currymoor PS on River Tone
await fetchLatest("52118-level-stage-i-15_min-mAOD");
// 52127 = Currymoor PS on Currymoor Drain
await fetchLatest("52127-level-stage-i-15_min-mAOD");
// E9094 = Dunball KSD
await fetchLatest("E9094-level-stage-i-15_min-mAOD");
// 52163 = Dunball Tidal Parrett
await fetchLatest("52163-level-tidal_level-i-15_min-mAOD");
