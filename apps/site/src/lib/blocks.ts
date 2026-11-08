import { em, html, type SafeHtml } from './html.ts';
import { button, curtainSvg, picture, textLink } from './components.ts';
import { stories } from '../data/content.ts';
import { img } from '../data/images.ts';
import { site } from '../data/site.ts';

export function journalCards(headingLevel: 2 | 3 = 3): SafeHtml {
  return html`<ol class="journal-grid">${stories.map((s) => {
    const i = img(s.image);
    const title = headingLevel === 2 ? html`<h2 class="story__title">${s.title}</h2>` : html`<h3 class="story__title">${s.title}</h3>`;
    return html`<li class="story" id="${s.id}" data-reveal="img">
      <div class="story__img ratio-45">${picture(s.image, { sizes: '(min-width: 1024px) 30vw, 100vw', pos: s.pos })}${i.estimate ? html`<span class="tag tag--estimate">Estimate</span>` : ''}</div>
      <p class="story__meta"><span>${s.kicker}</span><span class="story__soon">Coming soon</span></p>
      ${title}
      <p class="story__dek">${s.dek}</p>
    </li>`;
  })}</ol>`;
}

export function journalTeaser(): SafeHtml {
  return html`<section class="section wrap" aria-labelledby="journal-h">
  <div class="section-head">
    <div><p class="kicker">From the journal</p><h2 class="h2" id="journal-h" data-reveal="lines">${em('Notes on fit, fabric and a fitting room for the *internet.*')}</h2></div>
    ${textLink('/journal/', 'View all')}
  </div>
  ${journalCards()}
</section>`;
}

export function closingCta(title = 'Be one of the first brands *behind the curtain.*'): SafeHtml {
  return html`<section class="closing" aria-labelledby="closing-h">
  ${curtainSvg('closing__svg')}
  <div class="closing__inner wrap">
    <p class="kicker">Waitlist · Pilot stage</p>
    <h2 class="display-l" id="closing-h" data-reveal="lines">${em(title)}</h2>
    <p class="closing__text">We're onboarding a small number of Shopify and WooCommerce brands after the pilot. Leave your details and we'll be in touch.</p>
    <div class="btn-row">${button('/waitlist/', 'Join the waitlist')}${button('/how-it-works/', 'See how it works', 'secondary')}</div>
  </div>
</section>`;
}

export function pricingCard(): SafeHtml {
  return html`<article class="price-card" aria-labelledby="plan-h">
  <div class="price-card__head">
    <p class="kicker">One plan</p>
    <h2 class="price-card__name" id="plan-h">Curtain</h2>
  </div>
  <p class="price-card__price"><span class="price-card__cur">USD</span><span class="price-card__amt">${site.price.amount}</span><span class="price-card__per">/ ${site.price.per}</span></p>
  <ul class="ticks">
    <li>Size advice on every product page</li>
    <li>Unlimited products</li>
    <li>All chart templates: AU, UK, EU and US women's body charts, plus garment templates</li>
    <li>Bulk assign by collection, tag or product type</li>
    <li>Fit totals in your dashboard</li>
    <li>No fee per try-on</li>
  </ul>
  <p class="price-card__trial">${site.trialDays ? `Free trial: ${site.trialDays} days.` : 'Free trial at launch; its length is confirmed when installs open.'}</p>
  ${button('/waitlist/', 'Join the waitlist')}
  <p class="price-card__fine">Not "start trial": Curtain can't be installed publicly yet.</p>
</article>`;
}

export const ledgerRows = {
  device: [
    'Height, weight, fit preference, and age range (optional)',
    'Body measurements they type in',
    'The camera scan: frames are processed in the browser, never stored, never uploaded',
    'Their saved profile ("Remember me"), kept separately for each shop',
  ],
  server: [
    'A random device number (no name, e-mail or phone)',
    'Which shop and product the session is for',
    'The recommended size label and a confidence number, and nothing else about their body',
    'A ledger line naming what was sent (field names and sizes, never the values)',
  ],
  shop: [
    'Totals only: sessions, recommended sizes, and products opened without a result',
    'Each total appears only once enough shoppers are in a group',
    'Never a measurement, a device number or a photo',
    "We don't ask Shopify for access to your customers or orders",
  ],
};

export function ledger(compact = false): SafeHtml {
  const cols: [string, string, string[]][] = [
    ['i', "Stays on the shopper's device", ledgerRows.device],
    ['ii', 'Reaches our server', ledgerRows.server],
    ['iii', 'What the shop sees', ledgerRows.shop],
  ];
  return html`<div class="ledger${compact ? ' ledger--compact' : ''}">${cols.map(
    ([n, h, rows]) => html`<section class="ledger__col"><p class="ledger__n" aria-hidden="true">${n}</p><h3 class="ledger__h">${h}</h3><ul>${(compact ? rows.slice(0, 3) : rows).map((r) => html`<li>${r}</li>`)}</ul></section>`,
  )}</div>`;
}
