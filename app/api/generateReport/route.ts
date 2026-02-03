import { NextRequest } from "next/server";
import { getCached, setCached, computeCacheKey } from '@/lib/cache';
import { eventNameToCode } from "@/utils/eventNameToCode";
import fs from 'fs';
import path from 'path';
import { insertSnapshotRun, upsertSnapshotEntries } from '@/lib/supabaseServer';

async function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

export async function GET(req: NextRequest) {
    // Iterate events and ages and sexes to collect Tonbridge swimmers
    const events = Object.keys(eventNameToCode);
    const ages = [13,14,15,16,17,18];
    const sexes = ['M','F'];

    const report: any[] = [];
    const checkedExternal = new Set<string>();
    const calledInternal: string[] = [];
    const debugSamples: Record<string, any> = {};
    const snapshots: Record<string, any[]> = {};
    const snapshotsAll: Record<string, any[]> = {};

    function yearEndDateString() {
        const now = new Date();
        const yyyy = String(now.getFullYear());
        return `31/12/${yyyy}`;
    }

    const runIso = new Date().toISOString().slice(0,10); // YYYY-MM-DD for this run

    for (const ev of events) {
        const stroke = eventNameToCode[ev];
        for (const age of ages) {
            for (const sex of sexes) {
                // fetch rankings using age-as-at 31/12/currentYear
                const dateStr = yearEndDateString();
                const url = `/api/loadData?pool=L&stroke=${stroke}&sex=${sex}&ageGroup=${age}&date=${encodeURIComponent(dateStr)}`;
                    try {
                        calledInternal.push(url);
                        // prefer reusing cached loadData results when available
                        const cacheKey = computeCacheKey({ route: 'rankings', pool: 'L', stroke, sex, ageGroup: age, date: dateStr });
                        const cachedPayload = await getCached(cacheKey);
                        let data: any = null;
                        if (cachedPayload) {
                            data = cachedPayload;
                            if (data?.url) checkedExternal.add(String(data.url));
                            debugSamples[url] = (data.swimmers || []).slice(0, 5);
                        } else {
                            const host = req.headers.get('host') || 'localhost:3000';
                            const base = `http://${host}`;
                            const absolute = new URL(url, base).toString();
                            const res = await fetch(absolute);
                            if (!res.ok) {
                                const txt = await res.text().catch(() => '');
                                debugSamples[url] = { ok: false, status: res.status, text: txt };
                                // small polite pause
                                await sleep(30);
                                continue;
                            }
                            data = await res.json();
                            if (data?.url) checkedExternal.add(String(data.url));
                            debugSamples[url] = (data.swimmers || []).slice(0, 5);
                            try { await setCached(cacheKey, data, 60 * 60 * 6); } catch (e) {}
                        }
                        const swimmers = (data?.swimmers) || [];
                        const tonbridge = swimmers.filter((s: any) => (s.club || '').toLowerCase().includes('tonbridge'));
                        const snapKey = `${ev}|${age}|${sex}|${dateStr}`;
                        snapshots[snapKey] = tonbridge;
                        // store the full rankings for this run (keyed without the date)
                        const keyNoDate = `${ev}|${age}|${sex}`;
                        snapshotsAll[keyNoDate] = (swimmers || []).map((s: any) => ({ name: s.name, tiref: s.tiref, rank: s.rank, time: s.time })).slice(0, 200);
                        for (const t of tonbridge) {
                            let pbs: any[] = [];
                            if (t.tiref) {
                                try {
                                    const pbCacheKey = computeCacheKey({ route: 'personalBest', pool: 'L', stroke, sex, ageGroup: age, tiref: t.tiref, date: dateStr });
                                    const cachedPB = await getCached(pbCacheKey);
                                    if (cachedPB) {
                                        pbs = cachedPB.data || [];
                                        if (cachedPB?.url) checkedExternal.add(String(cachedPB.url));
                                        debugSamples[`pb:${t.tiref}:${dateStr}`] = (pbs || []).slice(0,5);
                                    } else {
                                        const pbPath = `/api/loadPersonalBest?pool=L&stroke=${stroke}&sex=${sex}&ageGroup=${age}&tiref=${t.tiref}&date=${encodeURIComponent(dateStr)}`;
                                        const pbAbsolute = new URL(pbPath, `http://${req.headers.get('host') || 'localhost:3000'}`).toString();
                                        const pbRes = await fetch(pbAbsolute);
                                        if (pbRes.ok) {
                                            const pbJson = await pbRes.json();
                                            pbs = pbJson.data || [];
                                            if (pbJson?.url) checkedExternal.add(String(pbJson.url));
                                            try { await setCached(pbCacheKey, pbJson, 60 * 60 * 24 * 7); } catch (e) {}
                                            debugSamples[`pb:${t.tiref}:${dateStr}`] = (pbs || []).slice(0,5);
                                        } else {
                                            const txt = await pbRes.text().catch(() => '');
                                            debugSamples[pbPath] = { ok: false, status: pbRes.status, text: txt };
                                        }
                                    }
                                } catch (e) {
                                    debugSamples[`err:${t.tiref}`] = String(e);
                                }
                                await sleep(20);
                            }
                            // record appearance with snapshot date
                            report.push({ event: ev, stroke, age, sex, rank: t.rank, name: t.name, club: t.club, tiref: t.tiref, time: t.time, date: dateStr, personalBests: pbs, snapshotFor: dateStr });
                        }
                    } catch (e) {
                        // ignore and continue
                    }
                    await sleep(60);
            }
        }
    }

    // Aggregate by swimmer name (combine entries)
    // We use the year-end date for age determination; keep only that snapshot so each swimmer appears once
    const latestSnapshotDate = yearEndDateString();
    const latestOnly = report.filter(r => r.snapshotFor === latestSnapshotDate);

    const byName: Record<string, any> = {};
    for (const r of latestOnly) {
        const key = r.name + '|' + (r.tiref || '');
        if (!byName[key]) {
            byName[key] = { name: r.name, tiref: r.tiref, club: r.club, appearances: [], best: null };
        }
        byName[key].appearances.push({ event: r.event, age: r.age, sex: r.sex, rank: r.rank, time: r.time, date: r.date });
        // find best time from personalBests
        const times = (r.personalBests || []).map((p: any) => p.time).filter((t: any) => t != null && !isNaN(t));
        if (times.length) {
            const best = Math.min(...times);
            if (byName[key].best == null || best < byName[key].best) byName[key].best = best;
        }
    }

    const out = Object.values(byName).map((v: any) => ({ ...v, best: v.best }));

    const payload = { generatedAt: new Date().toISOString(), count: out.length, swimmers: out, internalUrls: calledInternal, externalUrls: Array.from(checkedExternal), debugSamples, snapshots };
    try {
        // cache for 24 hours by default
        await setCached('fullReport', payload, 24 * 60 * 60);
    } catch (e) {
        // ignore cache errors
    }

    // persist ranking snapshot for this run: prefer Supabase, fallback to .cache filesystem
    try {
        if (process.env.USE_SUPABASE === 'true') {
            const run = { run_iso: runIso, generated_at: new Date().toISOString(), meta: { source: 'generateReport' } };
            try {
                const inserted = await insertSnapshotRun(run);
                const runId = inserted.run_id;
                // build entries from snapshotsAll (keyNoDate -> swimmers[])
                const entries: any[] = [];
                for (const keyNoDate of Object.keys(snapshotsAll)) {
                    const list = snapshotsAll[keyNoDate] || [];
                    for (const s of list) {
                        entries.push({ key: keyNoDate, tiref: s.tiref ?? null, name: s.name ?? null, club: s.club ?? null, rank: s.rank ?? null, time: s.time ?? null, payload: s });
                    }
                }
                if (entries.length) await upsertSnapshotEntries(inserted.run_id, entries);
            } catch (dbErr) {
                // on DB failure, fall back to writing file
                console.error('Supabase write failed, falling back to filesystem:', String(dbErr));
                const snapDir = path.join(process.cwd(), '.cache', 'rankingSnapshots');
                fs.mkdirSync(snapDir, { recursive: true });
                const outSnap = { generatedAt: new Date().toISOString(), runIso, snapshots: snapshotsAll };
                const file = path.join(snapDir, `${runIso}.json`);
                try { fs.writeFileSync(file, JSON.stringify(outSnap), { encoding: 'utf8' }); } catch (e) {}
            }
        } else {
            const snapDir = path.join(process.cwd(), '.cache', 'rankingSnapshots');
            fs.mkdirSync(snapDir, { recursive: true });
            const outSnap = { generatedAt: new Date().toISOString(), runIso, snapshots: snapshotsAll };
            const file = path.join(snapDir, `${runIso}.json`);
            try { fs.writeFileSync(file, JSON.stringify(outSnap), { encoding: 'utf8' }); } catch (e) {}
        }
    } catch (e) {
        // last-resort ignore
    }

    return Response.json(payload);
}
