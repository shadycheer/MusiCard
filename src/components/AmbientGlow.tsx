'use client';

import { useEffect, useState } from 'react';
import { extractCoverPalette } from '@/lib/card/colorExtraction';
import { proxyCoverUrl } from '@/lib/card/coverProxy';
import styles from './AmbientGlow.module.css';

/* Preset blob anchors — lower half of the viewport so the glow sits
   behind the shelf, not behind the input/header. */
const SPOTS = [
  { x: 18, y: 62 },
  { x: 45, y: 76 },
  { x: 72, y: 58 },
  { x: 92, y: 70 },
];

/* Dark album art yields near-black "primary" colors that vanish on
   the near-black wall. Re-light every extracted color into a luminous
   band (saturation floor + lightness clamp) so the glow stays visible
   while keeping the cover's hue — same trick streaming apps use for
   their ambient artwork lighting. */
function luminousRgb(hex: string): string | null {
  const m = hex.replace('#', '');
  if (m.length !== 6) return null;
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return null;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s2 = Math.max(s, 0.5);
  const l2 = Math.min(Math.max(l, 0.4), 0.58);

  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l2 - c / 2;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];

  const to255 = (v: number) => Math.round((v + mm) * 255);
  return `${to255(rr)}, ${to255(gg)}, ${to255(bb)}`;
}

/* Ambient color wash extracted from the user's recent covers — the
   page's color identity follows what they've been listening to,
   the same idea as the song page's coverBackdrop but aggregated.
   Renders nothing until at least one palette resolves, so first
   paint is the plain dark wall (no flash of wrong color). */
export default function AmbientGlow({ coverUrls }: { coverUrls: string[] }) {
  const [colors, setColors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const urls = coverUrls.slice(0, SPOTS.length);
    if (urls.length === 0) {
      setColors([]);
      return;
    }
    Promise.all(
      urls.map((u) =>
        extractCoverPalette(proxyCoverUrl(u))
          .then((p) => luminousRgb(p.primary))
          .catch(() => null),
      ),
    ).then((resolved) => {
      if (cancelled) return;
      setColors(resolved.filter((c): c is string => c !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [coverUrls]);

  if (colors.length === 0) return null;

  const background = colors
    .map((rgb, i) => {
      const s = SPOTS[i];
      return `radial-gradient(42% 50% at ${s.x}% ${s.y}%, rgba(${rgb}, 0.26) 0%, transparent 70%)`;
    })
    .join(', ');

  return <div className={styles.glow} aria-hidden style={{ background }} />;
}
