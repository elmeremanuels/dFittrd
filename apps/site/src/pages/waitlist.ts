import { em, html } from '../lib/html.ts';
import { chapter, figure } from '../lib/components.ts';
import { site } from '../data/site.ts';
import { type Page } from './types.ts';

function field(id: string, label: string, input: ReturnType<typeof html>, hint?: string, required = true): ReturnType<typeof html> {
  return html`<div class="field" data-field>
  <label for="${id}">${label}${required ? '' : html` <span class="field__opt">(optional)</span>`}</label>
  ${hint ? html`<p class="field__hint" id="${id}-hint">${hint}</p>` : ''}
  ${input}
  <p class="field__error" id="${id}-error" hidden></p>
</div>`;
}

export const waitlist: Page = {
  meta: {
    path: '/waitlist/',
    title: 'Join the waitlist — Curtain',
    description: "We're onboarding a small group of Shopify and WooCommerce fashion brands after the pilot. Tell us about your shop.",
  },
  body: () => {
    const email = site.contactEmail;
    const privacyEmail = site.privacyEmail ?? site.contactEmail;
    return html`
<section class="page-hero wrap split split--7-5 waitlist-hero">
  <div>
    ${chapter({ level: 1, kicker: 'Contact & waitlist', title: 'Join the *waitlist.*', standfirst: "We're onboarding a small group of fashion brands after the pilot. Tell us about your shop." })}
    <form class="form" action="mailto:${email}" method="post" enctype="text/plain" novalidate data-waitlist data-email="${email}">
      <div class="form__grid">
        ${field('wl-name', 'Name', html`<input id="wl-name" name="name" type="text" autocomplete="name" required aria-describedby="wl-name-error">`)}
        ${field('wl-email', 'Work e-mail', html`<input id="wl-email" name="email" type="email" autocomplete="email" required aria-describedby="wl-email-error">`)}
        ${field('wl-brand', 'Brand name', html`<input id="wl-brand" name="brand" type="text" autocomplete="organization" required aria-describedby="wl-brand-error">`)}
        ${field('wl-url', 'Shop URL', html`<input id="wl-url" name="shop" type="url" inputmode="url" placeholder="https://" required aria-describedby="wl-url-hint wl-url-error">`, 'The address of your online shop.')}
      </div>
      <fieldset class="field field--choice" data-field>
        <legend>Platform</legend>
        <div class="choices">
          <label><input type="radio" name="platform" value="Shopify" required aria-describedby="wl-platform-error"> Shopify</label>
          <label><input type="radio" name="platform" value="WooCommerce"> WooCommerce</label>
          <label><input type="radio" name="platform" value="Other"> Other</label>
        </div>
        <p class="field__error" id="wl-platform-error" hidden></p>
      </fieldset>
      <fieldset class="field field--choice">
        <legend>What you sell <span class="field__opt">(optional)</span></legend>
        <div class="choices">
          <label><input type="radio" name="sells" value="Women's"> Women's</label>
          <label><input type="radio" name="sells" value="Men's"> Men's</label>
          <label><input type="radio" name="sells" value="Kids"> Kids</label>
          <label><input type="radio" name="sells" value="Mixed"> Mixed</label>
        </div>
      </fieldset>
      ${field('wl-msg', 'Anything we should know?', html`<textarea id="wl-msg" name="message" rows="4"></textarea>`, undefined, false)}
      <div class="field field--check" data-field>
        <label class="check"><input id="wl-consent" name="consent" type="checkbox" value="yes" required aria-describedby="wl-consent-error"> <span>I agree that Curtain may e-mail me about the waitlist. <a href="/legal/#waitlist">How we handle this</a>.</span></label>
        <p class="field__error" id="wl-consent-error" hidden></p>
      </div>
      <div class="form__foot">
        <button class="btn btn--primary" type="submit"><span>Join the waitlist</span></button>
        <p class="micro">There is no sign-up backend yet. Sending opens your e-mail app with your details filled in, addressed to ${email}. Nothing is stored in your browser or sent to a third party.</p>
      </div>
      <p class="form__status" role="status" aria-live="polite" data-status></p>
    </form>
  </div>
  <aside class="waitlist-aside">
    ${figure('partner/cardi-front', { ratio: '34', caption: 'Pilot stage, small group, real attention.', sizes: '(min-width: 1024px) 34vw, 100vw', pos: '50% 30%' })}
    <div class="contact-card">
      <p class="kicker">Other ways to reach us</p>
      <dl class="spec spec--stack">
        <div><dt>General</dt><dd><a href="mailto:${email}">${email}</a></dd></div>
        <div><dt>Privacy</dt><dd><a href="mailto:${privacyEmail}">${privacyEmail}</a></dd></div>
        ${site.responseTime ? html`<div><dt>Reply time</dt><dd>${site.responseTime}</dd></div>` : ''}
      </dl>
      <p class="h3">${em('We read *every* message.')}</p>
    </div>
  </aside>
</section>
`;
  },
};
