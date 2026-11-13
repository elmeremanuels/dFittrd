/**
 * WooCommerce-style product page (Storefront theme markup): a variable product with
 * form.variations_form, select[name=attribute_pa_color] and select[name=attribute_pa_size], and the
 * Curtain button exactly as the plugin renders it (class-frontend.php, priority 35 = after the form).
 */
import { escapeHtml } from './garments.js';
import { description, fabricLine, gallery, listenForCurtain, sizeGuide, updateGallery } from './product-common.js';
import { CATEGORY_LABEL, addToBag, colorways, errorPage, footer, header, loadCatalog, loadSdk, money, productIdFromPath, shopFor } from './shop.js';

const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
document.body.classList.add('theme-woo', 'woocommerce', 'single-product');
document.getElementById('header').innerHTML = header('woo');
document.getElementById('footer').innerHTML = footer();
const main = document.getElementById('main');

try {
  const catalog = await loadCatalog();
  const shop = shopFor(catalog, 'woo');
  const p = shop.products.find((x) => x.externalId === productIdFromPath());
  if (!p) throw new Error(`No product "${productIdFromPath()}" in the WooCommerce demo shop.`);
  document.title = `${p.name} – Aalter Studio`;
  const cw = colorways(p);
  main.innerHTML = `
  <nav class="woocommerce-breadcrumb" aria-label="Breadcrumb"><a href="/?theme=woo">Home</a> / <a href="/?theme=woo&amp;c=${p.category}#new">${CATEGORY_LABEL[p.category] ?? p.category}</a> / ${escapeHtml(p.name)}</nav>
  <div class="woocommerce-notices-wrapper" aria-live="polite"></div>
  <div id="product-${escapeHtml(p.externalId)}" class="product type-product product-type-variable woo-layout">
    ${gallery(p, cw[0].hex, 'woocommerce-product-gallery')}
    <div class="summary entry-summary">
      <p class="woo-brand">${escapeHtml(p.brand)}</p>
      <h1 class="product_title entry-title">${escapeHtml(p.name)}</h1>
      <p class="price"><span class="woocommerce-Price-amount amount">${money(p.priceEur)}</span></p>
      <div class="woocommerce-product-details__short-description"><p>${description(p)}</p></div>
      <form class="variations_form cart" action="" method="post" data-product_id="${escapeHtml(p.externalId)}">
        <table class="variations" role="presentation"><tbody>
          <tr>
            <th class="label"><label for="pa_color">Colour</label></th>
            <td class="value"><select id="pa_color" name="attribute_pa_color" data-attribute_name="attribute_pa_color">
              ${cw.map((c, i) => `<option value="${slug(c.name)}"${i === 0 ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select></td>
          </tr>
          <tr>
            <th class="label"><label for="pa_size">Size</label></th>
            <td class="value"><select id="pa_size" name="attribute_pa_size" data-attribute_name="attribute_pa_size">
              <option value="">Choose an option</option>
              ${p.sizes.map((s) => `<option value="${slug(s)}">${escapeHtml(s)}</option>`).join('')}
            </select> <a class="reset_variations" href="#" hidden>Clear</a></td>
          </tr>
        </tbody></table>
        <div class="single_variation_wrap">
          <div class="woocommerce-variation single_variation" aria-live="polite"></div>
          <div class="woocommerce-variation-add-to-cart variations_button">
            <div class="quantity"><label class="screen-reader-text" for="qty">Quantity</label><input type="number" id="qty" class="input-text qty text" name="quantity" value="1" min="1" max="9" inputmode="numeric"></div>
            <button type="submit" class="single_add_to_cart_button button alt disabled wc-variation-selection-needed">Add to basket</button>
          </div>
        </div>
      </form>
      <p class="curtain-try"><button type="button" class="button alt curtain-try-button" data-curtain-product="${escapeHtml(p.externalId)}" data-curtain-mode="embed" data-curtain-size-option="pa_size" data-curtain-peek="on">Try it on</button><span class="curtain-try-note screen-reader-text">Find your size on this page. Your measurements stay on this device. Fit results are estimates.</span></p>
      <p class="curtain-picked" data-curtain-note hidden></p>
      <div class="product_meta">
        <span class="sku_wrapper">SKU: <span class="sku">${escapeHtml(cw[0].sku ?? p.externalId.toUpperCase())}</span></span>
        <span class="posted_in">Category: <a href="/?theme=woo&amp;c=${p.category}#new">${CATEGORY_LABEL[p.category] ?? p.category}</a></span>
      </div>
    </div>
  </div>
  <div class="woocommerce-tabs wc-tabs-wrapper">
    <div class="tabs wc-tabs" role="tablist">
      <button role="tab" aria-selected="true" aria-controls="tab-description" id="t-description">Description</button>
      <button role="tab" aria-selected="false" aria-controls="tab-size" id="t-size">Size guide</button>
      <button role="tab" aria-selected="false" aria-controls="tab-info" id="t-info">Additional information</button>
    </div>
    <div class="panel" role="tabpanel" id="tab-description" aria-labelledby="t-description"><p>${description(p)}</p><p>Cut in a small run. Wash cool, dry flat, press while slightly damp.</p></div>
    <div class="panel" role="tabpanel" id="tab-size" aria-labelledby="t-size" hidden>${sizeGuide(p)}</div>
    <div class="panel" role="tabpanel" id="tab-info" aria-labelledby="t-info" hidden>
      <table class="shop_attributes"><tbody>
        <tr><th>Colour</th><td>${cw.map((c) => escapeHtml(c.name)).join(', ')}</td></tr>
        <tr><th>Size</th><td>${p.sizes.map(escapeHtml).join(', ')}</td></tr>
        ${fabricLine(p) ? `<tr><th>Fabric</th><td>${escapeHtml(fabricLine(p))}</td></tr>` : ''}
      </tbody></table>
    </div>
  </div>`;

  const form = main.querySelector('form.variations_form');
  const size = form.querySelector('#pa_size');
  const color = form.querySelector('#pa_color');
  const out = form.querySelector('.single_variation');
  const add = form.querySelector('.single_add_to_cart_button');
  const reset = form.querySelector('.reset_variations');
  const notices = main.querySelector('.woocommerce-notices-wrapper');

  // What wc-add-to-cart-variation.js does on a change: show the variation, enable the button.
  const onVariation = () => {
    const chosen = size.value !== '';
    add.classList.toggle('disabled', !chosen);
    add.classList.toggle('wc-variation-selection-needed', !chosen);
    reset.hidden = !chosen;
    out.innerHTML = chosen ? `<div class="woocommerce-variation-price"><span class="price">${money(p.priceEur)}</span></div><div class="woocommerce-variation-availability"><p class="stock in-stock">In stock</p></div>` : '';
  };
  size.addEventListener('change', onVariation);
  color.addEventListener('change', () => updateGallery(main, p, cw.find((c) => slug(c.name) === color.value)?.hex));
  reset.addEventListener('click', (e) => {
    e.preventDefault();
    size.value = '';
    onVariation();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!size.value) {
      notices.innerHTML = '<ul class="woocommerce-error" role="alert"><li>Please select some product options before adding this product to your basket.</li></ul>';
      return;
    }
    notices.innerHTML = `<div class="woocommerce-message" role="status">“${escapeHtml(p.name)}” has been added to your basket.</div>`;
    addToBag(p.name, size.selectedOptions[0].text);
  });
  main.querySelectorAll('[role=tab]').forEach((tab) =>
    tab.addEventListener('click', () => {
      main.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      main.querySelectorAll('[role=tabpanel]').forEach((panel) => (panel.hidden = panel.id !== tab.getAttribute('aria-controls')));
    }),
  );
  listenForCurtain(main.querySelector('[data-curtain-note]'));
  loadSdk(catalog, shop, 'pa_size');
} catch (err) {
  errorPage(main, err);
}
