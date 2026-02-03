// Generates rankings and personal best URLs for swimmingresults.org

export function buildRankingsUrl({
	pool,
	stroke,
	sex,
	ageGroup,
	date,
	county = "XXXX",
	club = "XXXX",
	region = "P",
	nationality = "E"
}: {
	pool: "L" | "S";
	stroke: number;
	sex: "M" | "F";
	ageGroup: string;
	date: string;
	county?: string;
	club?: string;
	region?: string;
	nationality?: string;
}): string {
	const params = new URLSearchParams({
		Pool: pool,
		Stroke: stroke.toString(),
		Sex: sex,
		AgeGroup: ageGroup,
		date: date,
		StartNumber: "1",
		RecordsToView: "50",
		Level: "N",
		TargetNationality: nationality,
		TargetRegion: region,
		TargetCounty: county,
		TargetClub: club
	});
	return `https://www.swimmingresults.org/12months/last12.php?${params.toString()}`;
}

export function buildPersonalBestUrl({
	pool,
	stroke,
	sex,
	ageGroup,
	tiref,
	date,
	county = "XXXX",
	club = "XXXX",
	region = "P",
	nationality = "E"
}: {
	pool: "L" | "S";
	stroke: number;
	sex: "M" | "F";
	ageGroup: string;
	tiref: string;
	date: string;
	county?: string;
	club?: string;
	region?: string;
	nationality?: string;
}): string {
	const params = new URLSearchParams({
		back: "12months",
		Pool: pool,
		Stroke: stroke.toString(),
		Sex: sex,
		AgeGroup: ageGroup,
		"date-1-dd": date.split("/")[0],
		"date-1-mm": date.split("/")[1],
		"date-1": date.split("/")[2],
		StartNumber: "1",
		RecordsToView: "50",
		Level: "N",
		TargetClub: club,
		TargetRegion: region,
		TargetCounty: county,
		TargetNationality: nationality,
		tiref: tiref,
		mode: pool,
		tstroke: stroke.toString(),
		tcourse: pool
	});
	return `https://www.swimmingresults.org/individualbest/personal_best_time_date.php?${params.toString()}`;
}
