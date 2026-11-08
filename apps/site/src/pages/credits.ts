import { html } from '../lib/html.ts';
import { chapter, picture } from '../lib/components.ts';
import { images } from '../data/images.ts';
import { type Page } from './types.ts';

export const credits: Page = {
  meta: {
    path: '/credits/',
    title: 'Image credits — Curtain',
    description: 'Every photo on curtain.fit with its photographer, source and licence. Product screens come from our own demo shop.',
  },
  body: () => {
    const all = Object.values(images);
    const photos = all.filter((i) => i.kind === 'photo');
    const own = all.filter((i) => i.kind !== 'photo');
    return html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'Colophon', title: 'Image *credits.*', standfirst: 'Photography on this site is used under the CC0 public-domain dedication and hosted by us. Product screens come from our own demo store, with made-up products.' })}
</section>
<section class="section section--tight wrap">
  <h2 class="h2">Photography</h2>
  <p class="micro">All photos come from the WordPress Photo Directory under CC0 1.0, retrieved November 2026, and are self-hosted. CC0 waives copyright; it does not cover model releases, so we chose pictures where people are seen from behind or cropped. No image on this site comes from a shop.</p>
  <ol class="credits">${photos.map(
    (i) => html`<li class="credits__item" id="${i.id.replace('/', '-')}">
      <div class="credits__thumb">${picture(i.id, { sizes: '160px' })}</div>
      <div><p class="credits__title">“${i.sourceTitle ?? ''}”</p><p>Photo by ${i.credit} · <a href="${i.creditUrl ?? '#'}" rel="noopener">source</a> · <a href="${i.licenseUrl ?? '#'}" rel="noopener license">${i.license ?? ''}</a></p></div>
    </li>`,
  )}</ol>
  <h2 class="h2 credits__h2">Product screens and renders</h2>
  <p class="micro">Our own screenshots of the Curtain demo shop (a fictional label, “Aalter Studio”) and our own renders of synthetic test garments. Every 3D picture is an estimate and is labelled as one.</p>
  <ol class="credits credits--own">${own.map(
    (i) => html`<li class="credits__item"><div class="credits__thumb">${picture(i.id, { sizes: '160px' })}</div><div><p class="credits__title">${i.alt}</p><p>${i.credit}${i.estimate ? ' · labelled estimate' : ''}</p></div></li>`,
  )}</ol>
  <h2 class="h2 credits__h2">Type</h2>
  <p>Fraunces and Inter, both under the SIL Open Font Licence, self-hosted from the Fontsource packages.</p>
</section>
`;
  },
};
