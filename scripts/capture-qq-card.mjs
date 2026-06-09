#!/usr/bin/env node
// Capture the QqMusicCard component as a standalone PNG matching the
// dimensions and lyric-block presence of the other card-*.png files
// (Spotify / Apple / NetEase). Specifically:
//   • picks 4 lyric lines so the lyrics block renders (otherwise the
//     QQ card sits ~600px shorter than the others — the README table
//     ends up uneven)
//   • bumps the card's --s scale to 2.25 so the captured PNG lands at
//     720px wide, matching the other card-*.png screenshots
//
// Run: node scripts/capture-qq-card.mjs
// Requires: dev server on :3000, Playwright already installed.

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Jay Chou — 晴天. Cached song-detail + cached LRCLIB lyrics (Chinese
// liner notes feel) so the card has a clear lyrics block.
const URL = 'http://localhost:3000/qq-0039MnYb0qxYhV';

const browser = await chromium.launch({
  headless: true,
  /* Pin to an existing chromium 1208 binary so this works even when the
     playwright npm package was bumped to expect a newer build number. */
  executablePath: '/Users/shadycheer/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1200 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[class*="QqMusicCard"][class*="card"]', { timeout: 15000 });
// Lyrics list needs to actually populate (not the loading row).
await page.waitForFunction(
  () =>
    !/查找歌词中/.test(document.body.innerText) &&
    document.querySelectorAll('[class*="LyricsPicker"][class*="line"]:not([class*="lineSelected"])').length > 4,
  { timeout: 25000 },
).catch(() => {});

// Pick the first 4 actual lyric rows (the LyricsPicker filters out
// the title/credit header server-side, so the rendered list starts
// at real lyrics).
const lineLocators = await page.locator('[class*="LyricsPicker"][class*="line"]').all();
for (let i = 0; i < Math.min(4, lineLocators.length); i++) {
  await lineLocators[i].click();
  await page.waitForTimeout(80);
}

// Wait until the card actually renders the lyrics block (the selected
// lines have propagated into the ShareCard preview).
await page.waitForFunction(
  () => document.querySelector('[class*="QqMusicCard"][class*="lyrics"]') !== null,
  { timeout: 5000 },
).catch(() => {});

// Move the share card out to a fresh body root, scale it to 720px wide,
// and hide everything else. Avoids the SongView grid layout (which puts
// the lyrics + Song DNA panels right next to the card and confuses any
// element-relative screenshot) and the .cardFrame max-width cap.
await page.evaluate(() => {
  const card = document.querySelector('[class*="QqMusicCard"][class*="card"]');
  if (!card) return;
  card.style.setProperty('--s', '2.25');
  card.style.position = 'fixed';
  card.style.top = '0';
  card.style.left = '0';
  card.style.margin = '0';
  card.style.zIndex = '99999';
  document.body.appendChild(card);
  /* Hide everything else so any stray transparent edges read the page
     background as solid black, not the lyrics panel. */
  document.querySelectorAll('body > *').forEach((el) => {
    if (el !== card && el.nodeType === 1) el.style.display = 'none';
  });
  document.body.style.background = '#000';
});
await page.waitForTimeout(400);

const card = page.locator('[class*="QqMusicCard"][class*="card"]').first();
const out = resolve(projectRoot, 'docs/assets/card-qq-music.png');
await card.screenshot({ path: out, omitBackground: true });

await ctx.close();
await browser.close();
console.log(`✓ ${out}`);
