import { appleMusicLockup } from '@/assets/icons';
import {
  APPLE_LOCKUP_RATIO,
  BASE_W,
  drawImageCover,
  getFontFamily,
  loadImage,
  mkCanvas,
  newProbeCtx,
  roundedRectPath,
  svgToDataUrl,
  truncateToWidth,
  wrapTextClamp,
  type RenderOpts,
} from './canvasHelpers';
import { darken, extractCoverPalette } from './colorExtraction';

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
  brandLockupHeight: 18,
  brandLockupOpacity: 0.92,
  qrSize: 44,
  qrPad: 3,
  qrRadius: 8,
  white: '#FFFFFF',
  artistDim: 'rgba(255, 255, 255, 0.72)',
  lyricEdgeOpacity: 0.42,
  lyricShadowColor: 'rgba(0, 0, 0, 0.18)',
};

export async function renderAppleMusic(opts: RenderOpts): Promise<HTMLCanvasElement> {
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
  ctx.save();
  ctx.globalAlpha = AM.brandLockupOpacity;
  ctx.drawImage(lockupImg, AM.paddingX, footCenterY - lockupH / 2, lockupW, lockupH);
  ctx.restore();

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
