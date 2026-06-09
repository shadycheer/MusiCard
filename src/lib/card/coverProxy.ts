export function proxyCoverUrl(originalUrl: string): string {
  if (!originalUrl) return '';
  if (originalUrl.startsWith('/api/cover')) return originalUrl;
  return `/api/cover?url=${encodeURIComponent(originalUrl)}`;
}
