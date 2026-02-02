// Calculate monthly qualifying cutoff series and tracked swimmer series
// swimmers: array of { name, rank, data: PersonalBest[] }
// trackedName: string (swimmer name)
// rankings: array of { name, time } from current rankings (used to determine floor)
export function calculateMonthlyCutoff(
	swimmers: { name: string; rank?: number; data: { date: string; time: number | null | string }[] }[],
	trackedName: string,
	rankings: { name: string; time: number | string }[]
): {
	cutoffSeries: { month: string; cutoff: number | null; reason?: string }[];
	trackedSeries: { month: string; time: number | null }[];
} {
	// 1. Group all swims by month
	const groupedByMonth: Record<string, { name: string; time: number | null; date: string }[]> = {};
	swimmers.forEach(swimmer => {
		swimmer.data.forEach(pb => {
			const month = getMonthKey(pb.date);
			if (!month) return;
			if (!groupedByMonth[month]) groupedByMonth[month] = [];
			groupedByMonth[month].push({ name: swimmer.name, time: pb.time, date: pb.date });
		});
	});
	const months = Object.keys(groupedByMonth).sort();

	// 2. For each swimmer, get all-time PB
	const swimmerPBs: Record<string, number | null> = {};
	swimmers.forEach(swimmer => {
		const pbs = swimmer.data
			.map(pb => {
				if (pb.time == null) return null;
				if (typeof pb.time === "number") return pb.time;
				if (typeof pb.time === "string") return parseTimeString(pb.time);
				return null;
			})
			.filter((t): t is number => t != null && !isNaN(t));
		swimmerPBs[swimmer.name] = pbs.length > 0 ? Math.min(...pbs) : null;
	});

		// 3. Determine floor: current 20th-ranked swimmer's time (if available)
		let floor: number | null = null;
		if (rankings && rankings.length >= 20) {
			const raw = rankings[19].time;
			if (typeof raw === "number") floor = raw;
			else if (typeof raw === "string") floor = parseTimeString(raw);
		}
		// 3. Calculate cutoff for each month: simple rule — use the slowest time recorded in that month
		let lastCutoff: number | null = null;
		const cutoffSeries: { month: string; cutoff: number | null; reason?: string }[] = [];
		months.forEach(month => {
			const monthSwims = groupedByMonth[month]
				.map(s => {
					if (s.time == null) return null;
					if (typeof s.time === 'number') return s.time as number;
					if (typeof s.time === 'string') return parseTimeString(s.time as string);
					return null;
				})
				.filter((t): t is number => t != null && !isNaN(t));
			let cutoff: number | null = null;
			let reason = 'slowest this month';
			if (monthSwims.length > 0) {
				cutoff = Math.max(...monthSwims);
			} else {
				// no swims this month — carry forward previous cutoff for continuity
				cutoff = lastCutoff;
				reason = 'carry forward';
			}

			// Enforce floor: no month can be faster (smaller) than the current 20th-ranked time
			if (floor != null) {
				if (cutoff == null) {
					cutoff = floor;
					reason = 'floor applied';
				} else if (cutoff < floor) {
					cutoff = floor;
					reason = 'floor enforced';
				}
			}

			// Monotonic rule: don't allow cutoff to get faster than previous month
			if (lastCutoff != null && cutoff != null && cutoff < lastCutoff) {
				cutoff = lastCutoff;
				reason = 'monotonic enforced';
			}

			cutoffSeries.push({ month, cutoff, reason });
			lastCutoff = cutoff;
		});

	// 6. Tracked swimmer monthly best
	const tracked = swimmers.find(s => s.name === trackedName);
	const trackedSeries: { month: string; time: number | null }[] = months.map(month => {
		const swims = tracked?.data.filter(pb => getMonthKey(pb.date) === month && pb.time != null) || [];
		const best = swims.length > 0 ? Math.min(...swims.map(pb => pb.time!)) : null;
		return { month, time: best };
	});

	return { cutoffSeries, trackedSeries };
}
 
// Converts a time string (e.g., "2:03.68" or "63.45") to total seconds as a number
export function parseTimeString(time: string): number | null {
	const regex = /^(?:(\d+):)?(\d+)(?:\.(\d+))?$/;
	const match = time.match(regex);
	if (!match) return null;
	const minutes = match[1] ? parseInt(match[1], 10) : 0;
	const seconds = parseInt(match[2], 10);
	const fraction = match[3] ? parseFloat(`0.${match[3]}`) : 0;
	return minutes * 60 + seconds + fraction;
}

// Converts seconds to formatted string mm:ss.ms
export function formatTimeValue(seconds: number | null): string {
	if (seconds === null || isNaN(seconds)) return "--";
	const min = Math.floor(seconds / 60);
	const sec = Math.floor(seconds % 60);
	const ms = Math.round((seconds - min * 60 - sec) * 100);
	return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

// Parses a date string (DD/MM/YY or DD/MM/YYYY) to a Date object
export function parseDateString(date: string): Date | null {
	const parts = date.split("/").map(Number);
	if (parts.length < 3) return null;
	const [day, month, year] = parts;
	const fullYear = year < 100 ? 2000 + year : year;
	return new Date(fullYear, month - 1, day);
}

// Converts a date string to YYYY-MM format (zero-padded month)
export function getMonthKey(date: string): string | null {
	const d = parseDateString(date);
	if (!d) return null;
	const year = d.getFullYear();
	const month = (d.getMonth() + 1).toString().padStart(2, "0");
	return `${year}-${month}`;
}

// Calculate monthly cutoff using today's top-50 as candidate pool and virtual ranking per month
export function calculateMonthlyCutoffFromTop50(
	// swimmers: array of { name, rank?, data: { date, time, meet? }[] }
	swimmers: { name: string; data: { date: string; time: number | string | null; meet?: string }[] }[],
	rankings: { name: string; time: number | string }[],
	trackedName?: string,
	monthsToShow = 12
): { cutoffSeries: { month: string; cutoff: number | null; reason?: string }[]; trackedSeries: { month: string; time: number | null }[] } {
	// group swims by month
	const groupedByMonth: Record<string, { name: string; time: number | null; date: string; meet?: string }[]> = {};
	swimmers.forEach(sw => {
		sw.data.forEach(pb => {
			const m = getMonthKey(pb.date);
			if (!m) return;
			if (!groupedByMonth[m]) groupedByMonth[m] = [];
			groupedByMonth[m].push({ name: sw.name, time: pb.time as any, date: pb.date, meet: pb.meet });
		});
	});
	let months = Object.keys(groupedByMonth).sort();
	// limit to last N months
	if (months.length > monthsToShow) months = months.slice(months.length - monthsToShow);

	// parse today's top-50 times and determine floor (20th)
	const top50 = (rankings || []).slice(0, 50).map(r => ({ name: r.name, time: typeof r.time === 'number' ? r.time : (typeof r.time === 'string' ? parseTimeString(String(r.time)) : null) }));
	const floor = top50[19]?.time ?? null;

	const cutoffSeries: { month: string; cutoff: number | null; reason?: string }[] = [];
	let lastCutoff: number | null = null;

	months.forEach(month => {
		// build cumulative bests for each top50 swimmer up to and including this month
		const cumList: { name: string; cumulativeBest: number | null; swimmer?: any }[] = top50.map(t => {
			const swimmer = swimmers.find(s => s.name === t.name);
			const bestTimes = (swimmer?.data || [])
				.map(pb => {
					const m = getMonthKey(pb.date);
					if (!m) return null;
					return m <= month ? (typeof pb.time === 'number' ? pb.time : (typeof pb.time === 'string' ? parseTimeString(pb.time) : null)) : null;
				})
				.filter((x): x is number => x != null && !isNaN(x));
			const best = bestTimes.length > 0 ? Math.min(...bestTimes) : null;
			return { name: t.name, cumulativeBest: best, swimmer };
		});

		const eligible = cumList.filter(c => c.cumulativeBest != null) as { name: string; cumulativeBest: number; swimmer?: any }[];
		eligible.sort((a, b) => a.cumulativeBest - b.cumulativeBest);

		let cutoff: number | null = null;
		let reason = '';
		// keep track whether we computed a candidate from data (non-null)
		let originalCandidate: number | null = null;

		if (eligible.length >= 20) {
			const virtual20 = eligible[19];
			// find slowest swim by that swimmer in the month
			const swimsThisMonth = (virtual20.swimmer?.data || []).filter((s: any) => getMonthKey(s.date) === month && s.time != null).map((s: any) => (typeof s.time === 'number' ? s.time : (typeof s.time === 'string' ? parseTimeString(s.time) : null))).filter((x: any): x is number => x != null && !isNaN(x));
			if (swimsThisMonth.length > 0) {
				cutoff = Math.max(...swimsThisMonth);
				reason = `virtual20 swim in month: ${virtual20.name}`;
			} else {
				cutoff = virtual20.cumulativeBest;
				reason = `virtual20 cumulativeBest (no month swim)`;
			}
			originalCandidate = cutoff;
		} else {
			// fewer than 20 eligible: use slowest swim this month across pool if available
			const swimsThisMonthAll = (swimmers.flatMap(s => s.data) || []).filter((s: any) => getMonthKey(s.date) === month && s.time != null).map((s: any) => (typeof s.time === 'number' ? s.time : (typeof s.time === 'string' ? parseTimeString(s.time) : null))).filter((x: any): x is number => x != null && !isNaN(x));
			if (swimsThisMonthAll.length > 0) {
				cutoff = Math.max(...swimsThisMonthAll);
				reason = '<20 eligible swimmers';
				originalCandidate = cutoff;
			} else {
				cutoff = null;
				reason = 'no swims - carry forward';
			}
		}

		// enforce floor
		if (floor != null && cutoff != null && cutoff < floor) {
			cutoff = floor;
			reason = 'floor enforced';
		}

		// monotonic rule: only enforce when we had no original candidate from this month's data
		if (originalCandidate == null) {
			if (lastCutoff != null && cutoff != null && cutoff < lastCutoff) {
				cutoff = lastCutoff;
				reason = 'monotonic enforced';
			}
		}

		if (cutoff == null) cutoff = lastCutoff;

		cutoffSeries.push({ month, cutoff, reason });
		lastCutoff = cutoff;
	});

	// tracked series: for each month, use the swimmer's most recent swim up to that month and carry it forward
	const trackedSeries: { month: string; time: number | null }[] = months.map(month => {
		if (!trackedName) return { month, time: null };
		const trackedSwimmer = swimmers.find(s => s.name === trackedName);
		if (!trackedSwimmer) return { month, time: null };
		const candidateSwims = trackedSwimmer.data
			.map(pb => {
				const m = getMonthKey(pb.date);
				const d = parseDateString(pb.date);
				const t = pb.time == null ? null : (typeof pb.time === 'number' ? pb.time : (typeof pb.time === 'string' ? parseTimeString(pb.time) : null));
				return { m, d, t };
			})
			.filter(x => x.m != null && x.m <= month && x.t != null && !isNaN(x.t)) as { m: string; d: Date | null; t: number }[];
		if (candidateSwims.length === 0) return { month, time: null };
		// pick the most recent swim (by date) up to this month
		candidateSwims.sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0));
		return { month, time: candidateSwims[0].t };
	});

	return { cutoffSeries, trackedSeries };
}
