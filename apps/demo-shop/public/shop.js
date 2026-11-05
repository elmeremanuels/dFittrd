/**
 * Shared chrome for the Aalter Studio demo storefront: catalogue loading, header, footer, money,
 * and loading the Curtain SDK from the demo api exactly like the plugins do (a script tag with
 * data-shop / data-api / data-mode / data-size-option).
 */
import { escapeHtml } from './garments.js';

export const THEMES = {
  woo: { key: 'woocommerce', label: 'WooCommerce theme', path: (id) => `/product/${encodeURIComponent(id)}` },
  dawn: { key: 'shopify', label: 'Shopify Dawn theme', path: (id) => `/products/${encodeURIComponent(id)}` },
};

export const CATEGORY_LABEL = { dress: 'Dresses', top: 'Tops', bottom: 'Trousers & skirts', outerwear: 'Outerwear' };

export async function loadCatalog() {
  const res = await fetch('/catalog.json', { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `catalog ${res.status}`);
  return res.json();
}

export function shopFor(catalog, theme) {
  return catalog.shops.find((s) => s.key === THEMES[theme].key) ?? catalog.shops[0];
}

export const money = (eur) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: eur % 1 ? 2 : 0 }).format(eur);

export function colorways(p) {
  if (p.colorways?.length) return p.colorways;
  return [{ name: 'Natural', hex: p.primaryColorHex || '#C9BBA7' }];
}

export function header(theme) {
  const other = theme === 'woo' ? 'dawn' : 'woo';
  return `
  <div class="demo-strip" role="note">
    <span><strong>Curtain demo storefront.</strong> A pretend shop to try the plugin standalone, no app needed.</span>
    <a href="/?theme=${other}">Switch to the ${THEMES[other].label}</a>
  </div>
  <div class="announce">Free shipping in Belgium and the Netherlands over €100 · 30-day returns</div>
  <header class="site-header ${theme}">
    <a class="logo" href="/?theme=${theme}" aria-label="Aalter Studio, home">Aalter<span>Studio</span></a>
    <nav aria-label="Main">
      <a href="/?theme=${theme}#new">New in</a>
      <a href="/?theme=${theme}&amp;c=dress#new">Dresses</a>
      <a href="/?theme=${theme}&amp;c=top#new">Tops</a>
      <a href="/?theme=${theme}&amp;c=bottom#new">Trousers</a>
      <a href="/?theme=${theme}#story">Our story</a>
    </nav>
    <div class="header-icons">
      <span class="icon-btn" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></span>
      <a class="icon-btn bag" href="#" aria-label="Bag, ${bagCount()} items"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg><span class="bag-count">${bagCount()}</span></a>
    </div>
  </header>`;
}

export function footer() {
  return `
  <footer class="site-footer">
    <div class="footer-grid">
      <div><p class="logo small">Aalter<span>Studio</span></p><p>Natural fibres, cut in small runs. Designed in Aalter, Belgium.</p></div>
      <div><h3>Help</h3><p>Shipping &amp; returns<br>Size guide<br>Care for linen</p></div>
      <div><h3>Visit</h3><p>Stationsstraat 12<br>9880 Aalter<br>Thu to Sat, 10:00 to 18:00</p></div>
      <div><h3>Fit</h3><p>Not sure about your size? Press <em>Try it on</em> on any product page. Your measurements stay on your device.</p></div>
    </div>
    <p class="fineprint">This is a demo storefront for Curtain. Nothing here can be bought.</p>
  </footer>`;
}

function bagCount() {
  try {
    return Number(sessionStorage.getItem('demo-bag') || 0);
  } catch {
    return 0;
  }
}

export function addToBag(name, size) {
  try {
    sessionStorage.setItem('demo-bag', String(bagCount() + 1));
  } catch {
    /* private mode */
  }
  document.querySelectorAll('.bag-count').forEach((n) => (n.textContent = String(bagCount())));
  toast(`Added to bag: ${name}, size ${size}`);
}

export function toast(text) {
  let t = document.querySelector('.shop-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'shop-toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/**
 * Load sdk.v1.js from the demo api with the same attributes the plugins render.
 * mode: 'embed' (standalone, default) | 'app'. Override with ?mode=app for comparison.
 */
export function loadSdk(catalog, shop, sizeOption) {
  const mode = new URLSearchParams(location.search).get('mode') === 'app' ? 'app' : 'embed';
  const s = document.createElement('script');
  s.src = catalog.sdkUrl;
  s.defer = true;
  s.setAttribute('data-curtain-sdk', '');
  s.setAttribute('data-shop', shop.publicKey);
  s.setAttribute('data-api', catalog.apiUrl);
  s.setAttribute('data-mode', mode);
  s.setAttribute('data-size-option', sizeOption);
  s.setAttribute('data-locale', 'en');
  s.setAttribute('data-label', 'Try it on');
  s.onerror = () => toast('Could not load the Curtain SDK from the demo api. Is `pnpm demo` running?');
  document.head.append(s);
}

export function errorPage(main, err) {
  main.innerHTML = `<section class="notice"><h1>The demo api is not running yet</h1><p>${escapeHtml(err.message)}</p><p>Start everything with <code>pnpm demo</code> at the repository root, then reload this page.</p></section>`;
}

export function productIdFromPath() {
  return decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
}
