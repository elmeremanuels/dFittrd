import { describe, expect, it } from 'vitest';
import { FEATURES_VERSION, garmentFeatures, parseFeatures } from './features';

describe('garment features from the description', () => {
  it('reads the five Bohohippychic products as the shop words them', () => {
    // Phrases from the descriptions in data/bohohippychic/raw/ (rebuilt into products.json by shop:bohohippychic).
    const blouse = garmentFeatures('Designed with a button-down front, gentle gathering at the shoulders, and airy half sleeves finished with elastic cuffs', 'top');
    expect(blouse).toMatchObject({ sleeve: 'half', front: 'buttoned' });
    expect(blouse.neckline).toBeUndefined();
    const cardi = garmentFeatures('Designed with a flattering deep V neckline, oversized button front, and a relaxed easy-to-layer fit, this knit looks beautiful thrown over a lace cami. Deep V neckline with button front', 'outerwear');
    expect(cardi).toMatchObject({ front: 'buttoned', neckline: 'deep-v' });
    expect(cardi.sleeve).toBeUndefined(); // "thrown over a lace cami" names another garment
    const dress = garmentFeatures('The button-down front adds a touch of structure. Drawstring details on the sleeves bring a playful boho twist', 'dress');
    expect(dress).toMatchObject({ front: 'buttoned' });
    expect(dress.sleeve).toBeUndefined();
    expect(garmentFeatures('Perfect for pairing with the matching blouse or the Luna Cami', 'bottom').evidence).toEqual([]);
  });

  it('knows sleeve styles, open fronts and V-necks; reads nothing for bottoms', () => {
    expect(garmentFeatures('a sleeveless shell', 'top').sleeve).toBe('sleeveless');
    expect(garmentFeatures('three-quarter sleeves', 'top').sleeve).toBe('three-quarter');
    expect(garmentFeatures('3/4 sleeve tunic', 'dress').sleeve).toBe('three-quarter');
    expect(garmentFeatures('short sleeves', 'top').sleeve).toBe('short');
    expect(garmentFeatures('long-sleeved and cosy', 'outerwear').sleeve).toBe('long');
    expect(garmentFeatures('an open-front kimono', 'outerwear').front).toBe('open');
    expect(garmentFeatures('a V-neck tee', 'top').neckline).toBe('v');
    expect(garmentFeatures('long sleeves, open front', 'bottom')).toEqual({ version: FEATURES_VERSION, evidence: [] });
  });

  it('reads products.json back without trusting unknown values', () => {
    expect(parseFeatures({ sleeve: 'half', front: 'open', neckline: 'deep-v', evidence: ['x', 3] })).toEqual({ version: FEATURES_VERSION, sleeve: 'half', front: 'open', neckline: 'deep-v', evidence: ['x'] });
    expect(parseFeatures({ sleeve: 'huge', front: 'zipped', neckline: 'boat' })).toEqual({ version: FEATURES_VERSION, evidence: [] });
    expect(parseFeatures(undefined)).toBeUndefined();
    expect(parseFeatures('half')).toBeUndefined();
  });
});
