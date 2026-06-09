import { spotifyLockup } from '@/assets/icons';
import {
  BASE_W,
  SPOTIFY_LOCKUP_RATIO,
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

export async function renderSpotify(opts: RenderOpts): Promise<HTMLCanvasElement> {
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
