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

// 52158 = Baltmoor Wall Saltmoor Barrier
await fetchLatest("52158-level-stage-i-15_min-mAOD");
