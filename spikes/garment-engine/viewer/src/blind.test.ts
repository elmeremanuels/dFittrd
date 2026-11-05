import { describe, expect, it } from 'vitest';
import { csvField, makeTrials, parseStored, respond, sizePairs, summarise, toCsv, type BlindResponse } from './blind';

const products = [
  { id: 'a', sizes: ['XS', 'S', 'M', 'L', 'XL'] },
  { id: 'b', sizes: ['XS', 'S', 'M', 'L', 'XL'] },
];

describe('trials', () => {
  it('pairs S–M and M–L, or adjacent sizes around the middle', () => {
    expect(sizePairs(['XS', 'S', 'M', 'L'])).toEqual([['S', 'M'], ['M', 'L']]);
    expect(sizePairs(['36', '38', '40', '42', '44'])).toEqual([['38', '40'], ['40', '42']]);
  });

  it('shows each pair once in a seeded random order, the smaller size on a random side', () => {
    const t = makeTrials('size', products, 42);
    expect(t).toHaveLength(4);
    expect(t.map((x) => x.index)).toEqual([0, 1, 2, 3]);
    expect(makeTrials('size', products, 42)).toEqual(t);
    for (const x of t) {
      const smaller = sizePairs(products[0]!.sizes).find((p) => p.includes(x.left) && p.includes(x.right))![0];
      expect(x[x.answer]).toBe(smaller);
    }
    // Over many seeds both sides carry the answer.
    const sides = new Set(Array.from({ length: 20 }, (_, s) => makeTrials('size', products, s).map((x) => x.answer)).flat());
    expect(sides).toEqual(new Set(['left', 'right']));
  });

  it('fabric mode shows silk once on each side per product', () => {
    const t = makeTrials('fabric', products, 1);
    expect(t).toHaveLength(4);
    for (const x of t) expect(x[x.answer]).toBe('silk');
    expect(t.filter((x) => x.productId === 'a').map((x) => x.answer).sort()).toEqual(['left', 'right']);
  });
});

describe('results', () => {
  const t = makeTrials('size', products, 7);
  const rows: BlindResponse[] = t.map((x, i) => respond(x, { participant: 'p1', seed: 7, chosen: i === 0 ? (x.answer === 'left' ? 'right' : 'left') : x.answer, responseMs: 1234.4, at: new Date('2026-11-05T10:00:00Z') }));

  it('records correctness and summarises per participant and product', () => {
    expect(rows[0]!.correct).toBe(false);
    expect(rows.slice(1).every((r) => r.correct)).toBe(true);
    const [s] = summarise(rows);
    expect(s).toMatchObject({ participant: 'p1', mode: 'size', trials: 4, correct: 3, products: 2, productsRight: 1 });
  });

  it('exports CSV with a header and escaped fields', () => {
    const csv = toCsv(rows);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('participant,mode,seed,trial,productId,left,right,answer,chosen,correct,responseMs,at');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toMatch(/^p1,size,7,0,[ab],/);
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField(-3)).toBe('-3');
  });

  it('reads stored rows back and drops junk', () => {
    expect(parseStored(JSON.stringify([...rows, { nope: 1 }]))).toHaveLength(4);
    expect(parseStored('not json')).toEqual([]);
    expect(parseStored(null)).toEqual([]);
  });
});
