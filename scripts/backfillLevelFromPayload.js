#!/usr/bin/env node
// Backfill `level` column from payload->>'level' for existing swimmer_personal_bests rows
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
    console.log('Fetching swimmer_personal_bests rows (in batches)');
    let offset = 0;
    const batchSize = 500;
    let updated = 0;
    while (true) {
      const { data, error } = await supabase.from('swimmer_personal_bests').select('id, payload, level').order('pb_date', { ascending: false }).range(offset, offset + batchSize - 1);
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) break;
      const toUpdate = [];
      for (const r of rows) {
        const payloadLevel = r.payload && r.payload.level ? String(r.payload.level).trim() : null;
        const current = r.level == null ? null : String(r.level).trim();
        if ((current === null || current === '') && payloadLevel) {
          toUpdate.push({ id: r.id, level: payloadLevel });
        }
      }
      if (toUpdate.length > 0) {
        // Supabase upsert by primary key id
        const { error: upErr } = await supabase.from('swimmer_personal_bests').upsert(toUpdate, { onConflict: 'id' });
        if (upErr) throw upErr;
        updated += toUpdate.length;
        console.log(`Updated batch offset=${offset} rowsUpdated=${toUpdate.length}`);
      } else {
        console.log(`No updates needed for batch offset=${offset}`);
      }
      offset += batchSize;
    }
    console.log(`Backfill complete. Total rows updated: ${updated}`);
    process.exit(0);
  } catch (e) {
    console.error('Backfill error:', e);
    process.exit(2);
  }
})();
