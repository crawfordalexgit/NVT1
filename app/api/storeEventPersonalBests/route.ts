import { NextRequest } from 'next/server';
import { eventNameToCode } from '@/utils/eventNameToCode';
import { insertSnapshotRun, upsertSwimmerPersonalBests, insertEventPBImport, insertEventPersonalBests } from '@/lib/supabaseServer';
import util from 'util';
import { parseDateString } from '@/lib/time';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Accept either `preview` (preferred) or legacy `dryRun` flag
    const { event, ageGroup, sex, preview, dryRun } = body || {};
    const isPreview = !!preview || !!dryRun;
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

    // prepare a run id and iso (only inserted when not dryRun)
    const runIso = new Date().toISOString().slice(0,10);
    const run = { run_iso: runIso, generated_at: new Date().toISOString(), meta: { source: 'storeEventPersonalBests', event, ageGroup, sex } };
    let inserted: any = null;
    if (!isPreview) {
      inserted = await insertSnapshotRun(run);
    }

    // For each swimmer, fetch PBs and filter by event
    const pbsToStore: any[] = [];
    for (let i = 0; i < swimmers.length; i++) {
      const s = swimmers[i];
      if (!s.tiref) continue;
      const pbUrl = new URL('/api/loadPersonalBest', base);
      pbUrl.searchParams.set('pool', 'L');
      pbUrl.searchParams.set('stroke', String(strokeNum));
      pbUrl.searchParams.set('sex', String(sex));
      pbUrl.searchParams.set('ageGroup', String(ageGroup));
      pbUrl.searchParams.set('tiref', String(s.tiref));
      pbUrl.searchParams.set('date', dateStr);
      pbUrl.searchParams.set('force', '1');

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
    let swimmerUpsertResult: any = null;
    let eventInsertError: string | null = null;
    let swimmerUpsertError: string | null = null;

    if (pbsToStore.length) {
      if (isPreview) {
        // persist the preview for inspection
        try {
          const key = `${event}|${ageGroup}|${sex}`;
          await insertEventPBImport(null, key, event, ageGroup, sex, pbsToStore.length, pbsToStore.slice(0,10), pbsToStore);
        } catch (e) {
          const serialized = util.inspect(e, { depth: 5 });
          console.error('Failed to persist preview:', serialized);
          eventInsertError = serialized;
        }
      } else {
        // persist typed event_personal_bests rows
        try {
          const rowsForEvent = pbsToStore.map(p => ({ ...p, run_id: inserted.run_id }));
          eventInsertResult = await insertEventPersonalBests(rowsForEvent).catch(err => { throw err; });
        } catch (e: any) {
          const serialized = util.inspect(e, { depth: 5 });
          eventInsertError = serialized;
          console.error('Failed to insert event_personal_bests:', serialized);
        }
        // also keep legacy swimmer_personal_bests for compatibility
        try {
          swimmerUpsertResult = await upsertSwimmerPersonalBests(inserted.run_id, runIso, pbsToStore).catch(err => { throw err; });
        } catch (e: any) {
          const serialized = util.inspect(e, { depth: 5 });
          swimmerUpsertError = serialized;
          console.error('Failed to upsert swimmer_personal_bests:', serialized);
        }
      }
    }

    return Response.json({ ok: true, preview: isPreview, wouldStore: pbsToStore.length, sample: pbsToStore.slice(0, 10), runId: inserted ? inserted.run_id : null, eventInsertResult, swimmerUpsertResult, eventInsertError, swimmerUpsertError });
  } catch (err: any) {
    const serialized = util.inspect(err, { depth: 5 });
    return Response.json({ ok: false, error: serialized }, { status: 500 });
  }
}
