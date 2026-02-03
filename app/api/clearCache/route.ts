import { NextRequest } from "next/server";
import cache from "@/lib/cache";

export async function GET(req: NextRequest) {
    try {
        cache.clearCache();
        return Response.json({ ok: true });
    } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
