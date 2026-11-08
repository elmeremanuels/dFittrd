import { em, html, type SafeHtml } from '../lib/html.ts';
import { chapter, DEMO_NOTE, device, ESTIMATE_CAPTION_VIEWER, marginNote, nextFig, picture, textLink } from '../lib/components.ts';
import { closingCta } from '../lib/blocks.ts';
import { type Page } from './types.ts';

function row(n: string, title: string, body: SafeHtml, media: SafeHtml, flip = false): SafeHtml {
  return html`<li class="walk${flip ? ' walk--flip' : ''}">
  <div class="walk__text">
    <p class="walk__n" aria-hidden="true">${n}</p>
    <h3 class="h3">${title}</h3>
    ${body}
  </div>
  <div class="walk__media">${media}</div>
</li>`;
}

/** A size chart set in type, in the style of our AU template: the merchant's charts are the source of truth. */
function sizeChartCard(): SafeHtml {
  const rows: [string, number, number, number][] = [
    ['8', 82, 66, 90],
    ['10', 87, 71, 95],
    ['12', 92, 76, 100],
    ['14', 97, 81, 105],
    ['16', 102, 86, 110],
  ];
  return html`<figure class="chart-card" data-reveal="fade">
  <div class="chart-card__sheet">
    <p class="chart-card__head"><span>Women · body chart</span><span>AU · cm</span></p>
    <table class="chart-card__table">
      <caption class="visually-hidden">Example AU women's body chart in centimetres</caption>
      <thead><tr><th scope="col">Size</th><th scope="col">Bust</th><th scope="col">Waist</th><th scope="col">Hip</th></tr></thead>
      <tbody>${rows.map(([sz, b, w, h]) => html`<tr${sz === '12' ? html` class="is-hit"` : ''}><th scope="row">${sz}</th><td>${b}</td><td>${w}</td><td>${h}</td></tr>`)}</tbody>
    </table>
    <p class="chart-card__foot"><span>Describes</span> the body a size fits · ease set per garment</p>
  </div>
  <figcaption class="fig__cap"><span class="fig__no">Fig. ${nextFig()}</span> A size chart set in type, with example numbers (not a real brand's chart). Your own chart is the source of truth; we read it, we never invent one.</figcaption>
</figure>`;
}

export const how: Page = {
  meta: {
    path: '/how-it-works/',
    title: 'How it works — Curtain',
    description: 'Two sides, one fitting room: your shopper gets a size from your own chart in a few taps, you add one block to your theme.',
  },
  body: () => html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'How it works', title: 'How Curtain *works.*', standfirst: 'Two sides, one fitting room: your shopper gets a size, you get fewer guesses on your product page.' })}
  <nav class="tabs" aria-label="On this page"><a href="#shoppers">For your shoppers</a><a href="#team">For your team</a><a href="#works-with">Works with</a></nav>
</section>

<section class="section wrap" id="shoppers" aria-labelledby="shoppers-h">
  <div class="section-head"><div><p class="kicker">Part one</p><h2 class="h2" id="shoppers-h" data-reveal="lines">${em('For your *shoppers.*')}</h2></div><p class="micro">${DEMO_NOTE}</p></div>
  <ol class="walks">
    ${row(
      '01',
      'Tap “Try it on”.',
      html`<p>The button sits under your size picker. It opens an overlay on your own page, on desktop and mobile. No app, no account.</p>`,
      device('product/desktop-02-product-form', { device: 'browser', caption: 'The product form, with the button under the size picker.', url: 'demo shop · product page' }),
    )}
    ${row(
      '02',
      'About you, in a few taps.',
      html`<p>Height, weight and fit preference: snug, regular or relaxed. Metric or imperial. Shoppers who know their bust, waist and hips can add them, and say whether they used a tape.</p><p>An optional camera scan can estimate measurements instead. It runs entirely in the browser; the camera frames are never stored or uploaded.</p>`,
      device('product/mobile-04-about-you-filled', { device: 'phone', caption: 'The “About you” step.' }),
      true,
    )}
    ${row(
      '03',
      'A size, and why.',
      html`<p>Curtain recommends a size from your size chart. It shows how that size fits at bust, waist and hips, how confident it is, and your own size table with that size highlighted. Shoppers can flip to the size either side and see the difference.</p><p>When they only give height and weight, the confidence says so honestly.</p>${marginNote(html`The small figure on the result screen is an estimate too, and is labelled as one.`)}`,
      device('product/desktop-05-size-result-dialog', { device: 'bare', caption: 'The result: a size, a fit score, the fit per point.' }),
    )}
    ${row(
      '04',
      'Choose the size.',
      html`<p>One tap selects the size in your product form and closes the overlay. Add to cart is your button, your checkout, your customer.</p>`,
      device('product/mobile-06-size-selected', { device: 'phone', caption: 'Size L is now selected on the page.', pos: '50% 0%' }),
      true,
    )}
    ${row(
      '05',
      'Back next time.',
      html`<p>With “Remember me on this shop” on, a returning shopper sees their size right next to the button before they even tap. “Forget me” deletes it all in one go.</p>`,
      device('product/desktop-07-size-peek-crop', { device: 'bare', caption: 'The size peek. Only the shopper can see it; the shop can’t.' }),
    )}
  </ol>
  <aside class="note-band">
    <div class="note-band__img">${picture('renders/engine-dress-S-col', { sizes: '200px', alt: 'A synthetic test dress on our standard mannequin.' })}<span class="tag tag--estimate">Estimate</span></div>
    <div class="note-band__text">
      <p class="kicker">Optional · In development · demo only</p>
      <p class="h3">${em('See it in 3D — an *estimate*.')}</p>
      <p>In our demo shop, shoppers can open a 3D estimate at their recommended size. At real shops it comes once the approval screen is finished, and only for pieces you approve. ${ESTIMATE_CAPTION_VIEWER}</p>
      ${textLink('/3d/', 'The 3D estimate')}
    </div>
  </aside>
</section>

<section class="section band-sand" id="team" aria-labelledby="team-h">
  <div class="wrap">
    <div class="section-head"><div><p class="kicker">Part two</p><h2 class="h2" id="team-h" data-reveal="lines">${em('For your *team.*')}</h2></div></div>
    <div class="split split--5-7">
      <div class="split__media">${sizeChartCard()}</div>
      <ol class="team-steps">
        <li><p class="team-steps__n" aria-hidden="true">01</p><h3 class="h3">Install.</h3>
          <p><strong>Shopify:</strong> install the app and add the “Try it on” block in the theme editor, under the size picker.</p>
          <p><strong>WooCommerce:</strong> upload the plugin, press Connect, done.</p>
          <p class="micro">During the pilot, Shopify installs go through a private install link. A public App Store listing follows.</p></li>
        <li><p class="team-steps__n" aria-hidden="true">02</p><h3 class="h3">Your size charts.</h3>
          <p>Start from a sourced women's body chart template (AU, UK, EU or US) or from a garment template, in cm or inches. Assign it to whole collections, tags or product types at once.</p>
          <p>Each chart says whether its numbers describe the body a size fits or the finished garment, so ease is never guessed. A product can take sizes as soon as it has a chart.</p></li>
        <li><p class="team-steps__n" aria-hidden="true">03</p><h3 class="h3">Approve your 3D pieces <span class="tag tag--pill">Optional · coming</span></h3>
          <p>Our garment engine builds a garment from your front and back product photos. Nothing goes live until you approve it. The approval screen is still being built, so 3D stays off at real shops for now. If you later change your size chart so that a size isn't covered, the 3D button simply hides.</p></li>
        <li><p class="team-steps__n" aria-hidden="true">04</p><h3 class="h3">See what's happening.</h3>
          <p>Your dashboard shows totals: how many shoppers used Curtain, which sizes were recommended, and which products were opened without a result. You never see a measurement or a person, and a total only shows once a group is large enough that nobody can be singled out.</p></li>
      </ol>
    </div>
  </div>
</section>

<section class="section wrap" id="works-with" aria-labelledby="works-h">
  <div class="section-head"><div><p class="kicker">Compatibility</p><h2 class="h2" id="works-h" data-reveal="lines">${em('Works *with.*')}</h2></div></div>
  <dl class="spec">
    <div><dt>Shopify</dt><dd>A theme app block, tested on a Dawn-style theme in our demo store. Not yet run on a live store.</dd></div>
    <div><dt>WooCommerce</dt><dd>A WordPress plugin, with the button under the variation form.</dd></div>
    <div><dt>Templates</dt><dd>Women's body charts for AU, UK, EU and US. Men's, kids' and other categories need your own chart for now.</dd></div>
    <div><dt>Shopper language</dt><dd>English, with Dutch available.</dd></div>
  </dl>
</section>
${closingCta('Want it on your *product pages?*')}
`,
};
