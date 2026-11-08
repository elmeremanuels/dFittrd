import { em, html } from '../lib/html.ts';
import { chapter, faqList, figure } from '../lib/components.ts';
import { closingCta, pricingCard } from '../lib/blocks.ts';
import { faq } from '../data/content.ts';
import { type Page } from './types.ts';

export const pricing: Page = {
  meta: {
    path: '/pricing/',
    title: 'Pricing — Curtain',
    description: 'One plan: USD 8.99 a month per shop. Unlimited products, every chart template, no fee per try-on.',
  },
  body: () => html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'Pricing', title: 'One plan. *Simple.*', standfirst: 'Per shop, flat. No fee per try\u2011on, no tiers to compare.' })}
</section>
<section class="wrap pricing-layout">
  ${pricingCard()}
  <div class="pricing-notes">
    ${figure('photos/editorial-barrel', { ratio: '34', caption: 'Everything you need, nothing you don’t.', sizes: '(min-width: 1024px) 30vw, 100vw', pos: '74% 50%' })}
    <dl class="spec spec--stack">
      <div><dt>Billing</dt><dd>Through Shopify on Shopify (in your billing currency where available), and through Stripe on WooCommerce. Prices exclude taxes unless stated at checkout.</dd></div>
      <div><dt>3D estimate</dt><dd>In development (demo only) and not included in this plan. Whether and how it is priced is decided after the pilot.</dd></div>
      <div><dt>Cancel any time</dt><dd>If your plan pauses, your product page keeps working and the button shows a short “paused” note.</dd></div>
    </dl>
  </div>
</section>
<section class="section wrap split split--4-8">
  <div><p class="kicker">Questions</p><h2 class="h2" data-reveal="lines">${em('About the *price.*')}</h2></div>
  ${faqList(faq.filter((f) => /cost|cancel|developer|slow/i.test(f.q)))}
</section>
${closingCta('One plan, *one button* on your product page.')}
`,
};
