import http from 'node:http';

async function fetchEAGauge(stationRef) {
  const url = `http://environment.data.gov.uk/flood-monitoring/id/stations/${stationRef}/readings?_sorted&_limit=5`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(`Station ${stationRef} latest readings:`);
  if (data.items && data.items.length > 0) {
    data.items.slice(0, 3).forEach(item => {
      console.log(`  - Time: ${item.dateTime} | Value: ${item.value}m | Measure: ${item.measure}`);
    });
  } else {
    console.log("  - No items returned");
  }
}

console.log("Testing live EA Flood Monitoring API fetch...");
await fetchEAGauge("15154"); // Curry Moor area station
await fetchEAGauge("3073");  // Currymoor Pumping Station RLOI reference
