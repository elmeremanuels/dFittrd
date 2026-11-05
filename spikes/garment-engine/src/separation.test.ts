import { bodyShape, buildMannequin, buildMannequinMesh, turntablePaths } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import { generateGarment } from './garment';
import { SPIKE_PRODUCT_IDS, garmentSpec, spikeProduct } from './product';
import { BACKGROUND_RGB, hexToRgb, render } from './raster';
import { GARMENT_ID, MANNEQUIN_ID, differenceMask, iou, separate } from './separation';

const m = buildMannequin(bodyShape('M'));
const body = buildMannequinMesh(m);
const paths = turntablePaths(m, { frames: 8 });

describe('rasterizer', () => {
  const front = render([{ ...body, color: [0.5, 0.5, 0.5], id: MANNEQUIN_ID }], paths[1]!.frames[0]!, 96, 96);

  it('draws the mannequin in the middle of the frame on the studio background', () => {
    expect(front.ids[48 * 96 + 48]).toBe(MANNEQUIN_ID);
    expect(front.ids[0]).toBe(0);
    expect([front.rgb[0], front.rgb[1], front.rgb[2]]).toEqual(BACKGROUND_RGB);
    expect(front.depth[48 * 96 + 48]!).toBeGreaterThan(250);
    expect(front.depth[48 * 96 + 48]!).toBeLessThan(330);
  });

  it('sees a mirror-symmetric silhouette from the front and the back', () => {
    const back = render([{ ...body, color: [0.5, 0.5, 0.5], id: MANNEQUIN_ID }], paths[1]!.frames[4]!, 96, 96);
    const count = (ids: Uint8Array) => ids.reduce((n, v) => n + (v ? 1 : 0), 0);
    expect(Math.abs(count(front.ids) - count(back.ids)) / count(front.ids)).toBeLessThan(0.02);
  });

  it('parses hex colours', () => {
    expect(hexToRgb('#FF0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#0f0')).toEqual([0, 1, 0]);
  });
});

describe('difference mask', () => {
  it('is empty for identical frames and finds a changed block', () => {
    const w = 10, h = 10;
    const a = new Uint8ClampedArray(w * h * 3).fill(100);
    expect(differenceMask(a, a, w, h, 14).mask.every((v) => v === 0)).toBe(true);
    const b = Uint8ClampedArray.from(a);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) b[3 * (y * w + x)] = 200;
    const { mask } = differenceMask(b, a, w, h, 14);
    const truth = new Uint8Array(w * h);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) truth[y * w + x] = 1;
    const s = iou(mask, truth);
    expect(s.intersection / s.union).toBeGreaterThan(0.7); // the 3×3 vote rounds the corners
  });
});

describe.each(SPIKE_PRODUCT_IDS)('stage 3 — separation of %s on synthetic turntable renders', (id) => {
  const spec = garmentSpec(spikeProduct(id));
  const garment = generateGarment(m, spec);

  it('derives the garment mask by difference with IoU > 0.95 against ground truth', () => {
    const report = separate(body, { ...garment, color: hexToRgb(spec.colorHex) }, paths, { width: 128, height: 128 });
    expect(report.frames).toBe(3 * 8);
    expect(report.iou).toBeGreaterThan(0.95);
    expect(report.minFrameIou).toBeGreaterThan(0.9);
    expect(report.perFrame.every((f) => f.garmentPixels > 0)).toBe(true);
  });
});

describe('stage 3 — known limitation', () => {
  it('cannot separate a garment the colour of the mannequin by difference alone (needs the segmentation model or motion signal)', () => {
    const garment = generateGarment(m, garmentSpec(spikeProduct('monochrome-03')));
    const report = separate(body, { ...garment, color: [0.5, 0.5, 0.5] }, paths, { width: 96, height: 96, frameStride: 2 });
    expect(report.iou).toBeLessThan(0.5);
    expect(GARMENT_ID).not.toBe(MANNEQUIN_ID);
  });
});
