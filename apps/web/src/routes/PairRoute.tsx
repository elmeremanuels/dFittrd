import { QrCode, Store } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '@/store';
import { appStrings } from '@/strings';

/**
 * Pairing stub: a try link / QR code from a shop opens `/try/:token`. The QR scan itself is the
 * phone camera (deep link); here the user can paste the link or the code shown next to the QR.
 */
export function PairRoute(): ReactNode {
  const navigate = useNavigate();
  const shops = useApp((s) => s.settings.pairedShops);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const t = appStrings().app.pair;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const token = extractToken(value.trim());
    if (!token) {
      setError(t.invalid);
      return;
    }
    navigate(`/try/${encodeURIComponent(token)}`);
  };

  return (
    <div className="h-full space-y-5 overflow-y-auto px-5 py-4">
      <header>
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 className="font-display text-3xl">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.intro}</p>
      </header>
      <form onSubmit={submit} className="card space-y-3">
        <label htmlFor="pair-code" className="eyebrow">
          {t.fieldLabel}
        </label>
        <input id="pair-code" className="field-input font-sans text-base" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t.placeholder} inputMode="url" autoComplete="off" aria-describedby={error ? 'pair-error' : undefined} aria-invalid={!!error} />
        {error ? (
          <p id="pair-error" role="alert" className="text-xs text-coral-ink">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary w-full">
          <QrCode className="h-5 w-5" aria-hidden /> {t.open}
        </button>
      </form>
      <section className="space-y-2">
        <h2 className="eyebrow">{t.pairedShops}</h2>
        {shops.length === 0 ? (
          <p className="text-sm text-ink-mute">{t.none}</p>
        ) : (
          <ul className="space-y-2">
            {shops.map((s) => (
              <li key={s.id} className="card flex items-center gap-3">
                <Store className="h-5 w-5 text-coral" aria-hidden />
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-ink-mute">
                    {s.platform}
                    {s.paused ? ` · ${t.paused}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-ink-mute">{t.privacy}</p>
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
