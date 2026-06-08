'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import HistoryShelf from '@/components/HistoryShelf';
import { parseMusicUrl } from '@/lib/musicUrl';
import { buildSlug, trackToSlug } from '@/lib/slug';
import { getRecentTracks, removeCachedTrack } from '@/lib/trackCache';
import type { Track } from '@/lib/songlink';
import styles from './page.module.css';

/* Home: input + recent-tracks shelf. Pasting a valid link doesn't
   transition any state here — it navigates to /[slug]. That route
   owns the actual fetch + display, so the back button works
   naturally and each song has a shareable URL. */
export default function Page() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const [recent, setRecent] = useState<Track[]>([]);
  useEffect(() => {
    setRecent(getRecentTracks(12));
  }, []);

  /* Validate + navigate on input change. Debounced so a paste-and-edit
     sequence doesn't fire mid-edit. */
  useEffect(() => {
    if (!input.trim()) {
      setInputError(null);
      return;
    }
    const t = window.setTimeout(() => {
      const parsed = parseMusicUrl(input);
      if (parsed.kind === 'invalid') {
        setInputError('请粘贴 Spotify / Apple Music / 网易云 / QQ 音乐 单曲链接');
        return;
      }
      if (parsed.kind === 'non-track') {
        setInputError('目前只支持单曲链接');
        return;
      }
      setInputError(null);
      const slug = buildSlug(parsed.platform, parsed.externalId, parsed.country);
      router.push(`/${slug}`);
    }, 250);
    return () => window.clearTimeout(t);
  }, [input, router]);

  const handlePickRecent = useCallback(
    (track: Track) => {
      const slug = trackToSlug(track);
      if (slug) router.push(`/${slug}`);
    },
    [router],
  );

  const handleRemoveRecent = useCallback((sourceUrl: string) => {
    removeCachedTrack(sourceUrl);
    setRecent(getRecentTracks(12));
  }, []);

  return (
    <div className={styles.page}>
      <header className={`${styles.topBar}`}>
        <a href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden />
          <span className={styles.brandText}>MusiCard</span>
        </a>
        <div className={styles.topBarTrack} aria-hidden />
        <a
          className={styles.iconLink}
          href="https://github.com/shadycheer/MusiCard"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub repository"
          title="GitHub"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
            <path d="M12 .5C5.65.5.5 5.66.5 12.02c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.16c-3.2.69-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.21-1.5 3.18-1.18 3.18-1.18.63 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.55A11.52 11.52 0 0 0 23.5 12.02C23.5 5.66 18.35.5 12 .5Z" />
          </svg>
        </a>
      </header>

      <main
        className={styles.main}
        data-stage="idle"
        data-has-history={recent.length > 0 ? 'true' : 'false'}
      >
        <div className={styles.inputBlock}>
          <label className={styles.inputLabel} htmlFor="track-input">
            音乐链接
          </label>
          <input
            id="track-input"
            className={styles.input}
            placeholder="粘贴 Spotify / Apple Music / 网易云 / QQ 音乐 单曲链接"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          {inputError && <p className={styles.inputError}>{inputError}</p>}
        </div>

        {recent.length > 0 && (
          <HistoryShelf
            tracks={recent}
            onPick={handlePickRecent}
            onRemove={handleRemoveRecent}
          />
        )}
      </main>
    </div>
  );
}
