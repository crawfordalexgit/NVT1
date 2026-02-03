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
(async ()=>{
  try {
    const row = { tiref: 'TEST-PB-999', name: 'Test PB', run_id: null, pb_date: '2026-02-03', time: 59.99, meet: 'unit-test', payload: { test: true } };
    const { data, error } = await supabase.from('swimmer_personal_bests').insert([row], { returning: 'representation' });
    if (error) {
      console.error('Insert error:', error);
      process.exit(1);
    }
    console.log('Inserted PB row:', data && data.length ? data[0].id : '(no id returned)');
    process.exit(0);
  } catch (e) {
    console.error('Unexpected error:', e);
    process.exit(1);
  }
})();
