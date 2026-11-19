// @vitest-environment jsdom
/**
 * The v1 male 2D figure is pinned (branch `claude/male-2d-v2`): the snapshot in
 * `__snapshots__/maleFigureGolden.test.tsx.snap` was written on the code before the male shape v2
 * figure existed (first commit of the branch), so adding the v2 option must leave every v1 male
 * figure, garment outline, size ring and label byte for byte as it was when v2 is off (the
 * default, and `maleShape: 'v1'`). Each case is the sha256 of the rendered markup or of the
 * geometry as JSON; equal markup draws equal pixels. The female figure has its own golden
 * (`femaleFigureGolden.test.tsx`).
 */
import { createHash } from 'node:crypto';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MOCK_GARMENTS, SYNTHETIC_MENS_CHINO_WL, SYNTHETIC_MENS_TEE, type UserBody } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { bodyGeometry, bodyPath, garmentGeometry } from '@/render/body';
import { neutralFace } from '@/render/face';
import { ringInputsFor } from '@/render/ringInputs';
import { ringOverlayFor } from '@/render/rings';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
afterEach(cleanup);

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32);

const BODIES: { name: string; m: UserBody['measurements'] | null; h?: number }[] = [
  { name: 'reference', m: null },
  { name: 'S', m: { bust: 90, waist: 78, hip: 90.5, shoulder: 40 }, h: 172.5 },
  { name: 'M', m: { bust: 98, waist: 86, hip: 96, shoulder: 40.5 }, h: 174 },
  { name: 'L', m: { bust: 106, waist: 94, hip: 102, shoulder: 41.5 }, h: 175.5 },
  { name: 'XL', m: { bust: 114, waist: 102, hip: 108, shoulder: 42.5 }, h: 177 },
  { name: 'XXL', m: { bust: 123, waist: 111, hip: 114.5, shoulder: 43.5 }, h: 179 },
  { name: 'typed', m: { bust: 104, waist: 97, hip: 99, shoulder: 47, thigh: 60 }, h: 186 },
  { name: 'chest-only', m: { bust: 132 } },
];
const SKINS = [null, '#F6EDE4', '#A56F4B', '#3A2A22'];
const GARMENTS = [SYNTHETIC_MENS_TEE, SYNTHETIC_MENS_CHINO_WL, ...MOCK_GARMENTS];

describe('male 2D figure v1: unchanged by the male shape v2 option (golden)', () => {
  it('body geometry, body path and neutral face', () => {
    const out: Record<string, string> = {};
    for (const b of BODIES) {
      const g = bodyGeometry(b.m, b.h, 'male');
      out[b.name] = sha(JSON.stringify(g) + bodyPath(g) + JSON.stringify(neutralFace(g)));
    }
    expect(out).toMatchSnapshot();
  });

  it('garment outlines of the men\'s garments and every mock garment', () => {
    const out: Record<string, string> = {};
    for (const b of BODIES) {
      const body = bodyGeometry(b.m, b.h, 'male');
      for (const garment of GARMENTS) out[`${b.name}/${garment.id}`] = sha(JSON.stringify(garmentGeometry({ garment, gaps: null, body })));
    }
    expect(out).toMatchSnapshot();
  });

  it('AvatarView markup: skins, label strips, compact, plain, loading', () => {
    const out: Record<string, string> = {};
    const garment = SYNTHETIC_MENS_TEE;
    for (const b of BODIES) {
      for (const skin of SKINS) {
        const r = render(<AvatarView garment={garment} fit={null} size="M" measurements={b.m} heightCm={b.h} skinHex={skin} labelsAt="bottom" family="male" />);
        out[`${b.name}/${skin ?? 'standard'}/bottom`] = sha(r.container.innerHTML);
        r.unmount();
      }
      const compact = render(<AvatarView compact garment={garment} fit={null} size="M" measurements={b.m} heightCm={b.h} family="male" />);
      out[`${b.name}/compact`] = sha(compact.container.innerHTML);
      compact.unmount();
      const plain = render(<AvatarView bare plain garment={garment} fit={null} size="M" measurements={b.m} heightCm={b.h} family="male" />);
      out[`${b.name}/plain`] = sha(plain.container.innerHTML);
      plain.unmount();
      const empty = render(<AvatarView garment={null} fit={null} measurements={b.m} heightCm={b.h} isLoading family="male" />);
      out[`${b.name}/empty-loading`] = sha(empty.container.innerHTML);
      empty.unmount();
    }
    expect(out).toMatchSnapshot();
  });

  it('AvatarView with fit and size rings, every size of the men\'s tee and chino on every body', () => {
    const out: Record<string, string> = {};
    for (const b of BODIES.filter((x) => x.m)) {
      for (const garment of [SYNTHETIC_MENS_TEE, SYNTHETIC_MENS_CHINO_WL]) {
        const fit = computeFit(garment, { measurements: b.m! });
        const inputs = ringInputsFor(garment);
        for (const s of fit.perSize) {
          const rings = ringOverlayFor({ garment, fit, size: s.size, measurements: b.m, heightCm: b.h, inputs, family: 'male' });
          const r = render(<AvatarView garment={garment} fit={fit} size={s.size} measurements={b.m} heightCm={b.h} labelsAt="bottom" rings={rings} hemSweepCm={inputs?.hem?.sweepCm[s.size] ?? null} family="male" />);
          out[`${b.name}/${garment.id}/${s.size}`] = sha(r.container.innerHTML + JSON.stringify(rings));
          r.unmount();
        }
      }
    }
    expect(out).toMatchSnapshot();
  });
});
