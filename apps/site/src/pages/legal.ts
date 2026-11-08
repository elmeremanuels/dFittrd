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
  body: () => {
    const privacyEmail = site.privacyEmail ?? site.contactEmail;
    const controller = site.legalName && site.company.address
      ? html`${site.legalName}, ${site.company.address}${site.company.registration ? html`, registration ${site.company.registration}` : ''}. Contact: <a href="mailto:${privacyEmail}">${privacyEmail}</a>.`
      : html`<span class="tag tag--pill">Coming soon</span> The company behind Curtain (legal name, address and registration) is named here before the waitlist opens. Contact meanwhile: <a href="mailto:${privacyEmail}">${privacyEmail}</a>.`;
    return html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'Legal', title: 'The small print, *in progress.*', standfirst: 'We would rather show you an honest “coming soon” than publish a draft as if it were in force.' })}
</section>
<section class="section section--tight wrap legal">
  <article id="privacy"><h2 class="h3">Privacy policy</h2><p><span class="tag tag--pill">Coming soon</span> Our product privacy policy is being reviewed by a lawyer and is published here once it is in force. Until then, our <a href="/privacy-promise/">privacy promise</a> explains in plain words how Curtain handles data.</p></article>
  <article id="terms"><h2 class="h3">Terms</h2><p><span class="tag tag--pill">Coming soon</span> Merchant terms are under legal review. Curtain is in pilot and can't be installed publicly yet.</p></article>
  <article id="waitlist"><h2 class="h3">Waitlist and contact: privacy notice</h2>
    ${site.waitlistNoticeReviewed ? '' : html`<p><span class="tag tag--pill">Draft</span> This notice is awaiting legal review.</p>`}
    <dl class="spec spec--legal">
      <div><dt>Who is responsible</dt><dd>${controller}</dd></div>
      <div><dt>What we receive</dt><dd>Only what you send us: the waitlist form opens your own e-mail app, so we receive your e-mail with your name, work e-mail, brand, shop address, platform and anything you add. Nothing is stored by this website or sent to anyone else.</dd></div>
      <div><dt>Why</dt><dd>To reply to you and to tell you when Curtain opens to more shops.</dd></div>
      <div><dt>Legal basis</dt><dd>Your consent (GDPR Art. 6(1)(a)), given with the checkbox. You can withdraw it at any time by e-mail; that does not affect what we did before.</dd></div>
      <div><dt>How long</dt><dd>Until 12 months after Curtain opens to the public, or until you ask us to delete it, whichever comes first.</dd></div>
      <div><dt>Who else sees it</dt><dd>Nobody, apart from our e-mail provider, which stores the mailbox for us.</dd></div>
      <div><dt>Your rights</dt><dd>Access, correction, deletion, restriction, objection and data portability. Write to <a href="mailto:${privacyEmail}">${privacyEmail}</a>. You can also complain to your data protection authority (in the Netherlands: the Autoriteit Persoonsgegevens).</dd></div>
    </dl>
  </article>
  <article id="cookies"><h2 class="h3">Cookies</h2><p>This website sets no cookies and loads no analytics, trackers, font services or other third-party scripts. Fonts and images are served from our own server.</p></article>
  <article id="imprint"><h2 class="h3">Imprint</h2><p>${site.legalName && site.company.address ? html`${site.legalName}<br>${site.company.address}${site.company.registration ? html`<br>Registration: ${site.company.registration}` : ''}${site.company.vat ? html`<br>VAT: ${site.company.vat}` : ''}<br><a href="mailto:${site.contactEmail}">${site.contactEmail}</a>` : html`<span class="tag tag--pill">Coming soon</span> Company details (legal name, address, registration and VAT number) are added before launch.`}</p></article>
</section>
`;
  },
};
