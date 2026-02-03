async function main(){
  const fs = require('fs').promises;
  const path = require('path');
  const raw = await fs.readFile(path.resolve('.env.local'),'utf8').catch(()=>null);
  if (raw) raw.split(/\r?\n/).forEach(l=>{ if(!l.trim()||l.trim().startsWith('#')) return; const p=l.split('=',2); if(p.length===2&&!process.env[p[0].trim()]) process.env[p[0].trim()]=p[1].trim(); });
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false}});
  const { count, error } = await supabase.from('snapshot_entries').select('*', { count: 'exact', head: true });
  if (error) { console.error('count query error', error); process.exit(1); }
  console.log('snapshot_entries count (approx):', count);
  const { data: runs } = await supabase.from('snapshot_runs').select('run_id, run_iso, generated_at').order('generated_at',{ascending:false}).limit(5);
  console.log('recent runs:', runs);
}
main().catch(e=>{ console.error(e); process.exit(1); });
