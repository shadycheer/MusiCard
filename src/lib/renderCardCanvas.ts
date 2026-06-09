import { spotifyLockup, appleMusicLockup, qqMusicLockup } from '../assets/icons';
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
  if (opts.platform === 'spotify') return renderSpotify(opts);
  if (opts.platform === 'netease') return renderNetease(opts);
  if (opts.platform === 'qqMusic') return renderQqMusic(opts);
  return renderAppleMusic(opts);
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

// ── NetEase Cloud Music ───────────────────────────────────────────────

const NT = {
  paddingX: 16,
  paddingTop: 16,
  paddingBottom: 20,
  gap: 20,
  topHairlineH: 2,
  vinylStageRatio: 0.84,
  vinylInsetRatio: 0.07, // disc inset from halo (matches CSS `inset: 7%`)
  labelRatio: 0.62,      // label diameter / disc diameter
  titleSize: 22,
  titleLineHeight: 26.4,
  artistSize: 13,
  artistLineHeight: 18.2,
  infoGap: 6,
  lyricsTopHairlineLen: 24,
  lyricsTopPad: 16,
  lyricSize: 14,
  lyricLineHeight: 23.8,
  lyricGap: 4,
  brandLogoHeight: 18,
  brandLogoRatio: 5, // netease-logo-dark.svg viewBox 160×32 → 5
  qrSize: 44,
  qrPad: 3,
  qrRadius: 4,
  red: '#ec4141',
};

async function renderNetease(opts: RenderOpts): Promise<HTMLCanvasElement> {
  const targetWidth = opts.targetWidth ?? 1920;
  const scale = targetWidth / BASE_W;
  const lyrics = (opts.lyrics ?? []).filter((l) => l.trim().length > 0);
  // NetEase card reuses the Spotify font stack (matches NeteaseCard.module.css).
  const font = getFontFamily('--font-spotify');

  const coverImg = await loadImage(opts.coverUrl, true);
  const palette = await extractCoverPalette(coverImg).catch(() => ({
    primary: '#3a3a3a',
    secondary: '#1a1a1a',
  }));

  const probe = newProbeCtx();
  const contentW = BASE_W - NT.paddingX * 2;
  probe.font = `700 ${NT.titleSize}px ${font}`;
  const titleLines = wrapTextClamp(probe, opts.title, contentW, 2);
  probe.font = `400 ${NT.lyricSize}px ${font}`;
  const wrappedLyrics = lyrics.map((l) => wrapTextClamp(probe, l, contentW, 2));

  const vinylStageSize = BASE_W * NT.vinylStageRatio; // square
  const infoH =
    titleLines.length * NT.titleLineHeight + NT.infoGap + NT.artistLineHeight;
  const lyricsContentH =
    wrappedLyrics.length === 0
      ? 0
      : wrappedLyrics.reduce((s, lines) => s + lines.length * NT.lyricLineHeight, 0) +
        (wrappedLyrics.length - 1) * NT.lyricGap;
  const lyricsBlockH =
    lyricsContentH === 0 ? 0 : NT.lyricsTopPad + lyricsContentH + NT.gap;
  const footH = Math.max(NT.brandLogoHeight, NT.qrSize);

  const baseHeight =
    NT.paddingTop +
    vinylStageSize +
    NT.gap +
    infoH +
    NT.gap +
    lyricsBlockH +
    footH +
    NT.paddingBottom;

  const { canvas, ctx } = mkCanvas(BASE_W, baseHeight, scale);

  // ── Background gradient ───────────────────────────────────────────
  const grad = ctx.createLinearGradient(BASE_W * 0.5, 0, BASE_W * 0.5, baseHeight);
  // CSS uses 170deg → near-vertical with slight lean; an exact lineargrad
  // at 170° from horizontal is virtually vertical, so straight-vertical here
  // reads the same.
  grad.addColorStop(0, darken(palette.primary, 0.55));
  grad.addColorStop(0.55, darken(palette.secondary, 0.75));
  grad.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BASE_W, baseHeight);

  // ── Top red hairline (NetEase brand accent) ──────────────────────
  const redGrad = ctx.createLinearGradient(0, 0, BASE_W, 0);
  redGrad.addColorStop(0, 'rgba(236, 65, 65, 0)');
  redGrad.addColorStop(0.25, NT.red);
  redGrad.addColorStop(0.75, NT.red);
  redGrad.addColorStop(1, 'rgba(236, 65, 65, 0)');
  ctx.fillStyle = redGrad;
  ctx.fillRect(0, 0, BASE_W, NT.topHairlineH);

  // ── Vinyl stage ───────────────────────────────────────────────────
  const stageX = (BASE_W - vinylStageSize) / 2;
  const stageY = NT.paddingTop;
  const stageR = vinylStageSize / 2;
  const stageCx = stageX + stageR;
  const stageCy = stageY + stageR;

  // Halo — soft pale gray outer ring (the lifted-disc glow).
  ctx.beginPath();
  ctx.arc(stageCx, stageCy, stageR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fill();

  // Disc — inset 7% from halo (matches CSS).
  const discR = stageR * (1 - NT.vinylInsetRatio * 2);
  // Body: dark radial.
  const discGrad = ctx.createRadialGradient(stageCx, stageCy, 0, stageCx, stageCy, discR);
  discGrad.addColorStop(0, '#1c1c1c');
  discGrad.addColorStop(1, '#080808');
  ctx.beginPath();
  ctx.arc(stageCx, stageCy, discR, 0, Math.PI * 2);
  ctx.fillStyle = discGrad;
  ctx.fill();

  // Grooves — concentric thin strokes at varying opacity. The CSS uses a
  // repeating-radial-gradient with a 6px period; we mimic the rhythm by
  // alternating two opacity values at ~3px intervals.
  const labelR = discR * NT.labelRatio;
  ctx.save();
  ctx.beginPath();
  ctx.arc(stageCx, stageCy, discR, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineWidth = 0.5;
  for (let r = labelR + 1; r < discR; r += 3) {
    ctx.beginPath();
    ctx.arc(stageCx, stageCy, r, 0, Math.PI * 2);
    ctx.strokeStyle =
      Math.floor((r - labelR) / 3) % 2 === 0
        ? 'rgba(255, 255, 255, 0.07)'
        : 'rgba(255, 255, 255, 0.04)';
    ctx.stroke();
  }
  ctx.restore();

  // Specular shine — diagonal soft band across the upper-left of the disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(stageCx, stageCy, discR, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(stageCx, stageCy);
  ctx.rotate((115 * Math.PI) / 180);
  const shineGrad = ctx.createLinearGradient(-discR, 0, discR, 0);
  shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  shineGrad.addColorStop(0.42, 'rgba(255, 255, 255, 0.05)');
  shineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.14)');
  shineGrad.addColorStop(0.58, 'rgba(255, 255, 255, 0.05)');
  shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = shineGrad;
  ctx.fillRect(-discR, -discR, discR * 2, discR * 2);
  ctx.restore();

  // Outer rim hairline — the lit lip of pressed vinyl.
  ctx.beginPath();
  ctx.arc(stageCx, stageCy, discR - 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Label — cover image inside a white-bordered circle.
  // Two-layer halo: thin bright white + softer outer glow.
  ctx.beginPath();
  ctx.arc(stageCx, stageCy, labelR + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(stageCx, stageCy, labelR + 1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fill();
  // Cover, clipped to circle.
  ctx.save();
  ctx.beginPath();
  ctx.arc(stageCx, stageCy, labelR, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();
  ctx.clip();
  drawImageCover(
    ctx,
    coverImg,
    stageCx - labelR,
    stageCy - labelR,
    labelR * 2,
    labelR * 2,
  );
  ctx.restore();

  // ── Title + Artist ────────────────────────────────────────────────
  let cursorY = stageY + vinylStageSize + NT.gap;
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${NT.titleSize}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const line of titleLines) {
    cursorY += NT.titleLineHeight;
    ctx.fillText(line, BASE_W / 2, cursorY - (NT.titleLineHeight - NT.titleSize));
  }
  cursorY += NT.infoGap;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
  ctx.font = `400 ${NT.artistSize}px ${font}`;
  cursorY += NT.artistLineHeight;
  const artistText = truncateToWidth(ctx, opts.artist, contentW);
  ctx.fillText(artistText, BASE_W / 2, cursorY - (NT.artistLineHeight - NT.artistSize));
  ctx.textAlign = 'left';

  cursorY += NT.gap;

  // ── Lyrics — undecorated, centered, with a short hairline above ──
  if (wrappedLyrics.length > 0) {
    const hairlineY = cursorY;
    const hairlineX = (BASE_W - NT.lyricsTopHairlineLen) / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(hairlineX, hairlineY, NT.lyricsTopHairlineLen, 1);

    ctx.textAlign = 'center';
    ctx.font = `400 ${NT.lyricSize}px ${font}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    let lyricCursor = hairlineY + NT.lyricsTopPad;
    for (let i = 0; i < wrappedLyrics.length; i++) {
      for (const line of wrappedLyrics[i]) {
        lyricCursor += NT.lyricLineHeight;
        ctx.fillText(line, BASE_W / 2, lyricCursor - (NT.lyricLineHeight - NT.lyricSize) / 2);
      }
      if (i < wrappedLyrics.length - 1) lyricCursor += NT.lyricGap;
    }
    ctx.textAlign = 'left';
    cursorY = hairlineY + NT.lyricsTopPad + lyricsContentH + NT.gap;
  }

  // ── Foot: NetEase logo (left) + QR (right) ───────────────────────
  const [logoImg, qrImg] = await Promise.all([
    loadImage('/netease-logo-dark.svg', false),
    loadImage(svgToDataUrl(opts.qrSvg), false),
  ]);

  const footCenterY = cursorY + footH / 2;

  const logoH = NT.brandLogoHeight;
  const logoW = logoH * NT.brandLogoRatio;
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.drawImage(logoImg, NT.paddingX, footCenterY - logoH / 2, logoW, logoH);
  ctx.restore();

  const qrX = BASE_W - NT.paddingX - NT.qrSize;
  const qrY = footCenterY - NT.qrSize / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  roundedRectPath(ctx, qrX, qrY, NT.qrSize, NT.qrSize, NT.qrRadius);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();
  const qrInner = NT.qrSize - NT.qrPad * 2;
  ctx.drawImage(qrImg, qrX + NT.qrPad, qrY + NT.qrPad, qrInner, qrInner);

  return canvas;
}

// ── QQ Music ──────────────────────────────────────────────────────────

/* Tokens mirror QqMusicCard.module.css 1:1 so the exported PNG and the
   on-screen preview match pixel-for-pixel after scaling. */
const QQ = {
  padding: 22,
  gap: 18,
  // Sleeve takes 78% of card width; disc takes 74% and sits right:0.
  sleeveRatio: 0.78,
  sleevePad: 4,
  discRatio: 0.74,
  titleSize: 22,
  titleLineHeight: 26.4,
  artistSize: 13.5,
  artistLineHeight: 17.55,
  infoGap: 3,
  lyricSize: 13,
  lyricLineHeight: 21.45, // 13 * 1.65
  lyricGap: 4,
  brandLogoSize: 40,
  qrSize: 48,
  qrPad: 3,
  bg: '#C7DCA0',
  titleColor: '#1A2710',
  artistColor: 'rgba(26, 39, 16, 0.62)',
  lyricColor: 'rgba(26, 39, 16, 0.85)',
  sleeveBg: '#FFFFFF',
  discInner: '#5F635D',
  discOuter: '#3D403B',
  discRimDark: 'rgba(0, 0, 0, 0.28)',
  discGroove: 'rgba(255, 255, 255, 0.05)',
  hubBg: '#C7DCA0',
  hubInnerRing: '#FFFFFF',
};

async function renderQqMusic(opts: RenderOpts): Promise<HTMLCanvasElement> {
  const targetWidth = opts.targetWidth ?? 1920;
  const scale = targetWidth / BASE_W;
  const lyrics = (opts.lyrics ?? []).filter((l) => l.trim().length > 0);
  const font = getFontFamily('--font-apple') || getFontFamily('--font-spotify') || 'sans-serif';

  const probe = newProbeCtx();
  const contentW = BASE_W - QQ.padding * 2;
  probe.font = `700 ${QQ.titleSize}px ${font}`;
  const titleLines = wrapTextClamp(probe, opts.title, contentW, 2);

  probe.font = `500 ${QQ.lyricSize}px ${font}`;
  const wrappedLyrics = lyrics.map((l) => wrapTextClamp(probe, l, contentW, 2));

  // Stage height = sleeve height (sleeve sets the stage's vertical extent).
  const sleeveSize = contentW * QQ.sleeveRatio;
  const stageH = sleeveSize;
  const infoH =
    titleLines.length * QQ.titleLineHeight + QQ.infoGap + QQ.artistLineHeight;
  const lyricsContentH =
    wrappedLyrics.length === 0
      ? 0
      : wrappedLyrics.reduce((s, lines) => s + lines.length * QQ.lyricLineHeight, 0) +
        (wrappedLyrics.length - 1) * QQ.lyricGap;
  const lyricsBlockH = lyricsContentH === 0 ? 0 : lyricsContentH + QQ.gap;
  const footH = Math.max(QQ.brandLogoSize, QQ.qrSize);

  const baseHeight =
    QQ.padding + stageH + QQ.gap + infoH + QQ.gap + lyricsBlockH + footH + QQ.padding;

  const { canvas, ctx } = mkCanvas(BASE_W, baseHeight, scale);

  // ── Background ───────────────────────────────────────────────────
  ctx.fillStyle = QQ.bg;
  ctx.fillRect(0, 0, BASE_W, baseHeight);

  const [coverImg, qrImg, logoImg] = await Promise.all([
    loadImage(opts.coverUrl, true),
    loadImage(svgToDataUrl(opts.qrSvg), false),
    loadImage(svgToDataUrl(qqMusicLockup), false),
  ]);

  // ── Stage: sleeve (left) + disc (right, behind) ──────────────────
  const stageX = QQ.padding;
  const stageY = QQ.padding;
  const stageW = contentW;
  const stageCy = stageY + stageH / 2;

  // Disc — drawn first (lower z), peeking out from the right edge of stage.
  const discSize = stageW * QQ.discRatio;
  const discR = discSize / 2;
  const discCx = stageX + stageW - discR;
  const discCy = stageCy;

  // Soft drop shadow on the disc.
  ctx.save();
  ctx.shadowColor = 'rgba(28, 40, 14, 0.22)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(discCx, discCy, discR, 0, Math.PI * 2);
  ctx.fillStyle = QQ.discOuter;
  ctx.fill();
  ctx.restore();

  // Disc body — diagonal gradient + concentric grooves.
  const discBody = ctx.createLinearGradient(
    discCx - discR,
    discCy - discR,
    discCx + discR,
    discCy + discR,
  );
  discBody.addColorStop(0, QQ.discInner);
  discBody.addColorStop(1, QQ.discOuter);
  ctx.save();
  ctx.beginPath();
  ctx.arc(discCx, discCy, discR, 0, Math.PI * 2);
  ctx.fillStyle = discBody;
  ctx.fill();
  ctx.clip();

  // Concentric groove rings.
  ctx.lineWidth = 0.5;
  for (let r = 4; r < discR; r += 2) {
    ctx.beginPath();
    ctx.arc(discCx, discCy, r, 0, Math.PI * 2);
    ctx.strokeStyle = QQ.discGroove;
    ctx.stroke();
  }

  // Specular highlight — soft ellipse top-left.
  const hlGrad = ctx.createRadialGradient(
    discCx - discR * 0.2,
    discCy - discR * 0.4,
    0,
    discCx,
    discCy,
    discR * 0.8,
  );
  hlGrad.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  hlGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hlGrad;
  ctx.fillRect(discCx - discR, discCy - discR, discR * 2, discR * 2);
  ctx.restore();

  // Disc dark rim hairline.
  ctx.beginPath();
  ctx.arc(discCx, discCy, discR - 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = QQ.discRimDark;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Hub — small green dot in the disc center with a white inner ring.
  const hubR = discR * 0.16;
  ctx.beginPath();
  ctx.arc(discCx, discCy, hubR, 0, Math.PI * 2);
  ctx.fillStyle = QQ.hubBg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = QQ.hubInnerRing;
  ctx.stroke();
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.arc(discCx, discCy, hubR + 1.5, 0, Math.PI * 2);
  ctx.stroke();

  // Sleeve — white square + cover inside. Drawn last so it sits over
  // the disc's left half, exposing only the rightmost ~18% of the stage.
  const sleeveX = stageX;
  const sleeveY = stageY;
  ctx.save();
  ctx.shadowColor = 'rgba(28, 40, 14, 0.22)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = QQ.sleeveBg;
  ctx.fillRect(sleeveX, sleeveY, sleeveSize, sleeveSize);
  ctx.restore();

  // Cover image filling the sleeve minus the inner 6px white border.
  const coverInset = QQ.sleevePad;
  const coverInner = sleeveSize - coverInset * 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sleeveX + coverInset, sleeveY + coverInset, coverInner, coverInner);
  ctx.clip();
  drawImageCover(
    ctx,
    coverImg,
    sleeveX + coverInset,
    sleeveY + coverInset,
    coverInner,
    coverInner,
  );
  ctx.restore();

  // ── Title + Artist ───────────────────────────────────────────────
  let cursorY = stageY + stageH + QQ.gap;
  ctx.fillStyle = QQ.titleColor;
  ctx.font = `700 ${QQ.titleSize}px ${font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const line of titleLines) {
    cursorY += QQ.titleLineHeight;
    ctx.fillText(line, QQ.padding, cursorY - (QQ.titleLineHeight - QQ.titleSize));
  }
  cursorY += QQ.infoGap;

  ctx.fillStyle = QQ.artistColor;
  ctx.font = `500 ${QQ.artistSize}px ${font}`;
  cursorY += QQ.artistLineHeight;
  const artistText = truncateToWidth(ctx, opts.artist, contentW);
  ctx.fillText(artistText, QQ.padding, cursorY - (QQ.artistLineHeight - QQ.artistSize));

  cursorY += QQ.gap;

  // ── Lyrics — plain undecorated text block ────────────────────────
  if (wrappedLyrics.length > 0) {
    ctx.font = `500 ${QQ.lyricSize}px ${font}`;
    ctx.fillStyle = QQ.lyricColor;
    let lyricCursor = cursorY;
    for (let i = 0; i < wrappedLyrics.length; i++) {
      for (const line of wrappedLyrics[i]) {
        lyricCursor += QQ.lyricLineHeight;
        ctx.fillText(
          line,
          QQ.padding,
          lyricCursor - (QQ.lyricLineHeight - QQ.lyricSize) / 2,
        );
      }
      if (i < wrappedLyrics.length - 1) lyricCursor += QQ.lyricGap;
    }
    cursorY = cursorY + lyricsContentH + QQ.gap;
  }

  // ── Foot: glyph (left) + QR (right) ──────────────────────────────
  const footCenterY = cursorY + footH / 2;

  ctx.drawImage(
    logoImg,
    QQ.padding,
    footCenterY - QQ.brandLogoSize / 2,
    QQ.brandLogoSize,
    QQ.brandLogoSize,
  );

  const qrX = BASE_W - QQ.padding - QQ.qrSize;
  const qrY = footCenterY - QQ.qrSize / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.10)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(qrX, qrY, QQ.qrSize, QQ.qrSize);
  ctx.restore();
  const qrInner = QQ.qrSize - QQ.qrPad * 2;
  ctx.drawImage(qrImg, qrX + QQ.qrPad, qrY + QQ.qrPad, qrInner, qrInner);

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
