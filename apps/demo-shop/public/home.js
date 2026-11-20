import { escapeHtml, garmentSvg } from './garments.js';
import { CATEGORY_LABEL, THEMES, colorways, errorPage, footer, header, loadCatalog, money, shopFor } from './shop.js';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dawn' ? 'dawn' : 'woo';
const filter = params.get('c') || 'all';
document.body.classList.add(`theme-${theme}`);
document.getElementById('header').innerHTML = header(theme);
document.getElementById('footer').innerHTML = footer();
const main = document.getElementById('main');

try {
  const catalog = await loadCatalog();
  const shop = shopFor(catalog, theme);
  const products = shop.products.filter((p) => p.status === 'active');
  const hero = products.find((p) => p.externalId === 'aalter-studio-1') ?? products[0];
  const second = products.find((p) => p.category === 'outerwear') ?? products.find((p) => p.category === 'top') ?? products[1];
  const cats = ['all', ...new Set(products.map((p) => p.category))];
  main.innerHTML = `
  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">Autumn edit</p>
      <h1>Linen, wool and the shape of slow days</h1>
      <p>Pieces cut in small runs from natural fibres. Find your size before you order: press <strong>Try it on</strong> on any product, right here in the shop.</p>
      <a class="btn-primary" href="${THEMES[theme].path(hero.externalId)}">Shop the ${escapeHtml(hero.name)}</a>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="hero-card one">${garmentSvg(hero, colorways(hero)[0].hex, { background: '#E9DFD1' })}</div>
      <div class="hero-card two">${garmentSvg(second, colorways(second)[0].hex, { background: '#E2E6DC' })}</div>
    </div>
  </section>
  <section class="collection" id="new" aria-labelledby="h-new">
    <div class="collection-head">
      <h2 id="h-new">New in <span class="count">${products.length} pieces</span></h2>
      <div class="chips" role="group" aria-label="Filter by category">
        ${cats.map((c) => `<a class="chip${c === filter ? ' active' : ''}" href="/?theme=${theme}${c === 'all' ? '' : `&c=${c}`}#new"${c === filter ? ' aria-current="true"' : ''}>${c === 'all' ? 'All' : CATEGORY_LABEL[c] ?? c}</a>`).join('')}
      </div>
    </div>
    <ul class="grid">
      ${products
        .filter((p) => filter === 'all' || p.category === filter)
        .map((p) => {
          const cw = colorways(p);
          return `<li class="card">
          <a href="${THEMES[theme].path(p.externalId)}">
            <div class="card-img">${garmentSvg(p, cw[0].hex)}${p.sizingNotes && /small|size up/i.test(p.sizingNotes) ? '<span class="badge">Check your size</span>' : ''}</div>
            <p class="card-brand">${escapeHtml(p.brand)}</p>
            <h3 class="card-name">${escapeHtml(p.name)}</h3>
            <p class="card-price">${money(p.priceEur)}</p>
          </a>
          <div class="swatches" aria-label="${cw.length} colours">${cw.map((c) => `<span class="swatch" style="--c:${c.hex}" title="${escapeHtml(c.name)}"></span>`).join('')}</div>
        </li>`;
        })
        .join('')}
    </ul>
  </section>
  <section class="story" id="story">
    <div>
      <h2>Fewer returns, better fits</h2>
      <p>Every product page has a <strong>Try it on</strong> button. Tell it your height, weight and how you like things to fit, and it recommends a size for this exact garment, with how it fits at the bust, waist and hip. It works right here, without an app, and your measurements never leave your device.</p>
    </div>
    <ul class="usp">
      <li><strong>Natural fibres</strong><span>Linen, wool, silk and cotton</span></li>
      <li><strong>Small runs</strong><span>Made in Portugal and Belgium</span></li>
      <li><strong>30-day returns</strong><span>Free in Belgium</span></li>
    </ul>
  </section>`;
} catch (err) {
  errorPage(main, err);
}
