#!/usr/bin/env node
// Run migrations/0001_init.sql against Neon. Usage: node scripts/migrate.mjs
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
const migration = readFileSync(
  resolve(projectRoot, 'migrations/0001_init.sql'),
  'utf8',
);

// Strip comment-only lines, then split on `;\n`. The previous version
// dropped any statement whose first line was a `--` comment.
const statements = migration
  .split(/;\s*\n/)
  .map((s) =>
    s
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((s) => s);

console.log(`▸ Running ${statements.length} statement(s)...`);
for (const stmt of statements) {
  const summary = stmt.split('\n')[0].slice(0, 70);
  try {
    await sql.query(stmt);
    console.log(`  ✓ ${summary}`);
  } catch (err) {
    console.error(`  ✗ ${summary}`);
    console.error(`    ${err.message}`);
    process.exit(1);
  }
}

// Verify
const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name
`;
console.log('\n▸ Tables in DB:');
for (const t of tables) console.log(`  • ${t.table_name}`);

const counts = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM tracks)         AS tracks,
    (SELECT COUNT(*)::int FROM lyrics)         AS lyrics,
    (SELECT COUNT(*)::int FROM daily_stats)    AS daily_stats,
    (SELECT COUNT(*)::int FROM daily_visitors) AS daily_visitors
`;
console.log('\n▸ Row counts:', counts[0]);
console.log('\n✅ Migration complete');
