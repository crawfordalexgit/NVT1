import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
  const rows = entries.map(e => ({
    run_id: runId,
    key: e.key,
    tiref: e.tiref ?? null,
    name: e.name ?? null,
    club: e.club ?? null,
    rank: e.rank ?? null,
    time: e.time ?? null,
    payload: e.payload ?? {}
  }));

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('snapshot_entries')
      .upsert(batch, { onConflict: ['run_id', 'key', 'tiref'] });
    if (error) throw error;
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
