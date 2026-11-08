import { em, html } from '../lib/html.ts';
import { button, chapter, device, ESTIMATE_CAPTION, faqList, figure, lookbook, marquee, picture, placeholderFrame, tapeDivider, textLink } from '../lib/components.ts';
import { closingCta, journalTeaser, ledger } from '../lib/blocks.ts';
import { faq } from '../data/content.ts';
import { site } from '../data/site.ts';
import { type Page } from './types.ts';

export const home: Page = {
  meta: {
    path: '/',
    title: 'Curtain — your private fitting room for fashion shops',
    description:
      'Curtain gives your shoppers a size they can trust, right on your product page. Size advice from your own charts, measurements kept on their device. For Shopify and WooCommerce.',
    preload: { id: 'photos/maxi-dress-corridor', width: 1350 },
    bodyClass: 'is-home',
  },
  body: () => html`
<section class="hero" aria-labelledby="hero-h">
  <div class="hero__grid wrap">
    <p class="kicker hero__kicker"><span>Your private fitting room</span><span class="hero__issue">${site.issue}</span></p>
    <h1 class="display-xxl hero__title" id="hero-h" data-reveal="lines"><span class="line">The right size,</span> <span class="line"><em>behind the curtain.</em></span></h1>
    <div class="hero__media" data-reveal="img">
      <div class="hero__photo ratio-23">${picture('photos/maxi-dress-corridor', { eager: true, sizes: '(min-width: 1024px) 40vw, 100vw', pos: '50% 40%' })}</div>
      <p class="hero__photo-cap">Photo: Alina Kakshapati, CC0</p>
      <div class="hero__phone">
        <div class="phone"><div class="phone__screen">${picture('product/mobile-05-size-result', { sizes: '(min-width: 1024px) 240px, 46vw', eager: true })}</div></div>
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
  <div class="asym__big">${figure('photos/fitting-rooms', { ratio: '45', caption: 'The fitting room: two sizes, one curtain, a decision in a minute.', sizes: '(min-width: 1024px) 55vw, 100vw' })}</div>
  <div class="asym__text">
    <p class="kicker">The problem</p>
    <h2 class="h2" id="intro-h" data-reveal="lines">${em('Shopping for clothes online is a *guess.*')}</h2>
    <p class="lead dropcap">In a shop, you pull the curtain, try two sizes and walk out with the one that fits. Online, your customers stand in front of a size table, guess, and sometimes order two sizes to be safe.</p>
    <p>Curtain brings the fitting room back to your product page, quietly, in under thirty seconds.</p>
    ${textLink('/why/', 'Read why we started')}
  </div>
  <div class="asym__small">${figure('photos/knits-pampas-rail', { ratio: '34', caption: 'Knits, linen, soft shapes: where a size table says least.', sizes: '(min-width: 1024px) 30vw, 80vw', pos: '62% 50%' })}</div>
</section>

${marquee(['Size advice on the device', 'No photos leave the phone', '3D is an estimate, always labelled', `$${site.price.amount} / month`, 'Shopify & WooCommerce'])}

<section class="section wrap" aria-labelledby="how-h">
  ${chapter({ num: '01', kicker: 'How it works', title: 'Three taps, one *size.*', standfirst: 'For your shopper it takes under thirty seconds. For you it is a block in your theme.', id: 'how-h' })}
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
      ${chapter({ num: '02', kicker: 'In pilot · 3D estimate', title: 'See the dress *drape*, at the size we picked.', id: 'threed-h' })}
      <p>For pieces you approve, Curtain can show a 3D estimate of the garment on a figure shaped by your shopper's own measurements, draped right on their phone. Built from your own product photos by our garment engine.</p>
      <p><strong>Always labelled an estimate, because it is one.</strong> The size itself comes from the size advice, never from the picture.</p>
      ${textLink('/3d/', 'How the 3D estimate is made')}
    </div>
    <div class="split__media threed">
      ${device('product/desktop-09-3d-estimate-viewer', { device: 'bare', caption: `3D estimate · size XL, demo shop. ${ESTIMATE_CAPTION}`, sizes: '(min-width: 1024px) 26vw, 70vw', cls: 'threed__viewer' })}
      ${figure('renders/engine-dress-sizes-side', { ratio: 'auto', caption: `One synthetic dress graded to S, M and L. ${ESTIMATE_CAPTION}`, sizes: '(min-width: 1024px) 34vw, 100vw', figCls: 'threed__sizes' })}
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
      <li><strong>Approve 3D (optional).</strong> Nothing goes live until you approve it.</li>
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
    ${placeholderFrame('Partner imagery — awaiting Bohohippychic approval', 'Their photo goes here only with their written approval (DECISIONS D13). No logo, product photos or textures until then.', '45')}
    <div class="pilot-teaser__mood">${figure('photos/shell-straw-hat', { ratio: '11', caption: 'Mood only. Not a Bohohippychic product.', sizes: '(min-width: 1024px) 22vw, 60vw' })}</div>
  </div>
  <div class="split__text">
    ${chapter({ num: '05', kicker: 'Our pilot partner', title: 'Piloting with *Bohohippychic.*', id: 'pilot-h', stack: true })}
    <p class="lead">Our first shop is ${site.partner.name}, a boho label from Australia. We're setting Curtain up with their AU sizes 8 to 16 before anyone else gets it.</p>
    <p class="micro">Status: ${site.partner.status}</p>
    ${textLink('/pilot/', 'About the pilot')}
  </div>
</section>

${lookbook(
  'Fit stories',
  [
    { id: 'photos/maxi-dress-balcony', title: 'The maxi', text: 'Length and drape matter more than a bust number.' },
    { id: 'photos/leopard-dress-path', title: 'The printed mini', text: 'Short and swingy: the hip decides.' },
    { id: 'photos/beach-dress-walk', title: 'The summer dress', text: 'Relaxed or regular? The shopper says.', pos: '12% 50%' },
    { id: 'photos/editorial-barrel', title: 'The short skirt', text: 'Waist first, then length.', pos: '72% 50%' },
    { id: 'photos/colour-rail', title: 'The rail', text: 'Forty prints, one size question.' },
    { id: 'photos/minimal-rail', title: 'The basics', text: 'Even a tee has a fit preference.' },
  ],
  { kicker: 'Moodboard', title: 'Fit *stories.*' },
)}

<section class="section wrap pricing-teaser" aria-labelledby="price-h">
  ${tapeDivider()}
  <div class="pricing-teaser__grid">
    <div>
      <p class="kicker">06 · Pricing</p>
      <h2 class="display-l" id="price-h" data-reveal="lines">One plan. <em>USD&nbsp;${site.price.amount}</em> a month.</h2>
    </div>
    <div class="pricing-teaser__text">
      <p class="lead">Per shop. Unlimited products, every chart template, no fee per try-on.</p>
      <div class="btn-row">${button('/pricing/', 'Pricing', 'secondary')}</div>
    </div>
  </div>
</section>

<section class="section wrap split split--4-8" aria-labelledby="faq-h">
  <div class="split__text">
    ${chapter({ num: '07', kicker: 'FAQ', title: 'Good *questions.*', id: 'faq-h', stack: true })}
    ${textLink('/faq/', 'All questions')}
  </div>
  <div>${faqList(faq.slice(0, 6))}</div>
</section>

${journalTeaser()}
${closingCta()}
`,
};
