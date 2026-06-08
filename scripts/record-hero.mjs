#!/usr/bin/env node
// Records the actual web animations of the MusiCard hero flow:
//   1. idle home (input centered)
//   2. paste link → card materializes
//   3. click "开启 SONG-DNA"
//   4. helix particle connect animation
//   5. brief glimpse of streamed story
// Output: docs/assets/hero.gif (via webm → ffmpeg).
//
// Why Playwright: chrome-devtools MCP take_screenshot is ~300ms per
// shot, which can't capture smooth web animations. Playwright records
// at native browser framerate to webm, then ffmpeg downsamples.
//
// Usage: node scripts/record-hero.mjs
// Requires: `npm install --no-save playwright` + `npx playwright install chromium`
//           + a running dev server on http://localhost:3000.

import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const tmpDir = resolve(projectRoot, '.playwright-video');
mkdirSync(tmpDir, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };
// 晴天 by 周杰伦 (QQ Music) — cached song-detail + cached SONG-DNA so
// the gif lands in ~7s. Showcases the QQ Music platform which is the
// newest addition + the brand-green card aesthetic.
const URL_TO_PASTE = 'https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV';

const browser = await chromium.launch({
  headless: true,
  /* Pin to an existing chromium 1208 binary so this works even when the
     playwright npm package bump expects a newer build number. */
  executablePath: '/Users/shadycheer/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  recordVideo: { dir: tmpDir, size: VIEWPORT },
});
const page = await context.newPage();

console.log('▶ Navigating to localhost:3000');
// Hide the Next.js dev tools badge before recording — it's local-only
// chrome that has no business appearing in the README hero.
await page.addInitScript(() => {
  const css = `nextjs-portal { display: none !important; }`;
  const observer = new MutationObserver(() => {
    if (!document.getElementById('__hide-next-devtools')) {
      const style = document.createElement('style');
      style.id = '__hide-next-devtools';
      style.textContent = css;
      document.documentElement.appendChild(style);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
// Wait for the dark body background to land + idle animation to settle.
await page.waitForFunction(
  () => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        getComputedStyle(document.body).backgroundColor !== 'rgb(255, 255, 255)',
  { timeout: 5000 },
);
await page.waitForTimeout(700);

console.log('▶ Pasting URL');
await page.locator('input[type="text"], input[type="url"], input:not([type])').first().fill(URL_TO_PASTE);
// Let the card materialize animation run.
await page.waitForSelector('text=下载图片', { timeout: 15000 });

// Wait for lyrics to actually populate the picker list (not just the
// loading spinner). "查找歌词中" disappears + at least one clickable
// lyric line appears.
console.log('▶ Waiting for lyrics list to appear');
await page.waitForFunction(
  () => {
    const txt = document.body.innerText || '';
    if (txt.includes('查找歌词中')) return false;
    if (txt.includes('AI 在帮你找歌词')) return false;
    return /\bIs this the real life\?|\bSomewhere\b|\b故事\b|\bPlanetes\b|\b流れ\b|\b私\b|\bあなた\b|\b君\b|\b空\b|\b海\b|\b小黄花\b|\b花瓣\b|\b童年\b/.test(txt);
  },
  { timeout: 15000 },
).catch(() => {});
// Brief pause so the lyrics are visibly settled in the GIF.
await page.waitForTimeout(1600);

console.log('▶ Clicking 开启 SONG-DNA');
await page.locator('button:has-text("开启 SONG-DNA")').click();
// Connect animation (~0.7s) + cached payload + helix completing/
// dissolving sequence (1.9s) + badge view-transition (~0.5s).
await page.waitForTimeout(4800);

// Scroll the right column to show the sticky-card behavior. The page
// is the scroll container, so we just scrollBy the window; the left
// .previewPane stays glued at top:24px while the long SONG-DNA essay
// passes under it.
console.log('▶ Scrolling to demo sticky preview');
await page.evaluate(async () => {
  const total = 700;
  const stepCount = 28;
  const stepDelay = 25;
  for (let i = 0; i < stepCount; i++) {
    window.scrollBy(0, total / stepCount);
    await new Promise((r) => setTimeout(r, stepDelay));
  }
});
await page.waitForTimeout(800);

console.log('▶ Stopping recording');
await context.close();
await browser.close();

// Playwright names the file something like <hash>.webm; grab it.
const files = readdirSync(tmpDir).filter((f) => f.endsWith('.webm'));
if (files.length === 0) throw new Error('No video produced');
const webmIn = resolve(tmpDir, files[0]);
console.log(`▶ Got recording: ${webmIn}`);

// Convert webm → GIF. Two-pass palettegen for clean colors at modest size.
const gifOut = resolve(projectRoot, 'docs/assets/hero.gif');
// Trim the first 0.6s (any pre-paint white flash) and drop to 12fps /
// 760px / 64 colors to land near 1MB.
const ffArgs = [
  '-y',
  '-ss', '0.6',
  '-i', webmIn,
  '-vf', 'fps=12,scale=760:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
  '-loop', '0',
  gifOut,
];
console.log('▶ ffmpeg convert');
const r = spawnSync('ffmpeg', ffArgs, { stdio: 'inherit' });
if (r.status !== 0) throw new Error('ffmpeg failed');

// Leave the webm in .playwright-video/ in case we want to re-encode.
console.log(`✓ ${gifOut}`);
