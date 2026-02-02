
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { formatTimeValue } from "@/lib/time";

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

	return (
		<div className="chart-outer p-4 rounded-lg bg-gray-900 mt-8">
			<h3 className="mb-2 text-white">Historical Qualifying Time (20th Position Cutoff)</h3>
			<ResponsiveContainer width="100%" height={360}>
				<LineChart data={merged} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
					<XAxis dataKey="month" stroke="#fff" />
					<YAxis stroke="#fff" tickFormatter={formatTimeValue} domain={min != null && max != null ? [min, max] : ["auto", "auto"]} />
					<Tooltip formatter={formatTimeValue} labelStyle={{ color: "#fff" }} contentStyle={{ background: "#23243a", color: "#fff" }} />
					<Line type="monotone" dataKey="cutoff" stroke="#ffe600" strokeWidth={4} dot={{ r: 2 }} strokeDasharray="8 6" name="Cutoff" />
					<Line type="monotone" dataKey="time" stroke="#3b82f6" strokeWidth={3} dot={{ r: 2 }} name="Tracked Swimmer" connectNulls={true} />
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
					<YAxis stroke="#fff" tickFormatter={formatTimeValue} domain={["auto", "auto"]} />
					<Tooltip formatter={formatTimeValue} labelStyle={{ color: "#fff" }} contentStyle={{ background: "#23243a", color: "#fff" }} />
					<Line type="monotone" dataKey="time" stroke="#3b82f6" strokeWidth={3} dot={false} />
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

export default { LineGraph };
