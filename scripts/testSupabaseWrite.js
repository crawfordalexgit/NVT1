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
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local or env. Aborting.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function testWrite() {
  const now = new Date().toISOString();
  const runDate = now.slice(0, 10); // YYYY-MM-DD for date column
  const testRow = { run_iso: runDate, meta: { source: 'local-test-script' } };
  console.log('Attempting insert:', testRow);
  const { data, error } = await supabase.from('snapshot_runs').insert([testRow]).select();
  if (error) {
    console.error('Insert error:', error.message || error);
    process.exit(2);
  }
  console.log('Inserted row:', data);

  // cleanup
  const insertedRunId = (data && data[0] && data[0].run_id) ? data[0].run_id : null;
  if (insertedRunId) {
    const { error: delErr } = await supabase.from('snapshot_runs').delete().eq('run_id', insertedRunId);
    if (delErr) {
      console.error('Cleanup delete error:', delErr.message || delErr);
      process.exit(3);
    }
    console.log('Cleanup delete successful for run_id:', insertedRunId);
  } else {
    // fallback delete by unique fields
    const { error: delErr } = await supabase.from('snapshot_runs').delete().eq('run_iso', runDate).contains('meta', { source: 'local-test-script' });
    if (delErr) {
      console.error('Fallback cleanup error:', delErr.message || delErr);
      process.exit(4);
    }
    console.log('Fallback cleanup complete');
  }
}

testWrite().then(()=>console.log('Test completed')).catch(err=>{console.error('Test failed', err); process.exit(5);});
