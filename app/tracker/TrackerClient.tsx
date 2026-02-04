"use client";
import React, { useState } from "react";
import { useSearchParams } from 'next/navigation';
import { eventNameToCode } from "@/utils/eventNameToCode";
import { LineGraph, Virtual20thSeriesChart } from "@/app/components/Charts";
import Report from "@/app/components/Report";
import { calculateMonthlyCutoffFromTop50, parseTimeString, formatTimeValue, getMonthKey, parseDateString } from "@/lib/time";
import { predictCohort, daysSinceEpoch } from "@/lib/predict";

const eventOptions = Object.keys(eventNameToCode);

export default function TrackerClient() {
    const search = useSearchParams();
    const [event, setEvent] = useState(eventOptions[0]);
    const [ageGroup, setAgeGroup] = useState("");
    const [sex, setSex] = useState<"M" | "F" | "All">("M");
    const [levelFilter, setLevelFilter] = useState<string>('1');
    const [rankings, setRankings] = useState<any[]>([]);
    const [tonbridgeSwimmers, setTonbridgeSwimmers] = useState<any[]>([]);
    const [swimmer, setSwimmer] = useState("");
    const [personalBests, setPersonalBests] = useState<any[]>([]);
    const [allSwimmersBests, setAllSwimmersBests] = useState<any[]>([]);
    const [virtualMonths, setVirtualMonths] = useState<{month:string; ranking:any[]}[]>([]);
    const [showPrevOverlay, setShowPrevOverlay] = useState<boolean>(true);
    const [nextAgeVirtualMonths, setNextAgeVirtualMonths] = useState<{month:string; ranking:any[]}[]>([]);
    const [nextAgeAllSwimmersBests, setNextAgeAllSwimmersBests] = useState<any[]>([]);
    const [monthsWindow, setMonthsWindow] = useState<string>('18');
    const [customStart, setCustomStart] = useState<string>('');
    const [customEnd, setCustomEnd] = useState<string>('');
    const [qualStart, setQualStart] = useState<string>('2026-03-06');
    const [qualEnd, setQualEnd] = useState<string>('2026-05-10');
    const [baselineChoice, setBaselineChoice] = useState<'Dec'|'Jan'>('Dec');
    const [allowFallback, setAllowFallback] = useState<boolean>(true);
    const [excludeSlowerBaseline, setExcludeSlowerBaseline] = useState<boolean>(false);
    const [expandedVirtualMonths, setExpandedVirtualMonths] = useState<Record<string, boolean>>({});
    const [expandedNextAgeVirtualMonths, setExpandedNextAgeVirtualMonths] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(false);
    const [rankTrend, setRankTrend] = useState<{date:string,rank:number|null,time?:any}[]>([]);
    const [internalUrls, setInternalUrls] = useState<string[]>([]);
    const [debugSamples, setDebugSamples] = useState<Record<string, any>>({});
    const [zoom, setZoom] = useState<number>(1);
    const [transformOrigin, setTransformOrigin] = useState<string>('50% 0%');
    const [hoverChart, setHoverChart] = useState<boolean>(false);
    const chartRef = React.useRef<HTMLDivElement | null>(null);

    async function fetchRankings() {
        if (!event || !ageGroup) return;
        setLoading(true);
        let swimmers: any[] = [];
        if (sex === 'All') {
            const urlM = `/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=M&ageGroup=${ageGroup}&date=31/12/2026`;
            const urlF = `/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=F&ageGroup=${ageGroup}&date=31/12/2026`;
            setInternalUrls(prev => [...prev, urlM, urlF]);
            const [mRes, fRes] = await Promise.all([fetch(urlM), fetch(urlF)]);
            const mData = await mRes.json();
            const fData = await fRes.json();
            try { setDebugSamples(prev => ({ ...prev, [`rankings:${event}:M:${ageGroup}`]: (mData.swimmers||[]).slice(0,5), [`rankings:${event}:F:${ageGroup}`]: (fData.swimmers||[]).slice(0,5) })); } catch (e) {}
            swimmers = [...(mData.swimmers || []), ...(fData.swimmers || [])];
            swimmers = swimmers.map((s: any) => ({ ...s, _timeSeconds: typeof s.time === 'number' ? s.time : (typeof s.time === 'string' ? parseTimeString(s.time) : null) }));
            swimmers.sort((a: any, b: any) => (a._timeSeconds ?? Infinity) - (b._timeSeconds ?? Infinity));
            swimmers = swimmers.slice(0, 50).map((s: any, idx: number) => ({ ...s, rank: idx + 1 }));
        } else {
            const url = `/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=${sex}&ageGroup=${ageGroup}&date=31/12/2026`;
            setInternalUrls(prev => [...prev, url]);
            const res = await fetch(url);
            const data = await res.json();
            try { setDebugSamples(prev => ({ ...prev, [`rankings:${event}:${sex}:${ageGroup}`]: (data.swimmers||[]).slice(0,5) })); } catch (e) {}
            swimmers = data.swimmers || [];
        }
        setRankings(swimmers || []);
        const tonbridge = (swimmers || []).filter((r: any) => r.club?.toLowerCase().includes("tonbridge"));
        setTonbridgeSwimmers(tonbridge);
        setLoading(false);
    }

    async function fetchAllSwimmersBests(rankingsList: any[]) {
        setLoading(true);
        // Fetch PBs in parallel with a small concurrency limit to speed up population
        const concurrency = 6;
        const items = (rankingsList || []).filter((r: any) => r && r.tiref);
        const results: any[] = [];
        for (let i = 0; i < items.length; i += concurrency) {
            const chunk = items.slice(i, i + concurrency);
            const promises = chunk.map(async (r: any) => {
                try {
                    const pbUrl = `/api/loadPersonalBest?pool=L&stroke=${eventNameToCode[event]}&sex=${sex==='All'?'M':sex}&ageGroup=${ageGroup}&tiref=${r.tiref}&date=31/12/2026`;
                    setInternalUrls(prev => [...prev, pbUrl]);
                    const pbRes = await fetch(pbUrl);
                    const pbData = await pbRes.json();
                    try { setDebugSamples(prev => ({ ...prev, [`pb:${r.tiref}`]: (pbData.data||[]).slice(0,5) })); } catch (e) {}
                    return { name: r.name, rank: r.rank, data: pbData.data || [] };
                } catch (e) {
                    return { name: r.name, rank: r.rank, data: [] };
                }
            });
            const settled = await Promise.all(promises);
            results.push(...settled);
            // small pause between chunks to avoid hammering the server
            if (i + concurrency < items.length) await new Promise(res => setTimeout(res, 100));
        }
        setAllSwimmersBests(results);
        setLoading(false);
    }

        const isoToMonthKey = (iso: string | undefined | null) => {
            if (!iso) return null;
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return null;
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }

    React.useEffect(() => {
        if (event && ageGroup) fetchRankings();
    }, [event, ageGroup]);

    React.useEffect(() => {
        try {
            const params = search;
            if (!params) return;
            const qEvent = params.get('event');
            const qAge = params.get('ageGroup');
            const qSex = params.get('sex');
            const qSwimmer = params.get('swimmer');
            if (qEvent && eventOptions.includes(qEvent)) setEvent(qEvent);
            if (qAge) setAgeGroup(qAge);
            if (qSex === 'M' || qSex === 'F' || qSex === 'All') setSex(qSex as any);
            if (qSwimmer) setSwimmer(qSwimmer);
        } catch (e) { }
    }, [search]);

    

    React.useEffect(() => {
        if (rankings.length > 0) fetchAllSwimmersBests(rankings);
    }, [rankings]);

    // fetch top-50 rankings and PBs for the next age up cohort
    React.useEffect(() => {
        async function loadNextAgePBs() {
            if (!event || !ageGroup || !sex) return setNextAgeAllSwimmersBests([]);
            const nextAge = String(Number(ageGroup) + 1);
            try {
                const url = `/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=${sex==='All'?'M':sex}&ageGroup=${nextAge}&date=31/12/2026`;
                setInternalUrls(prev => [...prev, url]);
                const res = await fetch(url);
                const j = await res.json();
                const swimmersList = (j.swimmers || []).slice(0, 50).map((s: any, i: number) => ({ ...s, rank: i + 1 }));
                // reuse PB fetch pattern
                const concurrency = 6;
                const results: any[] = [];
                for (let i = 0; i < swimmersList.length; i += concurrency) {
                    const chunk = swimmersList.slice(i, i + concurrency);
                    const promises = chunk.map(async (r: any) => {
                        try {
                            const pbUrl = `/api/loadPersonalBest?pool=L&stroke=${eventNameToCode[event]}&sex=${sex==='All'?'M':sex}&ageGroup=${nextAge}&tiref=${r.tiref}&date=31/12/2026`;
                            setInternalUrls(prev => [...prev, pbUrl]);
                            const pbRes = await fetch(pbUrl);
                            const pbData = await pbRes.json();
                            return { name: r.name, rank: r.rank, data: pbData.data || [] };
                        } catch (e) {
                            return { name: r.name, rank: r.rank, data: [] };
                        }
                    });
                    const settled = await Promise.all(promises);
                    results.push(...settled);
                    if (i + concurrency < swimmersList.length) await new Promise(res => setTimeout(res, 100));
                }
                setNextAgeAllSwimmersBests(results);
            } catch (e) {
                setNextAgeAllSwimmersBests([]);
            }
        }
        loadNextAgePBs();
    }, [event, ageGroup, sex]);

    React.useEffect(() => {
        async function loadVirtual() {
            if (!event || !ageGroup || !sex) return setVirtualMonths([]);
            try {
                const q = new URLSearchParams({ event, ageGroup, sex, months: '18', level: levelFilter });
                const res = await fetch(`/api/virtualRanking?${q.toString()}`);
                if (!res.ok) return setVirtualMonths([]);
                const j = await res.json();
                if (j && j.ok && Array.isArray(j.months)) {
                    setVirtualMonths(j.months || []);
                } else {
                    setVirtualMonths([]);
                }
            } catch (e) {
                setVirtualMonths([]);
            }
        }
        loadVirtual();
    }, [event, ageGroup, sex, levelFilter]);

    

            // Shift next-age months forward by one year so the overlay lines align with current-year months
    const shiftedNextAgeVirtualMonths = React.useMemo(() => {
        if (!nextAgeVirtualMonths || !Array.isArray(nextAgeVirtualMonths)) return [];
        return nextAgeVirtualMonths.map(m => {
            try {
                const parts = String(m.month || '').split('-');
                if (parts.length !== 2) return { ...m };
                const y = Number(parts[0]);
                const mm = parts[1];
                if (isNaN(y)) return { ...m };
                return { ...m, month: `${y + 1}-${mm}` };
            } catch (e) {
                return { ...m };
            }
        });
    }, [nextAgeVirtualMonths]);

    const displayedVirtualMonths = React.useMemo(() => {
        try {
            if (!virtualMonths || virtualMonths.length === 0) return [];
            if (monthsWindow === 'custom' && customStart && customEnd) {
                // months are stored as YYYY-MM; include endpoints
                return virtualMonths.filter(m => m.month >= customStart && m.month <= customEnd);
            }
            const n = Number(monthsWindow || 18);
            if (!isNaN(n) && n > 0) return virtualMonths.slice(-n);
            return virtualMonths;
        } catch (e) { return virtualMonths || []; }
    }, [virtualMonths, monthsWindow, customStart, customEnd]);

    // Ensure previous-year (next-age) virtual months are loaded on mount when overlay is enabled
    React.useEffect(() => {
        async function loadPrev() {
            if (!showPrevOverlay || !event || !ageGroup) return;
            try {
                const nextAge = String(Number(ageGroup) + 1);
                const monthsParam = String((displayedVirtualMonths && displayedVirtualMonths.length) ? displayedVirtualMonths.length : 18);
                const q = new URLSearchParams({ event, ageGroup: nextAge, sex, months: monthsParam, level: levelFilter });
                const res = await fetch(`/api/virtualRanking?${q.toString()}`);
                if (!res.ok) { setNextAgeVirtualMonths([]); return; }
                const j = await res.json();
                if (j && j.ok && Array.isArray(j.months)) setNextAgeVirtualMonths(j.months || []);
                else setNextAgeVirtualMonths([]);
            } catch (e) { setNextAgeVirtualMonths([]); }
        }
        loadPrev();
    }, [showPrevOverlay, event, ageGroup, sex, displayedVirtualMonths.length, levelFilter]);

    // per-chart wheel handler will be attached to the chart container (see below)

    React.useEffect(() => {
        if (!swimmer) return setPersonalBests([]);
        const tracked = allSwimmersBests.find((s: any) => s.name === swimmer);
        setPersonalBests(tracked?.data || []);
    }, [allSwimmersBests, swimmer]);

    async function refreshSelectedSwimmerPB() {
        if (!swimmer) return;
        const s = tonbridgeSwimmers.find((t: any) => t.name === swimmer);
        if (!s || !s.tiref) return;
        setLoading(true);
        try {
            const url = `/api/loadPersonalBest?pool=L&stroke=${eventNameToCode[event]}&sex=${sex==='All'?'M':sex}&ageGroup=${ageGroup}&tiref=${s.tiref}&date=31/12/2026&force=1`;
            setInternalUrls(prev => [...prev, url]);
            const res = await fetch(url);
            const j = await res.json();
            // update local personal bests
            setPersonalBests(j.data || []);
            // also update allSwimmersBests entry for this swimmer
            setAllSwimmersBests(prev => prev.map(p => p.name === swimmer ? { ...p, data: j.data || [] } : p));
        } catch (e) {
            // ignore
        } finally {
            setLoading(false);
        }
    }

    React.useEffect(() => {
        async function loadTrend() {
            if (!swimmer || !event || !ageGroup || !sex) return setRankTrend([]);
            try {
                const q = new URLSearchParams({ name: swimmer, event, age: String(ageGroup), sex, limit: '12' });
                const res = await fetch(`/api/rankingTrend?${q.toString()}`);
                if (!res.ok) return setRankTrend([]);
                const j = await res.json();
                setRankTrend(j.data || []);
            } catch (e) {
                setRankTrend([]);
            }
        }
        loadTrend();
    }, [swimmer, event, ageGroup, sex]);

    const trendKPIs = React.useMemo(() => {
        try {
            if (!rankTrend || rankTrend.length === 0) return null;
            const valid = rankTrend.filter(r => r.rank != null).map((r,i)=>({i,rank:r.rank!}));
            if (valid.length < 2) return { netChange: null, slope: null, runs: valid.length };
            // net change: previous-first to latest (positive = improved)
            const first = valid[0].rank;
            const last = valid[valid.length-1].rank;
            const netChange = (first as number) - (last as number);

            // simple linear regression slope (rank vs index)
            const n = valid.length;
            const xs = valid.map(v=>v.i);
            const ys = valid.map(v=>v.rank);
            const meanX = xs.reduce((a,b)=>a+b,0)/n;
            const meanY = ys.reduce((a,b)=>a+b,0)/n;
            let num = 0; let den = 0;
            for (let k=0;k<n;k++) { num += (xs[k]-meanX)*(ys[k]-meanY); den += (xs[k]-meanX)*(xs[k]-meanX); }
            const slope = den === 0 ? 0 : num/den; // ranks per run (negative = improving)
            return { netChange, slope, runs: n };
        } catch (e) { return null; }
    }, [rankTrend]);

    const computed = React.useMemo(() => {
        try {
            if (!allSwimmersBests || allSwimmersBests.length === 0) return { cutoffSeries: [], trackedSeries: [], kpis: null };
            const swimmersForCutoff = allSwimmersBests.map((s: any) => ({ name: s.name, data: s.data || [] }));
            // determine parameters for cutoff calculation: prefer explicit custom range, otherwise align with displayed months
            let startMonth: string | undefined = undefined;
            let endMonth: string | undefined = undefined;
            if (monthsWindow === 'custom' && customStart && customEnd) {
                startMonth = customStart;
                endMonth = customEnd;
            } else if (displayedVirtualMonths && displayedVirtualMonths.length > 0) {
                startMonth = displayedVirtualMonths[0].month;
                endMonth = displayedVirtualMonths[displayedVirtualMonths.length - 1].month;
            }
            const monthsToShow = startMonth && endMonth ? undefined : Number(monthsWindow || 18);
            const { cutoffSeries, trackedSeries } = calculateMonthlyCutoffFromTop50(swimmersForCutoff, rankings, swimmer || undefined, ageGroup || '13', monthsToShow as any, startMonth, endMonth, levelFilter);

            // KPIs
            let monthsMeeting = 0;
            let virtualCount = 0;
            let sumMargins = 0;
            let marginCount = 0;
            let monthsRecorded = 0;
            for (let i = 0; i < cutoffSeries.length; i++) {
                const c = cutoffSeries[i];
                const t = trackedSeries[i];
                if (c && c.cutoff != null && t && t.time != null) {
                    monthsRecorded++;
                    const margin = c.cutoff - t.time; // positive means swimmer is faster than cutoff
                    if (!isNaN(margin)) {
                        sumMargins += margin;
                        marginCount++;
                    }
                    if (t.time <= c.cutoff) monthsMeeting++;
                }
                if (c && c.reason && String(c.reason).startsWith('virtual')) virtualCount++;
            }
            const avgMargin = marginCount > 0 ? (sumMargins / marginCount) : null;
            const latestMargin = (() => {
                if (cutoffSeries.length === 0) return null;
                const lastIdx = cutoffSeries.length - 1;
                const c = cutoffSeries[lastIdx];
                const t = trackedSeries[lastIdx];
                if (!c || c.cutoff == null || !t || t.time == null) return null;
                return c.cutoff - t.time;
            })();

            const monthsShown = cutoffSeries.length;
            return { cutoffSeries, trackedSeries, kpis: { monthsMeeting, virtualCount, avgMargin, latestMargin, monthsShown, monthsRecorded } };
        } catch (e) {
            return { cutoffSeries: [], trackedSeries: [], kpis: null };
        }
    }, [allSwimmersBests, rankings, swimmer, ageGroup, displayedVirtualMonths, monthsWindow, customStart, customEnd, levelFilter]);

    const predictionData = React.useMemo(() => {
        try {
            const rows: any[] = [];
            // Use next-age cohort for predictions
            if (!nextAgeAllSwimmersBests || nextAgeAllSwimmersBests.length === 0) return { rows: [], avgDrop: null, usedCount: 0, skippedCount: 0 };
            // For next-age cohort we compare their PB timeline shifted back one year
            const qualEndDateRaw = new Date(qualEnd);
            if (Number.isNaN(qualEndDateRaw.getTime())) return { rows: [], avgDrop: null, usedCount: 0, skippedCount: nextAgeAllSwimmersBests.length };
            const qualEndDate = new Date(qualEndDateRaw);
            qualEndDate.setFullYear(qualEndDate.getFullYear() - 1);
            const qualYear = qualEndDate.getFullYear();
            const baselineMonth = baselineChoice === 'Dec' ? `${qualYear - 1}-12` : `${qualYear}-01`;
            const nameToTiref: Record<string,string> = Object.fromEntries((nextAgeAllSwimmersBests || []).map((r:any) => [r.name, r.tiref || '']));

            const drops: number[] = [];
            // determine tracked swimmer baseline (for exclusion filter)
            let trackedBaselineTime: number | null = null;
            if (swimmer) {
                const tracked = (allSwimmersBests || []).find((x: any) => x.name === swimmer);
                if (tracked && Array.isArray(tracked.data)) {
                    const qualEndDateRawTracked = new Date(qualEnd);
                    if (!Number.isNaN(qualEndDateRawTracked.getTime())) {
                        const qualYearTracked = qualEndDateRawTracked.getFullYear();
                        const baselineMonthTracked = baselineChoice === 'Dec' ? `${qualYearTracked - 1}-12` : `${qualYearTracked}-01`;
                        const parsedTracked = (tracked.data || []).map((pb: any) => {
                            let d = parseDateString(pb.date);
                            if (!d) {
                                const nd = new Date(pb.date);
                                if (!Number.isNaN(nd.getTime())) d = nd;
                            }
                            const t = pb.time == null ? null : (typeof pb.time === 'number' ? pb.time : (typeof pb.time === 'string' ? parseTimeString(pb.time) : null));
                            return { raw: pb, d, t };
                        }).filter((x: any) => x.d);
                        const baselineMatchesTracked = parsedTracked.filter((p:any) => `${p.d.getFullYear()}-${String(p.d.getMonth()+1).padStart(2,'0')}` === baselineMonthTracked && p.t != null);
                        if (baselineMatchesTracked.length > 0) {
                            baselineMatchesTracked.sort((a:any,b:any) => b.d.getTime() - a.d.getTime());
                            trackedBaselineTime = baselineMatchesTracked[0].t;
                        } else if (allowFallback) {
                            const baselineStartTracked = new Date(`${baselineMonthTracked}-01`);
                            const beforeTracked = parsedTracked.filter((p:any) => p.d.getTime() < baselineStartTracked.getTime() && p.t != null);
                            if (beforeTracked.length > 0) { beforeTracked.sort((a:any,b:any) => b.d.getTime() - a.d.getTime()); trackedBaselineTime = beforeTracked[0].t; }
                        }
                    }
                }
            }
                for (const s of nextAgeAllSwimmersBests) {
                const parsed = (s.data || []).map((pb: any) => {
                    let d = parseDateString(pb.date);
                    if (!d) {
                        const nd = new Date(pb.date);
                        if (!Number.isNaN(nd.getTime())) d = nd;
                    }
                    const t = pb.time == null ? null : (typeof pb.time === 'number' ? pb.time : (typeof pb.time === 'string' ? parseTimeString(pb.time) : null));
                    return { raw: pb, d, t };
                }).filter((x: any) => x.d);

                // baseline exact month
                const baselineMatches = parsed.filter((p:any) => `${p.d.getFullYear()}-${String(p.d.getMonth()+1).padStart(2,'0')}` === baselineMonth && p.t != null);
                let baselineEntry: any = null;
                if (baselineMatches.length > 0) {
                    baselineMatches.sort((a:any,b:any) => b.d.getTime() - a.d.getTime());
                    baselineEntry = baselineMatches[0];
                } else if (allowFallback) {
                    const baselineStart = new Date(`${baselineMonth}-01`);
                    const before = parsed.filter((p:any) => p.d.getTime() < baselineStart.getTime() && p.t != null);
                    if (before.length > 0) {
                        before.sort((a:any,b:any) => b.d.getTime() - a.d.getTime());
                        baselineEntry = before[0];
                    }
                }

                // end PB: most recent PB with date <= qualEndDate (shifted back one year for age-up comparison)
                const ends = parsed.filter((p:any) => p.d.getTime() <= qualEndDate.getTime() && p.t != null);
                let endEntry: any = null;
                if (ends.length > 0) {
                    ends.sort((a:any,b:any) => b.d.getTime() - a.d.getTime());
                    endEntry = ends[0];
                }

                const baselineTime = baselineEntry && typeof baselineEntry.t === 'number' ? baselineEntry.t : null;
                const endTime = endEntry && typeof endEntry.t === 'number' ? endEntry.t : null;
                const drop = (typeof baselineTime === 'number' && typeof endTime === 'number') ? (baselineTime - endTime) : null;

                // compute age if possible from yob fields in PB payloads or fallback to nextAge
                let yob: number | null = null;
                for (const pb of (s.data || [])) {
                    const maybe = (pb && (pb.yob || (pb.payload && pb.payload.yob))) || null;
                    if (maybe) {
                        const n = Number(String(maybe).slice(0,4));
                        if (!isNaN(n)) { yob = n; break; }
                    }
                }
                const nextAgeNum = Number(ageGroup) + 1;
                const ageDisplay = yob ? (qualYear - yob) : (isNaN(nextAgeNum) ? '' : String(nextAgeNum));

                // optionally exclude next-age swimmers whose baseline is slower than tracked swimmer's baseline
                const shouldExclude = excludeSlowerBaseline && trackedBaselineTime != null && (baselineTime == null || baselineTime > trackedBaselineTime);
                if (shouldExclude) continue;

                if (typeof drop === 'number' && !isNaN(drop)) drops.push(drop);

                const baselineDate = baselineEntry && baselineEntry.d ? baselineEntry.d.toISOString().slice(0,10) : null;
                const baselineSource = (baselineMatches.length > 0 ? 'exact' : (baselineEntry ? 'fallback' : null));
                rows.push({
                    name: s.name,
                    tiref: nameToTiref[s.name] || '',
                    age: ageDisplay,
                    baselineMonth,
                    baselineTime,
                    baselineDate,
                    baselineSource,
                    endTime,
                    drop,
                    predictedTime: null
                });
            }

            const avgDrop = drops.length > 0 ? (drops.reduce((a,b) => a + b, 0) / drops.length) : null;
            const rowsFinal = rows.map(r => ({ ...r, predictedTime: typeof r.endTime === 'number' ? r.endTime : (r.baselineTime != null && avgDrop != null ? r.baselineTime - avgDrop : null) }));
            return { rows: rowsFinal, avgDrop, usedCount: drops.length, skippedCount: (nextAgeAllSwimmersBests || []).length - rowsFinal.length };
        } catch (e) {
            return { rows: [], avgDrop: null, usedCount: 0, skippedCount: allSwimmersBests ? allSwimmersBests.length : 0 };
        }
    }, [allSwimmersBests, nextAgeAllSwimmersBests, baselineChoice, allowFallback, qualEnd, rankings, swimmer, excludeSlowerBaseline]);

    const cohortPrediction = React.useMemo(() => {
        try {
            if (!nextAgeAllSwimmersBests || nextAgeAllSwimmersBests.length === 0) return null;
            const qualEndDateRaw = new Date(qualEnd);
            if (Number.isNaN(qualEndDateRaw.getTime())) return null;
            // shift next-age comparison back one year
            const shifted = new Date(qualEndDateRaw);
            shifted.setFullYear(shifted.getFullYear() - 1);
            const shiftedIso = shifted.toISOString().slice(0,10);
            const cohortPBs = (nextAgeAllSwimmersBests || []).map((s:any) => ({
                name: s.name,
                pbs: (s.data || []).map((pb:any) => ({ date: pb.date, timeSec: (typeof pb.time === 'number' ? pb.time : (typeof pb.time === 'string' ? parseTimeString(pb.time) : NaN)) }))
                    .filter((p:any) => Number.isFinite(p.timeSec) && p.date)
            }));
            return predictCohort(cohortPBs, shiftedIso);
        } catch (e) { return null; }
    }, [nextAgeAllSwimmersBests, qualEnd]);

    const trackedTrendPrediction = React.useMemo(() => {
        try {
            if (!swimmer) return null;
            const s = allSwimmersBests.find((x: any) => x.name === swimmer);
            if (!s) return null;
            const qualEndDateRaw = new Date(qualEnd);
            if (Number.isNaN(qualEndDateRaw.getTime())) return null;
            const qualDay = daysSinceEpoch(qualEndDateRaw.toISOString().slice(0,10));
            const pts = (s.data || []).map((pb: any) => {
                const x = daysSinceEpoch(pb.date);
                const y = pb.time == null ? NaN : (typeof pb.time === 'number' ? pb.time : (typeof pb.time === 'string' ? parseTimeString(pb.time) : NaN));
                return { x, y };
            }).filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
            if (pts.length === 0) return null;
            const xs = pts.map((p: any) => p.x);
            const ys = pts.map((p: any) => p.y);
            const n = xs.length;
            const meanX = xs.reduce((a: number, b: number) => a + b, 0) / n;
            const meanY = ys.reduce((a: number, b: number) => a + b, 0) / n;
            let num = 0; let den = 0;
            for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) * (xs[i] - meanX); }
            const swimmerSlope = den === 0 ? 0 : num / den;
            const intercept = meanY - swimmerSlope * meanX;
            const k = 3;
            const cohortSlope = cohortPrediction && cohortPrediction.cohortSlope != null ? cohortPrediction.cohortSlope : null;
            const finalSlope = (swimmerSlope == null || n < 2) ? cohortSlope : ((n / (n + k)) * swimmerSlope + (k / (n + k)) * (cohortSlope ?? swimmerSlope));
            const baseline = pts.reduce((a: any, b: any) => (a.x > b.x ? a : b));
            const daysToQual = qualDay - baseline.x;
            const predicted = baseline && (typeof finalSlope === 'number' && Number.isFinite(finalSlope)) ? (baseline.y + finalSlope * daysToQual) : null;
            const method = n >= 3 ? 'linear' : (n === 2 ? 'two-point' : 'cohort');
            return { predicted, method, n, finalSlope };
        } catch (e) { return null; }
    }, [swimmer, allSwimmersBests, cohortPrediction, qualEnd]);

    const trackedPrediction = React.useMemo(() => {
        try {
            if (!swimmer) return null;
            const avgDrop = (predictionData && predictionData.avgDrop) || null;
            const s = allSwimmersBests.find((x: any) => x.name === swimmer);
            if (!s) return null;

            const qualEndDateRaw = new Date(qualEnd);
            if (Number.isNaN(qualEndDateRaw.getTime())) return null;
            const qualYear = qualEndDateRaw.getFullYear();
            const baselineMonthTracked = baselineChoice === 'Dec' ? `${qualYear - 1}-12` : `${qualYear}-01`;

            const parsed = (s.data || []).map((pb: any) => {
                let d = parseDateString(pb.date);
                if (!d) {
                    const nd = new Date(pb.date);
                    if (!Number.isNaN(nd.getTime())) d = nd;
                }
                const t = pb.time == null ? null : (typeof pb.time === 'number' ? pb.time : (typeof pb.time === 'string' ? parseTimeString(pb.time) : null));
                return { raw: pb, d, t };
            }).filter((x: any) => x.d);

            // baseline for tracked swimmer
            const baselineMatches = parsed.filter((p:any) => `${p.d.getFullYear()}-${String(p.d.getMonth()+1).padStart(2,'0')}` === baselineMonthTracked && p.t != null);
            let baselineEntry: any = null;
            if (baselineMatches.length > 0) {
                baselineMatches.sort((a:any,b:any) => b.d.getTime() - a.d.getTime());
                baselineEntry = baselineMatches[0];
            } else if (allowFallback) {
                const baselineStart = new Date(`${baselineMonthTracked}-01`);
                const before = parsed.filter((p:any) => p.d.getTime() < baselineStart.getTime() && p.t != null);
                if (before.length > 0) { before.sort((a:any,b:any) => b.d.getTime() - a.d.getTime()); baselineEntry = before[0]; }
            }

            // observed end PB for tracked swimmer up to qualEnd (not shifted)
            const ends = parsed.filter((p:any) => p.d.getTime() <= qualEndDateRaw.getTime() && p.t != null);
            let endEntry: any = null;
            if (ends.length > 0) { ends.sort((a:any,b:any) => b.d.getTime() - a.d.getTime()); endEntry = ends[0]; }

            const baselineTime = baselineEntry && typeof baselineEntry.t === 'number' ? baselineEntry.t : null;
            const endTime = endEntry && typeof endEntry.t === 'number' ? endEntry.t : null;
            // Prefer observed end PB only if it is strictly after the baseline PB.
            // If the most-recent observed PB up to qual end is the same as (or earlier than)
            // the baseline month entry, apply cohort average drop to predict improvement.
            let predicted: number | null = null;
            if (endTime != null && baselineTime != null) {
                if (endEntry && baselineEntry && endEntry.d.getTime() > baselineEntry.d.getTime()) {
                    predicted = endTime; // swimmer already has a later observed PB
                } else if (avgDrop != null) {
                    predicted = baselineTime - avgDrop; // apply cohort drop
                } else {
                    predicted = endTime; // fallback to observed
                }
            } else {
                predicted = endTime != null ? endTime : (baselineTime != null && avgDrop != null ? baselineTime - avgDrop : null);
            }
            return { baselineTime, endTime, avgDrop, predicted };
            return { baselineTime, endTime, avgDrop, predicted };
        } catch (e) { return null; }
    }, [swimmer, allSwimmersBests, baselineChoice, allowFallback, qualEnd, predictionData]);

    return (
        <div className="p-8 max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">TSC National Qualification Tracker</h1>
            <form className="space-y-4 card" onSubmit={e => e.preventDefault()}>
                {/* debug toggle hidden */}
                <div>
                    <label className="block mb-1">Event</label>
                    <select value={event} onChange={e => setEvent(e.target.value)} className="w-full p-2 border rounded bg-gray-900 text-white">
                        {eventOptions.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block mb-1">Age Group</label>
                    <select value={ageGroup} onChange={e => setAgeGroup(e.target.value)} className="w-full p-2 border rounded bg-gray-900 text-white" required>
                        <option value="">Select age</option>
                        {[13,14,15,16,17,18].map(age => (
                            <option key={age} value={age}>{age}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block mb-1">Sex</label>
                    <select value={sex} onChange={e => setSex(e.target.value as any)} className="w-full p-2 border rounded bg-gray-900 text-white">
                        <option value="M">Male</option>
                        <option value="F">Female</option>
                        <option value="All">Both (M+F)</option>
                    </select>
                </div>
                <div>
                    <label className="block mb-1">Level</label>
                    <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} className="w-full p-2 border rounded bg-gray-900 text-white">
                        <option value="1">L1 only</option>
                        <option value="2">L2</option>
                        <option value="3">L3</option>
                        <option value="All">All levels</option>
                    </select>
                </div>
                <div>
                    <label className="block mb-1">Swimmer Name (Tonbridge only)</label>
                    <select value={swimmer} onChange={e => setSwimmer(e.target.value)} className="w-full p-2 border rounded bg-gray-900 text-white" disabled={tonbridgeSwimmers.length === 0} required>
                        <option value="">Select swimmer</option>
                        {tonbridgeSwimmers.map((s: any) => (
                            <option key={s.tiref} value={s.name}>{s.name} (Rank {s.rank})</option>
                        ))}
                    </select>
                    <div className="mt-2">
                        <button className="btn btn-sm" type="button" onClick={refreshSelectedSwimmerPB} disabled={!swimmer || loading}>Refresh PB</button>
                        <button className="btn btn-sm ml-2" type="button" onClick={async () => {
                            if (!event || !ageGroup || !sex) return alert('select event/age/sex first');
                            if (!confirm(`Fetch and store PBs for ${event} ${sex} ${ageGroup}?`)) return;
                            setLoading(true);
                            try {
                                const res = await fetch('/api/storeEventPersonalBests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, ageGroup, sex }) });
                                const j = await res.json();
                                if (res.ok && j.ok) {
                                    alert(`Stored ${j.stored} PB rows (run ${j.runId})`);
                                } else {
                                    alert('Failed: ' + (j.error || JSON.stringify(j)));
                                }
                            } catch (e) {
                                alert('Error: ' + String(e));
                            } finally { setLoading(false); }
                        }} disabled={loading}>Fetch & Store PBs</button>

                        

                        <button className="btn btn-ghost btn-sm ml-2" type="button" onClick={async () => {
                            if (!event || !ageGroup || !sex) return alert('select event/age/sex first');
                            setLoading(true);
                            try {
                                const res = await fetch('/api/storeEventPersonalBests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, ageGroup, sex, preview: true }) });
                                const j = await res.json();
                                if (res.ok && j.ok) {
                                    const sampleText = (j.sample || []).map((r: any, idx: number) => `${idx+1}. ${r.tiref} ${r.name} ${r.pb_date || ''} ${r.time} (${r.meet || ''})`).join('\n');
                                    alert(`Stored preview: would store ${j.wouldStore} rows. Sample:\n\n${sampleText}`);
                                } else {
                                    alert('Failed: ' + (j.error || JSON.stringify(j)));
                                }
                            } catch (e) {
                                alert('Error: ' + String(e));
                            } finally { setLoading(false); }
                        }} disabled={loading}>Store Preview</button>
                    </div>
                </div>
            </form>
            {loading && (
                <div className="mt-6 flex items-center space-x-3" role="status" aria-live="polite">
                    <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                    </svg>
                    <div className="text-white">Loading…</div>
                </div>
            )}

            {/* KPIs + Graph: placed immediately under filters as requested */}
            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-2">Historical Qualifying Time Graph</h2>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
                    <div className="card p-4 btn-accent">
                        <div className="text-sm text-gray-800">Rank Trend</div>
                        <div className="text-2xl font-bold">
                            {trendKPIs ? (
                                trendKPIs.netChange == null ? '--' : (() => {
                                    const arrow = trendKPIs.netChange > 0 ? '▲' : (trendKPIs.netChange < 0 ? '▼' : '—');
                                    const sign = trendKPIs.netChange > 0 ? '+' : (trendKPIs.netChange < 0 ? '' : '');
                                    const latestRank = rankTrend.filter(r=>r.rank!=null).slice(-1)[0]?.rank ?? null;
                                    return `${arrow} ${sign}${Math.abs(trendKPIs.netChange)} (${latestRank ? '#'+latestRank : 'n/a'})`;
                                })()
                            ) : '--'}
                        </div>
                        <div className="text-xs text-gray-300 mt-1">{trendKPIs ? `slope ${trendKPIs.slope ? trendKPIs.slope.toFixed(2) : '0.00'} ranks/run over ${trendKPIs.runs} runs` : ''}</div>
                    </div>
                    <div className="card p-4 btn-accent">
                        <div className="text-sm text-gray-800">Avg Margin</div>
                        <div className="text-2xl font-bold">{computed.kpis ? (computed.kpis.avgMargin == null ? '--' : (computed.kpis.avgMargin >= 0 ? '+' : '-') + formatTimeValue(Math.abs(computed.kpis.avgMargin))) : "--"}</div>
                    </div>
                    <div className="card p-4 btn-accent">
                        <div className="text-sm text-gray-800">Latest Margin</div>
                        <div className="text-2xl font-bold">{computed.kpis ? (computed.kpis.latestMargin == null ? '--' : (computed.kpis.latestMargin >= 0 ? '+' : '-') + formatTimeValue(Math.abs(computed.kpis.latestMargin))) : "--"}</div>
                    </div>
                    <div className="card p-4 btn-accent" title="Predicted Qual Time: baseline minus cohort avg drop (simple method). Hover for details.">
                        <div className="text-sm text-gray-800">Predicted Qual Time</div>
                        <div className="text-2xl font-bold">{trackedPrediction && trackedPrediction.predicted != null ? formatTimeValue(trackedPrediction.predicted) : '--'}</div>
                        <div className="text-xs text-gray-300 mt-1">{trackedPrediction && trackedPrediction.avgDrop != null ? `based on avg drop ${trackedPrediction.avgDrop ? formatTimeValue(trackedPrediction.avgDrop) : ''}` : ''}</div>
                    </div>
                    <div className="card p-4 btn-accent" title="Trend-based cohort prediction: fits per-swimmer linear trends, shrunk toward cohort slope; shows predicted time at qualifying end.">
                        <div className="text-sm text-gray-800">Predicted (Trend)</div>
                        <div className="text-2xl font-bold">{trackedTrendPrediction && trackedTrendPrediction.predicted != null ? formatTimeValue(trackedTrendPrediction.predicted) : '--'}</div>
                        <div className="text-xs text-gray-300 mt-1">{trackedTrendPrediction ? `${trackedTrendPrediction.method} (n=${trackedTrendPrediction.n})` : ''} {cohortPrediction && cohortPrediction.cohortSlope != null ? ` • cohort ${cohortPrediction.cohortSlope.toFixed(6)} sec/day` : ''}</div>
                    </div>
                    
                </div>

                {/* Prediction card removed per request */}

                {/* Virtual 20th series chart (last 12 months) */}
                {virtualMonths && virtualMonths.length > 0 ? (
                    <div className="mt-4">
                                <div className="card p-4">
                                    <div className="flex items-center gap-3 mb-3">
                                    <label className="text-sm text-gray-300">Window</label>
                                    <select className="p-2 bg-gray-800 text-white rounded" value={monthsWindow} onChange={e => setMonthsWindow(e.target.value)}>
                                        <option value="6">Last 6 months</option>
                                        <option value="12">Last 12 months</option>
                                        <option value="18">Last 18 months</option>
                                        <option value="24">Last 24 months</option>
                                        <option value="custom">Custom range</option>
                                    </select>
                                    {monthsWindow === 'custom' && (
                                        <div className="flex items-center gap-2">
                                            <input type="month" value={customStart} onChange={e => setCustomStart(e.target.value)} className="p-2 bg-gray-800 text-white rounded" />
                                            <span className="text-gray-400">to</span>
                                            <input type="month" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="p-2 bg-gray-800 text-white rounded" />
                                        </div>
                                    )}

                                        <input type="date" value={qualStart} onChange={e => setQualStart(e.target.value)} className="p-2 bg-gray-800 text-white rounded" />
                                        <span className="text-gray-400">to</span>
                                        <input type="date" value={qualEnd} onChange={e => setQualEnd(e.target.value)} className="p-2 bg-gray-800 text-white rounded" />
                                    </div>
                                    <div className="mb-2 flex items-center justify-between">
                                        <div className="text-sm text-gray-300">Qualifying Baseline</div>
                                        <div className="text-xs text-gray-400 flex items-center gap-2" title="Use mouse wheel to zoom the graph. Double-click to reset zoom."> 
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8z" />
                                            </svg>
                                            <div className="hidden sm:block">Use mouse wheel to zoom, double-click to reset</div>
                                        </div>
                                    </div>
                                    <div ref={chartRef} onMouseEnter={() => setHoverChart(true)} onMouseLeave={() => setHoverChart(false)} onWheel={(e) => {
                                        e.preventDefault();
                                        try {
                                            const rect = chartRef.current?.getBoundingClientRect();
                                            const delta = (e as React.WheelEvent).deltaY;
                                            // adjust zoom
                                            setZoom(z => {
                                                const factor = delta > 0 ? 0.9 : 1.1;
                                                const next = Math.max(1, Math.min(6, +(z * factor).toFixed(3)));
                                                return next;
                                            });
                                            // compute transform origin relative to cursor if we have rect
                                            if (rect) {
                                                const clientX = (e as any).clientX as number;
                                                const clientY = (e as any).clientY as number;
                                                const xPercent = ((clientX - rect.left) / rect.width) * 100;
                                                const yPercent = ((clientY - rect.top) / rect.height) * 100;
                                                setTransformOrigin(`${xPercent}% ${yPercent}%`);
                                            }
                                        } catch (err) { }
                                    }} onDoubleClick={() => { setZoom(1); setTransformOrigin('50% 0%'); }} style={{ overflow: 'hidden' }}>
                                        <div style={{ transform: `scale(${zoom})`, transformOrigin }}>
                                            <Virtual20thSeriesChart months={displayedVirtualMonths || []} trackedSeries={computed.trackedSeries || []} compareMonths={shiftedNextAgeVirtualMonths} highlightStart={qualStart} highlightEnd={qualEnd} />
                                        </div>
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                            <input id="prevOverlay" type="checkbox" checked={showPrevOverlay} onChange={async (e) => {
                                const checked = e.target.checked;
                                setShowPrevOverlay(checked);
                                if (checked && event && ageGroup) {
                                    const nextAge = String(Number(ageGroup) + 1);
                                    // request same months count as displayed (fallback to 18)
                                    const monthsParam = String(displayedVirtualMonths.length || 18);
                                    try {
                                        const q = new URLSearchParams({ event, ageGroup: nextAge, sex, months: monthsParam, level: levelFilter });
                                        const res = await fetch(`/api/virtualRanking?${q.toString()}`);
                                        if (!res.ok) { setNextAgeVirtualMonths([]); return; }
                                        const j = await res.json();
                                        if (j && j.ok && Array.isArray(j.months)) setNextAgeVirtualMonths(j.months || []);
                                        else setNextAgeVirtualMonths([]);
                                    } catch (err) {
                                        setNextAgeVirtualMonths([]);
                                    }
                                } else if (!checked) {
                                    setNextAgeVirtualMonths([]);
                                }
                            }} />
                            <label htmlFor="prevOverlay" className="text-sm text-gray-300">Previous Year</label>
                        </div>
                                </div>
                    </div>
                ) : (
                    <div className="mt-4 text-sm text-gray-300">No virtual monthly data available for the selected event/age yet.</div>
                )}
                <div className="mt-4">
                    <Report rankings={rankings} allSwimmersBests={allSwimmersBests} ageGroup={ageGroup} />
                </div>
            </div>

            <details className="mt-8 card p-4 btn-accent">
                <summary className="text-xl font-semibold mb-2 cursor-pointer">Top 50 Rankings</summary>
                {rankings.length > 0 && (
                    <ul className="space-y-1 mt-2">
                        {rankings.map((r, i) => (
                            <li key={i} className="card">{r.rank}. {r.name} ({r.time}) {r.club}</li>
                        ))}
                    </ul>
                )}
            </details>

            {false && (
                <div className="mt-6">
                    <details className="card p-4 btn-accent">
                        <summary className="cursor-pointer text-sm font-semibold text-white">Debug — internal calls & samples</summary>
                        <div className="mt-3 text-xs text-gray-300">
                            <div className="mb-2"><strong>Internal URLs:</strong></div>
                            <div className="mb-2 text-xs text-gray-200">
                                {internalUrls.slice(-50).map((u,i) => <div key={i}><code>{u}</code></div>)}
                            </div>
                            <div className="mb-2"><strong>Samples:</strong></div>
                            <div className="text-xs text-gray-200">
                                {Object.entries(debugSamples).map(([k,v],i) => (
                                    <div key={i} className="mb-2">
                                        <div className="text-xs font-semibold">{k}</div>
                                        <pre className="text-xs text-gray-200 p-2 bg-gray-800 rounded overflow-auto">{JSON.stringify(v, null, 2)}</pre>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </details>
                </div>
            )}

            <details className="mt-8 card p-4 btn-accent">
                <summary className="text-xl font-semibold mb-2 cursor-pointer">Personal Bests for {swimmer}</summary>
                {personalBests.length > 0 && (
                    <ul className="space-y-1 mt-2">
                        {personalBests.map((pb, i) => (
                            <li key={i} className="card">{pb.date}: {pb.event ? pb.event + ' ' : ''}{pb.time} sec ({pb.meet})</li>
                        ))}
                    </ul>
                )}
                <div className="mt-6">
                    <LineGraph data={personalBests.map(pb => ({ date: pb.date, time: pb.time }))} />
                </div>
            </details>

            {/* Virtual Rankings by Month (collapsed) */}
            {false && (<details className="mt-8 card p-4 btn-accent">
                <summary className="text-xl font-semibold mb-2 cursor-pointer">Virtual Rankings (monthly cumulative)</summary>
                <div className="mt-3 space-y-6">
                {/* Virtual ranking tables hidden for now */}
                {/* <div className="text-sm text-gray-300">No virtual ranking data available for this event/age/sex.</div> */}
                {/* </div> */}
                {displayedVirtualMonths.length === 0 ? (
                    <div className="text-sm text-gray-300">No virtual ranking data available for this event/age/sex.</div>
                ) : (
                    <div className="space-y-6">
                        {displayedVirtualMonths.map((m, mi) => (
                            <div key={m.month} className="card p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="font-semibold">{m.month}</div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-sm text-gray-400">{m.ranking.length} swimmers</div>
                                        <button className="btn btn-xs" onClick={() => setExpandedVirtualMonths(prev => ({ ...prev, [m.month]: !prev[m.month] }))}>{expandedVirtualMonths[m.month] ? 'Collapse' : 'Expand'}</button>
                                    </div>
                                </div>
                                {expandedVirtualMonths[m.month] && (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-xs text-gray-400">
                                                <th className="pr-4">#</th>
                                                <th className="pr-4">Name</th>
                                                <th className="pr-4">Tiref</th>
                                                <th className="pr-4">Club</th>
                                                <th className="pr-4">YoB</th>
                                                <th className="pr-4">Time</th>
                                                <th className="pr-4">PB Date</th>
                                                <th className="pr-4">Meet</th>
                                                <th className="pr-4">Venue</th>
                                                <th className="pr-4">Level</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {m.ranking.map((r: any, i: number) => (
                                                <tr key={r.tiref || r.name || i} className="border-t border-gray-800">
                                                    <td className="py-2 pr-4">{i+1}</td>
                                                    <td className="py-2 pr-4">{r.name}</td>
                                                    <td className="py-2 pr-4">{r.tiref || ''}</td>
                                                    <td className="py-2 pr-4">{r.club || (r.payload && r.payload.club) || ''}</td>
                                                    <td className="py-2 pr-4">{r.yob || (r.payload && r.payload.yob) || ''}</td>
                                                    <td className="py-2 pr-4">{typeof r.time === 'number' ? formatTimeValue(r.time) : r.time}</td>
                                                    <td className="py-2 pr-4">{r.pb_date || (r.pbDate || '')}</td>
                                                    <td className="py-2 pr-4">{r.meet || (r.payload && r.payload.meet) || ''}</td>
                                                    <td className="py-2 pr-4">{r.venue || (r.payload && r.payload.venue) || ''}</td>
                                                    <td className="py-2 pr-4">{r.level || (r.payload && r.payload.level) || ''}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            </details>)}
            {/* Debug UI hidden */}
            
            {/* Previous Years / Next Age Up Virtual Rankings */}
            {false && (
                <details className="mt-8 card p-4 btn-accent">
                    <summary className="text-xl font-semibold mb-2 cursor-pointer">Previous Years Overlay — Next Age Up (virtual monthly)</summary>
                    <div className="space-y-6 mt-4">
                    {/* Previous-years virtual ranking tables hidden */}
                    {/* <div className="space-y-6"> */}
                    {/* </div> */}
                        {nextAgeVirtualMonths.map((m, mi) => (
                            <div key={m.month} className="card p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="font-semibold">{m.month}</div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-sm text-gray-400">{m.ranking.length} swimmers</div>
                                        <button className="btn btn-xs" onClick={() => setExpandedNextAgeVirtualMonths(prev => ({ ...prev, [m.month]: !prev[m.month] }))}>{expandedNextAgeVirtualMonths[m.month] ? 'Collapse' : 'Expand'}</button>
                                    </div>
                                </div>
                                {expandedNextAgeVirtualMonths[m.month] && (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-xs text-gray-400">
                                                <th className="pr-4">#</th>
                                                <th className="pr-4">Name</th>
                                                <th className="pr-4">Tiref</th>
                                                <th className="pr-4">Club</th>
                                                <th className="pr-4">YoB</th>
                                                <th className="pr-4">Time</th>
                                                <th className="pr-4">PB Date</th>
                                                <th className="pr-4">Meet</th>
                                                <th className="pr-4">Venue</th>
                                                <th className="pr-4">Level</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {m.ranking.map((r: any, i: number) => (
                                                <tr key={r.tiref || r.name || i} className="border-t border-gray-800">
                                                    <td className="py-2 pr-4">{i+1}</td>
                                                    <td className="py-2 pr-4">{r.name}</td>
                                                    <td className="py-2 pr-4">{r.tiref || ''}</td>
                                                    <td className="py-2 pr-4">{r.club || (r.payload && r.payload.club) || ''}</td>
                                                    <td className="py-2 pr-4">{r.yob || (r.payload && r.payload.yob) || ''}</td>
                                                    <td className="py-2 pr-4">{typeof r.time === 'number' ? formatTimeValue(r.time) : r.time}</td>
                                                    <td className="py-2 pr-4">{r.pb_date || (r.pbDate || '')}</td>
                                                    <td className="py-2 pr-4">{r.meet || (r.payload && r.payload.meet) || ''}</td>
                                                    <td className="py-2 pr-4">{r.venue || (r.payload && r.payload.venue) || ''}</td>
                                                    <td className="py-2 pr-4">{r.level || (r.payload && r.payload.level) || ''}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        ))}
                    </div>
                </details>
            )}
            
        </div>
    );
}
