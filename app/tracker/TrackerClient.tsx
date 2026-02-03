"use client";
import React, { useState } from "react";
import { useSearchParams } from 'next/navigation';
import { eventNameToCode } from "@/utils/eventNameToCode";
import { LineGraph, MonthlyCutoffGraph, RankGraph } from "@/app/components/Charts";
import Report from "@/app/components/Report";
import { calculateMonthlyCutoff, calculateMonthlyCutoffFromTop50, parseTimeString, formatTimeValue, getMonthKey } from "@/lib/time";

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

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-2">Historical Qualifying Time Graph</h2>
                <Report rankings={rankings} allSwimmersBests={allSwimmersBests} ageGroup={ageGroup} />
            </div>
        </div>
    );
}
