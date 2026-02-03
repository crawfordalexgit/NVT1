'use strict';

// Importer script: reads .cache/rankingSnapshots/*.json and upserts into Supabase.
// Usage:
//   node scripts/importSnapshots.js --dry-run --dir .cache/rankingSnapshots
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.

const fs = require('fs').promises;
const path = require('path');

async function dynamicImportSupabase() {
  // dynamic import so TS/ESM projects can resolve during runtime if transpiled
  try {
    const mod = await import('../lib/supabaseServer');
    return mod;
  } catch (e) {
    // try CJS path
    try { return require('../lib/supabaseServer'); } catch (e2) { throw e; }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, dir: '.cache/rankingSnapshots' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    if ((a === '--dir' || a === '-d') && args[i+1]) { out.dir = args[i+1]; i++; }
  }
  return out;
}

function validateSnapshot(obj) {
  if (!obj) return false;
  if (!obj.runIso && !obj.generatedAt) return false;
  if (!obj.snapshots || typeof obj.snapshots !== 'object') return false;
  return true;
}

async function main() {
  const { dryRun, dir } = parseArgs();
  const root = path.resolve(process.cwd(), dir);
  const supabase = await dynamicImportSupabase();
  const insertSnapshotRun = supabase.insertSnapshotRun;
  const upsertSnapshotEntries = supabase.upsertSnapshotEntries;

  try {
    const files = await fs.readdir(root);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    console.log(`Found ${jsonFiles.length} files in ${root}`);
    for (const file of jsonFiles) {
      const full = path.join(root, file);
      try {
        const txt = await fs.readFile(full, 'utf8');
        const parsed = JSON.parse(txt);
        if (!validateSnapshot(parsed)) {
          console.warn(`Skipping invalid snapshot: ${file}`);
          continue;
        }

        const runIso = parsed.runIso || (parsed.generatedAt ? parsed.generatedAt.slice(0,10) : file.replace('.json',''));
        const run = { run_iso: runIso, generated_at: parsed.generatedAt || new Date().toISOString(), meta: {} };

        const snapshots = parsed.snapshots || {};
        const entries = [];
        for (const keyNoDate of Object.keys(snapshots)) {
          const list = snapshots[keyNoDate] || [];
          for (const swimmer of list) {
            entries.push({
              key: keyNoDate,
              tiref: swimmer.tiref ?? null,
              name: swimmer.name ?? null,
              club: swimmer.club ?? null,
              rank: swimmer.rank ?? null,
              time: (swimmer.time !== undefined && swimmer.time !== null) ? Number(swimmer.time) : null,
              payload: swimmer
            });
          }
        }

        console.log(`File ${file}: runIso=${runIso}, entries=${entries.length}`);
        if (dryRun) continue;

        const runResult = await insertSnapshotRun(run);
        const runId = runResult.run_id;
        await upsertSnapshotEntries(runId, entries);

      } catch (e) {
        console.error(`Error processing ${file}:`, e.message || e);
      }
    }
    console.log('Import finished');
  } catch (e) {
    console.error('Import failed:', e.message || e);
    process.exit(2);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
