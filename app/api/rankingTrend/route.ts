import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { queryRankingTrend } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const name = url.searchParams.get('name') || '';
    const event = url.searchParams.get('event') || '';
    const age = url.searchParams.get('age') || '';
    const sex = url.searchParams.get('sex') || '';
    const limit = parseInt(url.searchParams.get('limit') || '12', 10);

    // Prefer Supabase query when enabled
    if (process.env.USE_SUPABASE === 'true' && name) {
        try {
            const rows = await queryRankingTrend(name, Math.max(limit, 12));
            return Response.json({ data: rows });
        } catch (e) {
            console.error('Supabase queryRankingTrend failed, falling back to filesystem:', String(e));
            // fallback to filesystem below
        }
    }

    const snapDir = path.join(process.cwd(), '.cache', 'rankingSnapshots');
    if (!fs.existsSync(snapDir)) return Response.json({ data: [] });

    const files = fs.readdirSync(snapDir).filter(f => f.endsWith('.json')).sort();
    const picked = files.slice(-limit);
    const keyNoDate = `${event}|${age}|${sex}`;
    const out: { date: string; rank: number | null; time?: any }[] = [];

    for (const f of picked) {
        try {
            const txt = fs.readFileSync(path.join(snapDir, f), 'utf8');
            const parsed = JSON.parse(txt);
            const runIso = parsed.runIso || f.replace('.json','');
            const snaps = parsed.snapshots || {};
            const list = snaps[keyNoDate] || [];
            let found = null as any;
            if (name) {
                found = list.find((s: any) => (s.name || '').trim() === name.trim() || (s.tiref && String(s.tiref) === String(name)));
            }
            if (!found && list.length > 0 && !name) {
                // nothing requested
            }
            out.push({ date: runIso, rank: found ? (found.rank ?? null) : null, time: found ? found.time : undefined });
        } catch (e) {
            // ignore read errors
            out.push({ date: f.replace('.json',''), rank: null });
        }
    }

    return Response.json({ data: out });
}
