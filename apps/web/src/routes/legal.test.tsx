// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import privacyMd from '../../../../docs/legal/privacy.md?raw';
import termsMd from '../../../../docs/legal/terms.md?raw';
import { PrivacyRoute, TermsRoute } from './LegalRoute';
import { isSafeHref, parseInline, parseLegalMarkdown, slugify } from './legalMarkdown';

afterEach(cleanup);

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/privacy', element: <PrivacyRoute /> },
      { path: '/terms', element: <TermsRoute /> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe('legal markdown subset', () => {
  it('parses headings, paragraphs, lists with continuation lines and notes', () => {
    const doc = parseLegalMarkdown(['# Title', '', '> **DRAFT** note', '', 'One', 'two.', '', '- a `b`', '  continued', '- [c](/terms)', '', '## Sub head!'].join('\n'));
    expect(doc.title).toBe('Title');
    expect(doc.blocks.map((b) => b.kind)).toEqual(['heading', 'note', 'paragraph', 'list', 'heading']);
    expect(doc.blocks[2]).toEqual({ kind: 'paragraph', inlines: [{ kind: 'text', text: 'One two.' }] });
    expect(doc.blocks[3]).toEqual({
      kind: 'list',
      items: [
        [
          { kind: 'text', text: 'a ' },
          { kind: 'code', text: 'b' },
          { kind: 'text', text: ' continued' },
        ],
        [{ kind: 'link', text: 'c', href: '/terms' }],
      ],
    });
    expect(doc.blocks[4]).toMatchObject({ level: 2, id: 'sub-head' });
  });

  it('never emits a link with an unsafe href', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('//evil.example')).toBe(false);
    expect(isSafeHref('http://plain.example')).toBe(false);
    expect(parseInline('[x](javascript:void0)')).toEqual([{ kind: 'text', text: 'x' }]);
    expect(isSafeHref('https://oaic.gov.au')).toBe(true);
  });

  it('keeps [PLACEHOLDERS] as text', () => {
    expect(parseInline('Operated by [COMPANY LEGAL NAME], [ADDRESS].')).toEqual([{ kind: 'text', text: 'Operated by [COMPANY LEGAL NAME], [ADDRESS].' }]);
  });

  it.each([
    ['privacy', privacyMd],
    ['terms', termsMd],
  ])('docs/legal/%s.md uses only the supported subset', (_name, md) => {
    const doc = parseLegalMarkdown(md);
    expect(doc.title).not.toBe('');
    expect(doc.blocks[1]).toMatchObject({ kind: 'note' });
    const leftovers = /\*\*|`|\]\(|^#|^\||^\d+\. /m;
    for (const b of doc.blocks) {
      if (b.kind === 'heading') continue; // numbered headings ("1. What Curtain is") are intended
      const texts = (b.kind === 'list' ? b.items.flat() : b.inlines).map((n) => n.text);
      for (const t of texts) expect(t, `unparsed markdown in "${t}"`).not.toMatch(leftovers);
    }
    // Every in-page anchor points at a heading that exists.
    const ids = new Set(doc.blocks.flatMap((b) => (b.kind === 'heading' ? [b.id] : [])));
    for (const b of doc.blocks) {
      const inl = b.kind === 'list' ? b.items.flat() : b.kind === 'heading' ? [] : b.inlines;
      for (const n of inl) if (n.kind === 'link' && n.href.startsWith('#')) expect(ids).toContain(n.href.slice(1));
    }
  });

  it('slugify matches GitHub-style anchors', () => {
    expect(slugify('Service providers')).toBe('service-providers');
    expect(slugify('6. Liability')).toBe('6-liability');
  });
});

describe('/privacy and /terms', () => {
  it('renders the privacy policy with the draft notice and the D3 promise', () => {
    renderAt('/privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Curtain privacy policy' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/DRAFT for legal review/);
    expect(screen.getByText(/Your body measurements stay in your browser\./)).toBeInTheDocument();
    expect(document.title).toBe('Curtain privacy policy · Curtain');
  });

  it('renders the terms and links back to the privacy policy', () => {
    renderAt('/terms');
    expect(screen.getByRole('heading', { level: 1, name: 'Curtain terms of service' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/DRAFT for legal review/);
    const links = screen.getAllByRole('link', { name: /privacy/i });
    expect(links.some((a) => a.getAttribute('href') === '/privacy')).toBe(true);
  });
});
