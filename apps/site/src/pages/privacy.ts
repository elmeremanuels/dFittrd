import { em, html } from '../lib/html.ts';
import { chapter, textLink } from '../lib/components.ts';
import { closingCta, ledger } from '../lib/blocks.ts';
import { type Page } from './types.ts';

export const privacy: Page = {
  meta: {
    path: '/privacy-promise/',
    title: 'Privacy & trust — Curtain',
    description: "Private by design: sizing runs on the shopper's device, no photos or measurements leave it, shops see totals only, and 3D is opt-in.",
  },
  body: () => html`
<section class="night night--hero">
  <div class="wrap">
    ${chapter({ level: 1, kicker: 'Privacy & trust', title: 'Private by *design.*', standfirst: 'Not a setting. The way it’s built.' })}
    ${ledger()}
  </div>
</section>
<section class="section wrap split split--5-7">
  <div>
    <p class="kicker">What we don't do</p>
    <h2 class="h2" data-reveal="lines">${em('No ads. No tracking. *No sales.*')}</h2>
  </div>
  <div class="prose">
    <p class="lead">No advertising. No tracking cookies in the fit tool. No data sales. No third-party trackers. This website has none either.</p>
    <h3 class="h3">Forget me</h3>
    <p>One tap in the fit tool deletes the saved profile from the browser and asks our server to delete what it holds for that device.</p>
  </div>
</section>
<section class="section band-sand">
  <div class="wrap split split--5-7">
    <div><p class="kicker">The fine print, honestly</p><h2 class="h2" data-reveal="lines">${em('Small print, *large type.*')}</h2></div>
    <ul class="fine">
      <li>The 3D estimate downloads the garment file from our server; the draping happens on the device.</li>
      <li>The optional camera scan runs in the browser. Frames are processed there and never stored or uploaded.</li>
      <li>Our privacy policy is being reviewed by a lawyer. It is linked here once it is in force. ${textLink('/legal/#privacy', 'Status')}</li>
    </ul>
  </div>
</section>
${closingCta()}
`,
};
