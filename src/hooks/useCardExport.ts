import { useCallback, useEffect, useState } from 'react';
import { renderCardCanvas } from '@/lib/card/renderCanvas';
import { proxyCoverUrl } from '@/lib/card/coverProxy';
import { platforms } from '@/lib/music/platforms';
import { recordEvent } from '@/lib/clientEvents';
import type { Track } from '@/lib/music/songlink';

/* The card-export flow encapsulated: renders the visible ShareCard
   to a 1920px canvas, picks Web Share vs download based on UA, falls
   back to a previewable blob on iOS/Android browsers that don't
   support sharing files (Safari < 17, some in-app webviews).

   Lives as a hook (not just a function) because the share/fallback
   surface needs persistent React state — `fallbackImageUrl` lifts
   into the modal; `exporting` drives the button's loading affordance;
   `exportError` reads as inline feedback under the button. */

type ExportInput = {
  track: Track;
  qrSvg: string;
  lyrics: string[];
};

export function useCardExport() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);
  const [useMobileShare, setUseMobileShare] = useState(false);

  /* Detect once on mount — UA doesn't change during a session. The
     re-check inside exportCard covers desktop→tablet docked/undocked
     transitions, which would only matter on iPadOS, but it's cheap. */
  useEffect(() => {
    setUseMobileShare(shouldUseMobileShare());
  }, []);

  /* Revoke any lingering blob URL when the host component unmounts.
     Empty deps intentional — we only want the *unmount* cleanup,
     not "revoke whenever fallbackImageUrl changes" (which would tear
     down a freshly-created URL before the modal could show it). */
  useEffect(() => {
    return () => {
      if (fallbackImageUrl) URL.revokeObjectURL(fallbackImageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeFallback = useCallback(() => {
    setFallbackImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const exportCard = useCallback(async (input: ExportInput) => {
    if (!input.qrSvg) return;
    setExporting(true);
    setExportError(null);
    try {
      const canvas = await renderCardCanvas({
        title: input.track.title,
        artist: input.track.artist,
        coverUrl: proxyCoverUrl(input.track.coverUrl),
        qrSvg: input.qrSvg,
        platform: input.track.platform,
        lyrics: input.lyrics,
        targetWidth: 1920,
      });

      const blob = await canvasToBlob(canvas);
      const filename = sanitizeFilename(input.track.title, input.track.platform);

      const mobileShare = shouldUseMobileShare();
      setUseMobileShare(mobileShare);

      if (mobileShare) {
        const result = await tryShareFile(blob, filename);
        if (result === 'unsupported') {
          const url = URL.createObjectURL(blob);
          setFallbackImageUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      } else {
        const url = URL.createObjectURL(blob);
        triggerDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }

      recordEvent('export');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }, []);

  return {
    exporting,
    exportError,
    fallbackImageUrl,
    useMobileShare,
    exportCard,
    closeFallback,
  };
}

/* ─── helpers ──────────────────────────────────────────────────────── */

function sanitizeFilename(title: string, platform: Track['platform']): string {
  const cleaned = title
    .replace(/[^\w一-鿿-]+/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '');
  return `${platforms[platform].filePrefix}-${cleaned || 'track'}.png`;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      'image/png',
    );
  });
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function isDesktopPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  const ua = navigator.userAgent;
  return /Mac|Win|Linux|CrOS/i.test(platform) || /Macintosh|Windows|X11|Linux/i.test(ua);
}

function shouldUseMobileShare(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isDesktopPlatform()) return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

type ShareResult = 'ok' | 'cancelled' | 'unsupported';

/* Web Share API path. Returns 'unsupported' when the browser can't
   share files (older Safari, some Android webviews, all desktops),
   'cancelled' when the user dismisses the share sheet, 'ok' on success.
   Callers fall back to a blob-URL preview modal on 'unsupported'. */
async function tryShareFile(blob: Blob, filename: string): Promise<ShareResult> {
  if (typeof navigator === 'undefined') return 'unsupported';
  if (typeof navigator.share !== 'function') return 'unsupported';

  const file = new File([blob], filename, { type: 'image/png' });
  if (
    typeof navigator.canShare !== 'function' ||
    !navigator.canShare({ files: [file] })
  ) {
    return 'unsupported';
  }

  try {
    await navigator.share({ files: [file] });
    return 'ok';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}
