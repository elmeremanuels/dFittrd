/**
 * Synthetic landmark/mask fixtures: a 170 cm standing figure in a 480×854 (9:16) frame, built in
 * centimetres and projected at 4.07 px/cm so the geometry is realistic (shoulder ≈ 40 cm wide,
 * shoulder→hip ≈ 50 cm).
 */
import { POSE, SEG } from '../landmarks';
import type { CategoryMask } from '../maskGeometry';
import type { Landmark } from '../types';

export const FRAME = { width: 480, height: 854 } as const;
export const PX_PER_CM = 4.07;
export const HEEL_Y_PX = Math.round(FRAME.height * 0.93);
export const STATURE_CM = 170;

/** y in px from a height above the floor (cm); x in px from an offset from the body centre (cm). */
export const yPx = (hCm: number): number => HEEL_Y_PX - hCm * PX_PER_CM;
export const xPx = (dxCm: number): number => FRAME.width / 2 + dxCm * PX_PER_CM;
const n = (xp: number, yp: number, visibility = 0.95): Landmark => ({ x: xp / FRAME.width, y: yp / FRAME.height, z: 0, visibility });

/** Heights (cm above floor) and half-widths (cm) of a neutral A-pose figure. */
const H = { nose: 158, eye: 160, ear: 158, mouth: 155, shoulder: 142, elbow: 114, wrist: 88, hip: 92, knee: 48, ankle: 7, heel: 2, toe: 0 };

export interface FigureOptions {
  view?: 'front' | 'side' | 'back';
  /** elbow lateral offset in cm (A-pose ≈ 30; arms at the side ≈ 21). */
  elbowX?: number;
  /** lean of the body axis in degrees (positive = hips move right). */
  tiltDeg?: number;
  visibility?: number;
  /** shift the whole figure up (px) e.g. to push the head off-frame. */
  shiftYPx?: number;
  /** scale of the figure (1 = 170 cm fills 81 % of the frame). */
  scale?: number;
}

export function figure(opts: FigureOptions = {}): Landmark[] {
  const { view = 'front', elbowX = 30, tiltDeg = 0, visibility = 0.95, shiftYPx = 0, scale = 1 } = opts;
  const lm: Landmark[] = new Array<Landmark>(33);
  const tilt = Math.tan((tiltDeg * Math.PI) / 180);
  const put = (i: number, dxCm: number, hCm: number, vis = visibility): void => {
    const lean = (H.shoulder - hCm) * tilt; // hips move right relative to the shoulders
    const yp = (yPx(hCm) - HEEL_Y_PX) * scale + HEEL_Y_PX - shiftYPx;
    lm[i] = n(xPx((dxCm + lean) * scale), yp, vis);
  };
  if (view === 'side') {
    // facing camera-left: left side towards the camera, right side occluded
    put(POSE.NOSE, -6, H.nose, 0.9);
    put(POSE.LEFT_EYE_INNER, -3, H.eye);
    put(POSE.LEFT_EYE, -3.5, H.eye);
    put(POSE.LEFT_EYE_OUTER, -4, H.eye);
    put(POSE.RIGHT_EYE_INNER, -2, H.eye, 0.3);
    put(POSE.RIGHT_EYE, -2, H.eye, 0.3);
    put(POSE.RIGHT_EYE_OUTER, -2, H.eye, 0.3);
    put(POSE.LEFT_EAR, 1, H.ear, 0.95);
    put(POSE.RIGHT_EAR, 1.5, H.ear, 0.1);
    put(POSE.MOUTH_LEFT, -4, H.mouth);
    put(POSE.MOUTH_RIGHT, -3, H.mouth, 0.4);
    put(POSE.LEFT_SHOULDER, 1, H.shoulder);
    put(POSE.RIGHT_SHOULDER, -1, H.shoulder, 0.6);
    put(POSE.LEFT_ELBOW, 3, H.elbow);
    put(POSE.RIGHT_ELBOW, -1, H.elbow, 0.5);
    put(POSE.LEFT_WRIST, 5, H.wrist);
    put(POSE.RIGHT_WRIST, 0, H.wrist, 0.5);
    for (const i of [POSE.LEFT_PINKY, POSE.LEFT_INDEX, POSE.LEFT_THUMB]) put(i, 5, H.wrist - 4);
    for (const i of [POSE.RIGHT_PINKY, POSE.RIGHT_INDEX, POSE.RIGHT_THUMB]) put(i, 0, H.wrist - 4, 0.5);
    put(POSE.LEFT_HIP, 1, H.hip);
    put(POSE.RIGHT_HIP, -1, H.hip, 0.7);
    put(POSE.LEFT_KNEE, 0, H.knee);
    put(POSE.RIGHT_KNEE, -1, H.knee, 0.7);
    put(POSE.LEFT_ANKLE, 0, H.ankle);
    put(POSE.RIGHT_ANKLE, -1, H.ankle, 0.85);
    put(POSE.LEFT_HEEL, 4, H.heel);
    put(POSE.RIGHT_HEEL, 3, H.heel, 0.85);
    put(POSE.LEFT_FOOT_INDEX, -10, H.toe);
    put(POSE.RIGHT_FOOT_INDEX, -11, H.toe, 0.85);
    return lm;
  }
  const noseVis = view === 'back' ? 0.2 : visibility;
  put(POSE.NOSE, 0, H.nose, noseVis);
  put(POSE.LEFT_EYE_INNER, 1.5, H.eye, noseVis);
  put(POSE.LEFT_EYE, 3, H.eye, noseVis);
  put(POSE.LEFT_EYE_OUTER, 4.5, H.eye, noseVis);
  put(POSE.RIGHT_EYE_INNER, -1.5, H.eye, noseVis);
  put(POSE.RIGHT_EYE, -3, H.eye, noseVis);
  put(POSE.RIGHT_EYE_OUTER, -4.5, H.eye, noseVis);
  put(POSE.LEFT_EAR, 7, H.ear);
  put(POSE.RIGHT_EAR, -7, H.ear);
  put(POSE.MOUTH_LEFT, 2, H.mouth, noseVis);
  put(POSE.MOUTH_RIGHT, -2, H.mouth, noseVis);
  put(POSE.LEFT_SHOULDER, 20, H.shoulder);
  put(POSE.RIGHT_SHOULDER, -20, H.shoulder);
  put(POSE.LEFT_ELBOW, elbowX, H.elbow);
  put(POSE.RIGHT_ELBOW, -elbowX, H.elbow);
  put(POSE.LEFT_WRIST, elbowX + 6, H.wrist);
  put(POSE.RIGHT_WRIST, -(elbowX + 6), H.wrist);
  for (const i of [POSE.LEFT_PINKY, POSE.LEFT_INDEX, POSE.LEFT_THUMB]) put(i, elbowX + 8, H.wrist - 4);
  for (const i of [POSE.RIGHT_PINKY, POSE.RIGHT_INDEX, POSE.RIGHT_THUMB]) put(i, -(elbowX + 8), H.wrist - 4);
  put(POSE.LEFT_HIP, 17, H.hip);
  put(POSE.RIGHT_HIP, -17, H.hip);
  put(POSE.LEFT_KNEE, 9, H.knee);
  put(POSE.RIGHT_KNEE, -9, H.knee);
  put(POSE.LEFT_ANKLE, 8, H.ankle);
  put(POSE.RIGHT_ANKLE, -8, H.ankle);
  put(POSE.LEFT_HEEL, 8, H.heel);
  put(POSE.RIGHT_HEEL, -8, H.heel);
  put(POSE.LEFT_FOOT_INDEX, 9, H.toe);
  put(POSE.RIGHT_FOOT_INDEX, -9, H.toe);
  return lm;
}

export interface BodyWidths {
  neck: number;
  bust: number;
  waist: number;
  hip: number;
  thigh: number;
  calf: number;
  arm: number;
}

export const FRONT_WIDTHS_CM: BodyWidths = { neck: 11, bust: 32, waist: 26, hip: 36, thigh: 17, calf: 11, arm: 9 };
export const SIDE_DEPTHS_CM: BodyWidths = { neck: 11, bust: 24, waist: 20, hip: 26, thigh: 18, calf: 11, arm: 9 };

/**
 * Paint a category mask of the figure: torso with piecewise-linear width, two legs, two arms along
 * the A-pose, a head. Skin above the "shirt" and below "shorts"; clothes in between.
 */
export function paintMask(widths: BodyWidths, view: 'front' | 'side' = 'front'): CategoryMask {
  const { width, height } = FRAME;
  const data = new Uint8Array(width * height).fill(SEG.BACKGROUND);
  const fill = (xcCm: number, hCm: number, wCm: number, cls: number): void => {
    const y = Math.round(yPx(hCm));
    if (y < 0 || y >= height) return;
    const x0 = Math.round(xPx(xcCm - wCm / 2));
    const x1 = Math.round(xPx(xcCm + wCm / 2));
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) data[y * width + x] = cls;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  // head: 160–170 cm, 15 cm wide (face skin), hair on top 2 cm
  for (let h = 158; h <= STATURE_CM; h += 0.25) fill(0, h, h > 168 ? 14 : 15, h > 168 ? SEG.HAIR : SEG.FACE_SKIN);
  // neck 150–158
  for (let h = 150; h < 158; h += 0.25) fill(0, h, widths.neck, SEG.BODY_SKIN);
  // torso 87–150: shoulders (150) → bust (125, ≈ bust-point height) → waist (110) → hip (87, fullest)
  for (let h = 87; h < 150; h += 0.25) {
    let w: number;
    if (h >= 125) w = lerp(widths.bust, view === 'front' ? 38 : widths.bust, (h - 125) / 25);
    else if (h >= 110) w = lerp(widths.waist, widths.bust, (h - 110) / 15);
    else w = lerp(widths.hip, widths.waist, (h - 87) / 23);
    fill(0, h, w, SEG.CLOTHES);
  }
  // legs 0–92 (side view: both legs overlap → one blob)
  for (let h = 0; h < 92; h += 0.25) {
    const t = h / 92;
    const w = h > 48 ? lerp(widths.calf + 2, widths.thigh, (h - 48) / 44) : lerp(9, widths.calf, t * 2);
    const cls = h > 60 ? SEG.CLOTHES : SEG.BODY_SKIN;
    if (view === 'front') {
      fill(lerp(8, 17, t) * 0 + lerp(8.5, 10, t), h, w, cls);
      fill(-lerp(8.5, 10, t), h, w, cls);
    } else {
      fill(0, h, w, cls);
    }
  }
  // arms (front only): from the shoulder (142) down to the wrist (88), A-pose
  if (view === 'front') {
    for (let h = 86; h < 142; h += 0.25) {
      const t = (142 - h) / 56;
      const xc = lerp(20, 36, t);
      fill(xc, h, widths.arm, h > 120 ? SEG.CLOTHES : SEG.BODY_SKIN);
      fill(-xc, h, widths.arm, h > 120 ? SEG.CLOTHES : SEG.BODY_SKIN);
    }
  }
  return { width, height, data };
}
