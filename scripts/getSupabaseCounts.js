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

const envPath = path.resolve(process.cwd(), '.env.local');
loadEnvLocal(envPath);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local or env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function getCounts() {
  try {
    const r1 = await supabase.from('snapshot_runs').select('*', { head: true, count: 'exact' });
    const r2 = await supabase.from('snapshot_entries').select('*', { head: true, count: 'exact' });
      const r3 = await supabase.from('swimmer_personal_bests').select('*', { head: true, count: 'exact' });
      console.log('snapshot_runs count:', r1.count ?? 0);
      console.log('snapshot_entries count:', r2.count ?? 0);
      console.log('swimmer_personal_bests count:', r3.count ?? 0);
  } catch (err) {
    console.error('Error querying Supabase:', err.message || err);
    process.exit(1);
  }
}

getCounts();
