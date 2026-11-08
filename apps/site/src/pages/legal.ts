import { html } from '../lib/html.ts';
import { chapter } from '../lib/components.ts';
import { site } from '../data/site.ts';
import { type Page } from './types.ts';

export const legal: Page = {
  meta: {
    path: '/legal/',
    title: 'Legal — Curtain',
    description: 'Privacy policy, terms, imprint and cookies for curtain.fit. The product policies are under legal review.',
  },
  body: () => html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'Legal', title: 'The small print, *in progress.*', standfirst: 'We would rather show you an honest “coming soon” than publish a draft as if it were in force.' })}
</section>
<section class="section section--tight wrap legal">
  <article id="privacy"><h2 class="h3">Privacy policy</h2><p><span class="tag tag--pill">Coming soon</span> Our product privacy policy is being reviewed by a lawyer and is published here once it is in force. Until then, our <a href="/privacy-promise/">privacy promise</a> explains in plain words how Curtain handles data.</p></article>
  <article id="terms"><h2 class="h3">Terms</h2><p><span class="tag tag--pill">Coming soon</span> Merchant terms are under legal review. Curtain is in pilot and can't be installed publicly yet.</p></article>
  <article id="waitlist"><h2 class="h3">Waitlist and contact</h2><p>The waitlist form opens your own e-mail app. We receive only what you send us, use it to reply and to tell you when Curtain opens, and delete it on request. Write to <a href="mailto:${site.privacyEmail ?? site.contactEmail}">${site.privacyEmail ?? site.contactEmail}</a>.</p></article>
  <article id="cookies"><h2 class="h3">Cookies</h2><p>This website sets no cookies and loads no analytics, trackers, font services or other third-party scripts. Fonts and images are served from our own server.</p></article>
  <article id="imprint"><h2 class="h3">Imprint</h2><p>${site.legalName ? site.legalName : html`<span class="tag tag--pill">Coming soon</span> Company details (legal name, address, registration and VAT number) are added before launch.`}</p></article>
</section>
`,
};
