import { NextRequest } from "next/server";
import { buildPersonalBestUrl } from "@/lib/swimUrls";
import { parseTimeString } from "@/lib/time";
import * as cheerio from "cheerio";
import { getCached, setCached, computeCacheKey } from "@/lib/cache";
import { getSwimmerPersonalBests } from '@/lib/supabaseServer';
import { eventNameToCode } from '@/utils/eventNameToCode';

export async function GET(req: NextRequest) {
	const params = Object.fromEntries(req.nextUrl.searchParams) as Record<string, string>;
	const poolParam = params.pool === 'L' || params.pool === 'S' ? params.pool : 'L';
	const strokeNum = params.stroke ? Number(params.stroke) : 0;
	const sexParam = params.sex === 'M' || params.sex === 'F' ? params.sex : 'M';
	const ageGroup = params.ageGroup ?? '';
	const tiref = params.tiref ?? '';
	const date = params.date ?? '';
	const force = params.force === '1' || params.force === 'true';
	const url = buildPersonalBestUrl({ pool: poolParam as "L" | "S", stroke: strokeNum, sex: sexParam, ageGroup, tiref, date, fullHistory: true });
	const cacheKey = computeCacheKey({ route: 'personalBest', pool: poolParam, stroke: strokeNum, sex: sexParam, ageGroup, tiref, date });
	const cached = await getCached(cacheKey);
	if (!force && cached) return Response.json(cached);

	// If DB is enabled and not forcing a refresh, try DB-first lookup by tiref
	if (!force && process.env.USE_SUPABASE === 'true' && tiref) {
		try {
			const rows = await getSwimmerPersonalBests(tiref, 50);
			if (rows && rows.length) {
				// map to existing API shape
				// derive event name from stroke param if row.event missing
				const strokeToName = (snum: number) => Object.entries(eventNameToCode).find(([,v]) => v === snum)?.[0] || null;
				const data = rows.map(r => ({ time: r.time, date: (r.pb_date ? new Date(r.pb_date).toLocaleDateString('en-GB') : null), meet: r.meet, payload: r.payload, event: r.event ?? strokeToName(strokeNum) }));
				const payload = { data, url: 'db' };
				try { await setCached(cacheKey, payload, 60 * 60 * 24 * 7); } catch (e) {}
				return Response.json(payload);
			}
		} catch (e) {
			// ignore DB errors and fall back to scraping
		}
	}
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
		const isVercelAuth = typeof txt === 'string' && txt.includes('Vercel Authentication') || txt.includes('Authentication Required') || txt.includes('x-vercel-protection-bypass');
		const debug: Record<string, any> = { ok: false, status: res.status, statusText: res.statusText, text: txt.slice(0,4000), url };
		if (isVercelAuth) {
			debug.vercelAuth = true;
			debug.hint = 'Target site requires Vercel deployment authentication. Provide a bypass token or use vercel curl / MCP as described in the returned HTML.';
		}
		return Response.json(debug, { status: 200 });
	}
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
			level: cells.eq(7).text().trim(),
			event: Object.entries(eventNameToCode).find(([,v]) => v === strokeNum)?.[0] || null
		};
	}).get();
	const payload = { data, url };
	try { await setCached(cacheKey, payload, 60 * 60 * 24 * 7); } catch (e) {}
	return Response.json(payload);
}
