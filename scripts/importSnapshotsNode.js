const fs = require('fs').promises;
const path = require('path');

async function main() {
  const dir = process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir')+1] : '.cache/rankingSnapshots';
  const dry = process.argv.includes('--dry-run');

  // Load .env.local if present (simple parser) so script can run without external env setup
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    const raw = await fs.readFile(envPath, 'utf8').catch(()=>null);
    if (raw) {
      raw.split(/\r?\n/).forEach(line => {
        const l = line.trim(); if (!l || l.startsWith('#')) return;
        const parts = l.split('=',2); if (parts.length===2) {
          const k = parts[0].trim(); const v = parts[1].trim(); if (!process.env[k]) process.env[k]=v;
        }
      });
    }
  } catch(e){}

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment or .env.local');
    process.exit(2);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const root = path.resolve(process.cwd(), dir);
  const files = await fs.readdir(root).catch(e => { console.error('Cannot read dir', root, e.message); process.exit(3); });
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  console.log(`Found ${jsonFiles.length} snapshot files in ${root}`);

  for (const file of jsonFiles) {
    const full = path.join(root, file);
    try {
      const txt = await fs.readFile(full, 'utf8');
      const parsed = JSON.parse(txt);
      const runIso = parsed.runIso || (parsed.generatedAt ? parsed.generatedAt.slice(0,10) : file.replace('.json',''));
      const runRow = { run_iso: runIso, generated_at: parsed.generatedAt || new Date().toISOString(), meta: { importedFrom: file } };
      console.log('Processing', file, 'runIso=', runIso);
      if (dry) continue;

      // upsert run
      const { data: runData, error: runErr } = await supabase.from('snapshot_runs').upsert(runRow, { onConflict: 'run_iso' }).select('run_id, run_iso').single();
      if (runErr) { console.error('Run upsert error', runErr); continue; }
      const runId = runData.run_id;

      // build entries
      const snapshots = parsed.snapshots || {};
      const entries = [];
      for (const keyNoDate of Object.keys(snapshots)) {
        const list = snapshots[keyNoDate] || [];
        for (const swimmer of list) {
          entries.push({
            run_id: runId,
            key: keyNoDate,
            tiref: swimmer.tiref ?? null,
            name: swimmer.name ?? null,
            club: swimmer.club ?? null,
            rank: (swimmer.rank !== undefined && swimmer.rank !== null) ? Number(swimmer.rank) : null,
            time: (swimmer.time !== undefined && swimmer.time !== null) ? tryParseTime(swimmer.time) : null,
            payload: swimmer
          });
        }
      }

      // batch insert/upsert in chunks
      const batchSize = 500;
      for (let i=0;i<entries.length;i+=batchSize) {
        const batch = entries.slice(i,i+batchSize);
        const { error } = await supabase.from('snapshot_entries').insert(batch, { returning: 'minimal' });
        if (error) { console.error('Insert batch error', error); break; }
      }
      console.log(`Imported ${entries.length} entries for run ${runIso}`);
    } catch (e) {
      console.error('Error processing file', file, e.message || e);
    }
  }
  console.log('Import complete');
}

function tryParseTime(val) {
  // If numeric, return as-is; if string like mm:ss.xx, attempt to parse to seconds
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return null;
  const m = val.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
  if (m) { return Number(m[1]) * 60 + Number(m[2]); }
  const n = Number(val.replace(':','').replace(',','.'));
  return isNaN(n) ? null : n;
}

main().catch(e=>{ console.error(e); process.exit(1); });
