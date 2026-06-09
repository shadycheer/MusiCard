#!/usr/bin/env node
// Capture the NeteaseCard component as a standalone PNG matching the
// dimensions and lyric-block presence of the other card-*.png files.
// See capture-qq-card.mjs for the rationale on isolating + scaling.
//
// Run: node scripts/capture-netease-card.mjs
// Requires: dev server on :3000, Playwright already installed.

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Ember by haju:harmonics — soft cover, distinct from QQ's 晴天 in the
// README cards table so the row showcases two different songs.
const URL = 'http://localhost:3000/netease-2036581671';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/shadycheer/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1400 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[class*="NeteaseCard"][class*="card"]', { timeout: 15000 });
await page.waitForFunction(
  () =>
    !/查找歌词中/.test(document.body.innerText) &&
    document.querySelectorAll('[class*="LyricsPicker"][class*="line"]:not([class*="lineSelected"])').length > 4,
  { timeout: 25000 },
).catch(() => {});

const lineLocators = await page.locator('[class*="LyricsPicker"][class*="line"]').all();
for (let i = 0; i < Math.min(4, lineLocators.length); i++) {
  await lineLocators[i].click();
  await page.waitForTimeout(80);
}

await page.waitForFunction(
  () => document.querySelector('[class*="NeteaseCard"][class*="lyrics"]') !== null,
  { timeout: 5000 },
).catch(() => {});

await page.evaluate(() => {
  const card = document.querySelector('[class*="NeteaseCard"][class*="card"]');
  if (!card) return;
  card.style.setProperty('--s', '2.25');
  card.style.position = 'fixed';
  card.style.top = '0';
  card.style.left = '0';
  card.style.margin = '0';
  card.style.zIndex = '99999';
  document.body.appendChild(card);
  document.querySelectorAll('body > *').forEach((el) => {
    if (el !== card && el.nodeType === 1) el.style.display = 'none';
  });
  document.body.style.background = '#000';
});
await page.waitForTimeout(400);

const card = page.locator('[class*="NeteaseCard"][class*="card"]').first();
const out = resolve(projectRoot, 'docs/assets/card-netease.png');
await card.screenshot({ path: out, omitBackground: true });

await ctx.close();
await browser.close();
console.log(`✓ ${out}`);
