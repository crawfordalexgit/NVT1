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
    const event = process.argv[2] || '50 Free';
    const age = process.argv[3] ? Number(process.argv[3]) : null;
    const sex = process.argv[4] || 'M';
    console.log(`Querying swimmer_personal_bests for event='${event}', age=${age}, sex='${sex}' (filtering client-side)`);
    const { data, error } = await supabase
      .from('swimmer_personal_bests')
      .select('time, name, tiref, pb_date, payload, event')
      .eq('event', String(event))
      .order('pb_date', { ascending: true })
      .limit(1000);
    if (error) throw error;
    const rows = (data || []).filter(r => {
      if (!r.payload) return false;
      const payloadAge = r.payload.age !== undefined ? r.payload.age : (r.payload.age && Number(r.payload.age));
      const okAge = age === null ? true : payloadAge == age;
      const okSex = r.payload.sex ? String(r.payload.sex) === String(sex) : true;
      return okAge && okSex;
    });
    console.log('total PB rows found:', rows.length);
    const byMonth = {};
    rows.forEach(r => {
      const m = r.pb_date ? String(r.pb_date).slice(0,7) : 'unknown';
      byMonth[m] = byMonth[m] || [];
      byMonth[m].push(r);
    });
    const months = Object.keys(byMonth).sort();
    console.log('months with PB counts:');
    months.forEach(m => console.log(`  ${m}: ${byMonth[m].length}`));
    if (rows.length) {
      console.log('\nSample rows:');
      console.log(JSON.stringify(rows.slice(-10), null, 2));
    }
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
})();
