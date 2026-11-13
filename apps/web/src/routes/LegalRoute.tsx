import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import privacyMd from '../../../../docs/legal/privacy.md?raw';
import termsMd from '../../../../docs/legal/terms.md?raw';
import { parseLegalMarkdown, type Block, type Inline, type LegalDoc } from './legalMarkdown';

/**
 * Public legal pages, /privacy and /terms (the URLs the Shopify App Store listing points at).
 * The text lives in `docs/legal/*.md` and is bundled at build time, so the page works offline and
 * makes no request. Rendered as React elements from parsed data: no HTML injection.
 */

const PRIVACY = parseLegalMarkdown(privacyMd);
const TERMS = parseLegalMarkdown(termsMd);

export function PrivacyRoute(): ReactNode {
  return <LegalPage doc={PRIVACY} />;
}

export function TermsRoute(): ReactNode {
  return <LegalPage doc={TERMS} />;
}

export function LegalPage({ doc }: { doc: LegalDoc }): ReactNode {
  useEffect(() => {
    const before = document.title;
    document.title = `${doc.title} · Curtain`;
    return () => {
      document.title = before;
    };
  }, [doc.title]);

  return (
    <div className="min-h-dvh bg-cream text-ink">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 pt-6 sm:px-6">
        <p className="eyebrow">Curtain · your private fitting room</p>
        <nav aria-label="Legal" className="flex gap-4 text-sm">
          <Link to="/privacy" className="underline-offset-4 hover:underline">
            Privacy
          </Link>
          <Link to="/terms" className="underline-offset-4 hover:underline">
            Terms
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-16 sm:px-6">
        <article className="space-y-4 text-base leading-relaxed text-ink-soft">{doc.blocks.map((b, i) => renderBlock(b, i))}</article>
      </main>
    </div>
  );
}

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.kind) {
    case 'heading':
      if (b.level === 1)
        return (
          <h1 key={key} id={b.id} className="font-display text-4xl text-ink">
            {b.text}
          </h1>
        );
      if (b.level === 2)
        return (
          <h2 key={key} id={b.id} className="pt-6 font-display text-2xl text-ink">
            {b.text}
          </h2>
        );
      return (
        <h3 key={key} id={b.id} className="pt-2 font-sans text-lg font-semibold text-ink">
          {b.text}
        </h3>
      );
    case 'paragraph':
      return <p key={key}>{renderInlines(b.inlines)}</p>;
    case 'list':
      return (
        <ul key={key} className="list-disc space-y-2 pl-6">
          {b.items.map((item, i) => (
            <li key={i}>{renderInlines(item)}</li>
          ))}
        </ul>
      );
    case 'note':
      return (
        <p key={key} role="note" className="rounded-2xl border border-warn/40 bg-white/70 px-4 py-3 text-ink">
          {renderInlines(b.inlines)}
        </p>
      );
  }
}

function renderInlines(inlines: Inline[]): ReactNode[] {
  return inlines.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return n.text;
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-ink">
            {n.text}
          </strong>
        );
      case 'code':
        return (
          <code key={i} className="rounded bg-cream-deep px-1 font-mono text-[0.9em]">
            {n.text}
          </code>
        );
      case 'link':
        if (n.href.startsWith('/'))
          return (
            <Link key={i} to={n.href} className="text-coral-ink underline underline-offset-2">
              {n.text}
            </Link>
          );
        return (
          <a key={i} href={n.href} className="text-coral-ink underline underline-offset-2" {...(n.href.startsWith('https://') ? { rel: 'noopener noreferrer' } : {})}>
            {n.text}
          </a>
        );
    }
  });
}
