#!/usr/bin/env node
// Capture the QqMusicCard component as a standalone PNG matching the
// dimensions of docs/assets/card-{spotify,netease,apple-music}.png.
//
// Run: node scripts/capture-qq-card.mjs
// Requires: dev server on :3000, Playwright already installed.

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Jay Chou — 晴天. The cover crops square at 800x800 in the QQ album-photo
// bucket, which lines up cleanly with the card's 1:1 cover frame.
const URL = 'http://localhost:3000/qq-0039MnYb0qxYhV';

/* Pin to an existing chromium 1208 binary so this works even when the
   playwright npm package was bumped to expect a newer build number. */
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/shadycheer/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[class*="QqMusicCard"][class*="card"]', { timeout: 15000 });
// Lyrics arriving after the card mounts shift the card's height a bit —
// wait for the lyrics block to settle (or for AI to give up).
await page.waitForFunction(() => !/查找歌词中/.test(document.body.innerText), {
  timeout: 20000,
}).catch(() => {});
await page.waitForTimeout(800);

const card = page.locator('[class*="QqMusicCard"][class*="card"]').first();
const out = resolve(projectRoot, 'docs/assets/card-qq-music.png');
await card.screenshot({ path: out, omitBackground: true });

await ctx.close();
await browser.close();
console.log(`✓ ${out}`);
