import { em, html } from '../lib/html.ts';
import { chapter, figure, placeholderFrame, textLink } from '../lib/components.ts';
import { closingCta } from '../lib/blocks.ts';
import { site } from '../data/site.ts';
import { type Page } from './types.ts';

export const pilot: Page = {
  meta: {
    path: '/pilot/',
    title: 'Our pilot partner, Bohohippychic — Curtain',
    description: 'Our first shop is Bohohippychic, a boho label from Australia. What the pilot covers and where it stands.',
  },
  body: () => html`
<section class="page-hero wrap split split--7-5">
  ${chapter({ level: 1, kicker: 'Our pilot partner', title: 'Our first shop: *Bohohippychic.*', standfirst: 'A boho label from Australia, and the first shop to take Curtain from our demo store to a real one.' })}
  <div class="page-hero__aside">${placeholderFrame('Partner hero image — awaiting Bohohippychic approval', 'Reserved for an image from Bohohippychic, shown only with their written approval (DECISIONS D13). We show no logo, product photo or texture of theirs until then.', '45')}</div>
</section>

<section class="section wrap split split--5-7">
  <div class="split__text">
    <p class="kicker">The partner</p>
    <h2 class="h2" data-reveal="lines">${em('Flowing dresses, *soft fabrics.*')}</h2>
    <p class="lead">${site.partner.name} is a boho label from Australia, selling online at <a href="${site.partner.url}" rel="noopener">bohohippychic.com.au</a>.</p>
    <p>Flowing dresses, maxis and soft fabrics are exactly where a size table says least about the fit. If Curtain helps there, it helps everywhere.</p>
    <p class="status-line"><span class="tag tag--pill">Status</span> ${site.partner.status}</p>
  </div>
  <div class="pilot-moods">
    ${figure('photos/maxi-dress-balcony', { ratio: '23', caption: 'Mood: the maxi. Not a Bohohippychic product.', sizes: '(min-width: 1024px) 26vw, 50vw' })}
    ${figure('photos/shell-straw-hat', { ratio: '34', caption: 'Mood: boho texture. Not a Bohohippychic product.', sizes: '(min-width: 1024px) 26vw, 50vw' })}
  </div>
</section>

<section class="section band-sand">
  <div class="wrap">
    <div class="section-head"><div><p class="kicker">What the pilot covers</p><h2 class="h2" data-reveal="lines">${em('Three things, *in this order.*')}</h2></div></div>
    <ol class="cover-list">
      <li><span class="cover-list__n" aria-hidden="true">01</span><div><h3 class="h3">Size advice on their dresses</h3><p>Australian sizes 8 to 16, in AUD, from their own size chart.</p></div></li>
      <li><span class="cover-list__n" aria-hidden="true">02</span><div><h3 class="h3">A private Shopify install</h3><p>Before Curtain is listed publicly in the Shopify App Store.</p></div></li>
      <li><span class="cover-list__n" aria-hidden="true">03</span><div><h3 class="h3">The first real tests of our garment engine</h3><p>With their consent, we used a few of their public product photos to test the engine internally. Nothing from that test is shown to shoppers or on this site without their approval.</p></div></li>
    </ol>
  </div>
</section>

<section class="section wrap">
  <div class="section-head"><div><p class="kicker">Reserved</p><h2 class="h2" data-reveal="lines">${em('Space for *their* story.')}</h2></div></div>
  <div class="placeholder-row">
    ${placeholderFrame('Logo', 'Only after their written OK.', '169')}
    ${placeholderFrame('A quote, in their words', 'Only a real quote they sign off. We never invent one.', '169')}
    ${placeholderFrame('A 3D estimate of their garment', 'Only after they approve it, labelled as an estimate.', '169')}
  </div>
  <p class="center-link">${textLink('/waitlist/', 'Join the next group of shops')}</p>
</section>
${closingCta()}
`,
};
