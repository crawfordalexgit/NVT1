const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
// load env
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)){
  fs.readFileSync(envPath,'utf8').split(/\r?\n/).forEach(line=>{line=line.trim(); if(!line||line.startsWith('#')) return; const i=line.indexOf('='); if(i===-1) return; const k=line.slice(0,i); let v=line.slice(i+1); if(v.startsWith('"')&&v.endsWith('"')) v=v.slice(1,-1); process.env[k]=v;});
}
(async ()=>{
  try{
    const lib = require('../lib/supabaseServer');
    const rows = await lib.getSnapshotEntriesByKey('50 Free|13|M');
    console.log('Rows:', rows.length);
    console.log(rows.slice(0,5));
  }catch(e){console.error('Err',e)}
})();
