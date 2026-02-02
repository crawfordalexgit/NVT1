import { NextRequest } from "next/server";
import { buildPersonalBestUrl } from "@/lib/swimUrls";
import { parseTimeString } from "@/lib/time";
import * as cheerio from "cheerio";

export async function GET(req: NextRequest) {
	const { pool, stroke, sex, ageGroup, tiref, date } = Object.fromEntries(req.nextUrl.searchParams);
	const url = buildPersonalBestUrl({ pool, stroke: Number(stroke), sex, ageGroup, tiref, date });
	const res = await fetch(url);
	if (!res.ok) return Response.json({ error: "Failed to fetch personal bests" }, { status: 500 });
	const html = await res.text();
	const $ = cheerio.load(html);
	const table = $("table").first();
	if (!table.length) return Response.json({ error: "Personal best table not found" }, { status: 404 });
	const rows = table.find("tr").slice(1);
	const data = rows.map((i, row) => {
		const cells = $(row).find("th,td");
		return {
			time: parseTimeString(cells.eq(0).text().trim()),
			date: cells.eq(3).text().trim(),
			meet: cells.eq(4).text().trim(),
			venue: cells.eq(5).text().trim(),
			level: cells.eq(7).text().trim()
		};
	}).get();
	return Response.json({ data });
}
