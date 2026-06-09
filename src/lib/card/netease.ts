import {
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

export async function renderNetease(opts: RenderOpts): Promise<HTMLCanvasElement> {
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
