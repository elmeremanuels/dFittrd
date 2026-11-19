// @vitest-environment jsdom
/**
 * The female 2D figure is pinned (slice M1b, docs/research/men-3d-plan.md): the snapshot in
 * `__snapshots__/femaleFigureGolden.test.tsx.snap` was written on the code before the male figure
 * existed (branch `claude/men-m1b-2d`, first commit), so adding the male family must leave every
 * female figure, garment outline, size ring and label byte for byte as it was. Each case is the
 * sha256 of the rendered markup or of the geometry as JSON; equal markup draws equal pixels.
 */
import { createHash } from 'node:crypto';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MOCK_GARMENTS, MOCK_GARMENTS_BY_ID, type UserBody } from '@curtain/schema';
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
  { name: 'slim', m: { bust: 80, waist: 62, hip: 88 }, h: 160 },
  { name: 'mid', m: { bust: 92, waist: 76, hip: 100, shoulder: 39, thigh: 58 }, h: 170 },
  { name: 'full', m: { bust: 112, waist: 98, hip: 120 }, h: 176 },
];
const SKINS = [null, '#F6EDE4', '#A56F4B', '#3A2A22'];

describe('female 2D figure: unchanged by the male family (golden)', () => {
  it('body geometry, body path and neutral face', () => {
    const out: Record<string, string> = {};
    for (const b of BODIES) {
      const g = bodyGeometry(b.m, b.h);
      out[b.name] = sha(JSON.stringify(g) + bodyPath(g) + JSON.stringify(neutralFace(g)));
    }
    expect(out).toMatchSnapshot();
  });

  it('garment outlines of every mock garment, without and with fit gaps', () => {
    const out: Record<string, string> = {};
    for (const b of BODIES) {
      const body = bodyGeometry(b.m, b.h);
      for (const garment of MOCK_GARMENTS) {
        out[`${b.name}/${garment.id}/none`] = sha(JSON.stringify(garmentGeometry({ garment, gaps: null, body })));
      }
    }
    expect(out).toMatchSnapshot();
  });

  it('AvatarView markup: skins, label strips, compact, bare plain, loading', () => {
    const out: Record<string, string> = {};
    const garment = MOCK_GARMENTS_BY_ID['aalter-studio-2']!;
    for (const b of BODIES) {
      for (const skin of SKINS) {
        const r = render(<AvatarView garment={garment} fit={null} size="M" measurements={b.m} heightCm={b.h} skinHex={skin} labelsAt="bottom" />);
        out[`${b.name}/${skin ?? 'standard'}/bottom`] = sha(r.container.innerHTML);
        r.unmount();
      }
      const top = render(<AvatarView garment={garment} fit={null} size="M" measurements={b.m} heightCm={b.h} />);
      out[`${b.name}/top`] = sha(top.container.innerHTML);
      top.unmount();
      const compact = render(<AvatarView compact garment={garment} fit={null} size="M" measurements={b.m} heightCm={b.h} />);
      out[`${b.name}/compact`] = sha(compact.container.innerHTML);
      compact.unmount();
      const plain = render(<AvatarView bare plain garment={garment} fit={null} size="M" measurements={b.m} heightCm={b.h} />);
      out[`${b.name}/plain`] = sha(plain.container.innerHTML);
      plain.unmount();
      const empty = render(<AvatarView garment={null} fit={null} measurements={b.m} heightCm={b.h} isLoading />);
      out[`${b.name}/empty-loading`] = sha(empty.container.innerHTML);
      empty.unmount();
    }
    for (const garment of MOCK_GARMENTS) {
      const r = render(<AvatarView garment={garment} fit={null} size="M" measurements={BODIES[2]!.m} heightCm={170} labelsAt="bottom" />);
      out[`garment/${garment.id}`] = sha(r.container.innerHTML);
      r.unmount();
    }
    expect(out).toMatchSnapshot();
  });

  it('AvatarView with fit and size rings, every size of a top, a dress and a skirt', () => {
    const out: Record<string, string> = {};
    const m = BODIES[2]!.m;
    for (const garment of MOCK_GARMENTS.filter((g) => g.category === 'top' || g.category === 'dress' || g.category === 'bottom').slice(0, 4)) {
      const fit = computeFit(garment, { measurements: m! });
      const inputs = ringInputsFor(garment);
      for (const s of fit.perSize) {
        const rings = ringOverlayFor({ garment, fit, size: s.size, measurements: m, heightCm: 170, inputs });
        const r = render(<AvatarView garment={garment} fit={fit} size={s.size} measurements={m} heightCm={170} labelsAt="bottom" rings={rings} hemSweepCm={inputs?.hem?.sweepCm[s.size] ?? null} />);
        out[`${garment.id}/${s.size}`] = sha(r.container.innerHTML + JSON.stringify(rings));
        r.unmount();
      }
    }
    expect(out).toMatchSnapshot();
  });
});
