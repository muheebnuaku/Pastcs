// Fire-and-forget event tracker — never throws, never blocks UI
export function trackEvent(event: string, metadata: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, metadata }),
  }).catch(() => {});
}
