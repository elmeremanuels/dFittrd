/**
 * Look check for the avatar slices (docs/research/photo-avatar-plan.md, slices 1 and 2): skin
 * colour, lighting, the neutral head and `MountOptions.body`, through the shipped viewer's own
 * `mountGarmentView` (packages/garment-viewer), so what is rendered here is what the embed gets.
 * Not shipped and not part of `pnpm check` beyond typecheck and lint. Every picture is tagged
 * ESTIMATE. Nothing is sent anywhere: the page only GETs bundle files from this dev server.
 *
 * URL parameters: `product=eval/<id>` and `size`; `skin=rrggbb`; `lighting=neutral`; `head=egg`;
 * `family=male`, `height`, `shoulder`, `bust`, `waist`, `hip` (cm). `mode=head` shows the body
 * alone (no bundle): `family`, `yaw` (degrees), `frame=head|body`.
 *
 * `window.avatarCheck.patches()` returns the median rendered colour of small patches of bare skin
 * (forehead, neck, forearm, shin) for the colour-error measurement in `avatar-renders.mjs`.
 */
import type { GarmentPayload } from '@curtain/schema';
import { buildBody, buildMannequinMesh, type Mannequin } from '@curtain/mannequin';
import { mountGarmentView, type GarmentView } from '../../../../packages/garment-viewer/src/index';
import { fitForBody } from './fitting';
import { Figure, Stage, meshGeometry } from './scene';

const params = new URLSearchParams(location.search);
const num = (k: string): number | undefined => {
  const v = Number(params.get(k));
  return params.get(k) !== null && Number.isFinite(v) && v > 0 ? v : undefined;
};
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const tag = document.getElementById('tag')!;
const skin = /^[0-9a-fA-F]{6}$/.test(params.get('skin') ?? '') ? `#${params.get('skin')}` : null;
const lighting = params.get('lighting') === 'neutral' ? 'neutral' : 'classic';
const head = params.get('head') === 'egg' ? 'egg' : 'neutral';
const family = params.get('family') === 'male' ? 'male' : 'female';
const body = { family, heightCm: num('height'), shoulderCm: num('shoulder'), bust: num('bust'), waist: num('waist'), hip: num('hip') } as const;
const setState = (s: string): void => {
  document.documentElement.dataset.viewerState = s;
};

/** Points of bare skin on the drawn body, mannequin space (cm). */
function skinPoints(m: Mannequin): Record<string, [number, number, number]> {
  const S = m.statureCm;
  const arm = m.arms.left;
  const s = arm.upperArmCm + 0.5 * arm.forearmCm;
  const fore = m.armAt(s, 1);
  const shin = m.legAt(0.2 * S, 1);
  const neck = m.torsoAt(m.morphHeights.neck);
  return {
    forehead: [0, 0.972 * S, 0.05 * S],
    neck: [0, m.morphHeights.neck, neck ? neck.cz + neck.b : 5],
    forearm: [arm.joint[0] + arm.axis[0] * s, arm.joint[1] + arm.axis[1] * s, arm.joint[2] + arm.axis[2] * s + (fore ? fore.b : 3)],
    shin: [shin ? shin.cx : 8, 0.2 * S, shin ? shin.cz + shin.b : 5],
  };
}

/** Median sRGB of a (2r+1)² px patch of the WebGL canvas round a CSS-pixel position. */
function patchAt(at: { x: number; y: number }, r = 3): [number, number, number] {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  const k = canvas.width / canvas.clientWidth;
  const d = ctx.getImageData(Math.round(at.x * k) - r, Math.round(at.y * k) - r, 2 * r + 1, 2 * r + 1).data;
  const med = (c: number): number => {
    const v: number[] = [];
    for (let i = c; i < d.length; i += 4) v.push(d[i]!);
    v.sort((p, q) => p - q);
    return v[v.length >> 1]!;
  };
  return [med(0), med(1), med(2)];
}

declare global {
  interface Window {
    avatarCheck?: { patches(): Record<string, { rgb: [number, number, number]; x: number; y: number }>; view: GarmentView | null };
  }
}

async function garmentMode(): Promise<void> {
  const product = params.get('product') ?? '';
  const baseUrl = `/bundle/${product}`;
  const garment = (await (await fetch(`${baseUrl}/payload.json`)).json()) as GarmentPayload;
  const m = buildBody({ family, heightCm: body.heightCm, shoulderCm: body.shoulderCm, bust: body.bust, waist: body.waist, hip: body.hip });
  const meas = { bust: m.shape.rings.chest.circumferenceCm, waist: m.shape.rings.waist.circumferenceCm, hip: m.shape.rings.hip.circumferenceCm };
  const fit = fitForBody(garment, meas);
  const size = params.get('size') ?? fit.recommendedSize ?? '';
  const view = await mountGarmentView(canvas, { baseUrl, garment, fit, size, body, look: { skinHex: skin, head }, lighting, onState: setState });
  tag.textContent = `ESTIMATE · ${garment.name} · size ${canvas.dataset.size ?? size} · lighting ${lighting} · skin ${skin ?? 'default grey'} · head ${head}`;
  const points = skinPoints(m);
  // A bottom may cover the shin (a maxi skirt does): that patch is measured on other garments only.
  if (garment.category === 'bottom') delete points.shin;
  window.avatarCheck = {
    view,
    patches() {
      const out: Record<string, { rgb: [number, number, number]; x: number; y: number }> = {};
      for (const [name, p] of Object.entries(points)) {
        const at = view.toScreen(p);
        out[name] = { rgb: patchAt(at), x: at.x, y: at.y };
      }
      return out;
    },
  };
}

function headMode(): void {
  const m = buildBody({ family, heightCm: body.heightCm, shoulderCm: body.shoulderCm, bust: body.bust, waist: body.waist, hip: body.hip });
  const stage = new Stage(canvas, { controls: true, lighting });
  const figure = new Figure(meshGeometry(buildMannequinMesh(m, { head })), new Uint32Array(0), 0, null);
  figure.garment.visible = false;
  figure.setSkin(skin);
  figure.group.rotation.y = ((num('yaw') ?? 0) * Math.PI) / 180;
  stage.scene.add(figure.group);
  if (params.get('frame') === 'body') stage.frame(60, m.statureCm);
  else {
    const y = 0.925 * m.statureCm;
    stage.camera.position.set(0, y + 4, 105);
    stage.controls.target.set(0, y, 0);
    stage.controls.minDistance = 20;
    stage.controls.update();
  }
  tag.textContent = `ESTIMATE · ${family} body alone · lighting ${lighting} · skin ${skin ?? 'default grey'} · head ${head}`;
  const loop = (): void => {
    stage.render();
    requestAnimationFrame(loop);
  };
  loop();
  window.avatarCheck = { view: null, patches: () => ({}) };
  setState('settled');
}

(params.get('mode') === 'head' ? Promise.resolve().then(headMode) : garmentMode()).catch((e: unknown) => {
  tag.textContent = `ESTIMATE · error: ${e instanceof Error ? e.message : String(e)}`;
  setState('error');
});
