import { NextRequest } from 'next/server';
import { eventNameToCode } from '@/utils/eventNameToCode';
import { insertSnapshotRun, insertEventPBImport, insertEventPersonalBests, getEventPersonalBestsByTiref } from '@/lib/supabaseServer';
import util from 'util';
import { parseDateString } from '@/lib/time';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event, ageGroup, sex } = body || {};
    if (!event || !ageGroup || !sex) return Response.json({ ok: false, error: 'missing parameters' }, { status: 400 });

    const strokeNum = eventNameToCode[event];
    if (!strokeNum) return Response.json({ ok: false, error: 'unknown event' }, { status: 400 });

    // get top rankings for this filter via internal API
    const host = req.headers.get('host') || 'localhost:3000';
    const base = `http://${host}`;
    const dateStr = '31/12/2026';
    const loadUrl = new URL(`/api/loadData`, base);
    loadUrl.searchParams.set('pool', 'L');
    loadUrl.searchParams.set('stroke', String(strokeNum));
    loadUrl.searchParams.set('sex', String(sex));
    loadUrl.searchParams.set('ageGroup', String(ageGroup));
    loadUrl.searchParams.set('date', dateStr);

    const res = await fetch(loadUrl.toString());
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return Response.json({ ok: false, error: 'failed to load rankings', detail: txt }, { status: 502 });
    }
    const data = await res.json();
    const swimmers = data.swimmers || [];

    // prepare and insert a run id and iso
    const runIso = new Date().toISOString().slice(0,10);
    const run = { run_iso: runIso, generated_at: new Date().toISOString(), meta: { source: 'storeEventPersonalBests', event, ageGroup, sex } };
    const inserted = await insertSnapshotRun(run);

    // For each swimmer, fetch PBs and filter by event
    const pbsToStore: any[] = [];
    for (let i = 0; i < swimmers.length; i++) {
      const s = swimmers[i];
      if (!s.tiref) continue;
      // Check DB first: if we already have a PB for this swimmer/event/age/sex, skip scraping
      try {
        const existing = await getEventPersonalBestsByTiref(String(s.tiref));
        const matches = (existing || []).filter((r: any) => {
          if (!r) return false;
          if (r.event !== event) return false;
          if (r.age != null && String(r.age).trim() !== '' && String(r.age) !== String(ageGroup)) return false;
          if (r.sex != null && String(r.sex).trim() !== '' && String(r.sex) !== String(sex)) return false;
          return true;
        });
        if (matches.length) {
          // existing PB present — skip scraping
          continue;
        }
      } catch (e) {
        // on DB error, fall back to scraping as before
      }

      const pbUrl = new URL('/api/loadPersonalBest', base);
      pbUrl.searchParams.set('pool', 'L');
      pbUrl.searchParams.set('stroke', String(strokeNum));
      pbUrl.searchParams.set('sex', String(sex));
      pbUrl.searchParams.set('ageGroup', String(ageGroup));
      pbUrl.searchParams.set('tiref', String(s.tiref));
      pbUrl.searchParams.set('date', dateStr);
      // do not force a fresh scrape by default — allow server-side caching to be used

      try {
        const r = await fetch(pbUrl.toString());
        if (!r.ok) continue;
        const j = await r.json();
        const list = j.data || [];
        for (const pb of list) {
          // normalize event from pb.event if present, otherwise derive
          const pbEvent = pb.event || null;
          if (pbEvent && pbEvent !== event) continue; // only store PBs for the selected event
          // parse pb.date (DD/MM/YYYY or DD/MM/YY)
          let pbDateIso: string | null = null;
          try {
            const parsed = parseDateString(String(pb.date || ''));
            if (parsed) pbDateIso = parsed.toISOString().slice(0,10);
          } catch (e) {}
          const timeVal = (pb.time == null) ? null : (typeof pb.time === 'number' ? pb.time : Number(pb.time));
          if (timeVal == null || isNaN(timeVal)) continue;
          pbsToStore.push({
            tiref: s.tiref,
            name: s.name || null,
            event: event,
            age: String(ageGroup),
            sex: String(sex),
            // include ranking & club from the loaded rankings
            rank: s.rank || null,
            club: s.club || null,
            // include any year-of-birth if available on swimmer object
            yob: (s.yob ? s.yob : null),
            // include venue/level from scraped PB row
            venue: pb.venue || null,
            level: pb.level || null,
            time: timeVal,
            meet: pb.meet || null,
            payload: pb,
            pb_date: pbDateIso
          });
        }
      } catch (e) {
        // ignore individual fetch errors
      }
      // polite pause
      await new Promise(resol => setTimeout(resol, 50));
    }

    let eventInsertResult: any = null;
    let eventInsertError: string | null = null;

    // Deduplicate rows that would violate the DB unique constraint when
    // performing a bulk upsert. Unique key: tiref,event,pb_date,time
    let dedupedPbs: any[] = [];
    if (pbsToStore.length) {
      const seen = new Set<string>();
      for (const p of pbsToStore) {
        const key = `${p.tiref}||${p.event}||${p.pb_date || ''}||${p.time}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedPbs.push(p);
        }
      }
    }

    if (dedupedPbs.length) {
      // persist typed event_personal_bests rows
      try {
        const rowsForEvent = dedupedPbs.map(p => ({ ...p, run_id: inserted.run_id }));
        eventInsertResult = await insertEventPersonalBests(rowsForEvent).catch(err => { throw err; });
      } catch (e: any) {
        const serialized = util.inspect(e, { depth: 5 });
        eventInsertError = serialized;
        console.error('Failed to insert event_personal_bests:', serialized);
      }
      // legacy swimmer_personal_bests write removed — writing only to typed `event_personal_bests`
    }

    return Response.json({ ok: true, wouldStore: pbsToStore.length, sample: pbsToStore.slice(0, 10), runId: inserted ? inserted.run_id : null, eventInsertResult, eventInsertError });
  } catch (err: any) {
    const serialized = util.inspect(err, { depth: 5 });
    return Response.json({ ok: false, error: serialized }, { status: 500 });
  }
}
