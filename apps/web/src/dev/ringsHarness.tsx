/**
 * Dev-only harness (never bundled: only `dev/rings.html` loads it, under `vite` dev) that draws the
 * embed's real ResultScreen for a test body, a garment payload and ANY chart size, so the size-ring
 * overlay can be screenshot at AU 8 / 12 / 16 (`node scripts/rings-shots.mjs`). Query:
 *   ?payload=/@fs/<abs path to payload.json>&body=slim|average|curvy&size=12[&scenario=low|mid|high]
 */
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '@/index.css';
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { GarmentPayload } from '@curtain/schema';
import { adviseSize, EMPTY_ABOUT, fitForProfile, profileFromAbout, type AboutForm } from '@/embed/aboutYou';
import { ResultScreen } from '@/embed/ResultScreen';

/** The three test bodies of docs/research/step3-rings-usertest.md (cm / kg), near AU 8, 12 and 16. */
export const TEST_BODIES = {
  slim: { height: '165', weight: '54', bust: '82', waist: '64', hip: '90' },
  average: { height: '167', weight: '66', bust: '93', waist: '76', hip: '102' },
  curvy: { height: '166', weight: '82', bust: '106', waist: '86', hip: '116' },
} as const;

/** Bundle payloads carry no colour; the demo storefront gives them one (apps/api/src/demo.ts). */
function withDemoColour(g: GarmentPayload): GarmentPayload {
  if (g.primaryColorHex) return g;
  return { ...g, primaryColorHex: /skirt/.test(g.subcategory ?? '') ? '#A3243B' : '#4F8FC0' };
}

function Harness(): ReactNode {
  const q = new URLSearchParams(location.search);
  const [garment, setGarment] = useState<GarmentPayload | null>(null);
  const bodyKey = (q.get('body') ?? 'average') as keyof typeof TEST_BODIES;
  const [size, setSize] = useState(q.get('size') ?? '');
  useEffect(() => {
    void fetch(q.get('payload') ?? '').then(async (r) => setGarment(withDemoColour((await r.json()) as GarmentPayload)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!garment) return <p>loading…</p>;
  const form: AboutForm = { ...EMPTY_ABOUT, ...TEST_BODIES[bodyKey], knowsMeasurements: true, tape: true };
  const profile = profileFromAbout(form, garment.category);
  const embedFit = fitForProfile(garment, profile);
  const advice = adviseSize(embedFit.fit, 'regular');
  const selected = size || advice.size || advice.closest || garment.sizeChart[0]!.size;
  return (
    <main className="mx-auto max-w-[420px] px-4 py-4" data-testid="harness" data-recommended={advice.size ?? ''}>
      <p className="mb-2 text-[11px] text-ink-mute">
        Harness · test body “{bodyKey}” ({TEST_BODIES[bodyKey].bust}/{TEST_BODIES[bodyKey].waist}/{TEST_BODIES[bodyKey].hip} cm) · {garment.name} · showing size {selected}
      </p>
      <ResultScreen
        garment={garment}
        profile={profile}
        embedFit={embedFit}
        advice={advice}
        preference="regular"
        selected={selected}
        onSelect={setSize}
        onChoose={() => {}}
        onEdit={() => {}}
        returning={false}
        chooseFallback={null}
        chosen={null}
        currentVariantSize={null}
        units="metric"
        onUnits={() => {}}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
