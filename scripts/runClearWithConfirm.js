// Wrapper to set confirmation env var and execute purge script
// load .env.local if present (simple parser)
const fs = require('fs');
const path = require('path');
function loadEnvLocal(filePath) {
	if (!fs.existsSync(filePath)) return;
	const raw = fs.readFileSync(filePath, 'utf8');
	raw.split(/\r?\n/).forEach(line => {
		line = line.trim();
		if (!line || line.startsWith('#')) return;
		const eq = line.indexOf('=');
		if (eq === -1) return;
		const key = line.slice(0, eq).trim();
		let val = line.slice(eq + 1).trim();
		if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
		process.env[key] = val;
	});
}

loadEnvLocal(path.resolve(process.cwd(), '.env.local'));
process.env.PURGE_SUPABASE = 'true';
require('./clearSupabaseSnapshots.js');
