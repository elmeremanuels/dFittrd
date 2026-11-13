import { em, html, type SafeHtml } from '../lib/html.ts';
import { chapter, device, ESTIMATE_CAPTION, ESTIMATE_CAPTION_VIEWER, estimateTag, figure, marginNote, nextFig, picture, textLink } from '../lib/components.ts';
import { closingCta } from '../lib/blocks.ts';
import { partnerName } from '../data/site.ts';
import { type Page } from './types.ts';

/** S, M and L as three separate crops, with the garment measurements as a real table instead of baked-in labels. */
function sizeLineup(): SafeHtml {
  const cols: [string, string, number, number, number, number][] = [
    ['S', 'renders/engine-dress-S-col', 38.5, 96, 80, 100],
    ['M', 'renders/engine-dress-M-col', 39.5, 100, 84, 104],
    ['L', 'renders/engine-dress-L-col', 40.5, 104, 88, 108],
  ];
  return html`<figure class="lineup" data-reveal="fade">
  <div class="lineup__cols">${cols.map(([sz, id]) => html`<div class="lineup__col"><div class="lineup__img">${picture(id, { sizes: '(min-width: 1024px) 300px, 33vw' })}</div><p class="lineup__size">${sz}</p></div>`)}${estimateTag()}</div>
  <div class="lineup__side">
  <table class="lineup__table">
    <caption class="visually-hidden">Garment measurements of the synthetic test dress per size, in centimetres</caption>
    <thead><tr><th scope="col">Garment, cm</th>${cols.map(([sz]) => html`<th scope="col">${sz}</th>`)}</tr></thead>
    <tbody>
      <tr><th scope="row">Shoulders</th>${cols.map((c) => html`<td>${c[2]}</td>`)}</tr>
      <tr><th scope="row">Chest</th>${cols.map((c) => html`<td>${c[3]}</td>`)}</tr>
      <tr><th scope="row">Waist</th>${cols.map((c) => html`<td>${c[4]}</td>`)}</tr>
      <tr><th scope="row">Hip</th>${cols.map((c) => html`<td>${c[5]}</td>`)}</tr>
    </tbody>
  </table>
  <figcaption class="fig__cap"><span class="fig__no">Fig. ${nextFig()}</span> One synthetic test dress, graded to S, M and L from the same numbers as the size advice. ${ESTIMATE_CAPTION}</figcaption>
  </div>
</figure>`;
}

export const threed: Page = {
  meta: {
    path: '/3d/',
    title: 'The 3D estimate — Curtain',
    description: 'How our garment engine turns your front and back product photos into a 3D estimate at the recommended size. Always labelled an estimate.',
  },
  body: () => html`
<section class="page-hero wrap split split--7-5">
  ${chapter({ level: 1, kicker: 'In development · demo only · not part of the plan', title: 'Your product photos, *in three dimensions.*', standfirst: 'An honest preview of how a garment hangs, at the size Curtain recommended. We call it an estimate, every time.' })}
  <div class="page-hero__aside">${figure('renders/azure-estimate-3q', { ratio: '23', caption: `The Azure Palm Baby Doll Dress, size 12, estimated from ${partnerName}'s product photos. ${ESTIMATE_CAPTION}`, eager: true, sizes: '(min-width: 1024px) 30vw, 90vw', reveal: false })}</div>
</section>

<section class="section wrap" aria-labelledby="engine-h">
  <div class="section-head"><div><p class="kicker">The engine, simply</p><h2 class="h2" id="engine-h" data-reveal="lines">${em('Five steps from photo to *drape.*')}</h2></div></div>
  <div class="diagram" aria-hidden="true">
    <svg viewBox="0 0 1200 160" role="presentation" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1">
      <rect x="20" y="30" width="80" height="100"/><rect x="120" y="30" width="80" height="100"/>
      <path d="M210 80 H330" stroke-dasharray="4 6"/><path d="M322 74 l10 6 -10 6"/>
      <ellipse cx="400" cy="38" rx="14" ry="16"/><path d="M386 56 q14 10 28 0 l12 70 h-52 z"/>
      <path d="M440 80 H560" stroke-dasharray="4 6"/><path d="M552 74 l10 6 -10 6"/>
      <path d="M600 40 q30 -12 60 0 l14 90 h-88 z"/><path d="M630 40 v90" stroke-dasharray="2 4"/>
      <path d="M700 80 H820" stroke-dasharray="4 6"/><path d="M812 74 l10 6 -10 6"/>
      <path d="M850 40 h60 v90 h-60 z"/><path d="M862 52 l12 12 24 -24"/>
      <path d="M930 80 H1050" stroke-dasharray="4 6"/><path d="M1042 74 l10 6 -10 6"/>
      <rect x="1080" y="20" width="64" height="124" rx="10"/><path d="M1098 60 q14 -8 28 0 l6 56 h-40 z"/>
    </g></svg>
    <ol class="diagram__labels"><li>Photos</li><li>Known mannequin</li><li>Graded garment</li><li>You approve</li><li>On their phone</li></ol>
  </div>
  <ol class="engine-steps">
    <li><span class="engine-steps__n" aria-hidden="true">1</span><h3 class="h3">Two photos in.</h3><p>You give us the front and back photo of a garment you already shoot for your shop. Detail shots help.</p></li>
    <li><span class="engine-steps__n" aria-hidden="true">2</span><h3 class="h3">A known mannequin.</h3><p>Our engine shows the garment on our own mannequin, with a known camera path and a known motion. Because we know every point of that mannequin, everything else in the frame is garment. Every ring of the mannequin — bust, waist, hip and more — is a place we can measure.</p></li>
    <li><span class="engine-steps__n" aria-hidden="true">3</span><h3 class="h3">A garment per size.</h3><p>The engine builds a 3D garment and grades it across every size in your size chart, so the 3D picture and the size advice come from the same numbers.</p></li>
    <li><span class="engine-steps__n" aria-hidden="true">4</span><h3 class="h3">You approve.</h3><p>You check that it is recognisably your garment. Until you approve, no shopper sees it.</p></li>
    <li><span class="engine-steps__n" aria-hidden="true">5</span><h3 class="h3">Draped on the shopper's phone.</h3><p>The garment is draped on a figure built from their own measurements, inside their browser. The garment file comes from our server; their measurements stay on their device.</p></li>
  </ol>
</section>

<section class="section band-sand" aria-labelledby="sizes-h">
  <div class="wrap">
    <div class="section-head"><div><p class="kicker">Graded, not guessed</p><h2 class="h2" id="sizes-h" data-reveal="lines">${em('One garment, *every size.*')}</h2></div></div>
    ${sizeLineup()}
    <p class="micro">The line-up shows a synthetic test garment made by us. The dress at the top of the page is our estimate of a garment from ${partnerName}, our pilot shop, made from their product photos and shown with their permission.</p>
  </div>
</section>

<section class="section wrap split split--7-5" aria-labelledby="why-est-h">
  <div class="split__text">
    <p class="kicker">Why “estimate”</p>
    <h2 class="display-l" id="why-est-h" data-reveal="lines">${em('A model, not a *photograph.*')}</h2>
    <p class="lead">A 3D view depends on your photos, your size chart and our modelling, and modelling can't be exact. So the label stays on: “3D estimate · size M”.</p>
    <p>The size itself always comes from the size advice, never from the picture.</p>
  </div>
  <div class="split__media">${device('product/desktop-09-3d-estimate-dialog', { device: 'bare', caption: `The label is part of the viewer, not an afterthought. ${ESTIMATE_CAPTION_VIEWER}`, sizes: '(min-width: 1024px) 36vw, 100vw' })}</div>
</section>

<section class="section wrap" aria-labelledby="status-h">
  <div class="section-head"><div><p class="kicker">Honest status</p><h2 class="h2" id="status-h" data-reveal="lines">${em('Where it *stands.*')}</h2></div></div>
  <ul class="status-list">
    <li><span class="tag tag--pill">Demo only</span><p>The 3D estimate works in our demo store today. At a real shop, including our pilot shop, it stays off until the approval screen and preview are finished.</p></li>
    <li><span class="tag tag--pill">Improving</span><p>Each garment goes through our engine one product at a time. We're still improving which garment types come out well; dresses are furthest along.</p></li>
    <li><span class="tag tag--pill">Needs</span><p>A phone or computer with WebGL2. Without it, the button doesn't appear and the size advice works as usual.</p></li>
    <li><span class="tag tag--pill">Price</span><p>Decided after the pilot. Not part of the USD 8.99 plan.</p></li>
  </ul>
  ${marginNote(html`Rights: a shop's garment is shown in 3D only with that shop's permission, and on its own store only after it approves that garment. ${textLink('/privacy-promise/', 'Privacy & trust')}`)}
</section>
${closingCta('Want your pieces *in 3D first?*')}
`,
};
