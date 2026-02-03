#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq === -1) return;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    process.env[key] = val;
  });
}

loadEnvLocal(path.resolve(process.cwd(), '.env.local'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local or env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function test() {
  const date = new Date().toISOString().slice(0,10);
  const { data: runs, error: runErr } = await supabase.from('snapshot_runs').select('run_id').eq('run_iso', date);
  if (runErr) { console.error('Error fetching run:', runErr); process.exit(1); }
  if (!runs || !runs.length) { console.error('No snapshot_runs for', date); process.exit(2); }
  const runId = runs[0].run_id;
  console.log('Using run_id', runId);

  const row = { run_id: runId, key: 'TEST|x', tiref: 'TEST', name: 'Test Insert', club: 'TestClub', rank: 1, time: 99.99, payload: { test: true } };
  console.log('Attempting to insert entry');
  const { data: ins, error: insErr } = await supabase.from('snapshot_entries').insert([row]);
  if (insErr) { console.error('Insert error:', insErr); process.exit(3); }
  console.log('Insert OK:', ins);

  // delete
  const { error: delErr } = await supabase.from('snapshot_entries').delete().eq('run_id', runId).eq('tiref', 'TEST');
  if (delErr) { console.error('Delete error:', delErr); process.exit(4); }
  console.log('Cleanup OK');
}

test().catch(err => { console.error(err); process.exit(9); });
