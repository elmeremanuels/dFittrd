import { em, html, type SafeHtml } from '../lib/html.ts';
import { chapter, figure, marginNote, textLink } from '../lib/components.ts';
import { closingCta } from '../lib/blocks.ts';
import { type Page } from './types.ts';

function reason(n: string, title: string, body: SafeHtml, media: SafeHtml, flip: boolean): SafeHtml {
  return html`<article class="reason${flip ? ' reason--flip' : ''}">
  <div class="reason__text">
    <span class="chapter__num" aria-hidden="true">${n}</span>
    <h2 class="h2" data-reveal="lines">${em(title)}</h2>
    ${body}
  </div>
  <div class="reason__media">${media}</div>
</article>`;
}

export const why: Page = {
  meta: {
    path: '/why/',
    title: 'Why we do this — Curtain',
    description: 'Sizes are a guess, returns for fit help nobody, shipping twice costs the planet, and privacy should not be the price of a good fit.',
  },
  body: () => html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'Why we do this', title: 'Why *Curtain.*', standfirst: 'Four reasons, in order of how often we hear them.' })}
</section>
<div class="wrap reasons">
  ${reason(
    '01',
    'Sizes are a *guess.*',
    html`<p class="lead dropcap">A 12 at one label is a 10 at the next. Shoppers know it, so they guess, or order two sizes and send one back.</p><p>A good size chart helps, but it still asks someone to measure themselves and read a grid on a phone. We'd rather answer the question they actually have: which size should I order?</p>`,
    figure('photos/colour-rail', { ratio: '45', caption: 'Forty prints and one question: which size?', sizes: '(min-width: 1024px) 45vw, 100vw' }),
    false,
  )}
  ${reason(
    '02',
    'The wrong size is the return *nobody wanted.*',
    html`<p>Every parcel that comes back for fit has been packed, shipped, unpacked and checked twice. That's your margin and your team's afternoon.</p><p>We don't publish return-rate promises. Curtain is in pilot, and we'll only share numbers once we've measured them with real shops.</p>${marginNote('No statistics on this page yet: we only publish figures we can source and link.')}`,
    figure('photos/minimal-rail', { ratio: '34', caption: 'The rail before it goes back in the box.', sizes: '(min-width: 1024px) 40vw, 100vw' }),
    true,
  )}
  ${reason(
    '03',
    'Less shipping, *less waste.*',
    html`<p>A garment that fits the first time doesn't travel back and forth. Getting the size right is one of the simplest things a fashion brand can do for its footprint.</p><p>Our 3D engine also works from photos you already have, so there's no extra sample, shoot or shipment to make a 3D view.</p>`,
    figure('photos/fabric-rolls', { ratio: '45', caption: 'Fabric is precious. So is the trip it takes.', sizes: '(min-width: 1024px) 45vw, 100vw' }),
    false,
  )}
  ${reason(
    '04',
    'Privacy shouldn’t be the price of a *good fit.*',
    html`<p>Body measurements are personal. Many fit tools send them to a server. We built Curtain the other way round: the size is worked out on the shopper's own device, photos never leave it, and you see totals, not people.</p><p>It's a promise you can put on your product page.</p>${textLink('/privacy-promise/', 'Our privacy promise')}`,
    figure('photos/beach-dress-walk', { ratio: '34', caption: 'Some things are nobody else’s business.', sizes: '(min-width: 1024px) 40vw, 100vw', pos: '30% 50%' }),
    true,
  )}
</div>
${closingCta()}
`,
};
