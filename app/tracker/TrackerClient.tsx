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
    const [levelFilter, setLevelFilter] = useState<string>('All');
    const [rankings, setRankings] = useState<any[]>([]);
    const [tonbridgeSwimmers, setTonbridgeSwimmers] = useState<any[]>([]);
    const [swimmer, setSwimmer] = useState("");
    const [personalBests, setPersonalBests] = useState<any[]>([]);
    const [allSwimmersBests, setAllSwimmersBests] = useState<any[]>([]);
    const [virtualMonths, setVirtualMonths] = useState<{month:string; ranking:any[]}[]>([]);
    const [virtualDataSource, setVirtualDataSource] = useState<'db'|'pb'|'snapshot'|'live'|'unknown'|null>(null);
    const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
    const [showVirtualTables, setShowVirtualTables] = useState<boolean>(true);
    // Toggle to temporarily disable previous-year overlay and its data fetches
    // Re-enabled per user request
    const ENABLE_PREV = true;
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
    const [showNationals, setShowNationals] = useState<boolean>(false);
    
    const [rankTrend, setRankTrend] = useState<{date:string,rank:number|null,time?:any}[]>([]);
    const [internalUrls, setInternalUrls] = useState<string[]>([]);
    const [debugSamples, setDebugSamples] = useState<Record<string, any>>({});
    const [zoom, setZoom] = useState<number>(1);
    const [transformOrigin, setTransformOrigin] = useState<string>('50% 0%');
    const [hoverChart, setHoverChart] = useState<boolean>(false);
    const chartRef = React.useRef<HTMLDivElement | null>(null);
    const baselineAutoFetchKey = React.useRef<string | null>(null);
    const [graphKey, setGraphKey] = useState<number>(0);
    // debugging UI disabled in production

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
        // trigger chart regeneration after PB data loaded
        setGraphKey(k => k + 1);
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

    // default showNationals for age 14+
    React.useEffect(() => {
        try {
            const ag = Number(ageGroup);
            if (!isNaN(ag) && ag >= 14) setShowNationals(true);
            else setShowNationals(false);
        } catch (e) { setShowNationals(false); }
    }, [ageGroup]);

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

    // auto-fetch/store behavior removed (handled manually via explicit actions)

    // fetch top-50 rankings and PBs for the next age up cohort
    React.useEffect(() => {
        async function loadNextAgePBs() {
            if (!event || !ageGroup || !sex) return setNextAgeAllSwimmersBests([]);
            const nextAge = String(Number(ageGroup) + 1);
            try {
                setLoading(true);
                const url = `/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=${sex==='All'?'M':sex}&ageGroup=${nextAge}&date=31/12/2026`;
                setInternalUrls(prev => [...prev, url]);
                const res = await fetch(url);
                const j = await res.json();
                const swimmersList = (j.swimmers || []).map((s: any, i: number) => ({ ...s, rank: i + 1 }));
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
                // trigger chart regeneration after next-age PBs loaded
                setGraphKey(k => k + 1);
            } catch (e) {
                setNextAgeAllSwimmersBests([]);
            }
            finally { setLoading(false); }
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
                    // record data source when provided by server
                    // prefer explicit `source` flag, otherwise infer
                    if (j.source === 'live') setVirtualDataSource('live');
                    else if (j.source === 'persisted' || j.source === 'monthly_cutoffs') setVirtualDataSource('db');
                    else if (j.source === 'pbs') setVirtualDataSource('pb');
                    else if (j.source === 'snapshots') setVirtualDataSource('snapshot');
                    else setVirtualDataSource(j.live ? 'live' : (j.months && j.months.length && j.months.some((m:any)=>m.ranking && m.ranking.length) ? 'pb' : 'unknown'));
                    // trigger chart regeneration after virtual months loaded
                    setGraphKey(k => k + 1);
                } else {
                    setVirtualMonths([]);
                }
            } catch (e) {
                setVirtualMonths([]);
            }
        }
        loadVirtual();
    }, [event, ageGroup, sex, levelFilter]);

    // Force live scrape for virtual rankings (current and previous-year)
    async function fetchLiveVirtual() {
        if (!event || !ageGroup || !sex) return;
        setLoading(true);
        try {
            const monthsParam = String((displayedVirtualMonths && displayedVirtualMonths.length) ? displayedVirtualMonths.length : Number(monthsWindow) || 18);
            const q = new URLSearchParams({ event, ageGroup, sex, months: monthsParam, level: levelFilter, live: '1' });
            const res = await fetch(`/api/virtualRanking?${q.toString()}`);
            if (res.ok) {
                const j = await res.json().catch(() => ({}));
                if (j && j.ok && Array.isArray(j.months)) {
                    setVirtualMonths(j.months || []);
                    setVirtualDataSource('live');
                    setGraphKey(k => k + 1);
                }
            }
            // also fetch previous-year (next-age) live months if overlay is shown
            if (ENABLE_PREV && showPrevOverlay) {
                const nextAge = String(Number(ageGroup) + 1);
                const q2 = new URLSearchParams({ event, ageGroup: nextAge, sex, months: monthsParam, level: levelFilter, live: '1' });
                const res2 = await fetch(`/api/virtualRanking?${q2.toString()}`);
                if (res2.ok) {
                    const j2 = await res2.json().catch(() => ({}));
                    if (j2 && j2.ok && Array.isArray(j2.months)) {
                        setNextAgeVirtualMonths(j2.months || []);
                        setGraphKey(k => k + 1);
                        setVirtualDataSource('live');
                    }
                }
            }
        } catch (e) {
            // ignore errors for now
        } finally {
            setLoading(false);
        }
    }

    // Compute previous-year cutoff series from next-age PBs (shift months forward by +1 year)
    const prevYearCutoffShifted = React.useMemo(() => {
        try {
            if (!nextAgeAllSwimmersBests || nextAgeAllSwimmersBests.length === 0) return [];
            if (!nextAgeVirtualMonths || nextAgeVirtualMonths.length === 0) return [];
            const start = nextAgeVirtualMonths[0]?.month;
            const end = nextAgeVirtualMonths[nextAgeVirtualMonths.length - 1]?.month;
            const swimmersForPrev = (nextAgeAllSwimmersBests || []).map((s: any) => ({ name: s.name, data: s.data || [] }));
            const nextAgeStr = String(Number(ageGroup) + 1);
            const { cutoffSeries: raw, cutoffSeriesNationals: rawNationals } = calculateMonthlyCutoffFromTop50(swimmersForPrev, [], undefined, nextAgeStr, undefined, start, end, levelFilter);
            // shift month keys forward by one year to align with current-year months
            const shifted = (raw || []).map((c: any) => {
                try {
                    const parts = String(c.month).split('-').map(Number);
                    if (parts.length !== 2) return c;
                    const y = parts[0] + 1;
                    const m = String(parts[1]).padStart(2, '0');
                    return { month: `${y}-${m}`, cutoff: c.cutoff, reason: c.reason };
                } catch (e) { return c; }
            });
            return shifted;
        } catch (e) { return []; }
    }, [nextAgeAllSwimmersBests, nextAgeVirtualMonths, ageGroup, levelFilter]);

    

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
            if (!ENABLE_PREV || !showPrevOverlay || !event || !ageGroup) return;
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
                    // trigger chart regeneration after next-age months loaded
                    setGraphKey(k => k + 1);
        }
        loadPrev();
    }, [showPrevOverlay, event, ageGroup, sex, displayedVirtualMonths.length, levelFilter]);

    // Clear any stale previous-year months when the selected event/age changes
    React.useEffect(() => {
        setNextAgeVirtualMonths([]);
    }, [event, ageGroup]);

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
            const { cutoffSeries, trackedSeries, cutoffSeriesNationals } = calculateMonthlyCutoffFromTop50(swimmersForCutoff, rankings, swimmer || undefined, ageGroup || '13', monthsToShow as any, startMonth, endMonth, levelFilter);

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
            return { cutoffSeries, trackedSeries, cutoffSeriesNationals, kpis: { monthsMeeting, virtualCount, avgMargin, latestMargin, monthsShown, monthsRecorded } };
        } catch (e) {
            return { cutoffSeries: [], trackedSeries: [], kpis: null };
        }
    }, [allSwimmersBests, rankings, swimmer, ageGroup, displayedVirtualMonths, monthsWindow, customStart, customEnd, levelFilter]);

    // Auto-trigger baseline PB fetch once per event/age/sex when baseline data is missing
    React.useEffect(() => {
        try {
            const key = `${event || ''}-${ageGroup || ''}-${sex || ''}`;
            const noBaseline = computed && Array.isArray((computed as any).cutoffSeries) && (computed as any).cutoffSeries.length === 0;
            const haveRankings = rankings && rankings.length > 0;
            if (noBaseline && haveRankings && baselineAutoFetchKey.current !== key) {
                baselineAutoFetchKey.current = key;
                // fetch PBs for current rankings to build baseline
                fetchAllSwimmersBests(rankings);
            }
        } catch (e) { }
    }, [computed, rankings, event, ageGroup, sex]);

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

    // Prediction debug posting removed

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
        <div className="p-8 px-4 sm:px-8 max-w-7xl mx-auto">
            <div className="mb-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-600 flex-shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-7 h-7 text-white" fill="none" stroke="currentColor">
                                <circle cx="7" cy="7" r="1.5" fill="white" />
                                <path d="M3 12c3-1 6-1 9 0s6 1 9 0" strokeWidth="1.5" stroke="white" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M3 15c3-1 6-1 9 0s6 1 9 0" strokeWidth="1" stroke="white" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight truncate">TSC National Qualification Tracker</h1>
                            <p className="text-sm text-gray-400 mt-1 truncate">Track cohort predictions, virtual rankings, and personal bests</p>
                        </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <div className="text-xs text-gray-400">Season</div>
                        <div className="mt-1 inline-block text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-pink-600 px-3 py-1 rounded-full">2025–26</div>
                    </div>
                </div>
            </div>
            <form className="space-y-4 card w-full max-w-none" onSubmit={e => e.preventDefault()}>
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
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold mb-2">Historical Qualifying Time Graph</h2>
                    <div className="flex items-center">
                    {virtualDataSource && (
                        <div className="ml-4 text-sm">
                            <span className="text-xs text-gray-400 mr-2">Data</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-white text-xs ${virtualDataSource==='live' ? 'bg-red-600' : virtualDataSource==='db' ? 'bg-indigo-600' : virtualDataSource==='pb' ? 'bg-emerald-600' : virtualDataSource==='snapshot' ? 'bg-yellow-600' : 'bg-gray-600'}`}>
                                {virtualDataSource === 'live' ? 'Live scrape' : virtualDataSource === 'db' ? 'Persisted DB' : virtualDataSource === 'pb' ? 'Stored PBs' : virtualDataSource === 'snapshot' ? 'Snapshots' : 'Unknown'}
                            </span>
                        </div>
                    )}
                    <div className="flex items-center gap-3">
                        <button type="button" className="ml-3 text-xs text-gray-300 underline" onClick={() => setShowDiagnostics(s => !s)}>{showDiagnostics ? 'Hide diagnostics' : 'Show diagnostics'}</button>
                        <button type="button" className="ml-1 text-xs text-gray-300 underline" onClick={() => setShowVirtualTables(s => !s)}>{showVirtualTables ? 'Hide tables' : 'Show tables'}</button>
                    </div>
                    </div>
                </div>
                <div className="flex items-stretch gap-6 mb-6 overflow-x-auto">
                    <div className="card p-3 btn-accent min-w-[12rem] flex-shrink-0">
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
                    <div className="card p-3 btn-accent min-w-[12rem] flex-shrink-0">
                        <div className="text-sm text-gray-800">Avg Margin</div>
                        <div className="text-2xl font-bold">{computed.kpis ? (computed.kpis.avgMargin == null ? '--' : (computed.kpis.avgMargin >= 0 ? '+' : '-') + formatTimeValue(Math.abs(computed.kpis.avgMargin))) : "--"}</div>
                    </div>
                    <div className="card p-3 btn-accent min-w-[12rem] flex-shrink-0">
                        <div className="text-sm text-gray-800">Latest Margin</div>
                        <div className="text-2xl font-bold">{computed.kpis ? (computed.kpis.latestMargin == null ? '--' : (computed.kpis.latestMargin >= 0 ? '+' : '-') + formatTimeValue(Math.abs(computed.kpis.latestMargin))) : "--"}</div>
                    </div>
                    <div className="card p-3 btn-accent min-w-[12rem] flex-shrink-0" title="Predicted Qual Time: baseline minus cohort avg drop (simple method). Hover for details.">
                        <div className="text-sm text-gray-800">Predicted Qual Time</div>
                        <div className="text-2xl font-bold">{trackedPrediction && trackedPrediction.predicted != null ? formatTimeValue(trackedPrediction.predicted) : '--'}</div>
                        <div className="text-xs text-gray-300 mt-1">{trackedPrediction && trackedPrediction.avgDrop != null ? `based on avg drop ${trackedPrediction.avgDrop ? formatTimeValue(trackedPrediction.avgDrop) : ''}` : ''}</div>
                    </div>
                    <div className="card p-3 btn-accent min-w-[12rem] flex-shrink-0" title="Trend-based cohort prediction: fits per-swimmer linear trends, shrunk toward cohort slope; shows predicted time at qualifying end.">
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
                                                                        {/* zoom/reset hint removed because interaction is unreliable */}
                                    </div>
                                    <div className="mb-3 flex items-center gap-2">
                                        <label className="text-sm text-gray-400">Live</label>
                                        <button type="button" className="btn btn-sm" onClick={async () => { await fetchLiveVirtual(); }} disabled={loading}>Force live</button>
                                    </div>
                                    <div className="relative" ref={chartRef} onMouseEnter={() => setHoverChart(true)} onMouseLeave={() => setHoverChart(false)}>
                                        <Virtual20thSeriesChart
                                            key={graphKey}
                                            months={displayedVirtualMonths || []}
                                            trackedSeries={computed.trackedSeries || []}
                                            compareMonths={(ENABLE_PREV && showPrevOverlay) ? shiftedNextAgeVirtualMonths : []}
                                            fallbackCutoffSeries={(computed && (computed as any).cutoffSeries) || []}
                                            fallbackPrevCutoffSeries={prevYearCutoffShifted || []}
                                            nationalsCutoffSeries={(computed && (computed as any).cutoffSeriesNationals) || []}
                                            showNationals={showNationals}
                                            highlightStart={qualStart}
                                            highlightEnd={qualEnd}
                                        />
                                        {/* Explain missing baseline/previous-year data and offer action */}
                                        {computed && Array.isArray(computed.cutoffSeries) && computed.cutoffSeries.length === 0 && (
                                            <div className="mt-3 text-sm text-yellow-300">No qualifying baseline could be computed for this event/age — insufficient PB data or virtual rankings.</div>
                                        )}
                                        {ENABLE_PREV && showPrevOverlay && Array.isArray(shiftedNextAgeVirtualMonths) && shiftedNextAgeVirtualMonths.length === 0 && (
                                            <div className="mt-2 text-sm text-gray-400">Previous-year overlay not available for this event/age.</div>
                                        )}
                                        {/* manual load removed — auto-fetch will trigger when appropriate */}

                                        {/* Diagnostics to help explain empty baseline (hidden by default) */}
                                        {showDiagnostics && (
                                            <>
                                                <div className="mt-3 text-xs text-gray-400 space-y-1">
                                                    <div>Rankings: {rankings ? rankings.length : 0} ({(rankings || []).filter(r=>r && r.tiref).length} with tiref)</div>
                                                    <div>PB sets fetched: {allSwimmersBests ? allSwimmersBests.length : 0}</div>
                                                    <div>Computed cutoff points: {(computed && Array.isArray((computed as any).cutoffSeries)) ? (computed as any).cutoffSeries.length : 0}</div>
                                                    <div>Computed tracked points: {(computed && Array.isArray((computed as any).trackedSeries)) ? (computed as any).trackedSeries.length : 0}</div>
                                                    <div>Virtual months: {displayedVirtualMonths ? displayedVirtualMonths.length : 0} / Prev-year months: {(shiftedNextAgeVirtualMonths||[]).length}</div>
                                                    {(rankings && (rankings||[]).filter(r=>r && r.tiref).length === 0) && (
                                                        <div className="text-yellow-300">Note: rankings lack swimmer tiref identifiers; PBs cannot be fetched by tiref.</div>
                                                    )}
                                                </div>
                                                {/* Detailed diagnostic dump for troubleshooting empty baseline */}
                                                <details className="mt-2 text-xs text-gray-400">
                                                    <summary className="cursor-pointer mb-1">Show series diagnostics</summary>
                                                    <div className="bg-gray-900 p-2 rounded text-xs overflow-auto max-h-48">
                                                        <div><strong>cutoffSeries (first/last 3):</strong></div>
                                                        <pre className="whitespace-pre-wrap">{JSON.stringify(((computed && (computed as any).cutoffSeries) || []).slice(0,3).concat((((computed && (computed as any).cutoffSeries) || []).slice(-3))), null, 2)}</pre>
                                                        <div className="mt-2"><strong>trackedSeries (first/last 3):</strong></div>
                                                        <pre className="whitespace-pre-wrap">{JSON.stringify(((computed && (computed as any).trackedSeries) || []).slice(0,3).concat((((computed && (computed as any).trackedSeries) || []).slice(-3))), null, 2)}</pre>
                                                        <div className="mt-2"><strong>displayedVirtualMonths (first/last 3):</strong></div>
                                                        <pre className="whitespace-pre-wrap">{JSON.stringify((displayedVirtualMonths || []).slice(0,3).concat((displayedVirtualMonths || []).slice(-3)), null, 2)}</pre>
                                                        <div className="mt-2"><strong>shiftedNextAgeVirtualMonths (first/last 3):</strong></div>
                                                        <pre className="whitespace-pre-wrap">{JSON.stringify(((shiftedNextAgeVirtualMonths||[]).slice(0,3)).concat(((shiftedNextAgeVirtualMonths||[]).slice(-3))), null, 2)}</pre>
                                                    </div>
                                                </details>
                                            </>
                                        )}
                                        {loading && (
                                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
                                                <div className="flex items-center space-x-2 text-white">
                                                    <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                                                    </svg>
                                                    <div>Loading data…</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {/* Event/key diagnostics */}
                                    <div className="mt-3 text-xs text-gray-400">
                                        <div>Selected event: {event} (code: {event ? (eventNameToCode[event] ?? 'N/A') : 'N/A'})</div>
                                        <div>API key used for snapshots: {event ? `${event}|${ageGroup}|${sex}` : 'n/a'}</div>
                                        <div>Next-age PBs fetched: {nextAgeAllSwimmersBests ? nextAgeAllSwimmersBests.length : 0}</div>
                                        <div>Prev-year cutoff shifted length: {prevYearCutoffShifted ? prevYearCutoffShifted.length : 0}</div>
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
                                        <div className="ml-4 flex items-center gap-2">
                                            <input id="showNationals" type="checkbox" checked={showNationals} onChange={e => setShowNationals(e.target.checked)} />
                                            <label htmlFor="showNationals" className="text-sm text-gray-300">Show Nationals (40th)</label>
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

            {/* Virtual Rankings by Month - hidden per user request */}
            {/* Virtual Rankings by Month - expanded for debugging */}
            {showVirtualTables && (
            <details className="mt-8 card p-4 bg-gray-800 text-sm">
                <summary className="text-lg font-semibold mb-2 cursor-pointer">Virtual Rankings (by month) — displayed months: {displayedVirtualMonths ? displayedVirtualMonths.length : 0}</summary>
                {displayedVirtualMonths && displayedVirtualMonths.length > 0 ? (
                    <div className="mt-2 space-y-3">
                        {displayedVirtualMonths.map((m, mi) => (
                            <details key={m.month} className="bg-gray-900 p-3 rounded">
                                <summary className="cursor-pointer">{m.month} — {Array.isArray(m.ranking) ? m.ranking.length : 0} entries</summary>
                                <div className="mt-2 text-xs text-gray-300">
                                    {(Array.isArray(m.ranking) && m.ranking.length > 0) ? (
                                        <ol className="list-decimal list-inside space-y-1">
                                            {m.ranking.map((r: any, idx: number) => {
                                                // compute age anchored to qualifying end year if yob present
                                                let displayAge: number | null = null;
                                                const yobRaw = r.yob ?? r.payload?.yob ?? null;
                                                if (yobRaw != null) {
                                                    const y = Number(String(new Date(qualEnd).getFullYear()));
                                                    const yobNum = Number(yobRaw);
                                                    if (!isNaN(y) && !isNaN(yobNum)) displayAge = y - yobNum;
                                                }
                                                return (
                                                <li key={idx} className="flex justify-between items-center gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{r.name || r.tiref || `#${idx+1}`}</span>
                                                        {displayAge != null && <span className="text-xs text-gray-400">(age {displayAge})</span>}
                                                        {displayAge == null && r.yob != null && <span className="text-xs text-gray-400">(yob {r.yob})</span>}
                                                    </div>
                                                    <div className="text-gray-400">{typeof r.time === 'number' ? formatTimeValue(r.time) : (r.time == null ? '--' : (typeof r.time === 'string' ? r.time : String(r.time)))}</div>
                                                </li>
                                                );
                                            })}
                                        </ol>
                                    ) : (
                                        <div className="text-xs text-gray-500">No ranking entries for this month.</div>
                                    )}
                                </div>
                            </details>
                        ))}
                    </div>
                ) : (
                    <div className="mt-2 text-gray-400">No virtual months available.</div>
                )}
            </details>
            )}

            {/* Previous Years / Next Age Up Virtual Rankings - expanded for debugging */}
            {showVirtualTables && (
            <details className="mt-6 card p-4 bg-gray-800 text-sm">
                <summary className="text-lg font-semibold mb-2 cursor-pointer">Previous-Year Overlay (shifted next-age months): {shiftedNextAgeVirtualMonths ? shiftedNextAgeVirtualMonths.length : 0}</summary>
                {shiftedNextAgeVirtualMonths && shiftedNextAgeVirtualMonths.length > 0 ? (
                    <div className="mt-2 space-y-3">
                        {shiftedNextAgeVirtualMonths.map((m, mi) => (
                            <details key={m.month} className="bg-gray-900 p-3 rounded">
                                <summary className="cursor-pointer">{m.month} — {Array.isArray(m.ranking) ? m.ranking.length : 0} entries</summary>
                                <div className="mt-2 text-xs text-gray-300">
                                    {(Array.isArray(m.ranking) && m.ranking.length > 0) ? (
                                        <ol className="list-decimal list-inside space-y-1">
                                            {m.ranking.map((r: any, idx: number) => (
                                                <li key={idx} className="flex justify-between"><span>{r.name || r.tiref || `#${idx+1}`}</span><span className="text-gray-400">{typeof r.time === 'number' ? formatTimeValue(r.time) : (r.time == null ? '--' : (typeof r.time === 'string' ? r.time : String(r.time)))}</span></li>
                                            ))}
                                        </ol>
                                    ) : (
                                        <div className="text-xs text-gray-500">No ranking entries for this month.</div>
                                    )}
                                </div>
                            </details>
                        ))}
                    </div>
                ) : (
                    <div className="mt-2 text-gray-400">No previous-year months available.</div>
                )}
            </details>
            )}

        </div>
    );
}
