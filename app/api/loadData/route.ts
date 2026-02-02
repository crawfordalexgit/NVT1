import { NextRequest } from "next/server";
import { buildRankingsUrl } from "@/lib/swimUrls";
import * as cheerio from "cheerio";

export async function GET(req: NextRequest) {
	const { pool, stroke, sex, ageGroup, date } = Object.fromEntries(req.nextUrl.searchParams);
	const url = buildRankingsUrl({ pool, stroke: Number(stroke), sex, ageGroup, date });
	const res = await fetch(url);
	if (!res.ok) return Response.json({ error: "Failed to fetch rankings" }, { status: 500 });
	const html = await res.text();
	const $ = cheerio.load(html);
	const table = $("#rankTable");
	if (!table.length) return Response.json({ error: "Rank table not found" }, { status: 404 });
	const headers = table.find("tr").first().find("th,td").map((i, el) => $(el).text().toLowerCase()).get();
	const colIdx = {
		rank: headers.findIndex(h => h.includes("rank")),
		name: headers.findIndex(h => h.includes("name")),
		time: headers.findIndex(h => h.includes("time")),
		date: headers.findIndex(h => h.includes("date")),
		club: headers.findIndex(h => h.includes("club")),
		// add more if needed
	};
	const rows = table.find("tr").slice(1);
	const swimmers = rows.map((i, row) => {
		const cells = $(row).find("th,td");
		const nameCell = cells.eq(colIdx.name);
		const tirefMatch = nameCell.find("a[href*='tiref']").attr("href")?.match(/tiref=(\d+)/);
		return {
			rank: cells.eq(colIdx.rank).text().trim(),
			name: nameCell.text().trim(),
			time: cells.eq(colIdx.time).text().trim(),
			date: cells.eq(colIdx.date).text().trim(),
			club: cells.eq(colIdx.club).text().trim(),
			tiref: tirefMatch ? tirefMatch[1] : null
		};
	}).get();
	return Response.json({ swimmers });
}
