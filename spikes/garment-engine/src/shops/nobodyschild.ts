/**
 * Second validation shop (refinement P4): nobodyschild.com (Nobody's Child, UK, GBP, Shopify).
 *
 * A TEST SHOP CHOSEN BY US, NOT A PARTNER. Nobody's Child has not been contacted, has not given
 * consent and has no relationship with Curtain. Only its public storefront data is read (the
 * `/products.json` endpoint, the public size guide page and five product pages; robots.txt allows
 * all three). Nothing derived from it (names, photos, renders, bundles) may be shown publicly or to
 * a third party without the shop's written permission. Raw downloads stay in data/nobodyschild/raw/
 * (gitignored).
 *
 * Why this shop: a different size system (UK 4–24 and XS–XL, with its own printed body chart and EU/US
 * labels), a structured tag taxonomy instead of description prose, a Regular/Petite length option,
 * fabric composition and the photographed size on the product page, and 1600 × 2080 photos (above the
 * 1600 px rule that Bohohippychic's 800 × 1200 failed).
 *
 * The image classification below was made by looking at every image of the five products (Nov 8,
 * 2026); it is data, not a model output, and is pinned by the sha256 in images.json.
 */
import type { ImageClassification } from '../shopSelection';
import type { CategoryMapping, ShopAdapter, ShopBodyChart } from '../shopImport';

export const NOBODYSCHILD_ID = 'nobodyschild';

export const NOBODYSCHILD_STATUS =
  'Test shop chosen by Curtain for internal validation (refinement P4). Not a partner, not contacted, no consent given. Public storefront data only; ' +
  'no public use of its name, photos or anything derived from them without the shop\'s written permission.';

export const NOBODYSCHILD_SIZE_GUIDE_URL = 'https://nobodyschild.com/pages/size-guide';

/** Shopify product types this importer maps; everything else is listed as rejected with a reason. */
export const NOBODYSCHILD_PRODUCT_TYPES: Readonly<Record<string, CategoryMapping>> = {
  Dresses: { category: 'dress' },
  Tops: { category: 'top' },
  Blouses: { category: 'top' },
  Shirts: { category: 'top' },
  Skirts: { category: 'bottom', kind: 'skirt' },
  Trousers: { category: 'bottom', kind: 'trousers' },
  Jeans: { category: 'bottom', kind: 'trousers' },
  Outerwear: { category: 'outerwear' },
  Blazers: { category: 'outerwear' },
  // Knitwear holds jumpers (tops) and cardigans (outerwear): the type alone cannot say which.
  Knitwear: { category: 'top' },
};

export function nobodyschildAdapter(chart: ShopBodyChart): ShopAdapter {
  return {
    id: NOBODYSCHILD_ID,
    domain: 'nobodyschild.com',
    brand: "Nobody's Child",
    currency: 'GBP',
    status: NOBODYSCHILD_STATUS,
    chart,
    productTypes: NOBODYSCHILD_PRODUCT_TYPES,
  };
}

export interface ImportSelection {
  productType: string;
  handle: string;
  why: string;
  runnersUp: Array<{ handle: string; whyNot: string }>;
}

/**
 * One product per garment kind the engine has a proxy for (dress, top, skirt, trousers, outerwear).
 * Criteria in order: sizes on the shop's chart, a full front and a back photo of the garment, a
 * composition on the product page, a wearing length, then how usable the photos are for stage 1b.
 */
export const NOBODYSCHILD_SELECTION: readonly ImportSelection[] = [
  {
    productType: 'Dresses',
    handle: 'ezra-midi-dress-2616487001',
    why: 'UK 4–18, 7 photos with a straight full-length front (#3) and a straight full-length back (#5) on a plain studio backdrop; "Main: 100% Cotton", wearing length 130 cm, short puff sleeves, V-neck, shirred waist.',
    runnersUp: [
      { handle: 'rebecca-midi-dress-2614747001', whyNot: '85% cotton 15% linen, 134 cm, but no straight back photo (3/4 and side views only) and two photos in a street set.' },
      { handle: 'tiffany-midi-dress-2617333001', whyNot: '100% polyester satin slip; not reviewed by eye.' },
      { handle: 'denise-cord-mini-dress-2617008001', whyNot: '100% cotton cord, 88 cm; not reviewed by eye.' },
    ],
  },
  {
    productType: 'Tops',
    handle: 'sallie-top-2617136001',
    why: 'UK 4–18, sleeveless shirred top, "Main: 100% Cotton", wearing length 53 cm; a closed top (no layering) with a full straight front (#4). The only back photo (#5) is a 3/4 back crop with the hair over the back.',
    runnersUp: [
      { handle: 'dahlia-shirt-2616973001', whyNot: '100% cotton shirt, 72 cm, but worn open over a white tank in every front photo and the back is a 3/4 turn.' },
      { handle: 'bonnie-collared-blouse-2615827001', whyNot: 'The product page prints "Wearing length is: 4.7cm" (a typo), so no length.' },
      { handle: 'augusta-blouse-short-sleeve-2517568003', whyNot: '100% cotton with a nylon trim, no wearing length; not reviewed by eye.' },
    ],
  },
  {
    productType: 'Skirts',
    handle: 'ronda-skirt-2614903002',
    why: 'UK 4–18, "Main: 100% Cotton", wearing length 90 cm, shirred elasticated waist; a full straight front (#4) and a full straight back (#5) on a plain backdrop. The matching top covers the waistband in the front photo; a red jumper over the shoulders in the back photo.',
    runnersUp: [
      { handle: 'penrith-button-through-midaxi-skirt-2614897001', whyNot: 'UK 4–24 (the widest range) and 85% cotton 15% linen, but no back photo at all (a side view at most).' },
      { handle: 'adwoa-linen-column-skirt-2615318001', whyNot: '55% linen 45% viscose, 96 cm, but no back photo (front and side crops only).' },
    ],
  },
  {
    productType: 'Trousers',
    handle: 'topaz-trousers-2616025001',
    why: 'UK 4–18, wide leg, "Main: 100% Cotton", elasticated drawstring waist, length tag "regular" (the shop\'s inside leg 79 cm); full straight front (#5) and back (#4). The print is on the front only: the back is plain.',
    runnersUp: [
      { handle: 'barrel-leg-tie-trousers-2615226001', whyNot: '100% cotton, but a barrel leg (no proxy shape for it) and the back photo has the arms raised over the head.' },
      { handle: 'rue-tailored-wide-leg-trousers-2616917001', whyNot: 'Wool blend with elastane; not reviewed by eye.' },
    ],
  },
  {
    productType: 'Outerwear',
    handle: 'tie-neck-df-jacket-2616863001',
    why: 'XS–XL (letter sizes through the shop\'s letter chart), "Main: 51% Wool, 49% Polyester", wearing length 59 cm, button front, long sleeves; the only selected product with a no-model photo (#4, on a hanger), plus a full front (#2) and a straight back (#5).',
    runnersUp: [
      { handle: 'cropped-freddie-barn-coat-2616246003', whyNot: '100% cotton, 57 cm, but worn open over a tee in every photo and no straight back.' },
      { handle: 'collared-bomber-jacket-2616826001', whyNot: '100% nylon; the product page prints no model size.' },
    ],
  },
];

export const NOBODYSCHILD_REJECTED_TYPES: Readonly<Record<string, string>> = {
  Footwear: 'Shoes: not part of the garment engine.',
  'Soft accessories': 'Accessory: no 3D asset.',
  Bags: 'Accessory.',
  Bag: 'Accessory.',
  Jewellery: 'Accessory.',
  Bracelets: 'Accessory.',
  Accessories: 'Accessory.',
  Belts: 'Accessory.',
  Scarf: 'Accessory.',
  Beauty: 'Not a garment.',
  Homeware: 'Not a garment.',
  'Gift Card': 'Not a garment.',
  Kidswear: 'Not womenswear; the shop prints a separate children\'s chart.',
  'Jumpsuits & Playsuits': 'Spans torso and legs: the engine has no combined anchor subset (as Bohohippychic\'s Jumpsuits & Sets).',
  Shorts: 'Bottom without a proxy length rule for shorts yet; not selected.',
  Leggings: 'Stretch bottom; not selected.',
  Athleisure: 'Not selected.',
  Nightwear: 'Not selected.',
  Swimwear: 'Not selected.',
  Homewear: 'Not selected.',
  Cardigans: 'Three products typed outside Knitwear; not selected.',
  Jumpers: 'Three products typed outside Knitwear; not selected.',
  Sweatshirts: 'Not selected.',
  'Chore Jacket': 'One product typed outside Outerwear; not selected.',
  '': 'Untyped products.',
};

/**
 * "plain": seamless studio backdrop (cream or white room corner) with nothing else in the frame.
 * Every photo of the five products shows the garment worn by a model except the jacket's #4.
 */
export const NOBODYSCHILD_IMAGE_CLASSIFICATION: Readonly<Record<string, readonly ImageClassification[]>> = {
  'ezra-midi-dress-2616487001': [
    { position: 1, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Full body, slight turn, one knee bent; cream studio corner.' },
    { position: 2, role: 'detail', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Seated, skirt folded over the knee; crop.' },
    { position: 3, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Straight front, full length, arms down: V-neck, button placket, short puff sleeves with ties, shirred waist panel, hem at mid-calf. Best front.' },
    { position: 4, role: 'detail', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Close-up of the bodice and shirring.' },
    { position: 5, role: 'back', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Straight back, full length, hair over the shoulders; shirred back waist, puff sleeves. Best back.' },
    { position: 6, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Three-quarter crop from the head to the knee, hands on the hips.' },
    { position: 7, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Crop to the knee, hand behind the back.' },
  ],
  'sallie-top-2617136001': [
    { position: 1, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Street set (brick wall, jasmine), worn with the matching skirt; 1120 × 1456. Same file (sha256) as ronda-skirt-2614903002 image 3.' },
    { position: 2, role: 'detail', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Crop of the shirred bodice from the chin to the hip.' },
    { position: 3, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Seated on a wall in the street set; 1120 × 1456. Same file (sha256) as ronda-skirt-2614903002 image 1.' },
    { position: 4, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Straight front, full body, with the matching Ronda skirt; the top ends just above the skirt\'s waistband. Best front. Same file (sha256) as ronda-skirt-2614903002 image 4: one photo serves both products of the set.' },
    { position: 5, role: 'back', onModel: true, background: 'plain', garmentFullyVisible: false, notes: '3/4 back crop over the shoulder; long hair covers most of the back and the hem is at the frame edge. The only back view.' },
    { position: 6, role: 'side', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Seated, arm on the knee; three-quarter front.' },
    { position: 7, role: 'detail', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Crop of the armhole and the shirring.' },
  ],
  'ronda-skirt-2614903002': [
    { position: 1, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Seated in the street set; 1120 × 1456. Same file as sallie-top-2617136001 image 3.' },
    { position: 2, role: 'detail', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Crop from the waist to the feet; the shirred yoke visible.' },
    { position: 3, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Street set, legs crossed; 1120 × 1456. Same file as sallie-top-2617136001 image 1.' },
    { position: 4, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Straight front, full length to the ankle; the matching top ends at the waistband. Best front. Same file as sallie-top-2617136001 image 4.' },
    { position: 5, role: 'back', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Straight back, full length; a white tee and a red jumper over the shoulders end at the yoke. Best back.' },
    { position: 6, role: 'detail', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Crop of the yoke and the hand lifting the skirt.' },
    { position: 7, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Full length with a white tee and the red jumper over the shoulders.' },
  ],
  'topaz-trousers-2616025001': [
    { position: 1, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Crop from the chest to the feet, hands in the pockets; the waist is under the matching top\'s hem.' },
    { position: 2, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Full body, one arm raised; slight turn.' },
    { position: 3, role: 'detail', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Close-up of the drawstring waist and the embroidered tiles.' },
    { position: 4, role: 'back', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Straight back, full length, one hand in the pocket. The back legs are PLAIN cream: the tile print is on the front only.' },
    { position: 5, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Straight front, full length, arms down; drawstring waist, wide legs to the floor. Best front.' },
  ],
  'tie-neck-df-jacket-2616863001': [
    { position: 1, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Outdoor (harbour wall), 3/4 front, scarf tied; 960 × 1248.' },
    { position: 2, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Full body, straight front, jacket open over a cream knit, scarf removed, hands in the pockets. Best on-model front.' },
    { position: 3, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Crop to the hip, jacket closed with the scarf tied.' },
    { position: 4, role: 'front', onModel: false, background: 'busy', garmentFullyVisible: true, notes: 'On a hanger against a two-tone blue wall (not a studio backdrop), buttoned, scarf tied, flat front; 960 × 1248, below the 1600 px rule. The only no-model photo of the five products.' },
    { position: 5, role: 'back', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Straight back crop from the head to the hip, head turned; collar, dropped shoulders and the back hem visible. Best back.' },
    { position: 6, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Full body, jacket closed, hands on the hips.' },
    { position: 7, role: 'detail', onModel: true, background: 'plain', garmentFullyVisible: false, notes: 'Close-up of the scarf tie.' },
    { position: 8, role: 'side', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Full body, three-quarter turn, open.' },
    { position: 9, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: 'Full body, straight front, scarf tied, jacket buttoned.' },
  ],
};
