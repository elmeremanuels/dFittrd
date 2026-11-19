/**
 * Dev-only harness (never bundled: only `dev/skin.html` loads it, under `vite` dev) for the skin
 * review of branch claude/skin-v2 (D22 point 3): the real `AvatarView` in one Monk swatch, flat or
 * skin-v2, bare or with a garment payload, so `scripts/skin-2d-shots.mjs` can screenshot and
 * measure it. Query: ?monk=1..10&shading=flat|skin-v2[&family=male][&payload=/@fs/<abs payload.json>][&mask=1]
 * `mask=1` draws only the body's fill in white on black (the measuring mask).
 */
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '@/index.css';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { GarmentPayload } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { fitForProfile, profileFromAbout, EMPTY_ABOUT, type AboutForm } from '@/embed/aboutYou';
import { lookForMonk } from '@/embed/look';
import { skin2dShadingOf } from '@/render/skin2d';

const BODY = { height: '167', weight: '66', bust: '93', waist: '76', hip: '102' } as const;

function Harness(): ReactNode {
  const q = new URLSearchParams(location.search);
  const monk = Number(q.get('monk') ?? '6');
  const look = lookForMonk(monk);
  const shading = skin2dShadingOf(q.get('shading'));
  const family = q.get('family') === 'male' ? 'male' : 'female';
  const payload = q.get('payload');
  const [garment, setGarment] = useState<GarmentPayload | null | undefined>(payload ? undefined : null);
  useEffect(() => {
    if (payload) void fetch(payload).then(async (r) => {
        const g = (await r.json()) as GarmentPayload;
        setGarment({ ...g, primaryColorHex: g.primaryColorHex ?? '#4F8FC0' });
      });
  }, [payload]);
  const ref = useRef<HTMLElement>(null);
  const mask = !!q.get('mask');
  useLayoutEffect(() => {
    // The measuring mask: only the body's fill, white on black; everything else of the page hidden.
    const root = ref.current;
    if (!mask || !root) return;
    const body = root.querySelector<SVGPathElement>('[data-testid="figure-body"]');
    const svg = root.querySelector('svg');
    if (!body || !svg) return;
    document.body.style.background = '#000';
    for (const el of Array.from(root.querySelectorAll<HTMLElement | SVGElement>('*'))) {
      if (el === svg || el.contains(svg)) {
        el.style.background = '#000';
        el.style.boxShadow = 'none';
        el.style.filter = 'none';
        el.style.border = 'none';
      } else if (!svg.contains(el)) el.style.visibility = 'hidden';
    }
    for (const el of Array.from(svg.children)) if (el.tagName !== 'defs' && !el.contains(body)) (el as SVGElement).style.display = 'none';
    const g = body.parentElement!;
    for (const el of Array.from(g.children)) if (el !== body) (el as SVGElement).style.display = 'none';
    body.style.fill = '#fff';
    body.style.stroke = 'none';
  });
  if (garment === undefined) return <p>loading…</p>;
  const form: AboutForm = { ...EMPTY_ABOUT, ...BODY, knowsMeasurements: true, tape: true };
  const profile = profileFromAbout(form, garment?.category ?? 'dress');
  const embedFit = garment ? fitForProfile(garment, profile) : null;
  const size = embedFit?.fit.recommendedSize ?? null;
  return (
    <main ref={ref} className="mx-auto h-[432px] w-[240px]" data-testid="harness" data-ready="1">
      <AvatarView garment={garment} fit={embedFit?.fit ?? null} size={size} measurements={embedFit?.userBody.measurements ?? null} heightCm={Number(BODY.height)} skinHex={look?.hex ?? null} labelsAt="bottom" family={family} skinShading={shading} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
