
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, LabelList, ReferenceArea, Legend, Brush } from "recharts";
import { formatTimeValue } from "@/lib/time";

// Safe formatter to accept Recharts' possibly-undefined values
const safeFormat = (value: any) => formatTimeValue(typeof value === 'number' ? value : (value == null ? null : Number(value)));

export function MonthlyCutoffGraph({ cutoffSeries, trackedSeries }: {
	cutoffSeries: { month: string; cutoff: number | null; reason?: string }[];
	trackedSeries: { month: string; time: number | null }[];
}) {
	// Merge series by month into a single array for plotting
	const months = Array.from(new Set([...cutoffSeries.map(c => c.month), ...trackedSeries.map(t => t.month)])).sort();
	const merged = months.map(month => {
		const c = cutoffSeries.find(x => x.month === month);
		const t = trackedSeries.find(x => x.month === month);
		return { month, cutoff: c ? c.cutoff : null, time: t ? t.time : null };
	});
	// Compute Y domain from numeric values
	const values = merged.flatMap(m => [m.cutoff, m.time]).filter(v => v != null) as number[];
	const min = values.length > 0 ? Math.floor(Math.min(...values) - 5) : undefined;
	const max = values.length > 0 ? Math.ceil(Math.max(...values) + 5) : undefined;

	const safeFormat = (value: any) => formatTimeValue(typeof value === 'number' ? value : (value == null ? null : Number(value)));

	return (
		<div className="chart-outer p-4 rounded-lg bg-gray-900 mt-8">
			<h3 className="mb-2 text-white">Historical Qualifying Time (Current Year Cutoff)</h3>
			<ResponsiveContainer width="100%" height={360}>
				<LineChart data={merged} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
					<XAxis dataKey="month" stroke="#fff" />
					<YAxis stroke="#fff" tickFormatter={safeFormat as any} domain={min != null && max != null ? [min, max] : ["auto", "auto"]} />
					<Tooltip formatter={safeFormat as any} labelStyle={{ color: "#fff" }} contentStyle={{ background: "#23243a", color: "#fff" }} />
						<Legend />
						<Line type="monotone" dataKey="cutoff" stroke="#ffe600" strokeWidth={2} dot={{ r: 2 }} strokeDasharray="6 4" strokeOpacity={0.6} name="Current Year Cutoff" />
						<Line type="monotone" dataKey="time" stroke="#3b82f6" strokeWidth={4} dot={{ r: 2 }} name="Tracked Swimmer" connectNulls={true} />
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
	}

export function LineGraph({ data }: { data: { date: string; time: number | null }[] }) {
	return (
		<div className="chart-outer p-4 rounded-lg bg-gray-900">
			<h3 className="mb-2 text-white">Performance Over Time</h3>
			<ResponsiveContainer width="100%" height={300}>
				<LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
					<XAxis dataKey="date" stroke="#fff" />
					<YAxis stroke="#fff" tickFormatter={safeFormat as any} domain={["auto", "auto"]} />
					<Tooltip formatter={safeFormat as any} labelStyle={{ color: "#fff" }} contentStyle={{ background: "#23243a", color: "#fff" }} />
					<Line type="monotone" dataKey="time" stroke="#3b82f6" strokeWidth={3} dot={false} />
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

export default { LineGraph };

export function RankGraph({ data, maxRank = 50 }: { data: { month: string; rank: number | null }[]; maxRank?: number }) {
	// data: array of { month, rank }
	const merged = data.map(d => ({ month: d.month, rank: d.rank }));
	const values = merged.map(m => m.rank).filter(v => v != null) as number[];
	const max = values.length > 0 ? Math.max(...values) : maxRank;
	const min = 1;
	return (
		<div className="chart-outer p-4 rounded-lg bg-gray-900 mt-4">
			<h3 className="mb-2 text-white">Rank Over Time</h3>
			<ResponsiveContainer width="100%" height={200}>
				<LineChart data={merged} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
					<XAxis dataKey="month" stroke="#fff" />
					<YAxis stroke="#fff" domain={[max + 1, min]} allowDecimals={false} />
					<Tooltip labelStyle={{ color: "#fff" }} contentStyle={{ background: "#23243a", color: "#fff" }} formatter={(v:any)=>v} />
					<Line type="monotone" dataKey="rank" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls={true} />
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

export function VirtualTop20Chart({ ranking }: { ranking: { name?: string; tiref?: string; time?: number | null }[] }) {
	const data = (ranking || []).filter(r => r && r.time != null).slice(0,20).map((r, idx) => ({
		name: r.name || (r.tiref || `#${idx+1}`),
		time: typeof r.time === 'number' ? r.time : (r.time == null ? null : Number(r.time))
	}));
	// Recharts expects numeric x-values; we'll render horizontal bars with names on Y axis
	const safeFormatLocal = (v: any) => formatTimeValue(typeof v === 'number' ? v : (v == null ? null : Number(v)));
	return (
		<div className="chart-outer p-4 rounded-lg bg-gray-900 mt-6">
			<h3 className="mb-2 text-white">Virtual Top 20 (Latest Month)</h3>
			<ResponsiveContainer width="100%" height={420}>
				<BarChart layout="vertical" data={data} margin={{ top: 10, right: 30, left: 120, bottom: 10 }}>
					<XAxis type="number" stroke="#fff" tickFormatter={safeFormatLocal as any} />
					<YAxis type="category" dataKey="name" width={120} stroke="#fff" />
					<Tooltip formatter={(v:any) => safeFormatLocal(v)} labelStyle={{ color: '#fff' }} contentStyle={{ background: '#23243a', color: '#fff' }} />
					<Bar dataKey="time" fill="#60a5fa" isAnimationActive={false}>
						<LabelList dataKey="time" position="right" formatter={(v:any) => safeFormatLocal(v)} />
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}

export function Virtual20thSeriesChart({ months, trackedSeries, compareMonths, highlightStart, highlightEnd }: { months: { month: string; ranking: any[] }[]; trackedSeries?: { month: string; time: number | null }[]; compareMonths?: { month: string; ranking: any[] }[]; highlightStart?: string; highlightEnd?: string }) {
	// Parent supplies the months to display (may be sliced/filtered for the selected window)
	const lastMonths = months || [];

	// Include tracked swimmer months even if they're older than the cutoff window
	const baseMonths = lastMonths.map(m => m.month);
	const trackedMonths = (trackedSeries || []).map(t => t.month);
	const compareMonthKeys = (compareMonths || []).map(m => m.month);
	const combinedMonths = Array.from(new Set([...trackedMonths, ...compareMonthKeys, ...baseMonths])).sort();

	const series = combinedMonths.map(monthKey => {
		const mobj = (months || []).find(m => m.month === monthKey) || { month: monthKey, ranking: [] };
		const item = (Array.isArray(mobj.ranking) && mobj.ranking[19]) || null;
		const tracked = (trackedSeries || []).find(t => t.month === monthKey);
		const compareObj = (compareMonths || []).find(m => m.month === monthKey) || null;
		const compareItem = (Array.isArray(compareObj?.ranking) && compareObj?.ranking[19]) || null;
		return {
			month: monthKey,
			time: item && item.time != null ? (typeof item.time === 'number' ? item.time : Number(item.time)) : null,
			name: item ? item.name : null,
			trackedTime: tracked && tracked.time != null ? (typeof tracked.time === 'number' ? tracked.time : Number(tracked.time)) : null,
			compareTime: compareItem && compareItem.time != null ? (typeof compareItem.time === 'number' ? compareItem.time : Number(compareItem.time)) : null
		};
	});

	const values = series.flatMap(s => [s.time, s.trackedTime]).filter(v => v != null) as number[];
	const min = values.length > 0 ? Math.floor(Math.min(...values) - 5) : undefined;
	const max = values.length > 0 ? Math.ceil(Math.max(...values) + 5) : undefined;

	return (
		<div className="chart-outer p-4 rounded-lg bg-gray-900 mt-6">
			<h3 className="mb-2 text-white">Qualifying Baseline</h3>
			<div className="relative">
				<ResponsiveContainer width="100%" height={360}>
					<LineChart data={series} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
						{/* highlight region if provided (accepts YYYY-MM or YYYY-MM-DD, chart X axis uses YYYY-MM keys) */}
						{highlightStart && highlightEnd && (() => {
							const fmt = (s: string) => {
								try {
									const d = new Date(s);
									if (isNaN(d.getTime())) return String(s).slice(0,7);
									return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
								} catch (e) { return String(s).slice(0,7); }
							};
							const labelVal = `${fmt(String(highlightStart))} — ${fmt(String(highlightEnd))}`;
							return (
								<ReferenceArea
									x1={String(highlightStart).slice(0,7)}
									x2={String(highlightEnd).slice(0,7)}
									stroke="#1e40af"
									strokeOpacity={0.18}
									fill="#1e40af"
									fillOpacity={0.34}
									label={{ value: 'Q Window', position: 'center', fill: '#fff', fontSize: 11, fontWeight: 700 }}
								/>
							);
						})()}
						<XAxis dataKey="month" stroke="#fff" />
						<YAxis stroke="#fff" tickFormatter={(v:any) => formatTimeValue(typeof v === 'number' ? v : (v == null ? null : Number(v)))} domain={min != null && max != null ? [min, max] : ["auto", "auto"]} />
						<Legend />
						<Tooltip labelStyle={{ color: '#fff' }} contentStyle={{ background: '#23243a', color: '#fff' }} formatter={(v:any) => formatTimeValue(typeof v === 'number' ? v : (v == null ? null : Number(v)))} labelFormatter={(lab:any) => `Month: ${lab}`} />
						<Line type="monotone" dataKey="time" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="6 4" strokeOpacity={0.6} connectNulls={true} name="Current Year Cutoff" />
						{compareMonths && compareMonths.length > 0 && (
							<Line type="monotone" dataKey="compareTime" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} strokeDasharray="4 6" strokeOpacity={0.9} connectNulls={true} name="Previous Year" />
						)}
						<Line type="monotone" dataKey="trackedTime" stroke="#3b82f6" strokeWidth={4} dot={{ r: 3 }} connectNulls={true} name="Tracked Swimmer" />
	                        <Brush dataKey="month" height={36} stroke="#8884d8" travellerWidth={10} />
					</LineChart>
				</ResponsiveContainer>
				{/* label rendered inside ReferenceArea */}
			</div>
		</div>
	);
}
