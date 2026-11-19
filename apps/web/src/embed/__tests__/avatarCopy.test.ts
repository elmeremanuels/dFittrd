import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { c30Parts, c30Text } from '../avatarCopy';
import { faceOnHeadEnabled, facePhotoEnabled, facePhotoMode, lookForMonk, MONK_CLASSES, parseAnyLook, parseLook } from '../look';
import { embedStrings } from '../strings';

const COPY = readFileSync(fileURLToPath(new URL('../../../../../docs/legal/avatar-consent-copy.md', import.meta.url)), 'utf8');
const section = (from: string, to: string): string => COPY.slice(COPY.indexOf(from), COPY.indexOf(to));
/** D21: only the English section is shipped. The Dutch section stays in the document as source material. */
const DOC = section('## 2. English', '## 3. Nederlands');
const { claims: CLAIMS, ui: UI } = embedStrings('en').avatar;
const REMEMBER_LABEL = embedStrings('en').rememberLabel;

describe('avatar prompt copy (docs/legal/avatar-consent-copy.md)', () => {
  it('every claim shown is word for word in the English consent copy', () => {
    expect(DOC.length).toBeGreaterThan(1000);
    for (const [key, text] of Object.entries(CLAIMS)) {
      // C30 names the "Remember me" switch by the label the footer shows.
      const expected = key === 'c30' ? text.replace('{remember}', REMEMBER_LABEL) : text;
      expect(DOC, `${key}: ${expected}`).toContain(expected);
    }
  });

  it('C30 names the switch as the footer shows it, and is the document\'s sentence', () => {
    expect(REMEMBER_LABEL).toBe('Remember me on this shop');
    expect(c30Text()).toBe(`If "${REMEMBER_LABEL}" is on, your colour is saved on this device with your other answers.`);
    const row = DOC.split('\n').find((l) => l.startsWith('| C30'))!;
    expect(c30Text()).toBe(row.split('|')[2]!.trim());
    const parts = c30Parts();
    expect(parts.label).toBe(REMEMBER_LABEL);
    expect(`${parts.before}${parts.label}${parts.after}`).toBe(c30Text());
  });

  it('the face-on-head spike row says variant A of the copy word for word (the photo stays on the device)', () => {
    const f = embedStrings('en').avatar.faceSpike;
    for (const key of ['c6', 'c7', 'c9', 'yes', 'no', 'c27'] as const) expect(DOC, `${key}: ${f[key]}`).toContain(f[key]);
    // Variant B (the D19 server route) is never shown by this build.
    for (const v of Object.values(f)) expect(v).not.toMatch(/\bsend\b|deleted right after/i);
    expect(f.c7).toBe('The photo stays on your device. It is never sent to us.');
  });

  it('the live face photo rows (slices 4 and 5) say variant A of the copy word for word', () => {
    const { claims: c, ui } = embedStrings('en').avatar.facePhoto;
    for (const [key, text] of Object.entries(c)) {
      // C5 carries the age of the document's placeholder, "[16]".
      const expected = key === 'c5' ? text.replace('{age}', '[16]') : text;
      expect(DOC, `${key}: ${expected}`).toContain(expected);
    }
    // The variant A cells, exactly (variant B, the D19 server route, is never shown by this build).
    const cell = (id: string, col: number): string => DOC.split('\n').find((l) => l.startsWith(`| ${id} `))!.split('|')[col]!.trim();
    expect(c.c6).toBe(cell('C6', 2));
    expect(c.c7).toBe(cell('C7', 2));
    expect(c.c11).toBe(cell('C11', 2));
    expect(c.c12).toBe(cell('C12', 2));
    expect(c.c9).toBe(cell('C9, switched off again', 2));
    expect(c.c26).toBe(cell('C26, on yes', 2));
    expect(c.c19).toBe(cell('C19', 3));
    expect(c.c20).toBe(cell('C20', 3));
    expect(DOC).toContain(`Switch: **${c.c19Label}**`);
    expect(DOC).toContain(`Button: **${c.c20Label}**`);
    expect(DOC).toContain(`| Yes button | **${c.yes}** |`);
    expect(DOC).toContain(`| No button | **${c.no}** |`);
    const all = [...Object.values(c), ...Object.values(ui).flatMap((v) => (typeof v === 'function' ? [v(6, 10)] : typeof v === 'string' ? [v] : Object.values(v)))];
    for (const v of all) expect(v).not.toMatch(/\bsend\b|\bsent to curtain\b|deleted right after/i);
    // The labels promise nothing about data: no "stays", "never", "deleted", "saved", "stored" in them.
    for (const v of Object.values(ui).flatMap((x) => (typeof x === 'function' ? [x(6, 10)] : typeof x === 'string' ? [x] : Object.values(x)))) expect(v).not.toMatch(/\b(stays|never|deleted|saved|stored|private)\b/i);
  });

  it('credits the Monk Skin Tone Scale (CC BY 4.0)', () => {
    expect(UI.swatchCredit).toMatch(/Monk Skin Tone Scale.*Ellis Monk.*CC BY 4\.0/);
  });

  it('uses none of the words the copy bans (section 4), in claims or labels', () => {
    const banned = [/anonym/i, /100\s?%/, /\bsecure\b/i, /nobody can/i, /never leaves/i, /may be sent/i, /biometr/i, /\bwe only\b/i, /\blocked\b/i, /\bsafe\b/i, /accura/i];
    const fpUi = embedStrings('en').avatar.facePhoto.ui;
    const all = [
      ...Object.values(CLAIMS),
      ...Object.values(embedStrings('en').avatar.faceSpike),
      ...Object.values(embedStrings('en').avatar.facePhoto.claims),
      ...Object.values(fpUi).flatMap((v) => (typeof v === 'function' ? [v(3, 10)] : typeof v === 'string' ? [v] : Object.values(v))),
      ...Object.values(UI).map((v) => (typeof v === 'function' ? v(3, 10) : v)),
    ].join('\n');
    for (const re of banned) expect(all).not.toMatch(re);
  });

  it('shows no sentence about reading a colour from a photo: that is not built', () => {
    const all = Object.entries(CLAIMS)
      .filter(([k]) => k !== 'c3' && k !== 'c4')
      .map(([, v]) => v)
      .join('\n');
    expect(all).not.toMatch(/photo|camera/i);
  });
});

describe('skin look', () => {
  it('has the ten Monk classes, each one swatch', () => {
    expect(MONK_CLASSES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const hexes = MONK_CLASSES.map((n) => lookForMonk(n)!.hex);
    expect(new Set(hexes).size).toBe(10);
    for (const h of hexes) expect(h).toMatch(/^#[0-9A-F]{6}$/);
    expect(lookForMonk(0)).toBeNull();
    expect(lookForMonk(11)).toBeNull();
    expect(lookForMonk(2.5)).toBeNull();
  });

  it('reads back only a look that is exactly a swatch the shopper could have picked', () => {
    const look = lookForMonk(6)!;
    expect(parseLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
    expect(parseLook({ ...look, hex: '#123456' })).toBeNull();
    expect(parseLook({ ...look, source: 'photo' })).toBeNull();
    expect(parseLook(null)).toBeNull();
    expect(parseLook('#A07E56')).toBeNull();
  });

  it('the face photo mode: off by default, "1" is the coming-soon row, only "live" is live', () => {
    expect(facePhotoMode({})).toBe('off');
    expect(facePhotoMode({ VITE_AVATAR_FACE_PHOTO: '1' })).toBe('soon');
    expect(facePhotoMode({ VITE_AVATAR_FACE_PHOTO: 'live' })).toBe('live');
    expect(facePhotoMode({ VITE_AVATAR_FACE_PHOTO: 'true' })).toBe('off');
    expect(facePhotoMode({ VITE_AVATAR_FACE_PHOTO: 'LIVE' })).toBe('off');
    expect(facePhotoMode()).toBe('off');
  });

  it('a look read with the face may come from the photo, still exactly a swatch', () => {
    const look = lookForMonk(6)!;
    expect(parseAnyLook({ ...look, source: 'photo' })).toEqual({ ...look, source: 'photo' });
    expect(parseAnyLook(look)).toEqual(look);
    expect(parseAnyLook({ ...look, source: 'camera' })).toBeNull();
    expect(parseAnyLook({ ...look, source: 'photo', hex: '#000000' })).toBeNull();
  });

  it('the photo-based face flag is off unless the build sets it', () => {
    expect(facePhotoEnabled({})).toBe(false);
    expect(facePhotoEnabled({ VITE_AVATAR_FACE_PHOTO: '0' })).toBe(false);
    expect(facePhotoEnabled({ VITE_AVATAR_FACE_PHOTO: 'true' })).toBe(false);
    expect(facePhotoEnabled({ VITE_AVATAR_FACE_PHOTO: '1' })).toBe(true);
    expect(facePhotoEnabled()).toBe(false);
  });

  it('the face-on-head spike flag is off unless the build sets it to 1', () => {
    expect(faceOnHeadEnabled({})).toBe(false);
    expect(faceOnHeadEnabled({ VITE_AVATAR_FACE_ON_HEAD: 'true' })).toBe(false);
    expect(faceOnHeadEnabled({ VITE_AVATAR_FACE_ON_HEAD: '1' })).toBe(true);
    expect(faceOnHeadEnabled()).toBe(false);
  });
});
