import { NextRequest } from "next/server";
import { getCached } from '@/lib/cache';

export async function GET(req: NextRequest) {
    try {
        const cached = await getCached('fullReport');
        if (!cached) return new Response(JSON.stringify({ error: 'No cached report' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        return Response.json(cached);
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Cache error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
