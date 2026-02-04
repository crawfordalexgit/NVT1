#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!process.env.PURGE_SUPABASE) {
  console.error('Destructive action aborted. Set PURGE_SUPABASE=true to confirm.');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. Aborting.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function count(table) {
  // Try selecting id; if table has no `id` column, fallback to head-count
  let res;
  try {
    res = await supabase.from(table).select('id', { count: 'exact', head: false });
    if (res.error) throw res.error;
    return res.count || 0;
  } catch (e) {
    const r2 = await supabase.from(table).select('*', { head: true, count: 'exact' });
    if (r2.error) throw r2.error;
    return r2.count || 0;
  }
}

async function purge() {
  console.log('Starting Supabase snapshot purge...');
  const tables = ['snapshot_entries','top50_rankings','swimmer_personal_bests','report_cache','snapshot_runs'];
  // Known primary/key columns per table
  const keyCols = {
    snapshot_entries: 'id',
    top50_rankings: 'id',
    swimmer_personal_bests: 'id',
    report_cache: 'cache_key',
    snapshot_runs: 'run_id'
  };
  for (const t of tables) {
    try {
      const before = await count(t);
      console.log(`${t}: ${before} rows before`);
      const keyCol = keyCols[t] || 'id';
      // Delete all rows by filtering where primary/key col is not null
      const { error } = await supabase.from(t).delete().not(keyCol, 'is', 'null');
      if (error) {
        console.error(`Error deleting from ${t}:`, error.message || error);
        process.exit(1);
      }
      const after = await count(t);
      console.log(`${t}: ${after} rows after`);
    } catch (err) {
      console.error('Error handling table', t, err.message || err);
      process.exit(1);
    }
  }
  console.log('Supabase purge complete.');
}

purge().catch(err => { console.error(err); process.exit(1); });
