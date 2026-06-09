import { qqMusicLockup } from '@/assets/icons';
import {
  BASE_W,
  drawImageCover,
  getFontFamily,
  loadImage,
  mkCanvas,
  newProbeCtx,
  svgToDataUrl,
  truncateToWidth,
  wrapTextClamp,
  type RenderOpts,
} from './canvasHelpers';

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

export async function renderQqMusic(opts: RenderOpts): Promise<HTMLCanvasElement> {
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
