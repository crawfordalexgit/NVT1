import fs from 'fs';
import path from 'path';
import { getReportCache, setReportCache } from './supabaseServer';

type CacheEntry = { value: any; expiresAt: number };

const MEMORY_MAX = 500; // max entries
const memoryCache = new Map<string, CacheEntry>();

const CACHE_DIR = path.join(process.cwd(), '.cache');
let fsAvailable = true;
try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (e) {
    fsAvailable = false;
}

function pruneMemory() {
    while (memoryCache.size > MEMORY_MAX) {
        // remove oldest
        const firstKey = memoryCache.keys().next().value;
        if (!firstKey) break;
        memoryCache.delete(firstKey);
    }
}

export function computeCacheKey(obj: Record<string, any>) {
    // stable stringify: sort keys
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
        const v = obj[k];
        if (v === undefined || v === null) continue;
        parts.push(`${k}=${String(v)}`);
    }
    return parts.join('&');
}

export async function getCached(key: string): Promise<any | null> {
    // check memory
    const mem = memoryCache.get(key);
    const now = Date.now();
    if (mem) {
        if (mem.expiresAt > now) return mem.value;
        memoryCache.delete(key);
    }
    // If Supabase is enabled, use DB-only cache (no filesystem fallback)
    if (process.env.USE_SUPABASE === 'true') {
        try {
            const dbv = await getReportCache(key);
            if (dbv) {
                // store in memory for quick reuse
                memoryCache.set(key, { value: dbv, expiresAt: now + 60 * 60 * 1000 });
                pruneMemory();
                return dbv;
            }
        } catch (err) {
            console.error('getReportCache failed:', String(err));
            return null;
        }
        return null;
    }

    // check filesystem cache when DB is not enabled
    if (fsAvailable) {
        try {
            const file = path.join(CACHE_DIR, `${key}.json`);
            if (fs.existsSync(file)) {
                const txt = fs.readFileSync(file, 'utf8');
                const parsed = JSON.parse(txt) as CacheEntry;
                if (parsed.expiresAt > now) {
                    // copy to memory
                    memoryCache.set(key, parsed);
                    pruneMemory();
                    return parsed.value;
                } else {
                    try { fs.unlinkSync(file); } catch(_) {}
                }
            }
        } catch (e) {
            // ignore fs errors
        }
    }
    return null;
}

export async function setCached(key: string, value: any, ttlSeconds: number) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const entry: CacheEntry = { value, expiresAt };
    memoryCache.set(key, entry);
    pruneMemory();
    // If Supabase is enabled, write to DB only (no filesystem fallback)
    if (process.env.USE_SUPABASE === 'true') {
        try {
            await setReportCache(key, value, ttlSeconds);
        } catch (err) {
            console.error('setReportCache failed; not writing to filesystem:', String(err));
        }
        return;
    }

    // Otherwise persist to filesystem cache
    if (fsAvailable) {
        try {
            const file = path.join(CACHE_DIR, `${key}.json`);
            fs.writeFileSync(file, JSON.stringify(entry), { encoding: 'utf8' });
        } catch (e) {
            // ignore
        }
    }
}

export function clearCache() {
    memoryCache.clear();
    if (fsAvailable) {
        try {
            const files = fs.readdirSync(CACHE_DIR);
            for (const f of files) {
                try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch(_) {}
            }
        } catch (_) {}
    }
}

export default { getCached, setCached, computeCacheKey, clearCache };
