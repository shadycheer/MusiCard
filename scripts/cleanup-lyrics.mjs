#!/usr/bin/env node
// One-off DB hygiene: delete cached miss markers and any rows with empty
// lyrics so the next request gives them another shot through the new
// LRCLIB → AI flow (the manual-paste fallback is gone, so a permanent
// 'miss' cache entry would just silently render a card without lyrics).
//
// Usage: node scripts/cleanup-lyrics.mjs

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const envContent = readFileSync(resolve(projectRoot, '.env.local'), 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set in .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const before = await sql`
  SELECT source, COUNT(*)::int AS n FROM lyrics GROUP BY source ORDER BY source
`;
console.log('Before:');
for (const row of before) console.log(`  ${row.source.padEnd(14)} ${row.n}`);

const deleted = await sql`
  DELETE FROM lyrics
  WHERE source IN ('ai-miss', 'lrclib-miss')
     OR COALESCE(array_length(lines, 1), 0) = 0
  RETURNING cache_key
`;
console.log(`\nDeleted ${deleted.length} stale rows.`);

const after = await sql`
  SELECT source, COUNT(*)::int AS n FROM lyrics GROUP BY source ORDER BY source
`;
console.log('\nAfter:');
for (const row of after) console.log(`  ${row.source.padEnd(14)} ${row.n}`);
