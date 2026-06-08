import type { Metadata } from 'next';
import { Manrope, Inter, Geist, Geist_Mono } from 'next/font/google';
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

// Site-chrome fonts — modern grotesk, refined dark utility aesthetic.
// Geist for everything, Geist Mono for micro-labels and code-feeling tags.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://ohmydna.com'),
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
      className={`${manrope.variable} ${inter.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
