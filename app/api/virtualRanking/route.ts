import { NextRequest, NextResponse } from 'next/server';
import { getSnapshotEntriesByKey, getPersonalBestsByEvent, getMonthlyCutoffsByKey } from '@/lib/supabaseServer';
import { getMonthKey, parseDateString } from '@/lib/time';

function parseAnyDate(input: any): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  if (s.length === 0) return null;
  // Try DD/MM/YYYY or DD/MM/YY
  try {
    const d1 = parseDateString(s);
    if (d1 && !Number.isNaN(d1.getTime())) return d1;
  } catch (e) {}
  // Strip time part if present
  const spaceIdx = s.indexOf(' ');
  const maybeDate = spaceIdx > 0 ? s.slice(0, spaceIdx) : s;
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(maybeDate)) {
    const nd = new Date(maybeDate);
    if (!Number.isNaN(nd.getTime())) return nd;
  }
  // Try slashes or dashes with day first
  const partsSlash = maybeDate.split(/[\/\-]/);
  if (partsSlash.length === 3) {
    // heuristic: if first part is 4 digits, assume YYYY-MM-DD
    if (/^\d{4}$/.test(partsSlash[0])) {
      const nd = new Date(maybeDate);
      if (!Number.isNaN(nd.getTime())) return nd;
    } else {
      // try interpret as DD/MM/YYYY
      try {
        const dd = Number(partsSlash[0]);
        const mm = Number(partsSlash[1]);
        const yy = Number(partsSlash[2]);
        if (!isNaN(dd) && !isNaN(mm) && !isNaN(yy)) {
          const fy = yy < 100 ? 2000 + yy : yy;
          const nd = new Date(fy, mm - 1, dd);
          if (!Number.isNaN(nd.getTime())) return nd;
        }
      } catch (e) {}
    }
  }
  // Fallback to native parsing
  const nd = new Date(s);
  if (!Number.isNaN(nd.getTime())) return nd;
  return null;
}
import { eventNameToCode } from '@/utils/eventNameToCode';

function resolveStroke(ev: string | number | null | undefined): number | null {
  if (ev == null) return null;
  const s = String(ev).trim();
  if (s.length === 0) return null;
  // direct numeric
  const n = Number(s);
  if (!isNaN(n) && Number.isFinite(n)) return n;
  // try known mappings for common variants
  const variants = [s, s.replace(/\s+/g,' '), s.toLowerCase(), s.toUpperCase(), s.split(/\s+/).map(x => x.charAt(0).toUpperCase()+x.slice(1).toLowerCase()).join(' ')];
  for (const v of variants) {
    if (eventNameToCode[v]) return eventNameToCode[v];
  }
  // try swapping case words like '200 FLY' -> '200 Fly'
  const words = s.split(/\s+/).map(x => x.charAt(0).toUpperCase()+x.slice(1).toLowerCase()).join(' ');
  if (eventNameToCode[words]) return eventNameToCode[words];
  return null;
}

function normalizeEventToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const t = String(token).trim();
  if (t.length === 0) return null;
  // If it's numeric code already
  if (/^\d+$/.test(t)) return t;
  // Common short codes like '100FR' -> '100 Free'
  const m = t.match(/^(\d+)(?:\s*[-_]?\s*)?([A-Za-z]{2,4})$/);
  if (m) {
    const dist = m[1];
    const suf = m[2].toUpperCase();
    const map: Record<string,string> = { FR: 'Free', FREE: 'Free', BR: 'Breast', BRST: 'Breast', FL: 'Fly', BK: 'Back', IM: 'IM' };
    const stroke = map[suf] || (suf.length <= 4 ? suf : null);
    if (stroke) return `${Number(dist)} ${stroke}`;
  }
  // If it already matches known label, return as-is
  if (eventNameToCode[t]) return t;
  // Try variants: replace 'm' suffix or lowercase
  const cleaned = t.replace(/m$/i, '').replace(/\s+/g, ' ').split(/\s+/).map(s=>s.charAt(0).toUpperCase()+s.slice(1).toLowerCase()).join(' ');
  if (eventNameToCode[cleaned]) return cleaned;
  return t;
}

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams) as Record<string,string>;
  const eventRaw = params.event || '';
  const event = normalizeEventToken(eventRaw) || '';
  const age = params.ageGroup || params.age || '';
  const sex = params.sex || 'M';
  const level = params.level || 'All';
  const monthsToShow = Number(params.months || '12');
  if (!event || !age || !sex) return NextResponse.json({ ok: false, error: 'missing params' }, { status: 400 });

  // key format used in snapshot_entries: `${ev}|${age}|${sex}` where ev is event name
  const key = `${event}|${age}|${sex}`;
    // prepare rows container early so live mode can populate it
    let rows: any[] = [];
    try {
    // live mode: scrape rankings + PBs on-demand instead of relying on persisted DB rows
    const liveMode = String(params.live || params.preview || '').toLowerCase() === '1' || String(params.live || '').toLowerCase() === 'true';
    if (liveMode) {
      try {
        // call internal /api/loadData to get top rankings for the age/sex
        const host = req.headers.get('host') || 'localhost:3000';
        const base = `http://${host}`;
        const stroke = resolveStroke(event) ?? null;
        const dateStr = '31/12/2026';
        const loadUrl = `${base}/api/loadData?pool=L&stroke=${stroke ?? 0}&sex=${encodeURIComponent(String(sex))}&ageGroup=${encodeURIComponent(String(age))}&date=${encodeURIComponent(dateStr)}`;
        const loadRes = await fetch(loadUrl);
        if (loadRes.ok) {
          const loadJson = await loadRes.json().catch(() => ({}));
          const swimmers = (loadJson.swimmers || []).slice(0, 200); // limit to reasonable size
          // fetch PBs for each swimmer (concurrent with small concurrency)
          const concurrency = 6;
          const rowsLive: any[] = [];
          for (let i = 0; i < swimmers.length; i += concurrency) {
            const chunk = swimmers.slice(i, i + concurrency);
            const promises = chunk.map(async (s: any) => {
              try {
                if (!s.tiref) return null;
                const pbUrl = `${base}/api/loadPersonalBest?pool=L&stroke=${stroke ?? 0}&sex=${encodeURIComponent(String(sex))}&ageGroup=${encodeURIComponent(String(age))}&tiref=${encodeURIComponent(String(s.tiref))}&date=${encodeURIComponent(dateStr)}&force=1`;
                const pbRes = await fetch(pbUrl);
                if (!pbRes.ok) return null;
                const pbJson = await pbRes.json().catch(() => ({}));
                const list = pbJson.data || [];
                // map PB list into rows we can use for virtual ranking (one row per PB)
                const mapped = list.map((pb: any) => {
                  // try flexible parsing for pb.date
                  const dt = parseAnyDate(pb.date);
                  const runIso = dt ? dt.toISOString().slice(0,10) : null;
                  return {
                    time: pb.time,
                    name: s.name,
                    tiref: s.tiref,
                    run_iso: runIso,
                    pb_date: pb.date || null,
                    meet: pb.meet || null,
                    payload: pb || null,
                    club: s.club || null,
                    rank: s.rank || null,
                    yob: (pb.yob || pb.payload?.yob || s.yob) ?? null,
                    venue: pb.venue || null,
                    level: pb.level || (pb.payload && pb.payload.level) || null
                  };
                });
                return mapped;
              } catch (e) { return null; }
            });
            const settled = await Promise.all(promises);
            for (const part of settled) if (part && Array.isArray(part)) rowsLive.push(...part);
            if (i + concurrency < swimmers.length) await new Promise(r => setTimeout(r, 100));
          }
          // use rowsLive as `rows` below
          rows = rowsLive;
        }
      } catch (e) {
        // fall back to DB/snapshots behavior below
        console.warn('Live virtualRanking scrape failed, falling back to DB:', String(e));
      }
    }
    // Prefer persisted monthly cutoffs/rankings if present
    if (process.env.USE_SUPABASE === 'true') {
      try {
        const persisted = await getMonthlyCutoffsByKey(key);
        if (persisted && persisted.length) {
          // convert persisted rows into the same shape as previous `months` response
          const series = persisted.map((p: any) => ({ month: p.month, ranking: Array.isArray(p.ranking) ? p.ranking : [] }));
          // If the persisted series exists but contains no ranking entries (likely from an earlier bug),
          // treat it as missing so we fall back to PB/snapshots/live generation.
          const hasAny = series.some((m: any) => Array.isArray(m.ranking) && m.ranking.length > 0);
          if (hasAny) {
            return NextResponse.json({ ok: true, key, months: series });
          } else {
            console.warn('Persisted monthly cutoffs present but empty; falling through to regenerate via PBs/snapshots/live');
          }
        }
      } catch (e) {
        // ignore and continue to PB/snapshot fallback
        console.warn('Failed to read persisted monthly cutoffs, falling back:', String(e));
      }
    }
    // Prefer personal bests (if we've stored event/age/sex on PB payloads).
    // If PB results are small, supplement with snapshot entries so monthly virtual rankings include swimmers scraped from the rankings page.
    let usedPBs = false;
    if (process.env.USE_SUPABASE === 'true') {
      try {
        const pbRows = await getPersonalBestsByEvent(event, age, sex);
        if (pbRows && pbRows.length) {
          usedPBs = true;
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

    // Always fetch snapshot entries and merge when PBs are missing or sparse.
    try {
      const snaps = await getSnapshotEntriesByKey(key);
      if (snaps && snaps.length) {
        // Map snapshots into same shape (snapshot entries have run_iso)
        const mapped = snaps.map((r: any) => ({ time: r.time, name: r.name, tiref: r.tiref, run_iso: r.run_iso || null, pb_date: r.run_iso || null, meet: null, payload: null, club: null, rank: null, yob: null, venue: null, level: null }));
        if (!rows || rows.length === 0) {
          rows = mapped;
        } else {
          // Merge PB rows (prefer PBs) with snapshot rows, unique by tiref or name
          const byId: Record<string, any> = {};
          const add = (r: any) => {
            const id = r.tiref || r.name || JSON.stringify(r.name || '');
            if (!byId[id]) byId[id] = r;
          };
          // prefer PBs first
          rows.forEach(add);
          mapped.forEach(m => add(m));
          rows = Object.values(byId);
        }
      }
    } catch (e) {
      // if snapshot query fails and no PBs, fall back to empty
      if (!rows || rows.length === 0) rows = [];
    }
    // If there are no rows from DB/snapshots, or the rows are sparse (only a single month),
    // attempt a best-effort live scrape so non-`live=1` requests still return useful historical series.
    const rowsMonths = new Set((rows || []).map((r: any) => {
      const raw = r.run_iso || r.pb_date || null;
      return raw ? getMonthKey(String(raw)) : null;
    }).filter(Boolean));
    const isSparse = rowsMonths.size <= 1;
    if ((!rows || rows.length === 0) || isSparse) {
      try {
        const host = req.headers.get('host') || 'localhost:3000';
        const base = `http://${host}`;
        const stroke = resolveStroke(event) ?? null;
        const dateStr = '31/12/2026';
        const loadUrl = `${base}/api/loadData?pool=L&stroke=${stroke ?? 0}&sex=${encodeURIComponent(String(sex))}&ageGroup=${encodeURIComponent(String(age))}&date=${encodeURIComponent(dateStr)}`;
        const loadRes = await fetch(loadUrl);
        if (loadRes.ok) {
          const loadJson = await loadRes.json().catch(() => ({}));
          const swimmers = (loadJson.swimmers || []).slice(0, 200);
          const concurrency = 6;
          const rowsLive: any[] = [];
          for (let i = 0; i < swimmers.length; i += concurrency) {
            const chunk = swimmers.slice(i, i + concurrency);
            const promises = chunk.map(async (s: any) => {
              try {
                if (!s.tiref) return null;
                const pbUrl = `${base}/api/loadPersonalBest?pool=L&stroke=${stroke ?? 0}&sex=${encodeURIComponent(String(sex))}&ageGroup=${encodeURIComponent(String(age))}&tiref=${encodeURIComponent(String(s.tiref))}&date=${encodeURIComponent(dateStr)}&force=1`;
                const pbRes = await fetch(pbUrl);
                if (!pbRes.ok) return null;
                const pbJson = await pbRes.json().catch(() => ({}));
                const list = pbJson.data || [];
                const mapped = list.map((pb: any) => {
                  const dt = parseAnyDate(pb.date);
                  const runIso = dt ? dt.toISOString().slice(0, 10) : null;
                  return {
                    time: pb.time,
                    name: s.name,
                    tiref: s.tiref,
                    run_iso: runIso,
                    pb_date: pb.date || null,
                    meet: pb.meet || null,
                    payload: pb || null,
                    club: s.club || null,
                    rank: s.rank || null,
                    yob: (pb.yob || pb.payload?.yob || s.yob) ?? null,
                    venue: pb.venue || null,
                    level: pb.level || (pb.payload && pb.payload.level) || null
                  };
                });
                return mapped;
              } catch (e) { return null; }
            });
            const settled = await Promise.all(promises);
            for (const part of settled) if (part && Array.isArray(part)) rowsLive.push(...part);
            if (i + concurrency < swimmers.length) await new Promise(r => setTimeout(r, 100));
          }
          rows = rowsLive;
        }
      } catch (e) {
        console.warn('Fallback live scrape failed:', String(e));
      }
    } else {
      // keep existing rows (from PBs/snapshots)
    }
    // build list of months to show (last N months up to latest run)
    // Normalize any pb_date values into run_iso (ISO YYYY-MM-DD) so month extraction works
    rows = (rows || []).map((r: any) => {
      if ((!r.run_iso || r.run_iso === '') && r.pb_date) {
        try {
          const d = parseAnyDate(String(r.pb_date));
          if (d && !Number.isNaN(d.getTime())) {
            r.run_iso = d.toISOString().slice(0,10);
          }
        } catch (e) { /* ignore */ }
      }
      return r;
    });

    // (no debug logging)

    const runDates = (rows || []).map(r => r.run_iso).filter(Boolean).map(d => String(d));

    // Parse run dates robustly and pick the latest real date; cap to today to avoid future query-date artifacts
    const parsedRunDates = runDates.map(s => parseAnyDate(s)).filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
    let latestDateObj: Date;
    if (parsedRunDates.length > 0) {
      latestDateObj = new Date(Math.max(...parsedRunDates.map(d => d.getTime())));
    } else {
      latestDateObj = new Date();
    }
    const now = new Date();
    if (latestDateObj.getTime() > now.getTime()) latestDateObj = now;

    const months: string[] = [];
    const l = latestDateObj;
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
      const rawDate = r.run_iso || r.pb_date || (r.pb_date === 0 ? r.pb_date : null);
      const m = rawDate ? getMonthKey(String(rawDate)) : null;
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
        if (best != null) {
          const yobVal = (sb as any).yob ?? null;
          let ageVal: number | null = null;
          if (yobVal != null) {
            const yNum = Number(String(month).slice(0,4));
            const yobNum = Number(yobVal);
            if (!isNaN(yNum) && !isNaN(yobNum)) ageVal = yNum - yobNum;
          }
          entries.push({ name: sb.name, tiref: sb.tiref, time: best, rank: (sb as any).rank ?? null, club: (sb as any).club ?? null, yob: yobVal, age: ageVal, meet: (sb as any).meet ?? null, venue: (sb as any).venue ?? null, level: (sb as any).level ?? null });
        }
      });
      // sort ascending (fastest first)
      entries.sort((a,b) => a.time - b.time);
      series.push({ month, ranking: entries });
    }

    return NextResponse.json({ ok: true, key, months: series });
    } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any)?.message || e) }, { status: 500 });
  }
}
