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

export async function upsertSwimmerPersonalBests(runId: string, runIso: string, pbs: Array<{ tiref?: string | null; name?: string | null; time?: number | null; meet?: string | null; payload?: any; pb_date?: string }>) {
  if (!pbs || pbs.length === 0) return { inserted: 0 };
  // Prepare rows for upsert. pb_date uses runIso (YYYY-MM-DD)
  const rows = pbs.map(p => ({
    tiref: p.tiref == null || String(p.tiref).trim() === '' ? null : String(p.tiref),
    name: p.name == null || String(p.name).trim() === '' ? null : String(p.name),
    run_id: runId,
    // prefer an explicit pb_date on the PB object, fall back to runIso
    pb_date: p.pb_date ? String(p.pb_date) : runIso,
    time: typeof p.time === 'number' ? p.time : (p.time == null ? null : Number(p.time)),
    meet: p.meet == null || String(p.meet).trim() === '' ? null : String(p.meet),
    // keep full payload, and include event if present at top-level for easier querying
    payload: p.payload || {},
    event: p.payload && p.payload.event ? String(p.payload.event) : null,
    level: (p as any).level != null ? (String((p as any).level).trim() === '' ? null : String((p as any).level)) : (p.payload && p.payload.level ? (String(p.payload.level).trim() === '' ? null : String(p.payload.level)) : null),
    yob: (p as any).yob != null ? ((Number.isFinite(Number((p as any).yob)) ? Math.trunc(Number((p as any).yob)) : null)) : (p.payload && p.payload.yob ? (Number.isFinite(Number(p.payload.yob)) ? Math.trunc(Number(p.payload.yob)) : null) : null)
  }));

  // Try upsert; if the legacy table schema doesn't include `yob`, retry without it.
  let { error } = await supabase.from('swimmer_personal_bests').upsert(rows, { onConflict: 'tiref,pb_date,time' });
  if (error) {
    const serialized = util.inspect(error || {}, { depth: 3 });
    const msg = String(error?.message || serialized).toLowerCase();
    // Detect missing-column schema error for `yob` and retry without that field
    if (msg.includes("could not find the 'yob'") || msg.includes('yob') || (error && (error.code === 'PGRST204' || error.code === 'PGRST100'))) {
      try {
        const rowsNoYob = rows.map(r => {
          const copy: any = { ...r };
          if ('yob' in copy) delete copy.yob;
          return copy;
        });
        const { error: retryErr } = await supabase.from('swimmer_personal_bests').upsert(rowsNoYob, { onConflict: 'tiref,pb_date,time' });
        if (retryErr) throw retryErr;
        return { inserted: rows.length };
      } catch (retryError) {
        throw retryError;
      }
    }
    throw error;
  }
  return { inserted: rows.length };
}

export async function getSwimmerPersonalBests(tiref: string, limit = 50) {
  if (!tiref) return [];
  // Prefer typed per-event PBs table if present, fall back to legacy swimmer_personal_bests
  try {
    const ev = await getEventPersonalBestsByTiref(tiref, limit);
    if (ev && ev.length) return ev.map(r => ({
      tiref: r.tiref,
      name: r.name,
      time: r.time,
      meet: r.meet,
      pb_date: r.pb_date,
      payload: r.payload,
      event: r.event,
      rank: r.rank ?? null,
      club: r.club ?? null,
      yob: r.yob ?? null,
      venue: r.venue ?? null,
      level: r.level ?? null
    }));
  } catch (e) {
    // ignore and fall back
  }

  const q = supabase
    .from('swimmer_personal_bests')
    .select('*')
    .eq('tiref', String(tiref))
    .order('pb_date', { ascending: false })
    .limit(limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as any[];
}

export async function getSnapshotEntriesByKey(key: string) {
  if (!key) return [];
  const q = supabase
    .from('snapshot_entries')
    .select('time, name, tiref, run:run_id (run_iso)')
    .eq('key', String(key))
    .not('time', 'is', null)
    .order('run_id', { ascending: true });

  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r: any) => ({ time: r.time, name: r.name, tiref: r.tiref, run_iso: r.run?.run_iso || null }));
}

// Query swimmer personal bests for a specific event/age/sex if those
// attributes were stored in the PB payload when persisted.
export async function getPersonalBestsByEvent(event: string, age: string | number, sex: string) {
  if (!event) return [];
  // Prefer typed `event_personal_bests` if present (faster + typed columns)
  try {
    // Filter typed event PBs by event, age and sex when available for accurate queries
    const evQBuilder = supabase.from('event_personal_bests').select('time, name, tiref, pb_date, meet, payload, event, age, sex, rank, club, yob, venue, level').eq('event', String(event));
    if (age != null && String(age).trim() !== '') evQBuilder.eq('age', String(age));
    if (sex != null && String(sex).trim() !== '') evQBuilder.eq('sex', String(sex));
    const evQ = evQBuilder.order('pb_date', { ascending: true });
    const { data: evData, error: evErr } = await evQ;
    if (!evErr && evData && evData.length) {
      return (evData || []).map((r: any) => ({
        time: r.time,
        name: r.name,
        tiref: r.tiref,
        pb_date: r.pb_date,
        payload: r.payload,
        meet: r.meet,
        event: r.event,
        age: r.age,
        sex: r.sex,
        rank: r.rank ?? null,
        club: r.club ?? null,
        yob: r.yob ?? null,
        venue: r.venue ?? null,
        level: r.level ?? null
      }));
    }
    // If filtering by age/sex returned no rows, try a broader query without age/sex
    if ((!evData || evData.length === 0) && (age != null || sex != null)) {
      try {
        const fallback = await supabase.from('event_personal_bests').select('time, name, tiref, pb_date, meet, payload, event, age, sex, rank, club, yob, venue, level').eq('event', String(event)).order('pb_date', { ascending: true });
        if (fallback && (fallback.data || []).length) {
          return (fallback.data || []).map((r: any) => ({
            time: r.time,
            name: r.name,
            tiref: r.tiref,
            pb_date: r.pb_date,
            payload: r.payload,
            meet: r.meet,
            event: r.event,
            age: r.age,
            sex: r.sex,
            rank: r.rank ?? null,
            club: r.club ?? null,
            yob: r.yob ?? null,
            venue: r.venue ?? null,
            level: r.level ?? null
          }));
        }
      } catch (e) {
        // ignore and continue to legacy table fallback
      }
    }
  } catch (e) {
    // ignore and fall back to legacy table
  }

  // payload contains { event, age, sex } when persisted in generateReport
  // Prefer querying a dedicated `event` column on the legacy table if present (faster). Fall back to JSON payload match.
  // Try a direct event/age/sex query on swimmer_personal_bests if the columns exist
  const eqBuilder = supabase.from('swimmer_personal_bests').select('time, name, tiref, pb_date, payload, meet, event, run_id').eq('event', String(event));
  if (age != null && String(age).trim() !== '') eqBuilder.eq('age', String(age));
  if (sex != null && String(sex).trim() !== '') eqBuilder.eq('sex', String(sex));
  const eqFilter = eqBuilder.order('pb_date', { ascending: true });
  const { data: eqData, error: eqErr } = await eqFilter;
    if (!eqErr && eqData && eqData.length) {
    return (eqData || []).map((r: any) => ({
      time: r.time,
      name: r.name,
      tiref: r.tiref,
      pb_date: r.pb_date,
      payload: r.payload,
      meet: r.meet,
      event: r.event,
      rank: r.rank ?? null,
      club: r.club ?? null,
      yob: r.yob ?? null,
      venue: r.venue ?? null,
      level: r.level ?? null
    }));
    }
  // If the direct event+age+sex query returned nothing, try a broader event-only query
  if ((!eqData || eqData.length === 0) && (age != null || sex != null)) {
    try {
      const fallbackEq = await supabase.from('swimmer_personal_bests').select('time, name, tiref, pb_date, payload, meet, event, run_id').eq('event', String(event)).order('pb_date', { ascending: true });
      if (fallbackEq && (fallbackEq.data || []).length) {
        return (fallbackEq.data || []).map((r: any) => ({
          time: r.time,
          name: r.name,
          tiref: r.tiref,
          pb_date: r.pb_date,
          payload: r.payload,
          meet: r.meet,
          event: r.event,
          rank: r.rank ?? null,
          club: r.club ?? null,
          yob: r.yob ?? null,
          venue: r.venue ?? null,
          level: r.level ?? null
        }));
      }
    } catch (e) {
      // ignore and continue to payload-based fallback
    }
  }

  const payloadMatch: any = { event: String(event) };
  if (age != null) payloadMatch.age = String(age);
  if (sex) payloadMatch.sex = String(sex);

  const q = supabase
    .from('swimmer_personal_bests')
    .select('time, name, tiref, pb_date, payload, meet')
    .contains('payload', payloadMatch)
    .order('pb_date', { ascending: true });

  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r: any) => ({
    time: r.time,
    name: r.name,
    tiref: r.tiref,
    pb_date: r.pb_date,
    payload: r.payload,
    meet: r.meet,
    rank: r.rank ?? null,
    club: r.club ?? null,
    yob: r.yob ?? null,
    venue: r.venue ?? null,
    level: r.level ?? null
  }));
}

// Persist and read monthly virtual ranking/cutoff series for an event|age|sex key
export async function upsertMonthlyCutoffs(runId: string | null, key: string, series: Array<{ month: string; cutoff?: number | null; reason?: string; ranking?: any[] }>) {
  if (!key || !series || series.length === 0) return { inserted: 0 };
  const rows = series.map(s => ({
    key: String(key),
    month: String(s.month),
    cutoff: s.cutoff == null ? null : Number(s.cutoff),
    reason: s.reason || null,
    ranking: s.ranking || [],
    run_id: runId || null
  }));

  const { error } = await supabase.from('virtual_monthly_cutoffs').upsert(rows, { onConflict: 'key,month' });
  if (error) throw error;
  return { inserted: rows.length };
}

export async function getMonthlyCutoffsByKey(key: string) {
  if (!key) return [] as any[];
  const q = supabase.from('virtual_monthly_cutoffs').select('month, cutoff, reason, ranking').eq('key', String(key)).order('month', { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r: any) => ({ month: r.month, cutoff: r.cutoff, reason: r.reason, ranking: r.ranking }));
}

// Report cache helpers (DB-backed cache for serialized report outputs)
export async function getReportCache(cacheKey: string) {
  if (!cacheKey) return null;
  const q = supabase.from('report_cache').select('value, expires_at').eq('cache_key', String(cacheKey)).limit(1).maybeSingle();
  const { data, error } = await q;
  if (error) throw error;
  if (!data) return null;
  // check expiry
  if (data.expires_at) {
    const exp = new Date(data.expires_at).getTime();
    if (isNaN(exp) || exp < Date.now()) return null;
  }
  return data.value;
}

export async function setReportCache(cacheKey: string, value: any, ttlSeconds?: number) {
  if (!cacheKey) return { ok: false };
  let expires_at = null as string | null;
  if (ttlSeconds && Number(ttlSeconds) > 0) {
    expires_at = new Date(Date.now() + Number(ttlSeconds) * 1000).toISOString();
  }
  const row = { cache_key: String(cacheKey), value: value || {}, expires_at };
  const { error } = await supabase.from('report_cache').upsert(row, { onConflict: 'cache_key' });
  if (error) throw error;
  return { ok: true };
}

// Persist a dry-run or staged event PB import for later inspection
export async function insertEventPBImport(runId: string | null, key: string, event: string, age: string | number, sex: string, wouldStore: number, sample: any[], payload: any[]) {
  if (!key) return { ok: false };
  const row = {
    run_id: runId || null,
    key: String(key),
    event: event || null,
    age: String(age || ''),
    sex: String(sex || ''),
    would_store: Number(wouldStore || 0),
    sample: sample || [],
    payload: payload || []
  } as any;
  const { error } = await supabase.from('event_pbs_imports').insert(row);
  if (error) throw error;
  return { ok: true };
}

// Insert many event_personal_bests rows (bulk). Rows should be normalized to typed columns.
export async function insertEventPersonalBests(rows: Array<{ tiref?: string | null; name?: string | null; event?: string | null; age?: string | null; sex?: string | null; pb_date?: string | null; time?: number | null; meet?: string | null; payload?: any; run_id?: string | null }>) {
  if (!rows || rows.length === 0) return { inserted: 0 };
  const cleaned = rows.map(r => ({
    tiref: r.tiref == null || String(r.tiref).trim() === '' ? null : String(r.tiref),
    name: r.name == null || String(r.name).trim() === '' ? null : String(r.name),
    event: r.event == null || String(r.event).trim() === '' ? null : String(r.event),
    age: r.age == null ? null : String(r.age),
    sex: r.sex == null ? null : String(r.sex),
    rank: r.rank == null ? null : (Number.isFinite(Number(r.rank)) ? Math.trunc(Number(r.rank)) : null),
    club: r.club == null || String(r.club).trim() === '' ? null : String(r.club),
    yob: r.yob == null ? null : (Number.isFinite(Number(r.yob)) ? Math.trunc(Number(r.yob)) : null),
    venue: r.venue == null || String(r.venue).trim() === '' ? null : String(r.venue),
    level: r.level == null || String(r.level).trim() === '' ? null : String(r.level),
    pb_date: r.pb_date ? String(r.pb_date) : null,
    time: r.time == null ? null : Number(r.time),
    meet: r.meet == null || String(r.meet).trim() === '' ? null : String(r.meet),
    payload: r.payload || {},
    run_id: r.run_id || null
  }));

  // PostgREST expects a comma-separated list (no surrounding parentheses)
  const { error } = await supabase.from('event_personal_bests').upsert(cleaned, { onConflict: 'tiref,event,pb_date,time' });
  if (error) throw error;
  return { inserted: cleaned.length };
}

export async function getEventPersonalBestsByTiref(tiref: string, limit = 50) {
  if (!tiref) return [];
  const q = supabase.from('event_personal_bests').select('*').eq('tiref', String(tiref)).order('pb_date', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as any[];
}
