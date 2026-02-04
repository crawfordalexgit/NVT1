#!/usr/bin/env node
// Migration script: add `level` column to swimmer_personal_bests
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
const conn = process.env.BASE_DB_URL;
if (!conn) {
  console.error('BASE_DB_URL not found in environment or .env.local');
  process.exit(1);
}
(async ()=>{
  try {
    const { Client } = require('pg');
    const client = new Client({ connectionString: conn });
    await client.connect();
    console.log('Connected to DB, running migration to add `level` column...');
    const sql = `ALTER TABLE IF EXISTS swimmer_personal_bests ADD COLUMN IF NOT EXISTS level text;`;
    await client.query(sql);
    console.log('Migration completed: `level` column ensured.');
    await client.end();
    process.exit(0);
  } catch (e) {
    console.error('Migration error:', e);
    process.exit(2);
  }
})();
