// TypeScript interfaces for swimming tracker

export type PersonalBest = {
	date: string;        // Format: "DD/MM/YY" or "DD/MM/YYYY"
	time: number | null; // Seconds (e.g., 123.68)
	stroke: string;      // Event name
};

export type SwimmerBest = {
	name: string;
	rank?: number;
	data: PersonalBest[];
	personalBestsUrl?: string;
};

export type MonthlyCutoff = {
	month: string;        // Format: "YYYY-MM"
	cutoff: number | null;
	reason?: string;      // e.g., "20th fastest", "below floor", "monotonic enforced"
};

export type TrackedMonthly = {
	month: string;
	time: number | null;  // Best time in that month
};

// Event definitions and labels
export const eventLabels: Record<number, string> = {
	1: "50 Free",
	2: "100 Free",
	3: "200 Free",
	4: "400 Free",
	5: "800 Free",
	6: "1500 Free",
	7: "50 Breast",
	8: "100 Breast",
	9: "200 Breast",
 10: "50 Back",
 11: "100 Back",
 12: "200 Back",
 13: "50 Fly",
 14: "100 Fly",
 15: "200 Fly",
 16: "100 IM",
 17: "200 IM",
 18: "400 IM"
};
