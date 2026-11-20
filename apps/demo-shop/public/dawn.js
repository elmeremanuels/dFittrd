/**
 * Shopify Dawn-style product page: <variant-radios> with Color and Size fieldsets whose radios
 * belong to form[action="/cart/add"] through the `form` attribute (as in Dawn), and the "Try it on"
 * app block exactly as packages/shopify-app renders it (snippet markup + curtain-try.css).
 */
import { escapeHtml } from './garments.js';
import { description, fabricLine, gallery, listenForCurtain, sizeGuide, updateGallery } from './product-common.js';
import { addToBag, colorways, errorPage, footer, header, loadCatalog, loadSdk, money, productIdFromPath, shopFor } from './shop.js';

document.body.classList.add('theme-dawn');
document.getElementById('header').innerHTML = header('dawn');
document.getElementById('footer').innerHTML = footer();
const main = document.getElementById('main');
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = '/ext/curtain-try.css';
document.head.append(css);

try {
  const catalog = await loadCatalog();
  const shop = shopFor(catalog, 'dawn');
  const p = shop.products.find((x) => x.externalId === productIdFromPath());
  if (!p) throw new Error(`No product "${productIdFromPath()}" in the Shopify demo shop.`);
  document.title = `${p.name} – Aalter Studio`;
  const cw = colorways(p);
  const formId = 'product-form-template--main';
  const priceText = `${money(p.priceEur)} EUR`;
  const added = new URLSearchParams(location.search).get('added');
  main.innerHTML = `
  <section class="product dawn-layout">
    ${gallery(p, cw[0].hex, 'product__media-wrapper')}
    <div class="product__info-wrapper"><div class="product__info-container">
      <p class="product__text caption-with-letter-spacing">${escapeHtml(p.brand)}</p>
      <div class="product__title"><h1>${escapeHtml(p.name)}</h1></div>
      <div class="price"><span class="visually-hidden">Regular price</span><span class="price-item price-item--regular">${priceText}</span></div>
      <small class="product__tax caption">Tax included. Shipping calculated at checkout.</small>
      <variant-radios class="no-js-hidden" data-section="template--main" data-url="/products/${escapeHtml(p.externalId)}">
        <fieldset class="js product-form__input">
          <legend class="form__label">Color: <span data-color-name>${escapeHtml(cw[0].name)}</span></legend>
          ${cw.map((c, i) => `<input type="radio" id="Color-${i}" name="Color" value="${escapeHtml(c.name)}" form="${formId}"${i === 0 ? ' checked' : ''}><label for="Color-${i}" class="swatch-label"><span class="swatch" style="--c:${c.hex}" aria-hidden="true"></span>${escapeHtml(c.name)}</label>`).join('')}
        </fieldset>
        <fieldset class="js product-form__input">
          <legend class="form__label">Size</legend>
          ${p.sizes.map((s, i) => `<input type="radio" id="Size-${i}" name="Size" value="${escapeHtml(s)}" form="${formId}"${i === 0 ? ' checked' : ''}><label for="Size-${i}">${escapeHtml(s)}</label>`).join('')}
        </fieldset>
      </variant-radios>
      <product-form class="product-form">
        <form method="post" action="/cart/add" id="${formId}" accept-charset="UTF-8" class="form" enctype="application/x-www-form-urlencoded" novalidate="novalidate">
          <input type="hidden" name="form_type" value="product">
          <input type="hidden" name="id" value="${escapeHtml(p.externalId)}-${escapeHtml(p.sizes[0])}">
          <input type="hidden" name="return_to" value="/products/${escapeHtml(p.externalId)}">
          <div class="product-form__buttons">
            <button type="submit" name="add" class="product-form__submit button button--full-width button--secondary">Add to cart</button>
          </div>
        </form>
      </product-form>
      <div class="curtain-try curtain-try--full" id="shopify-block-curtain-try">
        <button type="button" class="curtain-try__button" data-curtain-product="${escapeHtml(p.externalId)}" aria-describedby="curtain-try-hint">
          <svg class="curtain-try__icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" focusable="false"><path fill="currentColor" d="M7 3h10l1.2 2.4L22 7l-2 4-2-.9V21H6V10.1L4 11 2 7l3.8-1.6L7 3zm2.1 2L8 7.2l-2.8 1.2.8 1.6 2-.9V19h8V9.1l2 .9.8-1.6L16 7.2 14.9 5h-1.2a1.7 1.7 0 0 1-3.4 0H9.1z"/></svg>
          <span>Try it on</span>
        </button>
        <p id="curtain-try-hint" class="curtain-try__hint">See how it fits on you, privately, right on this page. Your measurements stay on this device. Every render is an estimate.</p>
      </div>
      <p class="curtain-picked" data-curtain-note hidden></p>
      <div class="product__description rte"><p>${description(p)}</p></div>
      <details class="product__accordion" open><summary>Size &amp; fit</summary><div class="accordion__content">${sizeGuide(p)}</div></details>
      <details class="product__accordion"><summary>Materials &amp; care</summary><div class="accordion__content"><p>${escapeHtml(fabricLine(p) || 'Natural fibres')}. Wash cool, dry flat.</p></div></details>
      <details class="product__accordion"><summary>Shipping &amp; returns</summary><div class="accordion__content"><p>Free shipping in Belgium and the Netherlands over €100. Free returns within 30 days.</p></div></details>
    </div></div>
  </section>`;

  const form = main.querySelector('form[action="/cart/add"]');
  const idInput = form.querySelector('input[name=id]');
  // What Dawn's VariantRadios does on change: update the variant id, the URL and the media.
  main.querySelector('variant-radios').addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'Color') {
      main.querySelector('[data-color-name]').textContent = t.value;
      updateGallery(main, p, cw.find((c) => c.name === t.value)?.hex);
    }
    const chosen = main.querySelector('input[name=Size]:checked')?.value ?? '';
    idInput.value = `${p.externalId}-${chosen}`;
    history.replaceState(null, '', `${location.pathname}?variant=${encodeURIComponent(idInput.value)}`);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault(); // Dawn's product-form adds to the cart drawer with fetch; we fake the drawer.
    addToBag(p.name, main.querySelector('input[name=Size]:checked')?.value ?? '');
  });
  if (added) addToBag(p.name, added);
  listenForCurtain(main.querySelector('[data-curtain-note]'));
  loadSdk(catalog, shop, 'Size');
} catch (err) {
  errorPage(main, err);
}
