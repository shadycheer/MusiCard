import { spotifyLockup, appleMusicLockup } from '../assets/icons';
import type { Platform } from './musicUrl';
import { extractCoverPalette, darken } from './colorExtraction';

const BASE_W = 320;
const SPOTIFY_LOCKUP_RATIO = 823.46 / 225.25;
const APPLE_LOCKUP_RATIO = 83 / 20;

export type RenderOpts = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  platform: Platform;
  lyrics?: string[];
  targetWidth?: number;
};

export async function renderCardCanvas(opts: RenderOpts): Promise<HTMLCanvasElement> {
  await ensureFontsLoaded();
  return opts.platform === 'spotify' ? renderSpotify(opts) : renderAppleMusic(opts);
}

// ── Spotify ───────────────────────────────────────────────────────────

const SP = {
  padding: 20,
  gap: 16,
  coverRadius: 6,
  titleSize: 22,
  titleLineHeight: 25.3,
  artistSize: 14,
  artistLineHeight: 18.2,
  infoGap: 4,
  lyricsPad: { y: 14, x: 16 },
  lyricsAccentW: 3,
  lyricSize: 13,
  lyricLineHeight: 18.85,
  lyricGap: 6,
  brandLockupHeight: 24,
  qrSize: 44,
  qrPad: 3,
  qrRadius: 4,
  footPadTop: 4,
  bg: '#000000',
  green: '#1ED760',
  white: '#FFFFFF',
  artistDim: '#B3B3B3',
  lyricsBg: '#181818',
};

async function renderSpotify(opts: RenderOpts): Promise<HTMLCanvasElement> {
  const targetWidth = opts.targetWidth ?? 1920;
  const scale = targetWidth / BASE_W;
  const lyrics = (opts.lyrics ?? []).filter((l) => l.trim().length > 0);
  const font = getFontFamily('--font-spotify');

  const probe = newProbeCtx();
  const coverW = BASE_W - SP.padding * 2;
  const infoW = coverW;
  probe.font = `800 ${SP.titleSize}px ${font}`;
  const titleLines = wrapTextClamp(probe, opts.title, infoW, 2);

  const lyricsInnerW = coverW - SP.lyricsPad.x * 2 - SP.lyricsAccentW;
  probe.font = `600 ${SP.lyricSize}px ${font}`;
  const wrappedLyrics = lyrics.map((l) => wrapTextClamp(probe, l, lyricsInnerW, 2));

  const infoH =
    titleLines.length * SP.titleLineHeight + SP.infoGap + SP.artistLineHeight;
  const lyricsContentH =
    wrappedLyrics.length === 0
      ? 0
      : wrappedLyrics.reduce((s, lines) => s + lines.length * SP.lyricLineHeight, 0) +
        (wrappedLyrics.length - 1) * SP.lyricGap;
  const lyricsH = lyricsContentH === 0 ? 0 : lyricsContentH + SP.lyricsPad.y * 2;
  const lyricsBlockH = lyricsH === 0 ? 0 : lyricsH + SP.gap;
  const footContentH = Math.max(SP.brandLockupHeight, SP.qrSize);
  const footH = footContentH + SP.footPadTop;

  const baseHeight =
    SP.padding + coverW + SP.gap + infoH + SP.gap + lyricsBlockH + footH + SP.padding;

  const { canvas, ctx } = mkCanvas(BASE_W, baseHeight, scale);

  // Flat rectangle bg — rounded corners look broken when the exported PNG
  // is opened in a mobile image viewer (transparent corners show through).
  ctx.fillStyle = SP.bg;
  ctx.fillRect(0, 0, BASE_W, baseHeight);

  const [coverImg, qrImg] = await Promise.all([
    loadImage(opts.coverUrl, true),
    loadImage(svgToDataUrl(opts.qrSvg), false),
  ]);

  const coverX = SP.padding;
  const coverY = SP.padding;
  ctx.save();
  roundedRectPath(ctx, coverX, coverY, coverW, coverW, SP.coverRadius);
  ctx.fillStyle = '#181818';
  ctx.fill();
  ctx.clip();
  drawImageCover(ctx, coverImg, coverX, coverY, coverW, coverW);
  ctx.restore();

  let cursorY = coverY + coverW + SP.gap;
  ctx.fillStyle = SP.white;
  ctx.font = `800 ${SP.titleSize}px ${font}`;
  ctx.textBaseline = 'alphabetic';
  for (const line of titleLines) {
    cursorY += SP.titleLineHeight;
    ctx.fillText(line, SP.padding, cursorY - (SP.titleLineHeight - SP.titleSize));
  }
  cursorY += SP.infoGap;

  ctx.fillStyle = SP.artistDim;
  ctx.font = `500 ${SP.artistSize}px ${font}`;
  const artistText = truncateToWidth(ctx, opts.artist, infoW);
  cursorY += SP.artistLineHeight;
  ctx.fillText(artistText, SP.padding, cursorY - (SP.artistLineHeight - SP.artistSize));

  cursorY += SP.gap;

  if (wrappedLyrics.length > 0) {
    const lyricsX = SP.padding;
    const lyricsY = cursorY;
    const lyricsBlockW = coverW;

    ctx.fillStyle = SP.lyricsBg;
    ctx.fillRect(lyricsX, lyricsY, lyricsBlockW, lyricsH);
    ctx.fillStyle = SP.green;
    ctx.fillRect(lyricsX, lyricsY, SP.lyricsAccentW, lyricsH);

    ctx.fillStyle = SP.white;
    ctx.font = `600 ${SP.lyricSize}px ${font}`;
    const textX = lyricsX + SP.lyricsAccentW + SP.lyricsPad.x;
    let lyricCursor = lyricsY + SP.lyricsPad.y;
    for (let i = 0; i < wrappedLyrics.length; i++) {
      for (const line of wrappedLyrics[i]) {
        lyricCursor += SP.lyricLineHeight;
        ctx.fillText(line, textX, lyricCursor - (SP.lyricLineHeight - SP.lyricSize) / 2);
      }
      if (i < wrappedLyrics.length - 1) lyricCursor += SP.lyricGap;
    }

    cursorY = lyricsY + lyricsH + SP.gap;
  }

  const footY = cursorY + SP.footPadTop;
  const footCenterY = footY + footContentH / 2;

  const lockupImg = await loadImage(svgToDataUrl(spotifyLockup), false);
  const lockupH = SP.brandLockupHeight;
  const lockupW = lockupH * SPOTIFY_LOCKUP_RATIO;
  ctx.drawImage(lockupImg, SP.padding, footCenterY - lockupH / 2, lockupW, lockupH);

  const qrX = BASE_W - SP.padding - SP.qrSize;
  const qrY = footCenterY - SP.qrSize / 2;
  roundedRectPath(ctx, qrX, qrY, SP.qrSize, SP.qrSize, SP.qrRadius);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  const qrInner = SP.qrSize - SP.qrPad * 2;
  ctx.drawImage(qrImg, qrX + SP.qrPad, qrY + SP.qrPad, qrInner, qrInner);

  return canvas;
}

// ── Apple Music ───────────────────────────────────────────────────────

const AM = {
  paddingX: 20,
  paddingY: 24,
  gap: 18,
  coverSize: 200,
  coverRadius: 8,
  titleSize: 20,
  titleLineHeight: 24,
  artistSize: 14,
  artistLineHeight: 18.2,
  infoGap: 4,
  lyricsPadY: 4,
  lyricSize: 15,
  lyricLineHeight: 21,
  lyricGap: 10,
  brandLockupHeight: 22,
  qrSize: 44,
  qrPad: 3,
  qrRadius: 8,
  white: '#FFFFFF',
  artistDim: 'rgba(255, 255, 255, 0.72)',
  lyricEdgeOpacity: 0.42,
  lyricShadowColor: 'rgba(0, 0, 0, 0.18)',
};

async function renderAppleMusic(opts: RenderOpts): Promise<HTMLCanvasElement> {
  const targetWidth = opts.targetWidth ?? 1920;
  const scale = targetWidth / BASE_W;
  const lyrics = (opts.lyrics ?? []).filter((l) => l.trim().length > 0);
  const font = getFontFamily('--font-apple');

  const coverImg = await loadImage(opts.coverUrl, true);
  const palette = await extractCoverPalette(coverImg).catch(() => ({
    primary: '#4A4138',
    secondary: '#2A2520',
  }));

  const probe = newProbeCtx();
  const contentW = BASE_W - AM.paddingX * 2;
  probe.font = `700 ${AM.titleSize}px ${font}`;
  const titleLines = wrapTextClamp(probe, opts.title, contentW, 2);

  probe.font = `600 ${AM.lyricSize}px ${font}`;
  const wrappedLyrics = lyrics.map((l) => wrapTextClamp(probe, l, contentW, 2));

  const infoH =
    titleLines.length * AM.titleLineHeight + AM.infoGap + AM.artistLineHeight;
  const lyricsContentH =
    wrappedLyrics.length === 0
      ? 0
      : wrappedLyrics.reduce((s, lines) => s + lines.length * AM.lyricLineHeight, 0) +
        (wrappedLyrics.length - 1) * AM.lyricGap;
  const lyricsH = lyricsContentH === 0 ? 0 : lyricsContentH + AM.lyricsPadY * 2;
  const lyricsBlockH = lyricsH === 0 ? 0 : lyricsH + AM.gap;

  const footH = Math.max(AM.brandLockupHeight, AM.qrSize);
  const baseHeight =
    AM.paddingY + AM.coverSize + AM.gap + infoH + AM.gap + lyricsBlockH + footH + AM.paddingY;

  const { canvas, ctx } = mkCanvas(BASE_W, baseHeight, scale);

  const grad = ctx.createRadialGradient(
    BASE_W * 0.3,
    baseHeight * 0.1,
    20,
    BASE_W * 0.3,
    baseHeight * 0.1,
    Math.max(BASE_W, baseHeight),
  );
  grad.addColorStop(0, palette.primary);
  grad.addColorStop(0.7, darken(palette.secondary, 0.25));
  grad.addColorStop(1, '#1A1614');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BASE_W, baseHeight);

  const hl = ctx.createRadialGradient(
    BASE_W * 0.2,
    baseHeight * 0.2,
    0,
    BASE_W * 0.2,
    baseHeight * 0.2,
    BASE_W * 0.5,
  );
  hl.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
  hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, BASE_W, baseHeight);

  const sh = ctx.createRadialGradient(
    BASE_W * 0.8,
    baseHeight * 0.8,
    0,
    BASE_W * 0.8,
    baseHeight * 0.8,
    BASE_W * 0.5,
  );
  sh.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
  sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, BASE_W, baseHeight);

  const qrImg = await loadImage(svgToDataUrl(opts.qrSvg), false);
  const lockupImg = await loadImage(svgToDataUrl(appleMusicLockup), false);

  const coverX = (BASE_W - AM.coverSize) / 2;
  const coverY = AM.paddingY;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  roundedRectPath(ctx, coverX, coverY, AM.coverSize, AM.coverSize, AM.coverRadius);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, coverX, coverY, AM.coverSize, AM.coverSize, AM.coverRadius);
  ctx.clip();
  drawImageCover(ctx, coverImg, coverX, coverY, AM.coverSize, AM.coverSize);
  ctx.restore();

  let cursorY = coverY + AM.coverSize + AM.gap;
  ctx.fillStyle = AM.white;
  ctx.font = `700 ${AM.titleSize}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const line of titleLines) {
    cursorY += AM.titleLineHeight;
    ctx.fillText(line, BASE_W / 2, cursorY - (AM.titleLineHeight - AM.titleSize));
  }
  cursorY += AM.infoGap;

  ctx.fillStyle = AM.artistDim;
  ctx.font = `500 ${AM.artistSize}px ${font}`;
  cursorY += AM.artistLineHeight;
  const artistText = truncateToWidth(ctx, opts.artist, contentW);
  ctx.fillText(artistText, BASE_W / 2, cursorY - (AM.artistLineHeight - AM.artistSize));
  ctx.textAlign = 'left';

  cursorY += AM.gap;

  if (wrappedLyrics.length > 0) {
    const lyricsY = cursorY;
    ctx.font = `600 ${AM.lyricSize}px ${font}`;
    ctx.textAlign = 'center';

    let lyricCursor = lyricsY + AM.lyricsPadY;
    const total = wrappedLyrics.length;
    for (let i = 0; i < total; i++) {
      const isEdge = total >= 3 && (i === 0 || i === total - 1);
      ctx.save();
      if (isEdge) ctx.globalAlpha = AM.lyricEdgeOpacity;
      ctx.shadowColor = AM.lyricShadowColor;
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = AM.white;
      for (const line of wrappedLyrics[i]) {
        lyricCursor += AM.lyricLineHeight;
        ctx.fillText(line, BASE_W / 2, lyricCursor - (AM.lyricLineHeight - AM.lyricSize) / 2);
      }
      ctx.restore();
      if (i < total - 1) lyricCursor += AM.lyricGap;
    }
    ctx.textAlign = 'left';
    cursorY = lyricsY + lyricsH + AM.gap;
  }

  const footCenterY = cursorY + footH / 2;

  const lockupH = AM.brandLockupHeight;
  const lockupW = lockupH * APPLE_LOCKUP_RATIO;
  ctx.drawImage(lockupImg, AM.paddingX, footCenterY - lockupH / 2, lockupW, lockupH);

  const qrX = BASE_W - AM.paddingX - AM.qrSize;
  const qrY = footCenterY - AM.qrSize / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  roundedRectPath(ctx, qrX, qrY, AM.qrSize, AM.qrSize, AM.qrRadius);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();
  const qrInner = AM.qrSize - AM.qrPad * 2;
  ctx.drawImage(qrImg, qrX + AM.qrPad, qrY + AM.qrPad, qrInner, qrInner);

  return canvas;
}

// ── Helpers ───────────────────────────────────────────────────────────

async function ensureFontsLoaded(): Promise<void> {
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

function getFontFamily(varName: string): string {
  if (typeof document === 'undefined') return 'sans-serif';
  return getComputedStyle(document.body).getPropertyValue(varName).trim() || 'sans-serif';
}

function newProbeCtx(): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}

function mkCanvas(
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

function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${src.slice(0, 60)}…`));
    img.src = src;
  });
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function roundedRectPath(
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

function drawImageCover(
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

function truncateToWidth(
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

function wrapTextClamp(
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
