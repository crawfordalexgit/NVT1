import { NextRequest, NextResponse } from 'next/server';
import { getSnapshotEntriesByKey, getPersonalBestsByEvent, getMonthlyCutoffsByKey } from '@/lib/supabaseServer';
import { getMonthKey, parseDateString } from '@/lib/time';

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams) as Record<string,string>;
  const event = params.event || '';
  const age = params.ageGroup || params.age || '';
  const sex = params.sex || 'M';
  const level = params.level || 'All';
  const monthsToShow = Number(params.months || '12');
  if (!event || !age || !sex) return NextResponse.json({ ok: false, error: 'missing params' }, { status: 400 });

  // key format used in snapshot_entries: `${ev}|${age}|${sex}` where ev is event name
  const key = `${event}|${age}|${sex}`;
  try {
    // Prefer persisted monthly cutoffs/rankings if present
    if (process.env.USE_SUPABASE === 'true') {
      try {
        const persisted = await getMonthlyCutoffsByKey(key);
        if (persisted && persisted.length) {
          // convert persisted rows into the same shape as previous `months` response
          const series = persisted.map((p: any) => ({ month: p.month, ranking: Array.isArray(p.ranking) ? p.ranking : [] }));
          return NextResponse.json({ ok: true, key, months: series });
        }
      } catch (e) {
        // ignore and continue to PB/snapshot fallback
        console.warn('Failed to read persisted monthly cutoffs, falling back:', String(e));
      }
    }
    // Prefer personal bests (if we've stored event/age/sex on PB payloads)
    let rows: any[] = [];
    if (process.env.USE_SUPABASE === 'true') {
      try {
        const pbRows = await getPersonalBestsByEvent(event, age, sex);
        if (pbRows && pbRows.length) {
          // map PB rows to same shape used below; include pb_date/meet/payload and typed metadata when available
          rows = pbRows.map(r => ({
            time: r.time,
            name: r.name,
            tiref: r.tiref,
            run_iso: r.pb_date || (r.pb_date ? r.pb_date : null),
            pb_date: r.pb_date || null,
            meet: r.meet || (r.payload && r.payload.meet) || null,
            payload: r.payload || null,
            event: r.event || (r.payload && r.payload.event) || null,
            rank: r.rank ?? ((r.payload && r.payload.rank) || null),
            club: r.club ?? ((r.payload && r.payload.club) || null),
            yob: r.yob ?? ((r.payload && r.payload.yob) || null),
            venue: r.venue ?? ((r.payload && r.payload.venue) || null),
            level: r.level ?? ((r.payload && r.payload.level) || null)
          }));
        }
      } catch (e) {
        // ignore PB errors and fall back to snapshot entries
        console.warn('PB query failed, falling back to snapshots:', String(e));
      }
    }
    if (!rows || rows.length === 0) {
      rows = await getSnapshotEntriesByKey(key);
    }
    // build list of months to show (last N months up to latest run)
    const runDates = rows.map(r => r.run_iso).filter(Boolean).map(d => d as string).sort();
    const latest = runDates.length ? runDates[runDates.length - 1] : new Date().toISOString().slice(0,10);

    const months: string[] = [];
    const latestDate = parseDateString(latest.split('-').reverse().join('/')); // convert YYYY-MM-DD -> DD/MM/YYYY for parseDateString
    const l = latestDate || new Date();
    for (let i = monthsToShow - 1; i >= 0; i--) {
      const d = new Date(l.getFullYear(), l.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }

    // Optionally filter rows by level (when provided)
    const levelFilter = level;
    if (levelFilter && levelFilter !== 'All') {
      const normalize = (v: any) => {
        if (v == null) return null;
        const s = String(v).trim();
        if (s.length === 0) return null;
        // remove leading L/l if present
        if (/^[lL]\d+$/.test(s)) return s.slice(1);
        // if numeric string, return numeric part
        const num = s.match(/\d+/);
        return num ? num[0] : s;
      };
      const nf = normalize(levelFilter);
      rows = rows.filter(r => {
        const lvlRaw = r.level ?? (r.payload && r.payload.level) ?? null;
        const l = normalize(lvlRaw);
        return l != null && nf != null && String(l) === String(nf);
      });
    }

    // For each month, compute cumulative best per swimmer up to and including that month
    const bySwimmer: Record<string, { name?: string|null; tiref?: string|null; bestByMonth: Record<string, number> }> = {};
    // convert rows into objects with monthKey
    rows.forEach(r => {
      // r may come from snapshot_entries (run_iso) or PB rows (pb_date/run_iso)
      const runIso = r.run_iso || r.pb_date || (r.pb_date === 0 ? r.pb_date : null);
      const m = (runIso && String(runIso).slice(0,7)) || null; // YYYY-MM
      if (!m) return;
      const id = r.tiref || r.name || JSON.stringify(r.name || '');
      if (!bySwimmer[id]) bySwimmer[id] = {
        name: r.name,
        tiref: r.tiref,
        bestByMonth: {},
        rank: r.rank ?? null,
        club: r.club ?? null,
        yob: r.yob ?? null,
        meet: r.meet ?? null,
        venue: r.venue ?? null,
        level: r.level ?? ((r.payload && r.payload.level) || null)
      } as any;
      const cur = (bySwimmer[id].bestByMonth as Record<string, any>)[m];
      if (cur == null || (r.time != null && r.time < cur)) {
        (bySwimmer[id].bestByMonth as Record<string, any>)[m] = r.time;
      }
    });

    // build cumulative bests per month
    const result: Record<string, { month: string; ranking: { name?: string|null; tiref?: string|null; time: number }[] }[]> = { months: [] } as any;
    const series: { month: string; ranking: { name?: string|null; tiref?: string|null; time: number }[] }[] = [];

    // For each month, compute cumulative best up to that month for each swimmer
    for (const month of months) {
      const entries: { name?: string|null; tiref?: string|null; time: number; rank?: number|null; club?: string|null; yob?: number|null; meet?: string|null; venue?: string|null; level?: string|null }[] = [];
      Object.keys(bySwimmer).forEach(id => {
        const sb = bySwimmer[id];
        // find best <= month
        const monthsAvailable = Object.keys(sb.bestByMonth).filter(m => m <= month).sort();
        if (monthsAvailable.length === 0) return;
        // pick best among those
        let best: number | null = null;
        for (const m of monthsAvailable) {
          const t = sb.bestByMonth[m];
          if (t == null) continue;
          if (best == null || t < best) best = t;
        }
        if (best != null) entries.push({ name: sb.name, tiref: sb.tiref, time: best, rank: (sb as any).rank ?? null, club: (sb as any).club ?? null, yob: (sb as any).yob ?? null, meet: (sb as any).meet ?? null, venue: (sb as any).venue ?? null, level: (sb as any).level ?? null });
      });
      // sort ascending (fastest first)
      entries.sort((a,b) => a.time - b.time);
      series.push({ month, ranking: entries });
    }

    return NextResponse.json({ ok: true, key, months: series });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
