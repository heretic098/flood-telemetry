async function searchEA(query) {
  const url = `http://environment.data.gov.uk/flood-monitoring/id/stations?search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(`\n=== Query: "${query}" (Found ${data.items ? data.items.length : 0}) ===`);
  if (data.items) {
    data.items.slice(0, 5).forEach(item => {
      console.log(`Station: ${item.label} | notation: ${item.notation} | river: ${item.riverName}`);
      if (item.measures) {
        const mList = Array.isArray(item.measures) ? item.measures : [item.measures];
        mList.forEach(m => console.log(`   -> Measure: ${m.parameter} (${m.unitName}) | ID: ${m['@id']}`));
      }
    });
  }
}

await searchEA("Burrowbridge");
await searchEA("Saltmoor");
await searchEA("Northmoor");
