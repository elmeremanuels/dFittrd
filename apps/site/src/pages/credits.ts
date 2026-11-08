import { html } from '../lib/html.ts';
import { chapter, picture } from '../lib/components.ts';
import { images, PARTNER_CREDIT } from '../data/images.ts';
import { site } from '../data/site.ts';
import { type Page } from './types.ts';

/** The view a Bohohippychic photo shows, from the suffix of its id (partner/<product>-<view>). */
const views: Record<string, string> = { front: 'front', arms: 'front, arms raised', back: 'back', side: 'side', knit: 'front, styled with a knit', wide: 'detail, wide leg' };

export const credits: Page = {
  meta: {
    path: '/credits/',
    title: 'Image credits — Curtain',
    description: 'Every image on curtain.fit with its source: Bohohippychic photos used with permission, CC0 photography, our demo-shop screens and our 3D estimates.',
  },
  body: () => {
    const all = Object.values(images);
    const photos = all.filter((i) => i.kind === 'photo');
    const partner = all.filter((i) => i.partnerDerived);
    const own = all.filter((i) => (i.kind === 'screen' || i.kind === 'render') && !i.partnerDerived);
    return html`
<section class="page-hero wrap">
  ${chapter({ level: 1, kicker: 'Colophon', title: 'Image *credits.*', standfirst: 'Product photography and the logo of our pilot shop are courtesy of Bohohippychic, used with permission. The other photos are CC0 and hosted by us. Product screens come from our own demo store, with made-up products.' })}
</section>
<section class="section section--tight wrap">
  <h2 class="h2" id="bohohippychic">${site.partner.name}</h2>
  <p class="micro">Product photos and logo: courtesy of ${site.partner.name}, used with permission. ${site.partner.name} has given permission to use its name, logo, product photos and the 3D estimates made from them on this website and in demos. The photos are shown as published on their shop, resized for the web, without retouching. The 3D estimates are made by our garment engine from those photos; they are estimates, not photos, and are labelled as such.</p>
  <ol class="credits">${partner.map(
    (i) => html`<li class="credits__item" id="${i.anchor}">
      <div class="credits__thumb">${picture(i.id, { sizes: '160px' })}</div>
      <div><p class="credits__title">${i.sourceTitle ? html`“${i.sourceTitle}”` : i.kind === 'partner' ? 'Logo' : ''}${i.estimate ? ' · 3D estimate' : i.sourceTitle ? ` · ${views[i.id.split('-').slice(1).join('-')] ?? 'photo'}` : ''}</p><p>${i.kind === 'render' ? html`${i.credit}. ` : ''}${PARTNER_CREDIT}${i.creditUrl ? html` · <a href="${i.creditUrl}" rel="noopener">product page</a>` : ''}${i.estimate ? ' · labelled estimate' : ''}</p></div>
    </li>`,
  )}</ol>
  <h2 class="h2 credits__h2">Photography</h2>
  <p class="micro">These photos come from the WordPress Photo Directory under CC0 1.0, retrieved November 2026, and are self-hosted. CC0 waives copyright; it does not cover model releases, so we chose pictures where people are seen from behind or cropped. Every photo gets the same light colour grade and crop for the site.</p>
  <ol class="credits">${photos.map(
    (i) => html`<li class="credits__item" id="${i.anchor}">
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
