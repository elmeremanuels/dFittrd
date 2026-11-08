import { html } from '../lib/html.ts';
import { chapter } from '../lib/components.ts';
import { closingCta, journalCards } from '../lib/blocks.ts';
import { type Page } from './types.ts';

export const journal: Page = {
  meta: {
    path: '/journal/',
    title: 'The Journal — Curtain',
    description: 'Notes on fit, fabric and building a fitting room for the internet. First stories coming soon.',
  },
  body: () => html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'The Journal', title: 'Notes on fit, fabric and a fitting room for the *internet.*', standfirst: 'The first stories are being written. Each one is marked “Coming soon” until it is published.' })}
</section>
<section class="section section--tight wrap">${journalCards(2)}</section>
${closingCta('Read it first: *join the waitlist.*')}
`,
};
