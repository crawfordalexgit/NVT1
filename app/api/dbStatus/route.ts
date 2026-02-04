import { NextRequest } from 'next/server';
import supabase from '@/lib/supabaseServer';

async function count(table: string) {
  try {
    // Use head:true with count: 'exact' to get an exact row count without relying on an `id` column
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) return { table, error: String(error.message || error), count: null };
    return { table, error: null, count: typeof count === 'number' ? count : null };
  } catch (e: any) {
    return { table, error: String(e?.message || e), count: null };
  }
}

export async function GET(req: NextRequest) {
  try {
    const tables = ['event_pbs_imports', 'swimmer_personal_bests', 'snapshot_runs', 'report_cache'];
    const results = [] as any[];
    for (const t of tables) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await count(t));
    }
    return Response.json({ ok: true, results });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
