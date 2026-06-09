#!/usr/bin/env node
// Capture all 4 platform cards as strict equal-height PNGs.
// Forces the card to a min-height + pushes the foot row to the bottom
// (margin-top:auto) so every variant lands at exactly 720x1440 in the
// scaled PNG — no more "long short" mismatch in the README.
//
// Run: node scripts/capture-all-cards.mjs
// Requires: dev server on :3000, Playwright installed.

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const assets = resolve(projectRoot, 'docs/assets');

const CARDS = [
  {
    file: 'card-spotify.png',
    slug: 'spotify-1GUnIBiLhgEwSQJzGNuUrk', // Planetes / EGOIST
    selector: 'SpotifyCard',
  },
  {
    file: 'card-apple-music.png',
    slug: 'apple-us-1572515876', // Old School Vibe / Don Go$$
    selector: 'AppleMusicCard',
  },
  {
    file: 'card-netease.png',
    slug: 'netease-2036581671', // Ember / haju:harmonics
    selector: 'NeteaseCard',
  },
  {
    file: 'card-qq-music.png',
    slug: 'qq-0039MnYb0qxYhV', // 晴天 / 周杰伦
    selector: 'QqMusicCard',
  },
];

// 640 base px * 2.25 (--s) = 1440px. Generous enough that Spotify's
// lyrics block + footer fits with no clipping, modest enough that
// QQ/Apple don't leave huge empty bottoms.
const CARD_MIN_BASE_HEIGHT = 640;
const SCALE = 2.25;

const browser = await chromium.launch({
  headless: true,
  executablePath:
    '/Users/shadycheer/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});

for (const card of CARDS) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1700 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  console.log(`▶ ${card.file} (${card.slug})`);
  await page.goto(`http://localhost:3000/${card.slug}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`[class*="${card.selector}"][class*="card"]`, { timeout: 15000 });
  await page.waitForFunction(
    () =>
      !/查找歌词中/.test(document.body.innerText) &&
      document.querySelectorAll('[class*="LyricsPicker"][class*="line"]').length > 4,
    { timeout: 25000 },
  ).catch(() => {});

  // Pick the first 4 actual lyric rows so every card renders its
  // lyrics block (otherwise Spotify-without-lyrics and QQ-without-lyrics
  // would land empty).
  const lines = await page.locator('[class*="LyricsPicker"][class*="line"]').all();
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    await lines[i].click();
    await page.waitForTimeout(80);
  }

  // Wait for lyrics block in the card itself.
  await page.waitForFunction(
    (cls) => document.querySelector(`[class*="${cls}"][class*="lyrics"]`) !== null,
    card.selector,
    { timeout: 5000 },
  ).catch(() => {});

  // Isolate the card and force equal height + bottom-pinned footer.
  await page.evaluate(
    ({ selector, minHeight, scale }) => {
      const card = document.querySelector(`[class*="${selector}"][class*="card"]`);
      if (!card) return;
      card.style.setProperty('--s', String(scale));
      card.style.minHeight = `${minHeight * scale}px`;
      card.style.position = 'fixed';
      card.style.top = '0';
      card.style.left = '0';
      card.style.margin = '0';
      card.style.zIndex = '99999';
      // Push the foot row to the bottom of the (now taller) card so
      // each variant ends with brand + QR at the same vertical position.
      const foot = card.querySelector('[class*="foot"]');
      if (foot) foot.style.marginTop = 'auto';
      document.body.appendChild(card);
      document.querySelectorAll('body > *').forEach((el) => {
        if (el !== card && el.nodeType === 1) el.style.display = 'none';
      });
      document.body.style.background = '#000';
    },
    { selector: card.selector, minHeight: CARD_MIN_BASE_HEIGHT, scale: SCALE },
  );
  await page.waitForTimeout(400);

  const target = page.locator(`[class*="${card.selector}"][class*="card"]`).first();
  const out = resolve(assets, card.file);
  await target.screenshot({ path: out, omitBackground: true });
  console.log(`  ✓ ${out}`);

  await ctx.close();
}

await browser.close();
console.log('\n✓ all 4 cards captured at strict equal height');
