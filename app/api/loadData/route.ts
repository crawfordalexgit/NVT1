import { NextRequest } from "next/server";
import { buildRankingsUrl } from "@/lib/swimUrls";
import * as cheerio from "cheerio";
import { getCached, setCached, computeCacheKey } from "@/lib/cache";

export async function GET(req: NextRequest) {
	const params = Object.fromEntries(req.nextUrl.searchParams) as Record<string, string>;
	const poolParam = params.pool === 'L' || params.pool === 'S' ? params.pool : 'L';
	const strokeNum = params.stroke ? Number(params.stroke) : 0;
	const sexParam = params.sex === 'M' || params.sex === 'F' ? params.sex : 'M';
	const ageGroup = params.ageGroup ?? '';
	const date = params.date ?? '';
	const url = buildRankingsUrl({ pool: poolParam as "L" | "S", stroke: strokeNum, sex: sexParam, ageGroup, date });
	const cacheKey = computeCacheKey({ route: 'rankings', pool: poolParam, stroke: strokeNum, sex: sexParam, ageGroup, date });
	const cached = await getCached(cacheKey);
	if (cached) return Response.json(cached);
	const res = await fetch(url);
	if (!res.ok) return Response.json({ error: "Failed to fetch rankings", url }, { status: 500 });
	const html = await res.text();
	const $ = cheerio.load(html);
	const table = $("#rankTable");
	if (!table.length) return Response.json({ error: "Rank table not found" }, { status: 404 });
	const headers = table.find("tr").first().find("th,td").map((i, el) => $(el).text().toLowerCase()).get();
	const colIdx = {
		rank: headers.findIndex(h => /rank|pos|position/.test(h)),
		name: headers.findIndex(h => /name|swimmer/.test(h)),
		time: headers.findIndex(h => /time|result/.test(h)),
		date: headers.findIndex(h => /date/.test(h)),
		club: headers.findIndex(h => /club|team/.test(h)),
		// add more if needed
	};

	function readCell(cells: cheerio.Cheerio<any>, idx: number) {
		if (typeof idx !== 'number' || idx < 0) return '';
		return cells.eq(idx).text().trim();
	}
	const rows = table.find("tr").slice(1);
	const swimmers = rows.map((i, row) => {
		const cells = $(row).find("th,td");
		const nameCell = cells.eq(colIdx.name >= 0 ? colIdx.name : 0);
		const tirefMatch = nameCell.find("a[href*='tiref']").attr("href")?.match(/tiref=(\d+)/);
		let clubVal = readCell(cells, colIdx.club);
		// heuristic: if club not found in detected column, scan the whole row text for 'tonbridge' or similar
		if ((!clubVal || clubVal.length === 0) && $(row).text().toLowerCase().includes('tonbridge')) {
			clubVal = 'Tonbridge';
		}
		return {
			rank: readCell(cells, colIdx.rank),
			name: nameCell.text().trim(),
			time: readCell(cells, colIdx.time),
			date: readCell(cells, colIdx.date),
			club: clubVal,
			tiref: tirefMatch ? tirefMatch[1] : null
		};
	}).get();
	const payload = { swimmers, url };
	// cache rankings for 6 hours
	try { await setCached(cacheKey, payload, 60 * 60 * 6); } catch (e) {}
	return Response.json(payload);
}
