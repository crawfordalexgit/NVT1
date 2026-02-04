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
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing SUPABASE creds in .env.local'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async ()=>{
  try {
    const { data, error } = await supabase.from('swimmer_personal_bests').select('id, payload, event').limit(1000);
    if (error) throw error;
    const rows = data || [];
    const counts = {};
    rows.forEach(r => {
      const ev = (r.event && String(r.event)) || (r.payload && r.payload.event) || '<<none>>';
      counts[ev] = (counts[ev] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    console.log('event counts:');
    entries.forEach(e=>console.log(`  ${e[0]}: ${e[1]}`));
    console.log('\nsample rows:');
    console.log(JSON.stringify(rows.slice(0,10), null, 2));
    process.exit(0);
  } catch(e) { console.error(e); process.exit(2); }
})();
