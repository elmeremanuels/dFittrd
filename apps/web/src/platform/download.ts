/** Device access behind `src/platform/*` (ARCHITECTURE.md) so a Capacitor shell can swap it. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function onOnline(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', cb);
  return () => window.removeEventListener('online', cb);
}
