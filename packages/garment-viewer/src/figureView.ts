/**
 * The figure alone, without a garment (slice 6 spike of docs/research/photo-avatar-plan.md): the
 * shipped `Stage` and `Figure` on a typed body with head v2, so a face texture baked on the device
 * can be judged on the head the shopper would see. Used by the web app's dev harness
 * (`apps/web/dev/face-on-head.html`); the embed's 3D view stays `mountGarmentView`.
 *
 * Nothing here fetches, stores or sends anything: the look (skin colour, face) arrives as values.
 */
import { skinShadingOf } from './skin';
import { buildBody, buildMannequinMesh, faceUvOf } from '@curtain/mannequin';
import { fitNeckToHead } from './body';
import type { AvatarLook } from './mount';
import { Figure, Stage, meshGeometry, parseSkinHex, type Lighting } from './scene';

export type FigureFrame = 'face' | 'head' | 'body';

export interface FigureViewOptions {
  family?: 'female' | 'male';
  /** Skin colour and face; the head is always head v2 (the face frame exists only there). */
  look?: Omit<AvatarLook, 'head'> | null;
  lighting?: Lighting;
  /** `face`: the face filling the view; `head`: head and shoulders; `body`: the whole figure (default `head`). */
  frame?: FigureFrame;
}

export interface FigureView {
  setLook(look: Omit<AvatarLook, 'head'> | null | undefined): void;
  /** Turn the figure about its vertical axis, degrees (0 = facing the camera). */
  setYaw(deg: number): void;
  setFrame(frame: FigureFrame): void;
  /** Draw one frame now (for timing and screenshots). */
  render(): void;
  /** Whether a face is on the head now. */
  hasFace(): boolean;
  dispose(): void;
}

export function mountFigureView(canvas: HTMLCanvasElement, opts: FigureViewOptions = {}): FigureView {
  const m = buildBody({ family: opts.family ?? 'female' });
  const mesh = fitNeckToHead(buildMannequinMesh(m, { head: 'neutral-v2' }), m).mesh;
  const faceUv = faceUvOf(mesh);
  const stage = new Stage(canvas, { controls: true, lighting: opts.lighting ?? 'neutral-v2' });
  const figure = new Figure(meshGeometry(mesh), new Uint32Array(0), 0, null);
  figure.garment.visible = false;
  stage.scene.add(figure.group);
  let shading = skinShadingOf(undefined);
  const apply = (look: Omit<AvatarLook, 'head'> | null | undefined): void => {
    if (look?.shading !== undefined) shading = skinShadingOf(look.shading);
    figure.setSkinShading(shading, opts.lighting ?? 'neutral-v2');
    figure.setSkin(parseSkinHex(look?.skinHex));
    stage.setSkinTone(parseSkinHex(look?.skinHex));
    figure.setFace(look?.face, faceUv);
  };
  const frameTo = (frame: FigureFrame): void => {
    if (frame === 'body') {
      stage.frame(60, m.statureCm);
      return;
    }
    const y = (frame === 'face' ? 0.94 : 0.925) * m.statureCm;
    const dist = frame === 'face' ? 58 : 105;
    stage.camera.position.set(0, y + 4, dist);
    stage.controls.target.set(0, y, 0);
    stage.controls.minDistance = 20;
    stage.controls.update();
  };
  // Drawn on demand (a change of look, frame, turn or the controls), never in a loop: on a phone a loop would hold the CPU.
  let raf = 0;
  let still: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const draw = (): void => {
    if (disposed) return;
    // The frame the view stops on is drawn once more with the outline (`render(true)`).
    clearTimeout(still);
    still = setTimeout(() => {
      if (!disposed) stage.render(true);
    }, 160);
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!disposed) stage.render();
    });
  };
  stage.controls.addEventListener('change', draw);
  apply(opts.look);
  frameTo(opts.frame ?? 'head');
  draw();
  return {
    setLook: (look) => {
      if (disposed) return;
      apply(look);
      draw();
    },
    setYaw: (deg) => {
      figure.group.rotation.y = (deg * Math.PI) / 180;
      draw();
    },
    setFrame: (frame) => {
      frameTo(frame);
      draw();
    },
    render: () => {
      stage.camera.updateMatrixWorld();
      stage.render();
    },
    hasFace: () => figure.face !== null,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(still);
      stage.controls.removeEventListener('change', draw);
      figure.dispose();
      stage.controls.dispose();
      stage.renderer.dispose();
    },
  };
}
