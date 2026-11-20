/**
 * Words the merchant console and the Shopify embedded admin both say about the shop settings and
 * about a product's fabric notices (D21: one English catalogue; D24, D25 points 1, 2 and 7). They
 * live here once so the two surfaces cannot drift: the console's catalogue takes them from here,
 * and the Shopify admin page gets them in its config JSON.
 *
 * Every value is a plain string so the catalogue survives JSON; a value with a `{name}` slot is
 * filled with `fillText`. The Shopify admin page fills the same slots in its own script.
 */
import type { IncompleteProductDataPolicy, ProductHeldBack, ProductNotices } from './incompleteData';

/** `{name}` slots of a catalogue line replaced by their values; an unknown slot is left as it is. */
export function fillText(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (slot, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : slot));
}

const CHOICES: Readonly<Record<IncompleteProductDataPolicy, { label: string; text: string }>> = Object.freeze({
  'let-through': Object.freeze({
    label: 'Show size advice anyway',
    text: 'The product goes live and the product list tells you what is missing. Without a stretch value, size advice assumes the fabric does not stretch, and the popup tells shoppers that the shop has not said how much the fabric stretches.',
  }),
  'hold-back': Object.freeze({
    label: 'Hold the product back until it is complete',
    text: 'The product is saved, but shoppers get no size advice for it until you add what is missing. The product list shows which products are held back and why.',
  }),
});

/** The Settings section: the two choices every surface offers (the console adds the shop's colour and logo). */
export const SHOP_SETTINGS_TEXT = Object.freeze({
  title: 'Settings',
  /** For a surface where every setting is saved at once (the Shopify admin). The console has its own intro: it also has a Save button. */
  introSavedAtOnce: 'Choices for your whole shop. A choice or a switch is saved when you change it.',
  unavailable: 'Settings could not be loaded just now. Reload the page to try again.',
  saving: 'Saving…',
  saved: 'Saved.',
  failed: 'That was not saved. Check your internet connection and try again.',
  incomplete: Object.freeze({
    title: 'Products with incomplete fabric details',
    intro: 'What should happen when a product has no fabric stretch, or a fabric value Curtain cannot use? Either way Curtain keeps the rest of what you entered.',
    choices: CHOICES,
    /** After the label of the default choice. */
    defaultMark: '(standard)',
    heldNowOne: '1 product is held back right now.',
    /** Slot: `{n}`. */
    heldNowMany: '{n} products are held back right now.',
  }),
  popup: Object.freeze({
    title: 'The popup on your product page',
    wordmark: 'Show “Fit by Curtain”',
    wordmarkText: 'A small line at the bottom of the popup. The “Estimate” labels on the figure and on pictures always stay: they are not part of this switch. The link “Get the Curtain app” also stays.',
  }),
});

/**
 * The way from the Shopify admin into the web console: a one-time sign-in link (inventory S2). The
 * WooCommerce plugin says its own sentence through WordPress' translation functions.
 */
export const CONSOLE_LINK_TEXT = Object.freeze({
  title: 'The full console',
  intro: 'What shoppers liked, your usage by day, and your shop colour and logo are in the Curtain console. The button opens it in a new tab and signs you in: no password, no key.',
  open: 'Open the full console',
  opening: 'Opening the console…',
  /** When the browser kept the new tab from opening: the merchant follows this link instead. It works once. */
  ready: 'Your console is ready:',
  readyLink: 'Go to the console',
  tooOften: 'The console was opened several times in the last few minutes. Wait ten minutes, then try again.',
  failed: 'The console could not be opened just now. Check your internet connection and try again.',
});

/** What the product list says about a held-back product and about fabric values that were left out or assumed. */
export const PRODUCT_NOTICE_TEXT = Object.freeze({
  /** The chip of a product the shop's setting holds back. */
  heldBack: 'Held back',
  /** Slot: `{what}`, the fabric details to complete, joined with `heldBackJoin`. */
  heldBackText: 'Held back by your setting: shoppers get no size advice for this product until you add or correct {what}.',
  heldBackJoin: ' and ',
  /** The link to the setting, after `heldBackText`. */
  heldBackSetting: 'Change the setting',
  /** The short next step of a held-back product (the full sentence is under the product name). */
  heldBackNext: 'Add or correct the fabric details named under the product name.',
  /** Plain names of fabric details, by payload path; `other` for a path the surface does not know. */
  fabricPart: Object.freeze({
    'fabric.stretchPct': 'the fabric stretch',
    'fabric.drape': 'the drape',
    'fabric.weightGsm': 'the fabric weight',
    'fabric.opacity': 'the opacity',
    'fabric.sheen': 'the sheen',
    'fabric.blend': 'the fibre blend',
    'fabric.primary': 'the fabric name',
    other: 'a fabric detail',
  }) as Readonly<Record<string, string>> & { readonly other: string },
  /** What a fabric detail must be, by payload path (said when a value was not saved). */
  fabricRule: Object.freeze({
    'fabric.stretchPct': 'it must be a number from 0 to 100',
    'fabric.drape': 'it must be a number from 0 to 1',
    'fabric.weightGsm': 'it must be a number above 0 and at most 2000',
    'fabric.opacity': 'it must be a number from 0 to 1',
    'fabric.sheen': 'it must be a number from 0 to 1',
    'fabric.blend': 'it may hold at most 8 fibres, each from 0 to 100%',
    'fabric.primary': 'it may be at most 64 characters long',
  }) as Readonly<Record<string, string>>,
  /** A value that was not saved. Slots: `{part}`, `{rule}`. The api's own reason (a validator message) is never shown. */
  leftOut: 'Not saved: {part}. The value you entered was left out ({rule}). The rest of the fabric was kept.',
  /** The same for a detail the surface has no rule for. Slot: `{part}`. */
  leftOutOther: 'Not saved: {part}. The value you entered is not valid and was left out. The rest of the fabric was kept.',
  /** A stretch that was entered but not valid, on a product that gives size advice. Slot: `{rule}`. */
  leftOutStretch: 'Not saved: the fabric stretch. The value you entered was left out ({rule}), so size advice assumes the fabric does not stretch until you correct it. The rest of the fabric was kept.',
  /** No stretch on a product that gives size advice. */
  stretchAssumed: 'No fabric stretch given: size advice assumes the fabric does not stretch. For a stretchy fabric the advice is less exact until you add it.',
});

export type ProductNoticeText = typeof PRODUCT_NOTICE_TEXT;

/** The part of a merchant product row the notices are read from. */
export interface ProductNoticeFacts {
  status: 'active' | 'incomplete' | 'archived';
  heldBack?: ProductHeldBack | null | undefined;
  notices?: ProductNotices | null | undefined;
}

export interface ProductNoticeLines {
  /** Why the product is held back and what to add; null when it is not held back. */
  heldBack: string | null;
  /** One line per fabric value that was entered but not saved, in the api's order. */
  leftOut: { field: string; text: string }[];
  /** "No fabric stretch given …", only for a product that gives size advice and whose stretch was not left out. */
  stretchAssumed: string | null;
}

/** The plain name of a fabric detail. */
export function fabricPartText(field: string, text: ProductNoticeText = PRODUCT_NOTICE_TEXT): string {
  return (Object.hasOwn(text.fabricPart, field) ? text.fabricPart[field] : undefined) ?? text.fabricPart.other;
}

/**
 * What the product list says under a product's name (D25 point 1 and 2). One rule for every
 * surface; the Shopify admin page's script follows it and is tested against it.
 */
export function productNoticeLines(p: ProductNoticeFacts, text: ProductNoticeText = PRODUCT_NOTICE_TEXT): ProductNoticeLines {
  const leftOut = p.notices?.leftOut ?? [];
  const sized = !p.heldBack && p.status === 'active';
  // A stretch that was entered but left out is said once, by its "Not saved" line; "no stretch given" would be untrue.
  const stretchLeftOut = leftOut.some((l) => l.field === 'fabric.stretchPct');
  const stretchAssumed = sized && !stretchLeftOut && (p.notices?.defaulted.includes('fabric.stretchPct') ?? false);
  const leftOutText = (field: string): string => {
    const part = fabricPartText(field, text);
    const rule = Object.hasOwn(text.fabricRule, field) ? text.fabricRule[field] : undefined;
    if (!rule) return fillText(text.leftOutOther, { part });
    return field === 'fabric.stretchPct' && sized ? fillText(text.leftOutStretch, { rule }) : fillText(text.leftOut, { part, rule });
  };
  return {
    heldBack: p.heldBack ? fillText(text.heldBackText, { what: p.heldBack.fields.map((f) => fabricPartText(f, text)).join(text.heldBackJoin) }) : null,
    leftOut: leftOut.map((l) => ({ field: l.field, text: leftOutText(l.field) })),
    stretchAssumed: stretchAssumed ? text.stretchAssumed : null,
  };
}

/** "1 product is held back right now." / "3 products are held back right now." */
export function heldNowText(n: number): string {
  return n === 1 ? SHOP_SETTINGS_TEXT.incomplete.heldNowOne : fillText(SHOP_SETTINGS_TEXT.incomplete.heldNowMany, { n });
}
