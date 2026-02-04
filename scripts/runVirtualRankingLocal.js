const { getSnapshotEntriesByKey } = require('../lib/supabaseServer');

async function run(event, age, sex, months = 12) {
  const key = `${event}|${age}|${sex}`;
  console.log('Querying key=', key);
  const rows = await getSnapshotEntriesByKey(key);
  console.log('rows=', rows.length);

  const runDates = rows.map(r => r.run_iso).filter(Boolean).map(d => d).sort();
  const latest = runDates.length ? runDates[runDates.length - 1] : new Date().toISOString().slice(0,10);
  const latestParts = latest.split('-').reverse().join('/'); // YYYY-MM-DD -> DD/MM/YYYY
  const parseDateString = (s) => { // minimal parse
    const parts = s.split('/');
    return new Date(parseInt(parts[2],10), parseInt(parts[1],10)-1, parseInt(parts[0],10));
  }
  const latestDate = parseDateString(latestParts);
  const monthsArr = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(latestDate.getFullYear(), latestDate.getMonth() - i, 1);
    monthsArr.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  const bySwimmer = {};
  rows.forEach(r => {
    const m = (r.run_iso && r.run_iso.slice(0,7)) || null;
    if (!m) return;
    const id = r.tiref || r.name || JSON.stringify(r.name || '');
    if (!bySwimmer[id]) bySwimmer[id] = { name: r.name, tiref: r.tiref, bestByMonth: {} };
    const cur = bySwimmer[id].bestByMonth[m];
    if (cur == null || (r.time != null && r.time < cur)) {
      bySwimmer[id].bestByMonth[m] = r.time;
    }
  });

  const series = [];
  for (const month of monthsArr) {
    const entries = [];
    Object.keys(bySwimmer).forEach(id => {
      const sb = bySwimmer[id];
      const monthsAvailable = Object.keys(sb.bestByMonth).filter(m => m <= month).sort();
      if (monthsAvailable.length === 0) return;
      let best = null;
      for (const m of monthsAvailable) {
        const t = sb.bestByMonth[m];
        if (t == null) continue;
        if (best == null || t < best) best = t;
      }
      if (best != null) entries.push({ name: sb.name, tiref: sb.tiref, time: best });
    });
    entries.sort((a,b) => a.time - b.time);
    series.push({ month, ranking: entries });
  }
  console.log('series sample:', JSON.stringify(series.slice(-3), null, 2));
}

const [,, event, age, sex] = process.argv;
if (!event || !age || !sex) {
  console.error('usage: node scripts/runVirtualRankingLocal.js "50 Free" 13 M');
  process.exit(1);
}
run(event, age, sex).catch(e => { console.error(e); process.exit(2); });
