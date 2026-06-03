import type { Metadata } from 'next';
import { Manrope, Inter } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-spotify',
  display: 'swap',
  fallback: [
    '-apple-system',
    'BlinkMacSystemFont',
    'PingFang SC',
    'Microsoft YaHei',
    'sans-serif',
  ],
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-apple',
  display: 'swap',
  fallback: [
    '-apple-system',
    'BlinkMacSystemFont',
    'PingFang SC',
    'Microsoft YaHei',
    'sans-serif',
  ],
});

export const metadata: Metadata = {
  title: '音乐分享卡',
  description: 'Spotify / Apple Music 分享卡生成器',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh" className={`${manrope.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
