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
    const { data, error } = await supabase
      .from('swimmer_personal_bests')
      .select('id, tiref, name, pb_date, time, payload')
      .order('pb_date', { ascending: false })
      .limit(50);
    if (error) throw error;
    const rows = data || [];
    console.log('rows fetched:', rows.length);
    rows.forEach((r, i) => {
      const payloadLevel = r.payload && r.payload.level ? r.payload.level : null;
      console.log(`${i+1}. id=${r.id} tiref=${r.tiref} name=${r.name} pb_date=${r.pb_date} time=${r.time} level_col=${r.level} payload_level=${payloadLevel}`);
    });
    process.exit(0);
  } catch (e) {
    console.error('Error:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
