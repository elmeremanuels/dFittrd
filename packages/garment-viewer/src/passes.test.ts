import { describe, expect, it } from 'vitest';
import { binarise, cleanDepth, cleanNormals, flipRows, hexOf, neighbourSize, rowOf } from './passes';

describe('render pass helpers (pure)', () => {
  it('flips rows', () => {
    const d = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]);
    expect([...flipRows(d, 1, 2)]).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });
  it('binarises masks and cleans depth and normals off the figure', () => {
    const mask = binarise(new Uint8Array([200, 0, 0, 0, 90, 0, 0, 0]));
    expect([...mask]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect([...cleanDepth(new Uint8Array([0, 0, 0, 255, 50, 50, 50, 255]), mask)]).toEqual([1, 1, 1, 255, 0, 0, 0, 255]);
    expect([...cleanNormals(new Uint8Array([128, 128, 255, 255, 128, 128, 255, 255]), mask)]).toEqual([128, 128, 255, 255, 0, 0, 0, 255]);
  });
  it('picks the neighbouring size: next up, else down', () => {
    expect(neighbourSize(['S', 'M', 'L'], 'M')).toBe('L');
    expect(neighbourSize(['S', 'M', 'L'], 'L')).toBe('M');
    expect(neighbourSize(['M'], 'M')).toBeNull();
    expect(neighbourSize(['S'], 'XL')).toBeNull();
  });
  it('formats colours and rows', () => {
    expect(hexOf(245, 239, 231)).toBe('#f5efe7');
    expect(rowOf(-3, 100)).toBe(0);
    expect(rowOf(140.4, 100)).toBe(99);
  });
});
