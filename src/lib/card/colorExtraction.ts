export type ExtractedPalette = {
  primary: string;
  secondary: string;
};

const FALLBACK: ExtractedPalette = {
  primary: '#2A2520',
  secondary: '#4A4138',
};

export async function extractCoverPalette(
  source: string | HTMLImageElement,
): Promise<ExtractedPalette> {
  if (typeof document === 'undefined') return FALLBACK;

  let img: HTMLImageElement;
  if (typeof source === 'string') {
    try {
      img = await loadCrossOrigin(source);
    } catch {
      return FALLBACK;
    }
  } else {
    img = source;
  }

  const SAMPLE_SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return FALLBACK;

  try {
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  } catch {
    // Tainted canvas (CORS) — fall back.
    return FALLBACK;
  }

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    return FALLBACK;
  }

  type Bucket = { count: number; r: number; g: number; b: number };
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] < 128) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (max + min) / 2 / 255;
    if (sat < 0.18 || lum < 0.08 || lum > 0.92) continue;

    // 9-bit bucket: 3 bits per channel.
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (sorted.length === 0) return FALLBACK;

  const primary = avgHex(sorted[0]);
  const secondaryBucket =
    sorted.find((bk, i) => i > 0 && colorDistance(bk, sorted[0]) > 60) ??
    sorted[1] ??
    sorted[0];

  return { primary, secondary: avgHex(secondaryBucket) };
}

function avgHex(b: { count: number; r: number; g: number; b: number }): string {
  const r = Math.round(b.r / b.count);
  const g = Math.round(b.g / b.count);
  const bb = Math.round(b.b / b.count);
  return `#${[r, g, bb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function colorDistance(
  a: { count: number; r: number; g: number; b: number },
  b: { count: number; r: number; g: number; b: number },
): number {
  const ar = a.r / a.count;
  const ag = a.g / a.count;
  const ab = a.b / a.count;
  const br = b.r / b.count;
  const bg = b.g / b.count;
  const bb = b.b / b.count;
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function loadCrossOrigin(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

export function darken(hex: string, amount: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const k = 1 - Math.max(0, Math.min(1, amount));
  return `#${[r * k, g * k, b * k]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')}`;
}
