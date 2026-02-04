"use client";
import React from "react";
import { formatTimeValue, parseTimeString } from "@/lib/time";
import { calculateMonthlyCutoffFromTop50 } from "@/lib/time";

export default function Report({ rankings = [], allSwimmersBests = [], ageGroup = '13' }: any) {
    // filter tonbridge swimmers from rankings
    const tonbridge = (rankings || []).filter((r: any) => (r.club || '').toLowerCase().includes('tonbridge'));

    // build a lookup for PBs
    const pbLookup: Record<string, any[]> = {};
    (allSwimmersBests || []).forEach((s: any) => { pbLookup[s.name] = s.data || []; });

    // Compute a simple summary per swimmer
    const rows = tonbridge.map((r: any) => {
        const data = pbLookup[r.name] || [];
        const times = data.map((d: any) => typeof d.time === 'number' ? d.time : (typeof d.time === 'string' ? parseTimeString(d.time) : null)).filter((t: any) => t != null);
        const best = times.length ? Math.min(...times) : null;
        const latest = data.length ? data.slice().sort((a: any, b: any) => {
            const da = new Date(a.date.split('/').reverse().join('-'));
            const db = new Date(b.date.split('/').reverse().join('-'));
            return db.getTime() - da.getTime();
        })[0] : null;
        return {
            name: r.name,
            rank: r.rank,
            club: r.club,
            tiref: r.tiref,
            best,
            latestTime: latest ? (typeof latest.time === 'number' ? latest.time : (typeof latest.time === 'string' ? parseTimeString(latest.time) : null)) : null,
            latestLevel: latest ? (latest.level ?? (latest.payload && latest.payload.level) ?? null) : null,
            entries: data.length
        };
    });

    return (
        <div className="mt-8">
            <h3 className="text-lg font-semibold mb-3">Tonbridge Top-50 Report ({rows.length} swimmers)</h3>
            <div className="overflow-x-auto bg-gray-900 rounded">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="text-left text-gray-300">
                            <th className="p-2">Rank</th>
                            <th className="p-2">Name</th>
                            <th className="p-2">Level</th>
                            <th className="p-2">Best Seen</th>
                            <th className="p-2">Latest Time</th>
                            <th className="p-2">Entries</th>
                            <th className="p-2">Tiref</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row: any, i: number) => (
                            <tr key={i} className="border-t border-gray-800">
                                <td className="p-2 text-white">{row.rank ?? '-'}</td>
                                <td className="p-2 text-white">{row.name}</td>
                                    <td className="p-2 text-white">{row.latestLevel ?? '-'}</td>
                                <td className="p-2 text-white">{row.best != null ? formatTimeValue(row.best) : 'n/a'}</td>
                                <td className="p-2 text-white">{row.latestTime != null ? formatTimeValue(row.latestTime) : 'n/a'}</td>
                                <td className="p-2 text-white">{row.entries}</td>
                                <td className="p-2 text-white">{row.tiref ?? '-'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
