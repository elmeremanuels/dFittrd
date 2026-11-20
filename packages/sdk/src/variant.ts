import type { SizeSelectedVia } from './types';

/**
 * Variant selection on the merchant page (docs/STANDALONE.md §2): merchant hook → Shopify cart form
 * (radios / selects) → WooCommerce `form.variations_form` → caller shows a toast. Never throws.
 */

type Control = HTMLInputElement | HTMLSelectElement;
type JQueryLike = (el: Element) => { trigger(type: string): unknown };

/** Option names that hold the size when `data-size-option` is not set (matched case-insensitively). */
export const SIZE_OPTION_NAMES = ['Size', 'Maat', 'Taille', 'Größe'];

/** Lower-case words, space-padded: "options[Size]" → " options size ", "attribute_pa_size" → " attribute pa size ". */
const words = (t: string | null | undefined): string =>
  ' ' + (t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ') + ' ';

/** "One size" ↔ "one-size", "M" ↔ "m". */
const slug = (t: string): string => words(t).trim().replace(/ /g, '-');

const fire = (c: Element, type: string): boolean => c.dispatchEvent(new Event(type, { bubbles: true }));

/** Does this control belong to the size option? Looks at its name, its fieldset legend and its labels. */
function isSizeControl(c: Control, sizeOption?: string): boolean {
  let text = c.name + ' ' + (c.closest('fieldset')?.querySelector('legend')?.textContent || '');
  c.labels?.forEach((l) => (text += ' ' + l.textContent));
  text = words(text);
  return (sizeOption ? [sizeOption, ...SIZE_OPTION_NAMES] : SIZE_OPTION_NAMES).some((n) => text.includes(words(n)));
}

/** Shopify: radios / selects owned by a `/cart/add` form (Dawn uses the `form` attribute) or inside Dawn's variant pickers. */
function shopifyControls(sizeOption?: string): Control[] {
  return Array.from(document.querySelectorAll<Control>('input[type=radio],select')).filter(
    (c) =>
      (/\/cart\/add/.test(c.form?.getAttribute('action') || '') || !!c.closest('variant-radios,variant-selects')) &&
      isSizeControl(c, sizeOption),
  );
}

function wooControls(sizeOption?: string): HTMLSelectElement[] {
  return Array.from(
    document.querySelectorAll<HTMLSelectElement>('form.variations_form select[name^="attribute_"]'),
  ).filter((c) => isSizeControl(c, sizeOption));
}

/** Dawn 13+ labels an unavailable value "XS - Unavailable" (and its value is a numeric id). */
const label = (o: HTMLOptionElement): string => o.text.trim().replace(/\s+[-–—]\s+[^-–—]*$/, '');

function optionFor(sel: HTMLSelectElement, size: string): HTMLOptionElement | undefined {
  const want = slug(size);
  const opts = Array.from(sel.options).filter((o) => o.value);
  return (
    opts.find((o) => slug(o.value) === want || slug(o.text) === want) ||
    opts.find((o) => slug(label(o)) === want || slug(o.getAttribute('data-option-value') || '') === want)
  );
}

/**
 * Only the controls of the trigger's own product (F4): the nearest ancestor of the button that holds
 * any size control (Dawn's product-info section, a Woo product), so a quick-add or "complete the
 * look" form elsewhere on the page is never touched. Page-wide when there is no trigger.
 */
function scoped<T extends Control>(all: T[], scope?: Element | null): T[] {
  for (let a = scope?.parentElement; a; a = a.parentElement) {
    const inside = all.filter((c) => a.contains(c) || (!!c.form && a.contains(c.form)));
    if (inside.length) return inside;
  }
  return all;
}

/** Set the size on the page. Returns how it was done; `toast` means nothing on the page matched. */
export function selectSize(size: string, productExternalId: string, sizeOption?: string, scope?: Element | null): SizeSelectedVia {
  try {
    if (window.CurtainHooks?.onSizeSelected?.({ size, productExternalId }) === true) return 'hook';
  } catch {
    /* a broken merchant hook must not stop the built-in selection */
  }
  try {
    for (const c of scoped(shopifyControls(sizeOption), scope)) {
      if (c instanceof HTMLSelectElement) {
        const o = optionFor(c, size);
        if (!o) continue;
        c.value = o.value;
      } else {
        if (c.disabled || slug(c.value) !== slug(size)) continue;
        c.checked = true;
      }
      fire(c, 'input');
      fire(c, 'change');
      return 'shopify';
    }
    for (const c of scoped(wooControls(sizeOption), scope)) {
      const o = optionFor(c, size);
      if (!o) continue;
      c.value = o.value;
      const jq = (window as { jQuery?: JQueryLike }).jQuery;
      // wc-add-to-cart-variation listens through jQuery; a native event does not reach it.
      if (typeof jq === 'function') jq(c).trigger('change');
      else fire(c, 'change');
      return 'woo';
    }
  } catch {
    /* fall through to the toast */
  }
  return 'toast';
}

/** The size currently selected on the page, if a size control can be found. */
export function currentSize(sizeOption?: string, scope?: Element | null): string | undefined {
  try {
    for (const c of scoped([...shopifyControls(sizeOption), ...wooControls(sizeOption)], scope)) {
      if (c instanceof HTMLSelectElement) {
        const o = c.value ? c.selectedOptions[0] : undefined;
        if (o) return label(o) || o.value;
      } else if (c.checked && c.value) return c.value;
    }
  } catch {
    /* unknown theme markup */
  }
  return undefined;
}
