import type { Platform } from '@/lib/music/url';
import { ensureFontsLoaded, type RenderOpts } from './canvasHelpers';
import { renderSpotify } from './spotify';
import { renderAppleMusic } from './appleMusic';
import { renderNetease } from './netease';
import { renderQqMusic } from './qqMusic';

export type { RenderOpts };

/* Per-platform renderer registry. Each one consumes the same RenderOpts
   and produces an off-screen <canvas>. Adding a new platform = adding
   one row here + the corresponding renderer file. */
const renderers: Record<Platform, (opts: RenderOpts) => Promise<HTMLCanvasElement>> = {
  spotify: renderSpotify,
  appleMusic: renderAppleMusic,
  netease: renderNetease,
  qqMusic: renderQqMusic,
};

export async function renderCardCanvas(opts: RenderOpts): Promise<HTMLCanvasElement> {
  await ensureFontsLoaded();
  return renderers[opts.platform](opts);
}
