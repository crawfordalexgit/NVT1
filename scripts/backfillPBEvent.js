#!/usr/bin/env node
// Backfill script: copy payload->>'event' into a dedicated `event` column
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
    console.log('Fetching PB rows with payload.event...');
    const { data, error } = await supabase.from('swimmer_personal_bests').select('id, payload').limit(10000);
    if (error) throw error;
    const rows = data || [];
    const updates = [];
    for (const r of rows) {
      const ev = r.payload && r.payload.event ? String(r.payload.event) : null;
      if (ev) updates.push({ id: r.id, event: ev });
    }
    console.log('rows to update:', updates.length);
    // batch updates
    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i+500);
      const { error: upErr } = await supabase.from('swimmer_personal_bests').upsert(batch, { onConflict: 'id' });
      if (upErr) {
        console.error('Update error:', upErr);
        process.exit(2);
      }
      console.log(`Updated batch ${i} -> ${i+batch.length}`);
    }
    console.log('Backfill complete');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
})();
