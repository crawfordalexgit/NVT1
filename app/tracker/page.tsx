"use client";
import React, { useState } from "react";
import { eventNameToCode } from "@/utils/eventNameToCode";
import { LineGraph, MonthlyCutoffGraph } from "@/app/components/Charts";
import { calculateMonthlyCutoff, calculateMonthlyCutoffFromTop50, parseTimeString, formatTimeValue, getMonthKey } from "@/lib/time";

const eventOptions = Object.keys(eventNameToCode);

export default function TrackerPage() {
	const [event, setEvent] = useState(eventOptions[0]);
	const [ageGroup, setAgeGroup] = useState("");
	const [rankings, setRankings] = useState<any[]>([]);
	const [tonbridgeSwimmers, setTonbridgeSwimmers] = useState<any[]>([]);
	const [swimmer, setSwimmer] = useState("");
	const [personalBests, setPersonalBests] = useState<any[]>([]);
	const [allSwimmersBests, setAllSwimmersBests] = useState<any[]>([]);
	const [loading, setLoading] = useState(false);

	// Fetch rankings when event or ageGroup changes
	async function fetchRankings() {
		if (!event || !ageGroup) return;
		setLoading(true);
		const res = await fetch(`/api/loadData?pool=L&stroke=${eventNameToCode[event]}&sex=M&ageGroup=${ageGroup}&date=31/12/2026`);
		const data = await res.json();
		setRankings(data.swimmers || []);
		// Filter for Tonbridge swimmers
		const tonbridge = (data.swimmers || []).filter((r: any) => r.club?.toLowerCase().includes("tonbridge"));
		setTonbridgeSwimmers(tonbridge);
		setLoading(false);
	}


	// Fetch personal bests for all top 50 swimmers (with rate limiting)
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
			// 50ms delay between requests
			if (i < rankingsList.length - 1) await new Promise(res => setTimeout(res, 50));
		}
		setAllSwimmersBests(results);
		setLoading(false);
	}

	// Trigger rankings fetch when event or ageGroup changes
	React.useEffect(() => {
		if (event && ageGroup) fetchRankings();
	}, [event, ageGroup]);


	// Fetch all swimmers' PBs when rankings change
	React.useEffect(() => {
		if (rankings.length > 0) fetchAllSwimmersBests(rankings);
	}, [rankings]);

	// Set tracked swimmer's PBs when allSwimmersBests or swimmer changes
	React.useEffect(() => {
		if (!swimmer) return setPersonalBests([]);
		const tracked = allSwimmersBests.find((s: any) => s.name === swimmer);
		setPersonalBests(tracked?.data || []);
	}, [allSwimmersBests, swimmer]);

	return (
		<div className="p-8 max-w-3xl mx-auto">
			<h1 className="text-2xl font-bold mb-4">TSC National Qualification Tracker</h1>
			<form className="space-y-4" onSubmit={e => e.preventDefault()}>
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
					<label className="block mb-1">Swimmer Name (Tonbridge only)</label>
					<select value={swimmer} onChange={e => setSwimmer(e.target.value)} className="w-full p-2 border rounded bg-gray-900 text-white" disabled={tonbridgeSwimmers.length === 0} required>
						<option value="">Select swimmer</option>
						{tonbridgeSwimmers.map((s: any) => (
							<option key={s.tiref} value={s.name}>{s.name} (Rank {s.rank})</option>
						))}
					</select>
				</div>
			</form>
			{loading && <div className="mt-6">Loading...</div>}
			{/* Collapsible panels for Top 50 Rankings and Personal Bests */}
			<details className="mt-8">
				<summary className="text-xl font-semibold mb-2 cursor-pointer">Top 50 Rankings</summary>
				{rankings.length > 0 && (
					<ul className="space-y-1 mt-2">
						{rankings.map((r, i) => (
							<li key={i} className="bg-gray-800 p-2 rounded text-white">{r.rank}. {r.name} ({r.time}) {r.club}</li>
						))}
					</ul>
				)}
			</details>
			<details className="mt-8">
				<summary className="text-xl font-semibold mb-2 cursor-pointer">Personal Bests for {swimmer}</summary>
				{personalBests.length > 0 && (
					<ul className="space-y-1 mt-2">
						{personalBests.map((pb, i) => (
							<li key={i} className="bg-gray-700 p-2 rounded text-white">{pb.date}: {pb.time} sec ({pb.meet})</li>
						))}
					</ul>
				)}
				<div className="mt-6">
					{/* Chart: LineGraph for personal bests */}
					<LineGraph data={personalBests.map(pb => ({ date: pb.date, time: pb.time }))} />
				</div>
			</details>
			{/* Historical Qualifying Time Graph and Debug Table */}
			<div className="mt-8">
				<h2 className="text-xl font-semibold mb-2">Historical Qualifying Time Graph</h2>
				{allSwimmersBests.length > 0 && swimmer && ((() => {
					const { cutoffSeries, trackedSeries } = calculateMonthlyCutoffFromTop50(allSwimmersBests, rankings.map(r => ({ name: r.name, time: r.time })), swimmer);
					// Build debug table data: grouped by month, sorted by time
					const groupedByMonth: Record<string, { name: string; time: number | null; date: string; meet?: string }[]> = {};
					allSwimmersBests.forEach(swimmerObj => {
						const rankForSwimmer = rankings.find(r => r.name === swimmerObj.name)?.rank ?? null;
						swimmerObj.data.forEach(pb => {
							const month = getMonthKey(pb.date);
							if (!month) return;
							if (!groupedByMonth[month]) groupedByMonth[month] = [];
							groupedByMonth[month].push({ name: swimmerObj.name, time: pb.time, date: pb.date, meet: pb.meet, rank: rankForSwimmer });
						});
					});
					const months = Object.keys(groupedByMonth).sort();

					// Compute virtual ranks per month: for each month, rank swimmers by their best time up to and including that month
					const virtualRanksByMonth: Record<string, Record<string, number | null>> = {};
					months.forEach(month => {
						const ranksForMonth: Record<string, number | null> = {};
						// For each swimmer in the allSwimmersBests pool, find their best time up to this month
						allSwimmersBests.forEach((swimmerObj: any) => {
							const bestTimes = swimmerObj.data
								.map((pb: any) => {
									const m = getMonthKey(pb.date);
									if (!m) return null;
									return m <= month ? (typeof pb.time === 'number' ? pb.time : (typeof pb.time === 'string' ? parseTimeString(pb.time) : null)) : null;
								})
								.filter((t: any) => t != null && !isNaN(t));
							const best = bestTimes.length > 0 ? Math.min(...bestTimes) : null;
							ranksForMonth[swimmerObj.name] = best;
						});
						// Convert to sorted list and assign ranks where best exists
						const sorted = Object.entries(ranksForMonth)
							.filter(([, best]) => best != null)
							.sort((a, b) => (a[1]! - b[1]!));
						sorted.forEach(([name], idx) => { ranksForMonth[name] = idx + 1; });
						virtualRanksByMonth[month] = ranksForMonth;
					});
					return (
						<>
							<MonthlyCutoffGraph cutoffSeries={cutoffSeries} trackedSeries={trackedSeries} />

							{/* Dashboard: tracked swimmer — KPI summary */}
							<div className="mt-4 p-4 bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 rounded-lg text-sm text-white">
								{(() => {
									const margins = months.map(m => {
										const cutoff = cutoffSeries.find(c => c.month === m)?.cutoff ?? null;
										const tracked = trackedSeries.find(t => t.month === m)?.time ?? null;
										if (cutoff == null || tracked == null) return null;
										return cutoff - tracked;
									}).filter(v => v != null) as number[];
									const monthsMeeting = margins.filter(m => m > 0).length;
									const monthsCount = months.length || 1;
									const bestMargin = margins.length ? Math.max(...margins) : null;
									const avgMargin = margins.length ? (margins.reduce((a, b) => a + b, 0) / margins.length) : null;
									const pbTimes = trackedSeries.map(t => t.time).filter(t => t != null) as number[];
									const pb = pbTimes.length ? Math.min(...pbTimes) : null;
									const latestMonth = months.slice().reverse().find(m => {
										const t = trackedSeries.find(x => x.month === m && x.time != null);
										return !!t;
									});
									const latestCutoff = latestMonth ? cutoffSeries.find(c => c.month === latestMonth)?.cutoff ?? null : null;
									const latestTracked = latestMonth ? trackedSeries.find(t => t.month === latestMonth)?.time ?? null : null;
									const latestMargin = (latestCutoff != null && latestTracked != null) ? (latestCutoff - latestTracked) : null;
									const virtualTop20Count = months.reduce((acc, m) => {
										const vr = (virtualRanksByMonth[m] || {})[swimmer];
										return acc + ((vr != null && vr <= 20) ? 1 : 0);
									}, 0);
									const pct = Math.round((monthsMeeting / monthsCount) * 100);
									const formatSigned = (v: number | null) => {
										if (v == null) return 'n/a';
										const sign = v > 0 ? '+' : '-';
										return sign + formatTimeValue(Math.abs(v));
									};
									return (
										<div>
											<div className="flex items-center justify-between mb-3">
												<div className="text-lg font-semibold">{swimmer || 'Tracked swimmer'}</div>
												<div className="text-xs text-gray-300">Historic vs virtual 20th</div>
											</div>
											<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
												<div className="p-3 bg-gray-800 rounded">
													<div className="text-sm text-gray-300">Months meeting cutoff</div>
													<div className="text-2xl font-bold text-green-400">{monthsMeeting}</div>
													<div className="mt-2 h-2 bg-gray-600 rounded overflow-hidden">
														<div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
													</div>
												</div>
												<div className="p-3 bg-gray-800 rounded">
													<div className="text-sm text-gray-300">Months in virtual top‑20</div>
													<div className="text-2xl font-bold text-yellow-300">{virtualTop20Count}</div>
												</div>
												<div className="p-3 bg-gray-800 rounded">
													<div className="text-sm text-gray-300">Personal Best (seen)</div>
													<div className="text-2xl font-bold text-indigo-300">{pb != null ? formatTimeValue(pb) : 'n/a'}</div>
												</div>
											</div>
											<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
												<div className="p-3 bg-gray-800 rounded">
													<div className="text-sm text-gray-300">Best margin</div>
													<div className={`text-xl font-bold ${bestMargin != null && bestMargin > 0 ? 'text-green-400' : 'text-red-400'}`}>{formatSigned(bestMargin)}</div>
												</div>
												<div className="p-3 bg-gray-800 rounded">
													<div className="text-sm text-gray-300">Average margin</div>
													<div className={`text-xl font-bold ${avgMargin != null && avgMargin > 0 ? 'text-green-400' : 'text-red-400'}`}>{formatSigned(avgMargin)}</div>
												</div>
												<div className="p-3 bg-gray-800 rounded">
													<div className="text-sm text-gray-300">Latest margin</div>
													<div className={`text-xl font-bold ${latestMargin != null && latestMargin > 0 ? 'text-green-400' : 'text-red-400'}`}>{formatSigned(latestMargin)}</div>
												</div>
											</div>
										</div>
									);
								})()}
							</div>

							<details className="mt-8">
								<summary className="text-lg font-semibold mb-2 cursor-pointer">All Swims Grouped by Month</summary>
								<div className="mt-3">
									{months.map(month => {
										const cutoffEntry = cutoffSeries.find(c => c.month === month) || { cutoff: null, reason: "n/a" };
										const usedCutoff = cutoffEntry.cutoff;
										// find a swim in this month that matches the cutoff value (if any)
										const usedSwim = groupedByMonth[month].find(s => {
											const t = typeof s.time === 'number' ? s.time : (typeof s.time === 'string' ? parseTimeString(s.time) : null);
											return t != null && usedCutoff != null && Math.abs(t - usedCutoff) < 0.001;
										});
										return (
											<div key={month} className="mb-4">
												<div className="font-bold mb-1">{month}</div>
												<div className="text-sm text-gray-300 mb-2">Used cutoff: {formatTimeValue(usedCutoff)} — {usedSwim ? `${usedSwim.name} on ${usedSwim.date} (${usedSwim.meet})` : cutoffEntry.reason}</div>
												<table className="w-full text-sm bg-gray-900 rounded">
													<thead>
														<tr className="bg-gray-800 text-white">
															<th className="p-2">Swimmer</th>
															<th className="p-2">Virtual Rank</th>
															<th className="p-2">Rank</th>
															<th className="p-2">Time</th>
															<th className="p-2">Date</th>
															<th className="p-2">Meet</th>
															<th className="p-2">Used</th>
														</tr>
													</thead>
													<tbody>
														{groupedByMonth[month].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity)).map((swim, i) => {
															const tnum = typeof swim.time === 'number' ? swim.time : (typeof swim.time === 'string' ? parseTimeString(swim.time) : null);
															const isUsed = usedCutoff != null && tnum != null && Math.abs(tnum - usedCutoff) < 0.001 && usedSwim && usedSwim.name === swim.name;
															return (
																<tr key={i} className={`border-b border-gray-800 ${isUsed ? 'bg-green-900' : ''}`}>
																	<td className="p-2 text-white">{swim.name}</td>
																	<td className="p-2 text-white">{virtualRanksByMonth[month]?.[swim.name] ?? '-'}</td>
																	<td className="p-2 text-white">{swim.rank ?? '-'}</td>
																	<td className="p-2 text-white">{formatTimeValue(tnum)}</td>
																	<td className="p-2 text-white">{swim.date}</td>
																	<td className="p-2 text-white">{swim.meet}</td>
																	<td className="p-2 text-white">{isUsed ? '✓' : ''}</td>
																</tr>
															);
														})}
													</tbody>
												</table>
											</div>
										);
									})}
								</div>
							</details>
						</>
					);
				})())}
			</div>
			{/* Chart components will be added here */}
		</div>
	);
}
