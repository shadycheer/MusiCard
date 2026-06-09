import type { Platform } from '@/lib/music/url';

/* Shared canvas helpers + the public RenderOpts contract. Each per-
   platform renderer in this folder consumes BASE_W as its design-
   space width and scales up to opts.targetWidth at draw time, so
   layout math stays platform-agnostic. */

export const BASE_W = 320;
export const SPOTIFY_LOCKUP_RATIO = 823.46 / 225.25;
export const APPLE_LOCKUP_RATIO = 83 / 20;

export type RenderOpts = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  platform: Platform;
  lyrics?: string[];
  targetWidth?: number;
};

/* Warm up the font cache for both font families used across the four
   card variants. Each renderer assumes fonts are loaded; the
   dispatcher calls this once before delegating. */
export async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const spotifyFamily = getFontFamily('--font-spotify');
  const appleFamily = getFontFamily('--font-apple');
  const specs = [
    `500 16px ${spotifyFamily}`,
    `700 16px ${spotifyFamily}`,
    `800 22px ${spotifyFamily}`,
    `500 16px ${appleFamily}`,
    `600 15px ${appleFamily}`,
    `700 20px ${appleFamily}`,
  ];
  await Promise.all(specs.map((s) => document.fonts.load(s).catch(() => {})));
  await document.fonts.ready;
}

export function getFontFamily(varName: string): string {
  if (typeof document === 'undefined') return 'sans-serif';
  return getComputedStyle(document.body).getPropertyValue(varName).trim() || 'sans-serif';
}

export function newProbeCtx(): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}

export function mkCanvas(
  baseW: number,
  baseH: number,
  scale: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(baseW * scale);
  canvas.height = Math.round(baseH * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx };
}

export function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${src.slice(0, 60)}…`));
    img.src = src;
  });
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/* Object-fit: cover behavior — center-crop source to fit destination
   without distorting aspect ratio. Used by every card to draw the
   cover art into a square (or rounded square) slot regardless of
   source dimensions. */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const srcRatio = img.naturalWidth / img.naturalHeight;
  const dstRatio = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (srcRatio > dstRatio) {
    sw = img.naturalHeight * dstRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else if (srcRatio < dstRatio) {
    sh = img.naturalWidth / dstRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/* Truncate `text` with an ellipsis so its rendered width ≤ maxWidth.
   Binary-search the prefix length so we don't measure once per
   character on long titles. */
export function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ellipsis;
}

/* Word-wrap `text` into up to `maxLines` lines, ellipsizing the last
   line if more text remains. Prefers breaking on whitespace when a
   sensible break point exists in the last 60% of the line width;
   otherwise falls back to a hard cut so CJK titles still wrap. */
export function wrapTextClamp(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let remaining = text;
  for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
    if (!remaining) break;
    const isLast = lineIdx === maxLines - 1;

    if (ctx.measureText(remaining).width <= maxWidth) {
      lines.push(remaining);
      break;
    }

    let lo = 0;
    let hi = remaining.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(remaining.slice(0, mid)).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;

    if (!isLast) {
      const slice = remaining.slice(0, cut);
      const lastSpace = slice.lastIndexOf(' ');
      if (lastSpace > maxWidth * 0.4) cut = lastSpace;
      lines.push(remaining.slice(0, cut).trimEnd());
      remaining = remaining.slice(cut).trimStart();
    } else {
      const ellipsis = '…';
      while (cut > 0 && ctx.measureText(remaining.slice(0, cut) + ellipsis).width > maxWidth) {
        cut--;
      }
      lines.push(remaining.slice(0, cut).trimEnd() + ellipsis);
      remaining = '';
    }
  }
  return lines;
}
