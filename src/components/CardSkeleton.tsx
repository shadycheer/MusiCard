import type { Platform } from '../lib/musicUrl';
import styles from './CardSkeleton.module.css';

type Props = {
  platform: Platform;
};

/* A loading placeholder that mirrors the real ShareCard variant for the
   pasted link's platform — same 320px width, same inner geometry (square
   cover for Spotify/Apple, round vinyl for NetEase). Avoids the layout
   pop that a generic skeleton would cause when the real card lands. */
export default function CardSkeleton({ platform }: Props) {
  if (platform === 'netease') return <NeteaseSkeleton />;
  if (platform === 'appleMusic') return <AppleSkeleton />;
  if (platform === 'qqMusic') return <QqMusicSkeleton />;
  return <SpotifySkeleton />;
}

function SpotifySkeleton() {
  return (
    <div className={`${styles.card} ${styles.cardSpotify}`} aria-hidden>
      <div className={styles.coverSquare} />
      <div className={styles.info}>
        <div className={styles.titleBar} />
        <div className={styles.artistBar} />
      </div>
      <div className={styles.foot}>
        <div className={styles.brandSpotify} />
        <div className={styles.qr} />
      </div>
    </div>
  );
}

function AppleSkeleton() {
  return (
    <div className={`${styles.card} ${styles.cardApple}`} aria-hidden>
      <div className={styles.coverApple} />
      <div className={styles.info}>
        <div className={styles.titleBar} />
        <div className={styles.artistBar} />
      </div>
      <div className={styles.foot}>
        <div className={styles.brandApple} />
        <div className={styles.qr} />
      </div>
    </div>
  );
}

function NeteaseSkeleton() {
  return (
    <div className={`${styles.card} ${styles.cardNetease}`} aria-hidden>
      <div className={styles.vinylStage}>
        <div className={styles.vinyl}>
          <div className={styles.vinylLabel} />
        </div>
      </div>
      <div className={styles.info}>
        <div className={styles.titleBar} />
        <div className={styles.artistBar} />
      </div>
      <div className={styles.foot}>
        <div className={styles.brandNetease} />
        <div className={styles.qr} />
      </div>
    </div>
  );
}

function QqMusicSkeleton() {
  return (
    <div className={`${styles.card} ${styles.cardQq}`} aria-hidden>
      <div className={styles.coverSquare} />
      <div className={styles.info}>
        <div className={styles.titleBar} />
        <div className={styles.artistBar} />
      </div>
      <div className={styles.foot}>
        <div className={styles.brandQq} />
        <div className={styles.qr} />
      </div>
    </div>
  );
}
