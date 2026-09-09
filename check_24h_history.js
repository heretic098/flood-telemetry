async function check24hReadings(measureId) {
  // Query 24 hours of 15-minute readings = 96 items
  const url = `https://environment.data.gov.uk/flood-monitoring/id/measures/${measureId}/readings?_sorted&_limit=96`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(`\n=== Measure: ${measureId} ===`);
  if (data.items && data.items.length > 0) {
    const latest = data.items[0];
    const oldest = data.items[data.items.length - 1];
    console.log(`   Fetched ${data.items.length} readings`);
    console.log(`   Latest (Now):   ${latest.dateTime} | Value: ${latest.value} mAOD`);
    console.log(`   Oldest (-24h):  ${oldest.dateTime} | Value: ${oldest.value} mAOD`);
  } else {
    console.log("   No readings returned");
  }
}

console.log("Testing 24-hour backfill fetch from Environment Agency API...");
await check24hReadings("52118-level-stage-i-15_min-mAOD");
await check24hReadings("52127-level-stage-i-15_min-mAOD");
await check24hReadings("E9094-level-stage-i-15_min-mAOD");
await check24hReadings("52163-level-tidal_level-i-15_min-mAOD");
