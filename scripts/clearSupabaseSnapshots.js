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
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: false });
  if (error) throw error;
  return count || 0;
}

async function purge() {
  console.log('Starting Supabase snapshot purge...');
  const tables = ['snapshot_entries','top50_rankings','swimmer_personal_bests','report_cache','snapshot_runs'];
  for (const t of tables) {
    try {
      const before = await count(t);
      console.log(`${t}: ${before} rows before`);
      const { error } = await supabase.from(t).delete().gt('id', 0);
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
