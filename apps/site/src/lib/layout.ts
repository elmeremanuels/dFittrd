import { attrs, html, raw, type SafeHtml } from './html.ts';
import { contents, primaryNav, site } from '../data/site.ts';
import { tapeDivider } from './components.ts';

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  /** Hero image to preload: an images.ts id, its widths and the exact `sizes` of its <picture>, so the browser fetches it once. */
  preload?: { id: string; widths: number[]; sizes: string };
  ogImage?: string;
  noindex?: boolean;
  bodyClass?: string;
}

export interface Assets {
  css: string;
  js: string;
  fonts: string[];
}

function wordmark(): SafeHtml {
  return html`<a class="wordmark" href="/" aria-label="Curtain, home"><span>curtain</span><span class="wordmark__tld">.fit</span></a>`;
}

function header(path: string): SafeHtml {
  return html`<div class="announce"><p>Pilot stage — now inviting Shopify and WooCommerce fashion brands. <a href="/waitlist/">Join the waitlist<span aria-hidden="true"> →</span></a></p></div>
<header class="site-header" data-header>
  <div class="site-header__inner wrap">
    ${wordmark()}
    <nav class="site-nav" aria-label="Main">
      <ul>${primaryNav.map((n) => html`<li><a href="${n.href}"${attrs({ 'aria-current': path === n.href ? 'page' : undefined })}>${n.label}</a></li>`)}</ul>
    </nav>
    <div class="site-header__actions">
      <a class="btn btn--primary btn--sm header-cta" href="/waitlist/"><span>Join the waitlist</span></a>
      <a class="menu-toggle" href="#site-contents" data-menu-link><span class="menu-toggle__lines" aria-hidden="true"></span><span class="menu-toggle__label">Menu</span></a>
      <button type="button" class="menu-toggle" data-menu-toggle aria-controls="menu-overlay" aria-expanded="false" hidden><span class="menu-toggle__lines" aria-hidden="true"></span><span class="menu-toggle__label">Menu</span></button>
    </div>
  </div>
</header>
<div class="menu-overlay" id="menu-overlay" data-menu hidden role="dialog" aria-modal="true" aria-label="Contents">
  <div class="menu-overlay__inner wrap">
    <p class="kicker">Contents · ${site.issue}</p>
    <nav aria-label="Contents">${contentsList(path)}</nav>
    <p class="menu-overlay__foot">Pilot stage. 3D renders are estimates.</p>
  </div>
</div>`;
}

function contentsList(path: string): SafeHtml {
  return html`<ol class="toc">${contents.map(
    (c) => html`<li><a href="${c.href}"${attrs({ 'aria-current': path === c.href ? 'page' : undefined })}><span class="toc__num">${c.num}</span><span class="toc__label">${c.label}</span><span class="toc__dots" aria-hidden="true"></span></a></li>`,
  )}</ol>`;
}

function footer(): SafeHtml {
  const year = 2026;
  return html`<footer class="site-footer night" id="site-contents">
  <div class="wrap">
    <div class="site-footer__top">
      <div class="site-footer__brand">
        <p class="site-footer__mark" aria-hidden="true"><span>curtain</span><span class="wordmark__tld">.fit</span></p>
        <p class="site-footer__line">Your private fitting room. <a href="/waitlist/">Join the waitlist<span aria-hidden="true"> →</span></a></p>
      </div>
      <nav class="site-footer__cols" aria-label="Footer">
        <div><p class="kicker">Product</p><ul><li><a href="/how-it-works/">How it works</a></li><li><a href="/3d/">The 3D estimate</a></li><li><a href="/pricing/">Pricing</a></li><li><a href="/faq/">FAQ</a></li></ul></div>
        <div><p class="kicker">Company</p><ul><li><a href="/about/">Who we are</a></li><li><a href="/why/">Why we do this</a></li><li><a href="/pilot/">Our pilot partner</a></li><li><a href="/journal/">Journal</a></li></ul></div>
        <div><p class="kicker">Trust</p><ul><li><a href="/privacy-promise/">Privacy &amp; trust</a></li><li><a href="/legal/#privacy">Privacy policy</a></li><li><a href="/legal/#terms">Terms</a></li><li><a href="/legal/#imprint">Imprint</a></li></ul></div>
        <div><p class="kicker">Contact</p><ul><li><a href="/waitlist/">Waitlist</a></li><li><a href="mailto:${site.contactEmail}">E-mail us</a></li><li><a href="/legal/#cookies">Cookies</a></li><li><a href="/credits/">Image credits</a></li></ul></div>
      </nav>
    </div>
    ${tapeDivider()}
    <div class="site-footer__small">
      <p>© ${year} ${site.legalName ?? 'curtain.fit'}. Curtain is in pilot. Size advice is advice, and 3D renders are estimates.</p>
      <p>Shopify and WooCommerce are trademarks of their respective owners. No cookies, no trackers on this site.</p>
    </div>
  </div>
</footer>`;
}

export function layout(meta: PageMeta, assets: Assets, body: SafeHtml): string {
  const canonical = site.url + meta.path;
  const og = site.url + (meta.ogImage ?? '/og.jpg');
  const preload = meta.preload
    ? html`<link rel="preload" as="image" type="image/avif" imagesrcset="${meta.preload.widths.map((w) => `/img/${meta.preload?.id}-${w}.avif ${w}w`).join(', ')}" imagesizes="${meta.preload.sizes}" fetchpriority="high">`
    : '';
  const page = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${meta.title}</title>
<meta name="description" content="${meta.description}">
<link rel="canonical" href="${canonical}">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#F5EFE7">
${meta.noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Curtain">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Curtain — your private fitting room. Size advice for fashion shops.">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${assets.fonts.map((f) => html`<link rel="preload" href="${f}" as="font" type="font/woff2" crossorigin>`)}
${preload}
<link rel="stylesheet" href="${assets.css}">
<script type="module" src="${assets.js}"></script>
</head>
<body${attrs({ class: meta.bodyClass })}>
<a class="skip-link" href="#main">Skip to content</a>
${header(meta.path)}
<main id="main" tabindex="-1">
${body}
</main>
${footer()}
</body>
</html>
`;
  return page.value;
}
