import { describe, expect, it } from 'vitest';
import { convertEur, convertEurListPrice, currencyFractionDigits, DEFAULT_EUR_RATES, formatMoney, parseEurRates, resolveChargeCurrency } from './currency';

describe('billing currency (#6)', () => {
  it('charges a shop in its billing currency when the table has a rate (AUD pilot, EUR)', () => {
    expect(resolveChargeCurrency('AUD')).toEqual({ currencyCode: 'AUD', eurRate: DEFAULT_EUR_RATES.AUD, fallback: false });
    expect(resolveChargeCurrency('eur')).toEqual({ currencyCode: 'EUR', eurRate: 1, fallback: false });
  });

  it('falls back to USD for an unknown or missing currency', () => {
    expect(resolveChargeCurrency('XYZ')).toEqual({ currencyCode: 'USD', eurRate: DEFAULT_EUR_RATES.USD, fallback: true });
    expect(resolveChargeCurrency(null)).toMatchObject({ currencyCode: 'USD', fallback: true });
    expect(resolveChargeCurrency('AUD', { EUR: 1, USD: 1.2 })).toEqual({ currencyCode: 'USD', eurRate: 1.2, fallback: true });
  });

  it('covers every currency Shopify bills merchants in, plus USD and EUR', () => {
    for (const c of ['AUD', 'CAD', 'EUR', 'INR', 'JPY', 'GBP', 'BRL', 'CNY', 'CZK', 'DKK', 'HKD', 'IDR', 'CHF', 'MYR', 'MXN', 'NZD', 'NOK', 'PHP', 'PLN', 'RON', 'SGD', 'KRW', 'SEK', 'TWD', 'THB', 'USD']) {
      expect(DEFAULT_EUR_RATES[c], c).toBeGreaterThan(0);
    }
    expect(DEFAULT_EUR_RATES.EUR).toBe(1);
  });

  it('rounds usage to minor units and list prices to whole units', () => {
    expect(currencyFractionDigits('AUD')).toBe(2);
    expect(currencyFractionDigits('JPY')).toBe(0);
    expect(convertEur(0.05, 'AUD', 1.78)).toBe(0.09);
    expect(convertEur(1.23, 'EUR', 1)).toBe(1.23);
    expect(convertEur(0.05, 'JPY', 175)).toBe(9);
    expect(convertEurListPrice(29, 1.78)).toBe(52);
    expect(convertEurListPrice(0, 1.78)).toBe(0);
    expect(convertEurListPrice(0.1, 1.78)).toBe(1);
  });

  it('formats money for the usage terms', () => {
    expect(formatMoney(0.09, 'AUD')).toBe('A$0.09');
    expect(formatMoney(0.05, 'EUR')).toBe('€0.05');
  });

  it('parses a JSON override table over the defaults; EUR stays 1 and junk is ignored', () => {
    const r = parseEurRates('{"aud":1.9,"USD":-1,"EUR":2,"toolong":3,"GBP":"x"}');
    expect(r.AUD).toBe(1.9);
    expect(r.USD).toBe(DEFAULT_EUR_RATES.USD);
    expect(r.EUR).toBe(1);
    expect(r.GBP).toBe(DEFAULT_EUR_RATES.GBP);
    expect(parseEurRates('not json')).toBe(DEFAULT_EUR_RATES);
    expect(parseEurRates('')).toBe(DEFAULT_EUR_RATES);
    expect(parseEurRates('[1]')).toBe(DEFAULT_EUR_RATES);
  });
});
