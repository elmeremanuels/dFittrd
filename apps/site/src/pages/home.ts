import { em, html } from '../lib/html.ts';
import { button, chapter, DEMO_NOTE, device, ESTIMATE_CAPTION, ESTIMATE_CAPTION_VIEWER, faqList, figure, lookbook, marquee, picture, placeholderFrame, textLink } from '../lib/components.ts';
import { closingCta, journalTeaser, ledger } from '../lib/blocks.ts';
import { faq } from '../data/content.ts';
import { partnerName, site } from '../data/site.ts';
import { type Page } from './types.ts';

export const home: Page = {
  meta: {
    path: '/',
    title: 'Curtain — your private fitting room for fashion shops',
    description:
      'Curtain gives your shoppers a size they can trust, right on your product page. Size advice from your own charts, measurements kept on their device. For Shopify and WooCommerce.',
    preload: { id: 'photos/editorial-black-beige-1-portrait', widths: [600, 910], sizes: '(min-width: 1024px) 40vw, 100vw' },
    bodyClass: 'is-home',
  },
  body: () => html`
<section class="hero" aria-labelledby="hero-h">
  <div class="hero__grid wrap">
    <p class="kicker hero__kicker"><span class="hero__tagline">Your private fitting room</span><span class="hero__issue">${site.issue}</span></p>
    <h1 class="display-xxl hero__title" id="hero-h" data-reveal="lines"><span class="line">The right size,</span> <span class="line"><em>behind the curtain.</em></span></h1>
    <div class="hero__media" data-reveal="img">
      <div class="hero__photo ratio-23">${picture('photos/editorial-black-beige-1-portrait', { eager: true, sizes: '(min-width: 1024px) 40vw, 100vw' })}</div>
      <p class="hero__photo-cap">Photo: <a href="/credits/#photos-editorial-black-beige-1">Guste Cibulskyte</a>, CC0</p>
      <div class="hero__phone">
        <div class="phone"><div class="phone__screen">${picture('product/mobile-05-size-result', { sizes: '(min-width: 1024px) 220px, 120px', eager: true, alt: 'The Curtain result on a phone: We recommend L, fit score 69%.' })}</div></div>
        <span class="tag tag--estimate">Estimate</span>
      </div>
    </div>
    <div class="hero__copy">
      <p class="standfirst">Curtain adds a <em>Try it on</em> button to your product pages. Shoppers answer three quick questions and get a size from your own size chart, with the fit at bust, waist and hips. Their measurements never leave their phone.</p>
      <div class="btn-row">${button('/waitlist/', 'Join the waitlist')}${button('/how-it-works/', 'See how it works', 'secondary')}</div>
      <p class="micro">For Shopify and WooCommerce · USD ${site.price.amount} a month per shop · Now in pilot</p>
      <nav class="hero__index" aria-label="In this issue">
        <p class="kicker">In this issue</p>
        <ol>
          <li><a href="#how-h"><span>01</span> How it works</a></li>
          <li><a href="#threed-h"><span>02</span> The 3D estimate</a></li>
          <li><a href="#merchants-h"><span>03</span> For your team</a></li>
          <li><a href="#privacy-h"><span>04</span> Privacy &amp; trust</a></li>
          <li><a href="#pilot-h"><span>05</span> Our pilot partner</a></li>
        </ol>
      </nav>
    </div>
  </div>
  <div class="caption-strip"><div class="wrap"><span>${site.issue}</span><span>Pilot stage</span><span>Shopify &amp; WooCommerce</span><span>Size advice on the device</span></div></div>
</section>

<section class="wrap triad" aria-label="Curtain in three lines">
  <ol>
    <li><span class="triad__n" aria-hidden="true">01</span><h2 class="triad__h">A size, not homework.</h2><p>No grid to decode. One answer, with the reasons.</p></li>
    <li><span class="triad__n" aria-hidden="true">02</span><h2 class="triad__h">From your charts.</h2><p>AU, UK, EU or US, in cm or inches.</p></li>
    <li><span class="triad__n" aria-hidden="true">03</span><h2 class="triad__h">Private by design.</h2><p>Measurements stay on the shopper's device.</p></li>
  </ol>
</section>

<section class="section wrap asym" aria-labelledby="intro-h">
  <div class="asym__big">${figure('photos/blazer-buttons', { ratio: '45', caption: 'The fitting-room moment: one button, one mirror, a decision in a minute.', sizes: '(min-width: 1024px) 55vw, 100vw', pos: '30% 50%' })}</div>
  <div class="asym__text">
    <p class="kicker">The problem</p>
    <h2 class="h2" id="intro-h" data-reveal="lines">${em('Shopping for clothes online is a *guess.*')}</h2>
    <p class="lead dropcap">Every clothes shop has a fitting room. You pull the curtain, try two sizes and walk out with the one that fits. Online, your customers stand in front of a size table, guess, and sometimes order two sizes to be safe.</p>
    <p>Curtain brings the fitting room back to your product page, quietly, in a few taps.</p>
    ${textLink('/why/', 'Read why we started')}
  </div>
  <div class="asym__small">${figure('photos/knits-pampas-rail', { ratio: '11', caption: 'Knits, linen, soft shapes: where a size table says least.', sizes: '(min-width: 1024px) 30vw, 80vw', pos: '62% 50%' })}</div>
</section>

${marquee(['Size advice on the device', 'No photos leave the phone', '3D is an estimate, always labelled', `$${site.price.amount} / month`, 'Shopify & WooCommerce'])}

<section class="section wrap" aria-labelledby="how-h">
  ${chapter({ num: '01', kicker: 'How it works', title: 'Three taps, one *size.*', standfirst: 'For your shopper it takes a few taps. For you it is a block in your theme.', id: 'how-h' })}
  <p class="micro section-note">${DEMO_NOTE}</p>
  <ol class="steps">
    <li class="step">
      ${device('product/mobile-02-product-page', { device: 'phone', caption: 'The button sits under your size picker.', pos: '50% 0%' })}
      <p class="step__n" aria-hidden="true">i.</p><h3 class="h3">Try it on</h3>
      <p>Your shopper taps the button. An overlay opens on your page, with nothing to install.</p>
    </li>
    <li class="step step--down">
      ${device('product/mobile-04-about-you-filled', { device: 'phone', caption: 'Height, weight, how they like things to fit.' })}
      <p class="step__n" aria-hidden="true">ii.</p><h3 class="h3">Get a size</h3>
      <p>Or their own measurements. Curtain answers with a size, the fit at each point and how confident it is.</p>
    </li>
    <li class="step">
      ${device('product/mobile-06-size-selected', { device: 'phone', caption: 'One tap selects the size in your product form.', pos: '50% 0%' })}
      <p class="step__n" aria-hidden="true">iii.</p><h3 class="h3">Choose it</h3>
      <p>The size is set in your form. Add to cart is still your button, your checkout, your customer.</p>
    </li>
  </ol>
  <p class="center-link">${textLink('/how-it-works/', 'The full walkthrough')}</p>
</section>

<section class="section band-sand" aria-labelledby="threed-h">
  <div class="wrap split split--5-7">
    <div class="split__text">
      ${chapter({ num: '02', kicker: 'In development · demo only', title: 'See the dress *drape*, at the size we picked.', id: 'threed-h' })}
      <p>In our demo shop, Curtain already shows a 3D estimate of a garment on a figure shaped by the shopper's own measurements, draped right on their phone. Our garment engine builds it from ordinary product photos.</p>
      <p>At real shops it stays switched off until the approval screen is finished: you'll approve every piece first.</p>
      <p><strong>Always labelled an estimate, because it is one.</strong> The size itself comes from the size advice, never from the picture.</p>
      ${textLink('/3d/', 'How the 3D estimate is made')}
    </div>
    <div class="split__media threed">
      ${figure('renders/engine-dress-M-portrait', { ratio: '23', caption: `A synthetic test dress, size M, from our garment engine. ${ESTIMATE_CAPTION}`, sizes: '(min-width: 1024px) 34vw, 100vw', figCls: 'threed__figure' })}
      ${device('product/desktop-09-3d-estimate-viewer', { device: 'bare', caption: `The viewer in our demo shop. ${ESTIMATE_CAPTION_VIEWER}`, sizes: '(min-width: 1024px) 22vw, 60vw', cls: 'threed__viewer' })}
    </div>
  </div>
</section>

<section class="section wrap asym asym--mirror" aria-labelledby="merchants-h">
  <div class="asym__big">${figure('photos/pattern-scissors', { ratio: '45', caption: 'Your size chart is the source of truth. We read it; we never invent one.', sizes: '(min-width: 1024px) 55vw, 100vw' })}</div>
  <div class="asym__text">
    ${chapter({ num: '03', kicker: 'For your team', title: 'Install, add your *charts*, done.', id: 'merchants-h' })}
    <ol class="mini-steps">
      <li><strong>Install.</strong> Shopify: add the “Try it on” block in the theme editor. WooCommerce: upload the plugin, press Connect.</li>
      <li><strong>Your size charts.</strong> Start from an AU, UK, EU or US template and assign it to whole collections at once.</li>
      <li><strong>Approve 3D (optional, coming).</strong> Nothing goes live until you approve it. The approval screen is being built, so 3D stays off at real shops for now.</li>
    </ol>
    ${textLink('/how-it-works/#team', 'For your team, step by step')}
  </div>
</section>

<section class="night section-night" aria-labelledby="privacy-h">
  <div class="wrap">
    ${chapter({ num: '04', kicker: 'Privacy & trust', title: 'What happens behind the curtain *stays there.*', standfirst: "Measurements and photos stay on your shopper's device. We don't ask their name or e-mail. You see totals, never a person.", id: 'privacy-h' })}
    ${ledger(true)}
    <p class="night__link">${textLink('/privacy-promise/', 'Exactly what we store')}</p>
  </div>
</section>

<section class="section wrap split split--7-5 pilot-teaser" aria-labelledby="pilot-h">
  <div class="split__media pilot-teaser__media">
    ${placeholderFrame('Partner imagery — awaiting approval', "Their photo goes here only with the shop's written approval (DECISIONS D13). No logo, product photos or textures until then.", '45')}
    <div class="pilot-teaser__mood">${figure('photos/shell-straw-hat', { ratio: '11', caption: 'Mood only. Not a product of our pilot shop.', sizes: '(min-width: 1024px) 22vw, 60vw' })}</div>
  </div>
  <div class="split__text">
    ${chapter({ num: '05', kicker: 'Our pilot partner', title: `Piloting with *${partnerName}.*`, id: 'pilot-h' })}
    <p class="lead">${site.partner.showName ? `Our first shop is ${partnerName}, a boho label from Australia.` : `Our first shop is ${partnerName}.`} We're setting Curtain up with their AU sizes 8 to 16 before anyone else gets it.</p>
    <p class="micro">Status: ${site.partner.status}</p>
    ${textLink('/pilot/', 'About the pilot')}
  </div>
</section>

${lookbook(
  'Fit stories',
  [
    { id: 'photos/maxi-dress-corridor', title: 'The maxi', text: 'Length and drape matter more than a bust number.', pos: '50% 60%' },
    { id: 'photos/editorial-barrel', title: 'The textured mini', text: 'Waist first, then length.', pos: '74% 50%' },
    { id: 'photos/beach-dress-walk', title: 'The summer dress', text: 'Relaxed or regular? The shopper says.', pos: '12% 50%' },
    { id: 'photos/editorial-black-beige-2', title: 'The sleeve', text: 'Shoulders and arms: the fit nobody can see on a size table.', pos: '62% 50%' },
    { id: 'photos/colour-rail', title: 'The rail', text: 'Forty prints, one size question.' },
    { id: 'photos/minimal-rail', title: 'The basics', text: 'Even a tee has a fit preference.' },
  ],
  { kicker: 'Moodboard', title: 'Fit *stories.*' },
)}

<section class="section wrap pricing-teaser" aria-labelledby="price-h">
  <div class="pricing-teaser__grid">
    ${chapter({ num: '06', kicker: 'Pricing', title: `One plan. *USD\u00a0${site.price.amount}* a month.`, id: 'price-h' })}
    <div class="pricing-teaser__text">
      <p class="lead">Per shop, flat.</p>
      <ul class="ticks ticks--compact">
        <li>Unlimited products</li>
        <li>Every chart template: AU, UK, EU and US</li>
        <li>No fee per try-on</li>
      </ul>
      ${textLink('/pricing/', 'See the plan')}
    </div>
  </div>
</section>

<section class="section wrap split split--4-8" aria-labelledby="faq-h">
  <div class="split__text">
    ${chapter({ num: '07', kicker: 'FAQ', title: 'Good *questions.*', id: 'faq-h' })}
    ${textLink('/faq/', 'All questions')}
  </div>
  <div>${faqList(faq.slice(0, 6))}</div>
</section>

${journalTeaser()}
${closingCta('Be one of the first brands *behind the curtain.*')}
`,
};
