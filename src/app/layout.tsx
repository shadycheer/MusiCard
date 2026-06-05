import type { Metadata } from 'next';
import { Manrope, Inter, Fraunces, EB_Garamond, Noto_Serif_SC } from 'next/font/google';
import './globals.css';

// Card-specific fonts (kept exactly as the share cards render them — these
// must not change or exported PNGs will drift from the on-screen preview).
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-spotify',
  display: 'swap',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-apple',
  display: 'swap',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
});

// Site-chrome fonts — "music essay" aesthetic. Fraunces is the variable
// display face (axes-driven, lots of optical sizes), EB Garamond is the
// quiet long-form body face, Noto Serif SC carries the Chinese typography.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const ebGaramond = EB_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-body',
  display: 'swap',
});

const notoSerifSC = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cn',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: '音乐分享卡 · 链接人类的，我希望不是链接',
  description: 'Spotify / Apple Music / 网易云 单曲链接生成可分享的高清卡片。',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh"
      className={`${manrope.variable} ${inter.variable} ${fraunces.variable} ${ebGaramond.variable} ${notoSerifSC.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
