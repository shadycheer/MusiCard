#!/usr/bin/env node
// Combine the four card-*.png files into a single side-by-side collage
// with a shared baseline + brand-dark padding so the README doesn't
// expose the per-card height differences. README embeds the collage
// instead of laying the cards out in a table.
//
// Run: node scripts/build-card-collage.mjs

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, statSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const assets = resolve(projectRoot, 'docs/assets');

const inputs = [
  'card-spotify.png',
  'card-apple-music.png',
  'card-netease.png',
  'card-qq-music.png',
];
for (const f of inputs) {
  const p = resolve(assets, f);
  if (!existsSync(p)) throw new Error(`Missing ${p}`);
}

// All four cards are 720px wide. Compute padded height = max(all heights) + 40.
const sizes = inputs.map((f) => {
  const buf = readFileSync(resolve(assets, f));
  // PNG IHDR: width @ bytes 16-19, height @ 20-23 (big-endian).
  return {
    file: f,
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
});
const maxH = Math.max(...sizes.map((s) => s.height));
const padH = maxH + 40;
const gap = 48;
const bg = '#0E0E12';

/* Each card padded to (cardW + gap) × padH, with the actual card pinned
   to the top-left of the padded box (so the row reads as "top-aligned
   cards with gutters"). Final card stays cardW (no trailing gutter). */
const filterParts = inputs.map((_, i) => {
  const last = i === inputs.length - 1;
  const w = last ? sizes[i].width : sizes[i].width + gap;
  return `[${i}]pad=${w}:${padH}:0:0:color=${bg}[p${i}]`;
});
filterParts.push(`[p0][p1][p2][p3]hstack=inputs=4[row]`);
const filter = filterParts.join(';');

const out = resolve(assets, 'cards.png');
const args = [
  '-y',
  ...inputs.flatMap((f) => ['-i', resolve(assets, f)]),
  '-filter_complex', filter,
  '-map', '[row]',
  out,
];

const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (r.status !== 0) throw new Error('ffmpeg failed');

const final = statSync(out);
console.log(`✓ ${out} (${(final.size / 1024).toFixed(0)} KB)`);
