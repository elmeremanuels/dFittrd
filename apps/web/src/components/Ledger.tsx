import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { shortDate } from '@/lib/format';

/**
 * Privacy ledger (handoff §2.2): what left the device, when, and which field names — never values.
 * Shared by the profile screen (client ledger) and the merchant console (provider ledger).
 */
export interface LedgerLine {
  id: string;
  at: string;
  title: string;
  detail: string;
  fields: string[];
  bytes?: number;
  status?: string;
}

export function Ledger({ lines, emptyText = 'Nothing has left this device yet.', title = 'Privacy ledger', compact = false }: { lines: LedgerLine[]; emptyText?: string; title?: string; compact?: boolean }): ReactNode {
  return (
    <section className="card space-y-3" aria-labelledby="ledger-title">
      <header className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-coral" aria-hidden />
        <h2 id="ledger-title" className="font-display text-xl text-ink">
          {title}
        </h2>
      </header>
      {lines.length === 0 ? (
        <p className="text-sm text-ink-mute">{emptyText}</p>
      ) : (
        <ol className={`divide-y divide-ink/10 ${compact ? 'max-h-64 overflow-y-auto' : ''}`}>
          {lines.map((l) => (
            <li key={l.id} className="py-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-ink">{l.title}</span>
                <time dateTime={l.at} className="shrink-0 text-xs text-ink-mute">
                  {shortDate(l.at)}
                </time>
              </div>
              <p className="text-xs text-ink-soft">{l.detail}</p>
              {l.fields.length > 0 ? (
                <p className="mt-1 flex flex-wrap gap-1" aria-label="Fields sent">
                  {l.fields.map((f) => (
                    <span key={f} className="chip px-2 py-0.5 text-xs">
                      {f}
                    </span>
                  ))}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-ink-mute">
                {l.bytes !== undefined ? `${l.bytes} bytes` : ''}
                {l.status ? ` · ${l.status}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
