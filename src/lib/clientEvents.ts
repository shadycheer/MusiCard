/* Fire-and-forget client telemetry — view + export events flow to
   /api/track-view, which writes to the same Neon table the cron
   refresher reads. We don't await the network call (keepalive lets
   the request survive a page-unload trigger) and silently swallow
   errors — analytics shouldn't break the user flow. */
export function recordEvent(type: 'view' | 'export'): void {
  fetch('/api/track-view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
    keepalive: true,
  }).catch(() => {});
}
