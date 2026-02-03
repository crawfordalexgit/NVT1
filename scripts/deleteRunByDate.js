#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split(/\r?\n/).forEach(line => {
    line = line.trim(); if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('='); if (eq === -1) return;
    const key = line.slice(0, eq).trim(); let val = line.slice(eq+1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1,-1);
    process.env[key] = val;
  });
}

loadEnvLocal(path.resolve(process.cwd(), '.env.local'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const date = process.argv[2] || new Date().toISOString().slice(0,10);

async function run() {
  console.log('Deleting run rows for run_iso =', date);
  const { data: beforeRuns, error: beforeErr } = await supabase.from('snapshot_runs').select('run_id').eq('run_iso', date);
  if (beforeErr) { console.error('Error fetching runs:', beforeErr); process.exit(2); }
  console.log('Found run rows:', (beforeRuns || []).length);

  if (!beforeRuns || !beforeRuns.length) {
    console.log('No runs to delete for', date); process.exit(0);
  }

  const { error } = await supabase.from('snapshot_runs').delete().eq('run_iso', date);
  if (error) { console.error('Delete error:', error); process.exit(3); }

  const { data: afterRuns, error: afterErr } = await supabase.from('snapshot_runs').select('run_id').eq('run_iso', date);
  if (afterErr) { console.error('Error fetching runs after delete:', afterErr); process.exit(4); }
  console.log('Remaining runs for', date, (afterRuns || []).length);

  const { data: counts, error: cntErr } = await supabase.rpc ? await supabase.from('snapshot_entries').select('id', { head: true, count: 'exact' }) : { data: null, error: null };
  if (!cntErr) {
    // if supported
  }

  console.log('Delete completed (cascade should have removed snapshot_entries for that run).');
}

run().catch(err => { console.error(err); process.exit(99); });
