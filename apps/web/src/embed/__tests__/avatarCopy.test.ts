import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVATAR_CLAIMS, AVATAR_UI, c30Text, REMEMBER_LABEL, type AvatarLang } from '../avatarCopy';
import { facePhotoEnabled, lookForMonk, MONK_CLASSES, parseLook } from '../look';

const COPY = readFileSync(fileURLToPath(new URL('../../../../../docs/legal/avatar-consent-copy.md', import.meta.url)), 'utf8');
const section = (from: string, to: string): string => COPY.slice(COPY.indexOf(from), COPY.indexOf(to));
const DOC: Record<AvatarLang, string> = { en: section('## 2. English', '## 3. Nederlands'), nl: section('## 3. Nederlands', '## 4. Words this copy must not use') };
/** The name the copy document gives the embed's "Remember me" switch, per language. */
const DOC_REMEMBER: Record<AvatarLang, string> = { en: 'Remember me on this shop', nl: 'Onthoud mij bij deze winkel' };

describe('avatar prompt copy (docs/legal/avatar-consent-copy.md)', () => {
  it.each(['en', 'nl'] as const)('every claim shown in %s is word for word in the consent copy', (lang) => {
    expect(DOC[lang].length).toBeGreaterThan(1000);
    for (const [key, text] of Object.entries(AVATAR_CLAIMS[lang])) {
      // C30 names the "Remember me" switch; the document's name for it is a placeholder in Dutch.
      const expected = key === 'c30' ? text.replace('{remember}', DOC_REMEMBER[lang]) : text;
      expect(DOC[lang], `${lang}.${key}: ${expected}`).toContain(expected);
    }
  });

  it('C30 names the switch as the footer shows it', () => {
    expect(c30Text('en')).toBe(`If "${REMEMBER_LABEL}" is on, your colour is saved on this device with your other answers.`);
    expect(c30Text('nl')).toContain(`"${REMEMBER_LABEL}"`);
    expect(c30Text('nl')).not.toContain('{remember}');
  });

  it('uses none of the words the copy bans (section 4), in claims or labels', () => {
    const banned = [/anonym/i, /100\s?%/, /\bsecure\b/i, /\bveilig/i, /nobody can/i, /never leaves/i, /may be sent/i, /biometr/i, /\bwe only\b/i, /\blocked\b/i, /\bsafe\b/i, /accura/i, /nauwkeurig/i];
    for (const lang of ['en', 'nl'] as const) {
      const ui = AVATAR_UI[lang];
      const all = [...Object.values(AVATAR_CLAIMS[lang]), ...Object.values(ui).map((v) => (typeof v === 'function' ? v(3, 10) : v))].join('\n');
      for (const re of banned) expect(all).not.toMatch(re);
    }
  });

  it('shows no sentence about reading a colour from a photo: that is not built', () => {
    for (const lang of ['en', 'nl'] as const) {
      const all = Object.entries(AVATAR_CLAIMS[lang])
        .filter(([k]) => k !== 'c3' && k !== 'c4')
        .map(([, v]) => v)
        .join('\n');
      expect(all).not.toMatch(/photo|foto|camera/i);
    }
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

  it('the photo-based face flag is off unless the build sets it', () => {
    expect(facePhotoEnabled({})).toBe(false);
    expect(facePhotoEnabled({ VITE_AVATAR_FACE_PHOTO: '0' })).toBe(false);
    expect(facePhotoEnabled({ VITE_AVATAR_FACE_PHOTO: 'true' })).toBe(false);
    expect(facePhotoEnabled({ VITE_AVATAR_FACE_PHOTO: '1' })).toBe(true);
    expect(facePhotoEnabled()).toBe(false);
  });
});
