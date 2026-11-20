import { em, html } from '../lib/html.ts';
import { chapter, ESTIMATE_CAPTION, figure, partnerLogo, textLink } from '../lib/components.ts';
import { closingCta } from '../lib/blocks.ts';
import { PartnerName, partnerName, site } from '../data/site.ts';
import { type Page } from './types.ts';

/**
 * The pilot shop. Their name, logo, product photos and our 3D estimates of their garments are shown with
 * their permission (site.partner.permissionSource). There is no quote from them: we only ever print one they wrote.
 */
export const pilot: Page = {
  meta: {
    path: '/pilot/',
    title: `Our pilot partner, ${PartnerName} — Curtain`,
    description: `Our first shop is ${site.partner.showName ? `${partnerName}, a boho label from Australia` : partnerName}. What the pilot covers, where it stands, and their garments as 3D estimates in our demo.`,
    preload: { id: 'partner/azure-arms', widths: [600, 800], sizes: '(min-width: 1024px) 34vw, 100vw' },
  },
  body: () => html`
<section class="page-hero wrap split split--7-5">
  ${chapter({ level: 1, kicker: 'Our pilot partner', title: `Our first shop: *${partnerName}.*`, standfirst: 'A boho label from Australia, and the first shop to take Curtain from our demo store to a real one.' })}
  <div class="page-hero__aside">${figure('partner/azure-arms', { ratio: '23', caption: 'The Azure Palm Baby Doll Dress, one of the first garments in the pilot.', eager: true, sizes: '(min-width: 1024px) 34vw, 100vw', reveal: false })}</div>
</section>

<section class="section wrap split split--5-7">
  <div class="split__text">
    ${site.partner.showName ? html`<div class="partner-mark">${partnerLogo()}</div>` : ''}
    <p class="kicker">The partner</p>
    <h2 class="h2" data-reveal="lines">${em('Flowing dresses, *soft fabrics.*')}</h2>
    <p class="lead">${site.partner.showName ? html`${partnerName} is a boho label from Australia, selling online at <a href="${site.partner.url}" rel="noopener">bohohippychic.com.au</a>.` : html`${PartnerName}, selling online in Australia.`}</p>
    <p>Flowing dresses, maxis, wide palazzo legs and soft knits are exactly where a size table says least about the fit. If Curtain helps there, it helps everywhere.</p>
    <p class="status-line"><span class="tag tag--pill">Status</span> ${site.partner.status}</p>
  </div>
  <div class="pilot-moods">
    ${figure('partner/skirt-front', { ratio: '23', caption: 'The Crimson Wildflower Maxi Skirt.', sizes: '(min-width: 1024px) 26vw, 100vw' })}
    ${figure('partner/palazzo-knit', { ratio: '23', caption: 'The Rosewater Palazzo Pants.', sizes: '(min-width: 1024px) 26vw, 100vw' })}
  </div>
</section>

<section class="section band-sand" aria-labelledby="estimate-h">
  <div class="wrap">
    <div class="section-head"><div><p class="kicker">In our demo · not on their store</p><h2 class="h2" id="estimate-h" data-reveal="lines">${em('Their photos, *our estimate.*')}</h2></div></div>
    <p class="lead section-lead">From ${partnerName}'s ordinary product photos, our garment engine builds a 3D estimate of the garment and drapes it at each size. Left: their photo. Right: our estimate in AU size 12 on the standard mannequin.</p>
    <div class="pair-grid">
      <div class="pair">
        ${figure('partner/azure-front', { ratio: '23', caption: 'Their photo: the Azure Palm Baby Doll Dress.', sizes: '(min-width: 1024px) 22vw, 50vw' })}
        ${figure('renders/azure-estimate', { ratio: '23', caption: `Our estimate, size 12. ${ESTIMATE_CAPTION}`, sizes: '(min-width: 1024px) 22vw, 50vw' })}
      </div>
      <div class="pair">
        ${figure('partner/skirt-side', { ratio: '23', caption: 'Their photo: the Crimson Wildflower Maxi Skirt.', sizes: '(min-width: 1024px) 22vw, 50vw' })}
        ${figure('renders/skirt-estimate', { ratio: '23', caption: `Our estimate, size 12. ${ESTIMATE_CAPTION}`, sizes: '(min-width: 1024px) 22vw, 50vw' })}
      </div>
    </div>
    <p class="micro pair-note">Demo only. ${partnerName} has given us permission to show their name, logo, product photos and the 3D estimates made from them on this website and in demos. On their own store the 3D view stays switched off: it goes live only once the screen where a shop approves each garment is built, and they have approved that piece there. The size advice never comes from the picture.</p>
  </div>
</section>

<section class="section wrap">
  <div class="section-head"><div><p class="kicker">What the pilot covers</p><h2 class="h2" data-reveal="lines">${em('Three things, *in this order.*')}</h2></div></div>
  <ol class="cover-list">
    <li><span class="cover-list__n" aria-hidden="true">01</span><div><h3 class="h3">Size advice on their garments</h3><p>Australian sizes 8 to 16, in AUD, from their own size chart.</p></div></li>
    <li><span class="cover-list__n" aria-hidden="true">02</span><div><h3 class="h3">A private Shopify install</h3><p>Before Curtain is listed publicly in the Shopify App Store.</p></div></li>
    <li><span class="cover-list__n" aria-hidden="true">03</span><div><h3 class="h3">Later: 3D on their store</h3><p>Today their garments appear in 3D only in our demo and on this site. On their store it stays off until the approval screen is finished and they approve each garment in it.</p></div></li>
  </ol>
  <p class="center-link">${textLink('/waitlist/', 'Join the next group of shops')}</p>
</section>
${closingCta('Be in the *next group* of shops.')}
`,
};
