/**
 * Look check for the avatar slices (docs/research/photo-avatar-plan.md, slices 1 and 2): skin
 * colour, lighting, the neutral head and `MountOptions.body`, through the shipped viewer's own
 * `mountGarmentView` (packages/garment-viewer), so what is rendered here is what the embed gets.
 * Not shipped and not part of `pnpm check` beyond typecheck and lint. Every picture is tagged
 * ESTIMATE. Nothing is sent anywhere: the page only GETs bundle files from this dev server.
 *
 * URL parameters: `product=<bundle dir under out/>` and `size`; `skin=rrggbb`;
 * `lighting=neutral|neutral-v2`; `head=egg|neutral-v2`; the look comparison's overrides of the
 * lighting's extras `outline` (CSS px), `shadow` (opacity), `backdrop=adaptive`, `rim`; `family=male`,
 * `height`, `shoulder`, `bust`, `waist`, `hip` (cm). `mode=head` shows the body alone (no bundle),
 * through the shipped viewer's `Stage` and `Figure`: `family`, `yaw` (degrees), `pitch`, `frame=head|body|face`.
 *
 * `window.avatarCheck.patches()` returns the median rendered colour of small patches of bare skin
 * (forehead, neck, forearm, shin) for the colour-error measurement in `avatar-renders.mjs`;
 * `garmentPatches()` the same on the garment; `contrast()` (body alone) the contrast of the skin
 * against what is next to it along the silhouette (`look-v2-renders.mjs`).
 */
import * as THREE from 'three';
import type { GarmentPayload } from '@curtain/schema';
import { buildBody, buildMannequinMesh, type Mannequin } from '@curtain/mannequin';
import { headOf, lightingOf, mountGarmentView, type GarmentView, type LookExtras } from '../../../../packages/garment-viewer/src/index';
import { fitNeckToHead } from '../../../../packages/garment-viewer/src/body';
import { Figure, Stage, meshGeometry } from '../../../../packages/garment-viewer/src/scene';
import { fitForBody } from './fitting';

const params = new URLSearchParams(location.search);
const num = (k: string): number | undefined => {
  const v = Number(params.get(k));
  return params.get(k) !== null && Number.isFinite(v) && v > 0 ? v : undefined;
};
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const tag = document.getElementById('tag')!;
const skin = /^[0-9a-fA-F]{6}$/.test(params.get('skin') ?? '') ? `#${params.get('skin')}` : null;
const lighting = lightingOf(params.get('lighting'));
const head = headOf(params.get('head'));
const extras: Partial<LookExtras> = {};
if (params.get('outline') !== null) extras.outline = Number(params.get('outline'));
if (params.get('shadow') !== null) extras.contactShadow = Number(params.get('shadow'));
if (params.get('backdrop') === 'adaptive' || params.get('backdrop') === 'cream') extras.backdrop = params.get('backdrop') as LookExtras['backdrop'];
if (params.get('rim') !== null) extras.rim = Number(params.get('rim'));
if (params.get('outlineContrast') !== null) extras.outlineContrast = Number(params.get('outlineContrast'));
const extrasTag = Object.entries(extras).map(([k, v]) => `${k} ${String(v)}`).join(' · ');
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
    avatarCheck?: {
      patches(): Record<string, { rgb: [number, number, number]; x: number; y: number }>;
      garmentPatches?(): Record<string, { rgb: [number, number, number]; x: number; y: number }>;
      contrast?(): ContrastReport;
      frameMs?(frames: number): number;
      look?: unknown;
      view: GarmentView | null;
    };
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
  const view = await mountGarmentView(canvas, { baseUrl, garment, fit, size, body, look: { skinHex: skin, head }, lighting, lookExtras: extras, onState: setState });
  tag.textContent = `ESTIMATE · ${garment.name} · size ${canvas.dataset.size ?? size} · lighting ${lighting}${extrasTag ? ` (${extrasTag})` : ''} · skin ${skin ?? 'default grey'} · head ${head}`;
  const points = skinPoints(m);
  // A bottom may cover the shin (a maxi skirt does): that patch is measured on other garments only.
  if (garment.category === 'bottom') delete points.shin;
  // Points on the garment, in front of the body: hip and thigh for every garment, bust and waist for a top or a dress.
  const hip = m.torsoAt(m.morphHeights.hip);
  const thigh = m.legAt(0.42 * m.statureCm, 1);
  const cloth: Record<string, [number, number, number]> = {
    hip: [0.25 * (hip?.a ?? 10), m.morphHeights.hip, (hip?.cz ?? 0) + (hip?.b ?? 10)],
    thigh: [thigh ? thigh.cx : 9, 0.42 * m.statureCm, (thigh ? thigh.cz + thigh.b : 6) + 2],
    knee: [8, 0.3 * m.statureCm, 12],
  };
  if (garment.category !== 'bottom') {
    const bust = m.torsoAt(m.morphHeights.chest);
    const waist = m.torsoAt(m.morphHeights.waist);
    cloth.bust = [0.3 * (bust?.a ?? 12), m.morphHeights.chest - 4, (bust?.cz ?? 0) + (bust?.b ?? 10)];
    cloth.waist = [0, m.morphHeights.waist, (waist?.cz ?? 0) + (waist?.b ?? 9)];
  }
  window.avatarCheck = {
    view,
    garmentPatches() {
      const out: Record<string, { rgb: [number, number, number]; x: number; y: number }> = {};
      for (const [name, p] of Object.entries(cloth)) {
        const at = view.toScreen(p);
        out[name] = { rgb: patchAt(at, 4), x: at.x, y: at.y };
      }
      return out;
    },
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
  const stage = new Stage(canvas, { controls: true, lighting, extras });
  // The same neck fit as the mount's typed body (`buildTypedAvatar`).
  const figure = new Figure(meshGeometry(fitNeckToHead(buildMannequinMesh(m, { head }), m).mesh), new Uint32Array(0), 0, null);
  figure.garment.visible = false;
  figure.setSkin(skin);
  stage.setSkinTone(skin);
  figure.group.rotation.y = ((num('yaw') ?? 0) * Math.PI) / 180;
  stage.scene.add(figure.group);
  const frame = params.get('frame');
  if (frame === 'body') stage.frame(60, m.statureCm);
  else {
    // `head`: head and shoulders; `face`: the face filling the view.
    const y = (frame === 'face' ? 0.94 : 0.925) * m.statureCm;
    const dist = frame === 'face' ? 58 : 105;
    const pitch = ((Number(params.get('pitch')) || 0) * Math.PI) / 180;
    stage.camera.position.set(0, y + 4 + dist * Math.sin(pitch), dist * Math.cos(pitch));
    stage.controls.target.set(0, y, 0);
    stage.controls.minDistance = 20;
    stage.controls.update();
  }
  tag.textContent = `ESTIMATE · ${family} body alone · lighting ${lighting}${extrasTag ? ` (${extrasTag})` : ''} · skin ${skin ?? 'default grey'} · head ${head}`;
  let frames = 0;
  const loop = (): void => {
    stage.render();
    frames++;
    requestAnimationFrame(loop);
  };
  loop();
  const points = skinPoints(m);
  window.avatarCheck = {
    view: null,
    look: stage.lookNow(),
    patches() {
      const out: Record<string, { rgb: [number, number, number]; x: number; y: number }> = {};
      stage.render();
      for (const [name, p] of Object.entries(points)) {
        const at = stage.toScreen(new THREE.Vector3(...p));
        out[name] = { rgb: patchAt(at), x: at.x, y: at.y };
      }
      return out;
    },
    contrast: () => silhouetteContrast(stage, figure),
    frameMs(n: number) {
      const t0 = performance.now();
      // Each frame is read back (one pixel), so its time includes the GPU's work (SwiftShader: the CPU's).
      const gl = stage.renderer.getContext();
      const px = new Uint8Array(4);
      for (let i = 0; i < n; i++) {
        stage.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.01);
        stage.render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / n;
    },
  };
  void frames;
  setState('settled');
}

export interface ContrastReport {
  /** Pixels of the silhouette edge of the bare skin that were measured. */
  edgePixels: number;
  /**
   * The silhouette's edge: at each edge pixel the stronger of two WCAG contrasts, the skin just inside
   * against what is just outside (the outline, where there is one), and that against the backdrop
   * 6 to 9 CSS px further out (the outline's own edge). Without an outline both outside samples are the
   * backdrop and this is the skin against the backdrop. 10th percentile, median, share under 3:1 (%).
   */
  edge: { p10: number; median: number; under3: number };
  /** The skin just inside the edge against the backdrop 6 to 9 CSS px outside (any outline ignored). */
  far: { p10: number; median: number; under3: number };
  /** Median colour of the skin inside the edge and of the backdrop beyond it. */
  skinEdge: string;
  backdrop: string;
}

const lum = (r: number, g: number, b: number): number => {
  const c = (v: number): number => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * Contrast along the silhouette of the bare skin. The skin mask is a second render with the body
 * in flat white and everything else hidden; the picture is the frame as drawn. For every edge
 * pixel of the mask: the mean colour of the skin 1 to 2 px inside, of what is 1 to 2 px outside
 * (near: the outline, where there is one), and of the backdrop 6 to 9 CSS px outside (far).
 */
function silhouetteContrast(stage: Stage, figure: Figure): ContrastReport {
  stage.render();
  const W = canvas.width, H = canvas.height;
  const grab = (): Uint8ClampedArray => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, W, H).data;
  };
  const picture = grab();
  // The mask: body white, nothing else drawn, no tone mapping.
  const hidden: [THREE.Object3D, boolean][] = [];
  stage.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== figure.body) {
      hidden.push([o, o.visible]);
      o.visible = false;
    }
  });
  const material = figure.body.material;
  figure.body.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const bg = stage.scene.background;
  stage.scene.background = new THREE.Color(0x000000);
  const tm = stage.renderer.toneMapping;
  stage.renderer.toneMapping = THREE.NoToneMapping;
  stage.renderer.render(stage.scene, stage.camera);
  const maskPx = grab();
  stage.renderer.toneMapping = tm;
  stage.scene.background = bg;
  figure.body.material = material;
  for (const [o, v] of hidden) o.visible = v;
  stage.render();
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = maskPx[4 * i]! > 127 ? 1 : 0;
  const dpr = W / canvas.clientWidth;
  const ring = (r0: number, r1: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let dy = -Math.ceil(r1); dy <= Math.ceil(r1); dy++) for (let dx = -Math.ceil(r1); dx <= Math.ceil(r1); dx++) {
      const d = Math.hypot(dx, dy);
      if (d >= r0 && d <= r1) out.push([dx, dy]);
    }
    return out;
  };
  const inner = ring(1, 2.5), nearRing = ring(1, 2.5), farRing = ring(6 * dpr, 9 * dpr);
  const near: number[] = [], far: number[] = [];
  const skinAcc = [0, 0, 0], bgAcc = [0, 0, 0];
  let edges = 0;
  for (let y = 12; y < H - 12; y += 1) {
    for (let x = 12; x < W - 12; x += 1) {
      const i = y * W + x;
      if (!mask[i]) continue;
      if (mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) continue;
      // An edge pixel of the skin. Sample only every other one, for speed.
      if ((x + y) % 2) continue;
      const mean = (offs: [number, number][], want: number): [number, number, number] | null => {
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of offs) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (mask[j] !== want) continue;
          r += picture[4 * j]!;
          g += picture[4 * j + 1]!;
          b += picture[4 * j + 2]!;
          n++;
        }
        return n >= 3 ? [r / n, g / n, b / n] : null;
      };
      const s = mean(inner, 1), o = mean(nearRing, 0), f = mean(farRing, 0);
      if (!s || !o || !f) continue;
      const ls = lum(...s), lo = lum(...o), lf = lum(...f);
      const c = (p: number, q: number): number => (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05);
      near.push(Math.max(c(ls, lo), c(lo, lf)));
      far.push(c(ls, lf));
      for (let c = 0; c < 3; c++) {
        skinAcc[c]! += s[c]!;
        bgAcc[c]! += f[c]!;
      }
      edges++;
    }
  }
  const stats = (v: number[]): { p10: number; median: number; under3: number } => {
    const a = [...v].sort((p, q) => p - q);
    const q = (t: number): number => Math.round((a[Math.min(a.length - 1, Math.floor(t * a.length))] ?? 0) * 100) / 100;
    return { p10: q(0.1), median: q(0.5), under3: Math.round((1000 * a.filter((c) => c < 3).length) / Math.max(1, a.length)) / 10 };
  };
  const n = Math.max(1, edges);
  return { edgePixels: edges, edge: stats(near), far: stats(far), skinEdge: hex(skinAcc[0]! / n, skinAcc[1]! / n, skinAcc[2]! / n), backdrop: hex(bgAcc[0]! / n, bgAcc[1]! / n, bgAcc[2]! / n) };
}

(params.get('mode') === 'head' ? Promise.resolve().then(headMode) : garmentMode()).catch((e: unknown) => {
  tag.textContent = `ESTIMATE · error: ${e instanceof Error ? e.message : String(e)}`;
  setState('error');
});
