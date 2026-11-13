import { html } from '../lib/html.ts';
import { picture } from '../lib/components.ts';
import { type Page } from './types.ts';

/** 1200×630 card, screenshotted once into public/og.jpg (scripts in docs/SITE.md). Not linked, not in the sitemap. */
export const ogCard: Page = {
  meta: { path: '/og-card.html', title: 'Curtain OG card', description: 'Social card source.', noindex: true, bodyClass: 'og-body' },
  hidden: true,
  file: 'og-card.html',
  body: () => html`
<div class="og">
  <div class="og__text">
    <p class="kicker">curtain.fit · Pilot stage</p>
    <p class="og__title">The right size, <em>behind the curtain.</em></p>
    <p class="og__sub">Size advice for fashion shops, computed on the shopper's device.</p>
  </div>
  <div class="og__img">${picture('partner/azure-front', { eager: true, sizes: '420px' })}</div>
</div>
`,
};
