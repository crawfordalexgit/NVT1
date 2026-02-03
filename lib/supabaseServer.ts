import { createClient, SupabaseClient } from '@supabase/supabase-js';
import util from 'util';

// Server-only Supabase helper. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in environment.
// This module must only be used on the server (API routes, scripts) and never bundled to client.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in server environment');
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

export type SnapshotRun = {
  run_iso: string; // YYYY-MM-DD
  generated_at?: string;
  meta?: Record<string, any>;
};

export type SnapshotEntry = {
  key: string;
  tiref?: string | null;
  name?: string | null;
  club?: string | null;
  rank?: number | null;
  time?: number | null;
  payload?: Record<string, any> | null;
};

export async function insertSnapshotRun(run: SnapshotRun) {
  const { data, error } = await supabase
    .from('snapshot_runs')
    .upsert({ run_iso: run.run_iso, generated_at: run.generated_at || new Date().toISOString(), meta: run.meta || {} }, { onConflict: 'run_iso' })
    .select('run_id, run_iso')
    .single();

  if (error) throw error;
  return data as { run_id: string; run_iso: string };
}

export async function upsertSnapshotEntries(runId: string, entries: SnapshotEntry[], batchSize = 500) {
  function parseTimeVal(t: any) {
    if (t == null) return null;
    if (typeof t === 'number') return t;
    if (typeof t === 'string') {
      // formats like '1:23.45' or '59.12'
      if (t.includes(':')) {
        const parts = t.split(':').map(p => p.trim());
        const mins = parseFloat(parts[0]) || 0;
        const secs = parseFloat(parts[1]) || 0;
        const total = mins * 60 + secs;
        return isFinite(total) ? total : null;
      }
      const n = parseFloat(t.replace(',', '.'));
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function parseRankVal(r: any) {
    if (r == null) return null;
    if (typeof r === 'number') return Number.isFinite(r) ? Math.trunc(r) : null;
    if (typeof r === 'string') {
      const cleaned = r.trim();
      if (cleaned === '') return null;
      const n = parseInt(cleaned, 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  const rows = entries.map(e => ({
    run_id: runId,
    key: e.key,
    tiref: e.tiref ?? null,
    name: e.name ?? null,
    club: e.club ?? null,
    rank: parseRankVal(e.rank),
    time: parseTimeVal(e.time),
    payload: e.payload ?? {}
  }));

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      console.log(`Inserting snapshot_entries batch size=${batch.length}`);
      // defensively clean batch values to avoid invalid types (e.g., empty-string rank)
      const cleanedBatch = batch.map((b: any) => ({
        run_id: b.run_id,
        key: b.key,
        tiref: b.tiref == null || String(b.tiref).trim() === '' ? null : String(b.tiref),
        name: b.name == null || String(b.name).trim() === '' ? null : String(b.name),
        club: b.club == null || String(b.club).trim() === '' ? null : String(b.club),
        rank: parseRankVal(b.rank),
        time: parseTimeVal(b.time),
        payload: b.payload || {}
      }));

      // Use insert with graceful handling of duplicate-key conflicts (unique index uses expression)
      const { error } = await supabase.from('snapshot_entries').insert(cleanedBatch);
      if (error) {
        // If it's a duplicate-key error, log and continue; otherwise propagate
        const serialized = util.inspect(error, { depth: 3 });
        console.error('Error inserting batch:', serialized);
        const msg = String(error.message || serialized).toLowerCase();
        if (msg.includes('duplicate key') || msg.includes('unique')) {
          console.warn('Duplicate key conflict inserting snapshot_entries batch — continuing');
          continue;
        }
        throw error;
      }
    } catch (err) {
      const serialized = util.inspect(err, { depth: 5 });
      console.error('Unexpected error inserting snapshot_entries batch:', serialized);
      // Re-throw any unexpected errors so caller can fall back to filesystem
      throw err;
    }
  }
  return { inserted: rows.length };
}

export async function queryRankingTrend(swimmerId: string, limit = 100) {
  // swimmerId can be tiref or name. Return array [{ date: run_iso, rank, time }]
  // We'll join snapshot_entries -> snapshot_runs to get run_iso
  const query = supabase
    .from('snapshot_entries')
    .select('rank, time, tiref, name, run:run_id (run_iso)')
    .or(`tiref.eq.${swimmerId},name.ilike.%25${swimmerId}%25`)
    .order('run_id', { ascending: true })
    .limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).map((r: any) => ({ date: r.run?.run_iso || null, rank: r.rank ?? null, time: r.time }));
  return rows;
}

export default supabase;

export async function upsertSwimmerPersonalBests(runId: string, runIso: string, pbs: Array<{ tiref?: string | null; name?: string | null; time?: number | null; meet?: string | null; payload?: any }>) {
  if (!pbs || pbs.length === 0) return { inserted: 0 };
  // Prepare rows for upsert. pb_date uses runIso (YYYY-MM-DD)
  const rows = pbs.map(p => ({
    tiref: p.tiref == null || String(p.tiref).trim() === '' ? null : String(p.tiref),
    name: p.name == null || String(p.name).trim() === '' ? null : String(p.name),
    run_id: runId,
    pb_date: runIso,
    time: typeof p.time === 'number' ? p.time : (p.time == null ? null : Number(p.time)),
    meet: p.meet == null || String(p.meet).trim() === '' ? null : String(p.meet),
    payload: p.payload || {}
  }));

  const { error } = await supabase.from('swimmer_personal_bests').upsert(rows, { onConflict: 'tiref,pb_date,time' });
  if (error) throw error;
  return { inserted: rows.length };
}
