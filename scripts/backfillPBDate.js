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

function parsePayloadDate(d) {
  if (!d) return null;
  d = String(d).trim();
  // Try DD/MM/YY or DD/MM/YYYY
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (m[3].length === 2) year = 2000 + year;
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Simple ISO date
    const mm = String(month).padStart(2,'0');
    const dd = String(day).padStart(2,'0');
    return `${year}-${mm}-${dd}`;
  }
  // Try ISO-like parse
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) {
    const y = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth()+1).padStart(2,'0');
    const dd = String(dt.getUTCDate()).padStart(2,'0');
    return `${y}-${mm}-${dd}`;
  }
  return null;
}

loadEnvLocal(path.resolve(process.cwd(), '.env.local'));
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing SUPABASE creds in .env.local'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async ()=>{
  try {
    console.log('Fetching swimmer_personal_bests rows...');
    const { data, error } = await supabase.from('swimmer_personal_bests').select('id, pb_date, payload').limit(10000);
    if (error) throw error;
    const rows = data || [];
    const updates = [];
    for (const r of rows) {
      const payloadDate = r.payload && (r.payload.date || r.payload.dt || r.payload.pb_date) ? (r.payload.date || r.payload.dt || r.payload.pb_date) : null;
      const parsed = parsePayloadDate(payloadDate);
      if (!parsed) continue;
      const existing = r.pb_date ? String(r.pb_date).slice(0,10) : null;
      if (existing !== parsed) {
        updates.push({ id: r.id, pb_date: parsed });
      }
    }
    console.log('rows to update:', updates.length);
    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i+500);
      const { error: upErr } = await supabase.from('swimmer_personal_bests').upsert(batch, { onConflict: 'id' });
      if (upErr) {
        console.error('Update error:', upErr);
        process.exit(2);
      }
      console.log(`Updated batch ${i} -> ${i+batch.length}`);
    }
    console.log('Backfill pb_date complete');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
})();
