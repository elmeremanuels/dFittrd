import { em, html } from '../lib/html.ts';
import { chapter, figure, textLink } from '../lib/components.ts';
import { closingCta } from '../lib/blocks.ts';
import { type Page } from './types.ts';

export const about: Page = {
  meta: {
    path: '/about/',
    title: 'Who we are — Curtain',
    description: 'Curtain is a small, founder-led studio building a private fitting room for online fashion. We say what is true: what works, what is in pilot, what is not finished.',
  },
  body: () => html`
<section class="page-hero wrap split split--7-5">
  ${chapter({ level: 1, kicker: 'Who we are', title: 'A small studio *behind the curtain.*' })}
  <div class="page-hero__aside">${figure('photos/knits-pampas-rail', { ratio: '34', caption: 'Soft things, measured carefully.', eager: true, sizes: '(min-width: 1024px) 34vw, 100vw', pos: '60% 50%' })}</div>
</section>

<section class="section wrap prose-grid">
  <div class="prose">
    <p class="lead dropcap">Curtain is founder-led and early. It started with one idea: the fitting room is the most honest moment in shopping, and online fashion lost it.</p>
    <p>The first plan was an app with a full body profile. We chose to start with the plugin instead, so a shopper gets a good size right on your page, with nothing to install.</p>
    <p>We build carefully and say what's true: what works, what's in pilot, what isn't finished. Pictures are labelled estimates. Measurements stay on the device. Shops see totals.</p>
    ${textLink('/why/', 'Why we do this')}
  </div>
  <aside class="beliefs" aria-labelledby="beliefs-h">
    <p class="kicker" id="beliefs-h">What we believe</p>
    <ol>
      <li><span aria-hidden="true">i.</span><p>${em('The shopper *chooses.* We advise.')}</p></li>
      <li><span aria-hidden="true">ii.</span><p>${em('An estimate is called an *estimate.*')}</p></li>
      <li><span aria-hidden="true">iii.</span><p>${em('What happens behind the curtain *stays there.*')}</p></li>
    </ol>
  </aside>
</section>

<section class="section band-sand">
  <div class="wrap split split--5-7">
    <div class="split__media">${figure('photos/fabric-rolls', { ratio: '45', caption: 'The materials of the trade.', sizes: '(min-width: 1024px) 36vw, 100vw' })}</div>
    <div class="split__text">
      <p class="kicker">The studio</p>
      <h2 class="h2" data-reveal="lines">${em('Small *on purpose.*')}</h2>
      <p>Curtain is founder-led and early. We work from a demo shop with made-up products, and with our first pilot shop in Australia. We'll grow when the pilot tells us what to build next, not before.</p>
      <p>Want to talk shop, sizes or partnerships? ${textLink('/waitlist/', 'Get in touch')}</p>
    </div>
  </div>
</section>
${closingCta()}
`,
};
