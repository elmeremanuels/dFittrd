import { html } from '../lib/html.ts';
import { chapter, faqList } from '../lib/components.ts';
import { closingCta } from '../lib/blocks.ts';
import { faq as items } from '../data/content.ts';
import { type Page } from './types.ts';

export const faqPage: Page = {
  meta: {
    path: '/faq/',
    title: 'FAQ — Curtain',
    description: 'Is Curtain live, which platforms, where the size comes from, what it costs, and what the 3D estimate is.',
  },
  body: () => html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'FAQ', title: 'Questions, *answered.*', standfirst: 'Twelve things fashion brands ask us first.' })}
</section>
<section class="wrap faq-page">${faqList(items, true)}</section>
${closingCta('Something we *didn’t answer?*')}
`,
};
