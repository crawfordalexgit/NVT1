"use client";
import React, { useState, useEffect } from "react";
import SwimmerLoader from "@/app/components/SwimmerLoader";
import { formatTimeValue, parseTimeString, parseDateString } from "@/lib/time";

export default function ReportPage() {
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState('');
    const [result, setResult] = useState<any>(null);
    const [showDebug, setShowDebug] = useState(true);

    async function runReport() {
        setRunning(true);
        setProgress('Starting report generation...');
        try {
            const res = await fetch('/api/generateReport');
            if (!res.ok) {
                setProgress('Failed to generate report');
                setRunning(false);
                return;
            }
            setProgress('Downloading report...');
            const data = await res.json();
            setResult(applySnapshotDates(data));
            setProgress('Done');
        } catch (e) {
            setProgress('Error: ' + String(e));
        } finally {
            setRunning(false);
        }
    }

    // On mount, try to load cached report; only run generation when user requests
    useEffect(() => {
        (async () => {
            setProgress('Loading cached report...');
            try {
                const r = await fetch('/api/reportCached');
                if (r.ok) {
                    const data = await r.json();
                    setResult(applySnapshotDates(data));
                    setProgress('Loaded cached report');
                } else {
                    setProgress('No cached report available — click Generate Report');
                }
            } catch (e) {
                setProgress('Error loading cache');
            }
        })();
    }, []);

    function applySnapshotDates(payload: any) {
        if (!payload) return payload;
        try {
            const snaps = payload.snapshots || {};
            const swimmers = payload.swimmers || [];
            for (const s of swimmers) {
                if (!s.appearances) continue;
                for (const a of s.appearances) {
                    const snapKey = `${a.event}|${a.age}|${a.sex}|${a.date}`;
                    const list = snaps[snapKey];
                    if (Array.isArray(list)) {
                        // try to find matching swimmer by name or tiref
                        const match = list.find((x: any) => (x.name || '').trim() === (s.name || '').trim() || (x.tiref && s.tiref && String(x.tiref) === String(s.tiref)));
                        if (match && match.date) {
                            a.date = match.date;
                        }
                    }
                }
            }
            return payload;
        } catch (e) {
            return payload;
        }
    }

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Tonbridge — National Summer Meet Qualification Report</h1>
            <p className="text-sm text-gray-300 mb-4">Snapshot of Tonbridge club members found in top‑50 national rankings across events, ages and sexes — useful for tracking National Summer Meet qualification progress. Cached results reduce external scraping; regenerate when needed.</p>
            <div className="mb-4 flex items-center gap-4">
                <button className="btn-accent" onClick={runReport} disabled={running}>{running ? 'Running…' : 'Generate Report'}</button>
                <span className="text-sm text-gray-300">{progress}</span>
            </div>
            {running && <SwimmerLoader label={progress || 'Generating report...'} />}
            {result && (
                <div className="mt-6">
                    <div className="mb-2 text-sm text-gray-300">Generated: {result.generatedAt} — {result.count} swimmers</div>
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-sm text-gray-300">Report details</div>
                        <div className="flex items-center space-x-3">
                            <label className="text-xs text-gray-400">Show debug</label>
                            <input type="checkbox" checked={showDebug} onChange={e => setShowDebug(e.target.checked)} className="h-4 w-4" />
                        </div>
                    </div>

                    {showDebug && result.externalUrls && result.externalUrls.length > 0 && (
                        <details className="mb-3">
                            <summary className="text-sm text-gray-300 cursor-pointer">External target URLs checked ({result.externalUrls.length})</summary>
                            <div className="mt-2 text-xs text-gray-300">
                                {result.externalUrls.map((u: string, i: number) => <div key={i}><a className="underline text-indigo-200" href={u} target="_blank" rel="noreferrer">{u}</a></div>)}
                            </div>
                        </details>
                    )}
                    {showDebug && result.internalUrls && result.internalUrls.length > 0 && (
                        <details className="mb-3">
                            <summary className="text-sm text-gray-300 cursor-pointer">Internal API calls made ({result.internalUrls.length})</summary>
                            <div className="mt-2 text-xs text-gray-300">
                                {result.internalUrls.map((u: string, i: number) => <div key={i}><code className="text-xs">{u}</code></div>)}
                            </div>
                        </details>
                    )}
                    {showDebug && result.debugSamples && Object.keys(result.debugSamples).length > 0 && (
                        <details className="mb-3">
                            <summary className="text-sm text-gray-300 cursor-pointer">Sample swimmers from internal calls</summary>
                            <div className="mt-2 text-xs text-gray-300">
                                {Object.entries(result.debugSamples).map(([k, v]: any, i: number) => (
                                    <div key={i} className="mb-2">
                                        <div className="text-xs font-semibold">{k}</div>
                                        <pre className="text-xs text-gray-200 p-2 bg-gray-800 rounded overflow-auto">{JSON.stringify(v, null, 2)}</pre>
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
                    {showDebug && result.snapshots && Object.keys(result.snapshots).length > 0 && (
                        <details className="mb-3">
                            <summary className="text-sm text-gray-300 cursor-pointer">Monthly snapshots collected ({Object.keys(result.snapshots).length})</summary>
                            <div className="mt-2 text-xs text-gray-300">
                                {Object.entries(result.snapshots).map(([k, v]: any, i: number) => (
                                    <div key={i} className="mb-3">
                                        <div className="text-xs font-semibold">{k}</div>
                                        <pre className="text-xs text-gray-200 p-2 bg-gray-800 rounded overflow-auto">{JSON.stringify((v as any[]).slice(0,5), null, 2)}</pre>
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {result.swimmers.map((s: any, i: number) => (
                            <div key={i} className="card">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-lg font-semibold text-white">{s.name}</div>
                                        <div className="text-xs text-gray-300">{s.club ?? 'Tonbridge'} • {s.tiref ?? '-'}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-gray-400">Latest rank: <span className="font-semibold">{(s.appearances && s.appearances.length) ? s.appearances[s.appearances.length-1].rank : 'n/a'}</span></div>
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <div className="text-sm text-gray-300 mb-1">Appearances</div>
                                    <div className="space-y-1">
                                        {s.appearances.map((a: any, j: number) => (
                                            <div key={j} className="flex items-center justify-between text-xs text-gray-200">
                                                <div>
                                                    <a href={`/tracker?event=${encodeURIComponent(a.event)}&ageGroup=${encodeURIComponent(a.age)}&sex=${encodeURIComponent(a.sex)}&swimmer=${encodeURIComponent(s.name)}`} className="text-indigo-200 underline">{a.event}</a>
                                                    <span className="ml-2 text-gray-400">({a.sex}{a.age})</span>
                                                </div>
                                                <div className="text-right">
                                                    <div>rank: <span className="font-semibold">{a.rank}</span></div>
                                                    <div className="text-sm text-gray-400">{formatTimeValue(typeof a.time === 'number' ? a.time : (typeof a.time === 'string' ? parseTimeString(a.time) : null))} • {a.date}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                            <div className="mt-6">
                                <details className="bg-gray-900 p-4 rounded">
                                    <summary className="cursor-pointer text-sm font-semibold text-white">Meet summary and qualification notes (click to expand)</summary>
                                    <div className="mt-3 text-xs text-gray-300 space-y-2">
                                        <div>• Entries are by invitation only. Competitors must appear in the British Rankings during the qualification period to be eligible.</div>
                                        <div>• Qualification period: competitors must be recorded in the British Rankings between 6 March and 10 May 2026 (as shown in the provided rules).</div>
                                        <div>• Competitors must meet Swim England club membership and other eligibility requirements (home nation status and any residency/travel restrictions apply per the rules).</div>
                                        <div>• Invitation order: the fastest Home Nation competitors are invited (e.g., to GB Next Gen Championships) followed by the next fastest Swim England competitors, per the event-specific quotas.</div>
                                        <div>• Age groups covered: 13 years through 18+ years (see the attached table for per-event quotas and exact numbers by age).</div>
                                        <div className="text-gray-400">Full event quota table is included in the attachment you provided; expand the attachment to inspect the per-event numbers and notes about unavailable events or course-specific eligibility.</div>
                                    </div>
                                </details>
                            </div>
                            {/* Qualification table transcribed from provided attachment */}
                            <div className="mt-4">
                                <details className="bg-gray-900 p-4 rounded">
                                    <summary className="cursor-pointer text-sm font-semibold text-white">Qualification quotas table (transcribed)</summary>
                                    <div className="mt-3 overflow-auto">
                                        <table className="w-full text-xs text-gray-200 table-auto border-collapse">
                                            <thead>
                                                <tr className="text-left text-gray-300">
                                                    <th className="p-2">Event</th>
                                                    <th className="p-2">13y</th>
                                                    <th className="p-2">14y</th>
                                                    <th className="p-2">15y</th>
                                                    <th className="p-2">16y</th>
                                                    <th className="p-2">17y</th>
                                                    <th className="p-2">18y+</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {/** Transcribed from your screenshot — please verify these values against the attachment. */}
                                                {[
                                                    ["50 Freestyle",20,20,20,20,20,28],
                                                    ["100 Freestyle",20,20,20,20,20,28],
                                                    ["200 Freestyle",20,20,15,12,12,28],
                                                    ["400 Freestyle",12,12,12,12,12,28],
                                                    ["800 Freestyle",12,12,12,12,12,28],
                                                    ["1500 Freestyle",12,12,12,12,12,28],
                                                    ["50 Breaststroke",20,20,20,20,20,28],
                                                    ["100 Breaststroke",20,20,20,20,20,28],
                                                    ["200 Breaststroke",20,20,20,20,20,28],
                                                    ["50 Butterfly",20,20,20,20,20,28],
                                                    ["100 Butterfly",20,20,20,20,20,28],
                                                    ["200 Butterfly",20,20,20,20,20,28],
                                                    ["50 Backstroke",20,20,20,20,20,28],
                                                    ["100 Backstroke",20,20,20,20,20,28],
                                                    ["200 Backstroke",20,20,20,20,20,28],
                                                    ["200 IM",20,20,20,20,20,28],
                                                    ["400 IM",15,15,15,15,15,28]
                                                ].map((row, i) => (
                                                    <tr key={i} className="border-t border-gray-800">
                                                        <td className="p-2 font-medium text-gray-100">{row[0]}</td>
                                                        <td className="p-2">{row[1]}</td>
                                                        <td className="p-2">{row[2]}</td>
                                                        <td className="p-2">{row[3]}</td>
                                                        <td className="p-2">{row[4]}</td>
                                                        <td className="p-2">{row[5]}</td>
                                                        <td className="p-2">{row[6]}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <div className="mt-3 text-xs text-gray-400">Note: table values were transcribed from the screenshot you attached. Please verify these numbers against the original image; if any values need correction I will update them.</div>
                                    </div>
                                </details>
                            </div>
                </div>
            )}
        </div>
    );
}
