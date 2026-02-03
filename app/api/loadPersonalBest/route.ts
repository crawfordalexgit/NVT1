import { NextRequest } from "next/server";
import { buildPersonalBestUrl } from "@/lib/swimUrls";
import { parseTimeString } from "@/lib/time";
import * as cheerio from "cheerio";
import { getCached, setCached, computeCacheKey } from "@/lib/cache";

export async function GET(req: NextRequest) {
	const params = Object.fromEntries(req.nextUrl.searchParams) as Record<string, string>;
	const poolParam = params.pool === 'L' || params.pool === 'S' ? params.pool : 'L';
	const strokeNum = params.stroke ? Number(params.stroke) : 0;
	const sexParam = params.sex === 'M' || params.sex === 'F' ? params.sex : 'M';
	const ageGroup = params.ageGroup ?? '';
	const tiref = params.tiref ?? '';
	const date = params.date ?? '';
	const url = buildPersonalBestUrl({ pool: poolParam as "L" | "S", stroke: strokeNum, sex: sexParam, ageGroup, tiref, date });
	const cacheKey = computeCacheKey({ route: 'personalBest', pool: poolParam, stroke: strokeNum, sex: sexParam, ageGroup, tiref, date });
	const cached = await getCached(cacheKey);
	if (cached) return Response.json(cached);
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
	const payload = { data, url };
	try { await setCached(cacheKey, payload, 60 * 60 * 24 * 7); } catch (e) {}
	return Response.json(payload);
}
