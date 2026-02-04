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
	// use browser-like headers to reduce chance of remote blocking
	const fetchOptions: RequestInit = {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-GB,en;q=0.9',
			'Referer': url
		}
	};
	let res: Response;
	try {
		res = await fetch(url, fetchOptions);
	} catch (e: any) {
		const errText = String(e?.message || e);
		return Response.json({ ok: false, error: 'Fetch failed', message: errText, url }, { status: 200 });
	}
	if (!res.ok) {
		const txt = await res.text().catch(() => '');
		// detect Vercel deployment-protection HTML and surface guidance
		const isVercelAuth = typeof txt === 'string' && txt.includes('Vercel Authentication') || txt.includes('Authentication Required') || txt.includes('x-vercel-protection-bypass');
		const debug: Record<string, any> = { ok: false, status: res.status, statusText: res.statusText, text: txt.slice(0, 4000), url };
		if (isVercelAuth) {
			debug.vercelAuth = true;
			debug.hint = 'Target site requires Vercel deployment authentication. Provide a bypass token or use vercel curl / MCP as described in the returned HTML.';
		}
		return Response.json(debug, { status: 200 });
	}
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
        yob: headers.findIndex(h => /yob|year of birth|born/.test(h)),
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

		// parse yob if present
		let yobVal: number | null = null;
		if (typeof colIdx.yob === 'number' && colIdx.yob >= 0) {
			const raw = readCell(cells, colIdx.yob);
			if (raw && raw.length > 0) {
				// Match either 4-digit year or 2-digit year like '09' meaning 2009
				const m = raw.match(/(\d{2,4})/);
				if (m) {
					const val = m[1];
					if (val.length === 4) {
						yobVal = Number(val);
					} else if (val.length === 2) {
						const two = Number(val);
						const now = new Date();
						const cur2 = Number(String(now.getFullYear()).slice(-2));
						// if two-digit <= current 2-digit year, assume 2000+two, else 1900+two
						yobVal = two <= cur2 ? 2000 + two : 1900 + two;
					}
				}
			}
		}
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
			yob: yobVal,
			tiref: tirefMatch ? tirefMatch[1] : null
		};
	}).get();
	const payload = { swimmers, url };
	// cache rankings for 6 hours
	try { await setCached(cacheKey, payload, 60 * 60 * 6); } catch (e) {}
	return Response.json(payload);
}
