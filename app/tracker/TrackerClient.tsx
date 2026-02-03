"use client";
import React, { useState } from "react";
import { useSearchParams } from 'next/navigation';
import { eventNameToCode } from "@/utils/eventNameToCode";
import { LineGraph, MonthlyCutoffGraph, RankGraph } from "@/app/components/Charts";
import Report from "@/app/components/Report";
import { calculateMonthlyCutoffFromTop50, parseTimeString, formatTimeValue } from "@/lib/time";

const eventOptions = Object.keys(eventNameToCode);

export default function TrackerClient() {
    const search = useSearchParams();
    const [event, setEvent] = useState(eventOptions[0]);
    const [ageGroup, setAgeGroup] = useState("");
    const [sex, setSex] = useState<"M" | "F" | "All">("M");
    const [rankings, setRankings] = useState<any[]>([]);
    const [tonbridgeSwimmers, setTonbridgeSwimmers] = useState<any[]>([]);
    const [swimmer, setSwimmer] = useState("");
    const [personalBests, setPersonalBests] = useState<any[]>([]);
    const [allSwimmersBests, setAllSwimmersBests] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [rankTrend, setRankTrend] = useState<{date:string,rank:number|null,time?:any}[]>([]);

    async function fetchRankings() {
        if (!event || !ageGroup) return;
        setLoading(true);
        let swimmers: any[] = [];
        if (sex === 'All') {
            const [mRes, fRes] = await Promise.all([
                fetch(`/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=M&ageGroup=${ageGroup}&date=31/12/2026`),
                fetch(`/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=F&ageGroup=${ageGroup}&date=31/12/2026`)
            ]);
            const mData = await mRes.json();
            const fData = await fRes.json();
            swimmers = [...(mData.swimmers || []), ...(fData.swimmers || [])];
            swimmers = swimmers.map((s: any) => ({ ...s, _timeSeconds: typeof s.time === 'number' ? s.time : (typeof s.time === 'string' ? parseTimeString(s.time) : null) }));
            swimmers.sort((a: any, b: any) => (a._timeSeconds ?? Infinity) - (b._timeSeconds ?? Infinity));
            swimmers = swimmers.slice(0, 50).map((s: any, idx: number) => ({ ...s, rank: idx + 1 }));
        } else {
            const res = await fetch(`/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=${sex}&ageGroup=${ageGroup}&date=31/12/2026`);
            const data = await res.json();
            swimmers = data.swimmers || [];
        }
        setRankings(swimmers || []);
        const tonbridge = (swimmers || []).filter((r: any) => r.club?.toLowerCase().includes("tonbridge"));
        setTonbridgeSwimmers(tonbridge);
        setLoading(false);
    }

    async function fetchAllSwimmersBests(rankingsList: any[]) {
        setLoading(true);
        const results: any[] = [];
        for (let i = 0; i < rankingsList.length; i++) {
            const r = rankingsList[i];
            if (!r.tiref) continue;
            try {
                const pbRes = await fetch(`/api/loadPersonalBest?pool=L&stroke=${eventNameToCode[event]}&sex=M&ageGroup=${ageGroup}&tiref=${r.tiref}&date=31/12/2026`);
                const pbData = await pbRes.json();
                results.push({ name: r.name, rank: r.rank, data: pbData.data || [] });
            } catch (e) {
                results.push({ name: r.name, rank: r.rank, data: [] });
            }
            if (i < rankingsList.length - 1) await new Promise(res => setTimeout(res, 50));
        }
        setAllSwimmersBests(results);
        setLoading(false);
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

    React.useEffect(() => {
        if (!swimmer) return setPersonalBests([]);
        const tracked = allSwimmersBests.find((s: any) => s.name === swimmer);
        setPersonalBests(tracked?.data || []);
    }, [allSwimmersBests, swimmer]);

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
            const { cutoffSeries, trackedSeries } = calculateMonthlyCutoffFromTop50(swimmersForCutoff, rankings, swimmer || undefined, ageGroup || '13', 12);

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
    }, [allSwimmersBests, rankings, swimmer, ageGroup]);

    return (
        <div className="p-8 max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">TSC National Qualification Tracker</h1>
            <form className="space-y-4 card" onSubmit={e => e.preventDefault()}>
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
                    <label className="block mb-1">Swimmer Name (Tonbridge only)</label>
                    <select value={swimmer} onChange={e => setSwimmer(e.target.value)} className="w-full p-2 border rounded bg-gray-900 text-white" disabled={tonbridgeSwimmers.length === 0} required>
                        <option value="">Select swimmer</option>
                        {tonbridgeSwimmers.map((s: any) => (
                            <option key={s.tiref} value={s.name}>{s.name} (Rank {s.rank})</option>
                        ))}
                    </select>
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
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
                    
                </div>

                {/* Graph */}
                {computed && computed.cutoffSeries && computed.cutoffSeries.length > 0 && (
                    (() => {
                        const hasCutoffs = (computed.cutoffSeries || []).some((c: any) => c.cutoff != null);
                        return hasCutoffs ? (
                            <div>
                                <MonthlyCutoffGraph cutoffSeries={computed.cutoffSeries} trackedSeries={computed.trackedSeries} />
                                {/* Rank trend chart */}
                                {rankTrend && rankTrend.length > 0 && (
                                    <div className="mt-4">
                                        <RankGraph data={rankTrend.map(r => ({ month: r.date, rank: r.rank }))} />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="mt-4 text-sm text-gray-300">No historical cutoff data available for the selected event/age yet.</div>
                        );
                    })()
                )}
                <div className="mt-4">
                    <Report rankings={rankings} allSwimmersBests={allSwimmersBests} ageGroup={ageGroup} />
                </div>
            </div>

            <details className="mt-8">
                <summary className="text-xl font-semibold mb-2 cursor-pointer">Top 50 Rankings</summary>
                {rankings.length > 0 && (
                    <ul className="space-y-1 mt-2">
                        {rankings.map((r, i) => (
                            <li key={i} className="card">{r.rank}. {r.name} ({r.time}) {r.club}</li>
                        ))}
                    </ul>
                )}
            </details>

            <details className="mt-8">
                <summary className="text-xl font-semibold mb-2 cursor-pointer">Personal Bests for {swimmer}</summary>
                {personalBests.length > 0 && (
                    <ul className="space-y-1 mt-2">
                        {personalBests.map((pb, i) => (
                            <li key={i} className="card">{pb.date}: {pb.time} sec ({pb.meet})</li>
                        ))}
                    </ul>
                )}
                <div className="mt-6">
                    <LineGraph data={personalBests.map(pb => ({ date: pb.date, time: pb.time }))} />
                </div>
            </details>

            
        </div>
    );
}
