'use client';

import { useEffect, useState } from 'react';
import NeteaseCard from '@/components/NeteaseCard';
import { generateQrSvg } from '@/lib/qr';

const MOCK = {
  title: '晴天',
  artist: '周杰伦',
  coverUrl: 'https://picsum.photos/seed/qingtian-jay/600/600',
  sourceUrl: 'https://music.163.com/#/song?id=186016',
  lyrics: [
    '故事的小黄花',
    '从出生那年就飘着',
    '童年的荡秋千',
    '随记忆一直晃到现在',
  ],
};

export default function NeteasePreviewPage() {
  const [qrSvg, setQrSvg] = useState('');
  const [showLyrics, setShowLyrics] = useState(true);

  useEffect(() => {
    generateQrSvg(MOCK.sourceUrl).then(setQrSvg);
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 32,
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: '#888',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        NetEase card preview — mock data, no API call. Switch lyrics:
        <button
          style={{
            marginLeft: 8,
            padding: '4px 10px',
            border: '1px solid #ddd',
            background: '#fff',
            borderRadius: 4,
            cursor: 'pointer',
          }}
          onClick={() => setShowLyrics((v) => !v)}
        >
          {showLyrics ? 'hide' : 'show'}
        </button>
      </div>
      {qrSvg && (
        <NeteaseCard
          title={MOCK.title}
          artist={MOCK.artist}
          coverUrl={MOCK.coverUrl}
          qrSvg={qrSvg}
          lyrics={showLyrics ? MOCK.lyrics : undefined}
        />
      )}
    </div>
  );
}
