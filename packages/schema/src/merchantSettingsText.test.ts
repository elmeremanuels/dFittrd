import { describe, expect, it } from 'vitest';
import { INCOMPLETE_PRODUCT_DATA_POLICIES } from './incompleteData';
import { FabricSchema } from './garment';
import { PRODUCT_NOTICE_TEXT, SHOP_SETTINGS_TEXT, fabricPartText, fillText, heldNowText, productNoticeLines } from './merchantSettingsText';

const T = PRODUCT_NOTICE_TEXT;

describe('fillText', () => {
  it('fills named slots and leaves an unknown slot as it is', () => {
    expect(fillText('{n} of {total}', { n: 2, total: 5 })).toBe('2 of 5');
    expect(fillText('{part} ({rule})', { part: 'the drape' })).toBe('the drape ({rule})');
    // A value is text, never a pattern: `$&` stays as written.
    expect(fillText('{what}.', { what: '$& and {n}' })).toBe('$& and {n}.');
    expect(fillText('{constructor}', {})).toBe('{constructor}');
  });
});

describe('the shared settings catalogue', () => {
  it('survives JSON unchanged (the Shopify admin page reads it from its config)', () => {
    expect(JSON.parse(JSON.stringify(SHOP_SETTINGS_TEXT))).toEqual(SHOP_SETTINGS_TEXT);
    expect(JSON.parse(JSON.stringify(PRODUCT_NOTICE_TEXT))).toEqual(PRODUCT_NOTICE_TEXT);
  });

  it('has a label and a text for each choice, and the estimate labels are said to stay (rule 3)', () => {
    for (const policy of INCOMPLETE_PRODUCT_DATA_POLICIES) {
      expect(SHOP_SETTINGS_TEXT.incomplete.choices[policy].label).not.toBe('');
      expect(SHOP_SETTINGS_TEXT.incomplete.choices[policy].text).not.toBe('');
    }
    expect(SHOP_SETTINGS_TEXT.popup.wordmarkText).toMatch(/“Estimate” labels .* always stay/);
  });

  it('names every fabric part, and has a rule for each one the api can leave out', () => {
    for (const key of Object.keys(FabricSchema.shape)) {
      expect(T.fabricPart[`fabric.${key}`], key).toBeTruthy();
      expect(T.fabricRule[`fabric.${key}`], key).toBeTruthy();
    }
  });

  it('counts held-back products in words', () => {
    expect(heldNowText(1)).toBe('1 product is held back right now.');
    expect(heldNowText(3)).toBe('3 products are held back right now.');
  });
});

describe('productNoticeLines', () => {
  it('says nothing for a complete product', () => {
    expect(productNoticeLines({ status: 'active', notices: { defaulted: [], leftOut: [] } })).toEqual({ heldBack: null, leftOut: [], stretchAssumed: null });
    expect(productNoticeLines({ status: 'active' })).toEqual({ heldBack: null, leftOut: [], stretchAssumed: null });
  });

  it('a left-out stretch on a sized product: one line with what size advice assumes, and no "no stretch given"', () => {
    const r = productNoticeLines({ status: 'active', notices: { defaulted: ['fabric.stretchPct'], leftOut: [{ field: 'fabric.stretchPct', reason: 'Too big: expected number to be <=100' }] } });
    expect(r.leftOut).toEqual([
      { field: 'fabric.stretchPct', text: 'Not saved: the fabric stretch. The value you entered was left out (it must be a number from 0 to 100), so size advice assumes the fabric does not stretch until you correct it. The rest of the fabric was kept.' },
    ]);
    expect(r.stretchAssumed).toBeNull();
    // The validator's own message is never shown.
    expect(JSON.stringify(r)).not.toContain('Too big');
  });

  it('no stretch given on a sized product', () => {
    const r = productNoticeLines({ status: 'active', notices: { defaulted: ['fabric.stretchPct', 'fabric.drape'], leftOut: [] } });
    expect(r).toEqual({ heldBack: null, leftOut: [], stretchAssumed: T.stretchAssumed });
    expect(productNoticeLines({ status: 'incomplete', notices: { defaulted: ['fabric.stretchPct'], leftOut: [] } }).stretchAssumed).toBeNull();
  });

  it('another left-out value uses the plain rule; a path with no rule gets the general line', () => {
    const r = productNoticeLines({ status: 'active', notices: { defaulted: [], leftOut: [{ field: 'fabric.drape', reason: 'x' }, { field: 'fabric.future', reason: 'y' }] } });
    expect(r.leftOut.map((l) => l.text)).toEqual([
      'Not saved: the drape. The value you entered was left out (it must be a number from 0 to 1). The rest of the fabric was kept.',
      'Not saved: a fabric detail. The value you entered is not valid and was left out. The rest of the fabric was kept.',
    ]);
  });

  it('held back: names what to add, and a left-out stretch reads as the plain line (no size advice is given)', () => {
    const r = productNoticeLines({
      status: 'incomplete',
      heldBack: { reason: 'incomplete_product_data', fields: ['fabric.stretchPct', 'fabric.drape'] },
      notices: { defaulted: [], leftOut: [{ field: 'fabric.stretchPct', reason: 'x' }] },
    });
    expect(r.heldBack).toBe('Held back by your setting: shoppers get no size advice for this product until you add or correct the fabric stretch and the drape.');
    expect(r.leftOut[0]!.text).toBe('Not saved: the fabric stretch. The value you entered was left out (it must be a number from 0 to 100). The rest of the fabric was kept.');
    expect(r.stretchAssumed).toBeNull();
  });

  it('a path named like an Object member is "a fabric detail"', () => {
    expect(fabricPartText('constructor')).toBe('a fabric detail');
    expect(fabricPartText('other')).toBe('a fabric detail');
  });
});
