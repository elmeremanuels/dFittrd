import { QrCode, Store } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '@/store';

/**
 * Pairing stub: a try link / QR code from a shop opens `/try/:token`. The QR scan itself is the
 * phone camera (deep link); here the user can paste the link or the code shown next to the QR.
 */
export function PairRoute(): ReactNode {
  const navigate = useNavigate();
  const shops = useApp((s) => s.settings.pairedShops);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const token = extractToken(value.trim());
    if (!token) {
      setError('Paste the “Try in Paskamer” link or the code shown under the QR.');
      return;
    }
    navigate(`/try/${encodeURIComponent(token)}`);
  };

  return (
    <div className="h-full space-y-5 overflow-y-auto px-5 py-4">
      <header>
        <p className="eyebrow">Pair a shop</p>
        <h1 className="font-display text-3xl">Bring a shop into your fitting room</h1>
        <p className="mt-1 text-sm text-ink-soft">Tap “Try in Paskamer” on a product page, or scan the QR with your camera. On this phone you can also paste the link.</p>
      </header>
      <form onSubmit={submit} className="card space-y-3">
        <label htmlFor="pair-code" className="eyebrow">
          Try link or code
        </label>
        <input id="pair-code" className="field-input font-sans text-base" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://app.paskamer.app/try/…" inputMode="url" autoComplete="off" aria-describedby={error ? 'pair-error' : undefined} aria-invalid={!!error} />
        {error ? (
          <p id="pair-error" role="alert" className="text-xs text-coral-deep">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary w-full">
          <QrCode className="h-5 w-5" aria-hidden /> Open try-on
        </button>
      </form>
      <section className="space-y-2">
        <h2 className="eyebrow">Paired shops</h2>
        {shops.length === 0 ? (
          <p className="text-sm text-ink-mute">No shop paired yet — the rail shows the demo collection.</p>
        ) : (
          <ul className="space-y-2">
            {shops.map((s) => (
              <li key={s.id} className="card flex items-center gap-3">
                <Store className="h-5 w-5 text-coral" aria-hidden />
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-ink-mute">
                    {s.platform}
                    {s.paused ? ' · paused' : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-ink-mute">A shop never sees your measurements, photos or device id — only a per-shop pseudonym and the fact that an item was opened.</p>
    </div>
  );
}

export function extractToken(input: string): string | null {
  if (!input) return null;
  try {
    const u = new URL(input);
    const m = /\/try\/([^/?#]+)/.exec(u.pathname);
    if (m) return decodeURIComponent(m[1]!);
    const t = u.searchParams.get('token');
    if (t) return t;
  } catch {
    /* not a URL */
  }
  const m = /\/try\/([^/?#]+)/.exec(input);
  if (m) return decodeURIComponent(m[1]!);
  if (/^[A-Za-z0-9._:-]{8,}$/.test(input)) return input;
  return null;
}
