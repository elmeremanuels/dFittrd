/**
 * The bohohippychic.com.au validation set: one product per apparel collection, why it was chosen,
 * the collections left out, and the classification of every product image. The image
 * classification was made by looking at each image (Nov 6, 2026); it is data, not a model output.
 */
import type { ShopApparelType } from './shop';

export interface ShopSelection {
  productType: ShopApparelType;
  handle: string;
  why: string;
  /** Close candidates and why they lost. */
  runnersUp: Array<{ handle: string; whyNot: string }>;
}

/**
 * Preference order (task brief): sizes 8–16 or a clear size option; at least 3 images including a
 * back view; fabric composition in the description; garment (flat) measurements in the description.
 * Ties are broken by how usable the photos are for the engine (garment fully visible, waist not
 * covered).
 */
export const SHOP_SELECTION: readonly ShopSelection[] = [
  {
    productType: 'Dresses',
    handle: 'azure-palm-baby-doll-dress',
    why: 'Only dress that meets all four criteria with 4 images: AU 8–16, front/back/3-4 views, "lightweight rayon", and a printed garment table (bust and length per size, ~7 cm over the AU body bust, so garment measurements).',
    runnersUp: [
      { handle: 'rosabelle-babydoll-dress', whyNot: 'Same garment table and fabric line, but 3 images.' },
      { handle: 'coastal-gypsy-block-print-midi-dress', whyNot: 'Cotton, 3 images; its only measurement is the chest of the size 8 sample (44 cm flat), not a table per size.' },
      { handle: 'seraphina-embroidered-mirror-work-maxi-dress', whyNot: 'Prints the AU body chart, not garment measurements. Its third image is a ghost-mannequin shot on white, the only dress photo that meets the D13 front rule (no model, plain background); swap it in if that matters more than measurements.' },
      { handle: 'capri-midi-dress', whyNot: 'No measurements; "cut oversize to allow for shrinkage" makes a body chart misleading.' },
    ],
  },
  {
    productType: 'Tops',
    handle: 'rosewater-blouse',
    why: 'AU 8–16, 5 images (4 of the blouse) with a clean straight back view, "100% lightweight rayon". It prints no measurements; the one top that does (meadowlight-blouse) shows the blouse in 2 photos only.',
    runnersUp: [
      { handle: 'meadowlight-blouse', whyNot: 'Ranks first on text (AU 8–16, rayon, printed garment bust 96–112 cm), but its third image is a different garment (a matching long dress), so only front and back of the blouse: fails "at least 3 images".' },
      { handle: 'amelie-button-back-blouse', whyNot: '4 images, 70% viscose / 30% nylon, but the back view is a 3/4 turn and the scene is busier.' },
      { handle: 'marella-coast-blouse', whyNot: 'Prints the AU body chart (not garment measurements); fabric "rayon" without a percentage.' },
      { handle: 'sandy-cove-poncho-top', whyNot: 'S–XL with a "Bust/Waist/Hip" table that is the same boilerplate the shop prints on jeans (drift-tide-denim-jeans), so not product measurements.' },
    ],
  },
  {
    productType: 'Pants',
    handle: 'rosewater-palazzo-pants',
    why: 'AU 8–16, 5 images with a back view, "100% lightweight rayon", and a printed garment table (waist, hips, length per AU size).',
    runnersUp: [
      { handle: 'byron-barrel-denim-jeans', whyNot: 'No measurements. Its fifth image is a flat-lay on white (meets the D13 front rule); 100% cotton denim; the best pants candidate for the photo contract.' },
      { handle: 'drift-tide-denim-jeans', whyNot: 'AU 8–14 only, boilerplate top chart (bust for jeans).' },
    ],
  },
  {
    productType: 'Skirts',
    handle: 'crimson-wildflower-maxi-skirt',
    why: 'AU 8–16, 3 images (side with slit, front, back), "lightweight, breathable rayon", elastic drawstring waist visible in every photo. No skirt prints measurements.',
    runnersUp: [
      { handle: 'santorini-bloom-maxi-skirt', whyNot: 'Ranks equal on text (states "100% rayon"), but a crochet top covers the waistband in all 4 photos and 2 of them crop the hem: the waist is never visible.' },
      { handle: 'pink-paradise-maxi-skirt', whyNot: 'Ties with Crimson on the text, but its third image is a different outfit, so front and back share one styling only, and a loose cami hangs over the waistband.' },
    ],
  },
  {
    productType: 'Jackets & Knits',
    handle: 'woodstock-wanderer-knit-cardi',
    why: 'No jacket or knit is sold in AU 8–16. Several knits tie on the text criteria (S-M/M-L mapped to AU 8–12 and 14–16 in the text, 3 images, wool/acrylic). This cardigan has front, 3/4 back and a straight back, a stated composition (35% wool 65% acrylic), and an open button front, the closest to a jacket in the collection.',
    runnersUp: [
      { handle: 'ocean-mist-knit', whyNot: 'Equal on text and photos (front, side, back; "Fabric 65% Acrylic 35% Wool"), but a pullover jumper, which the Tops pick already covers in shape.' },
      { handle: 'cocoa-coast-longline-knit-coat', whyNot: 'Ties on text, but no back view (front, side, front).' },
      { handle: 'sunset-stripe-knit-jacket', whyNot: 'Front, side, back, but the fabric is only "Wool Blend" (no composition).' },
      { handle: 'sandbar-cardigan', whyNot: 'S/M = AU 8–14 and M/L = AU 14–18 overlap at 14.' },
      { handle: 'nomad-cotton-jacket-chocolate', whyNot: 'Free size with only a length (68 cm) in the text, no chest: no usable chart.' },
      { handle: 'saltwater-coast-knit', whyNot: 'Free size with chest 124 cm and length 60 cm (a garment chart is possible), but only 2 images.' },
    ],
  },
];

/** Shopify product types not validated, with the reason. */
export const SHOP_REJECTED_TYPES: Readonly<Record<string, string>> = {
  Jewellery: 'Accessory: no 3D asset; accessories stay on today\'s flow (ENGINE-HANDOFF Phase 4).',
  Bags: 'Accessory: no 3D asset (ENGINE-HANDOFF Phase 4).',
  'Gift Ideas': 'Sarongs and beach towels: not fitted garments, accessory flow (ENGINE-HANDOFF Phase 4).',
  'Gift Card': 'Not a garment.',
  'Body Care': 'Not a garment.',
  Clothing: 'Catch-all type for tees, tops and dresses that belong to Tops or Dresses (e.g. starlight-cotton-*-tee, coastal-breeze-maxi-dress); not a separate category.',
  'Jumpsuits & Sets': 'Clothing category WITHOUT a validation product (see SHOP_UNCOVERED_CATEGORIES): the engine has no combined dress + bottom anchor subset for overalls, jumpsuits and pant suits yet. The founder accepts this gap or asks for a product from it.',
  '': 'Untyped products (a cami top and a lounge set) that duplicate Tops and sets.',
};

/**
 * Clothing categories of the shop that have no product in this validation set. The request was "one
 * from each category", so each entry is a deviation the founder has to accept or overrule; it is
 * printed in products.json, the data README and the generated Phase 0 report.
 */
export const SHOP_UNCOVERED_CATEGORIES: readonly { productType: string; reason: string }[] = [
  {
    productType: 'Jumpsuits & Sets',
    reason:
      'No validation product: jumpsuits, overalls and pant suits span the torso and the legs, and the engine has no combined dress + bottom anchor subset for them yet (anchoring, calibration and grading would have to be added first). It was left out for this technical reason, not on scope grounds; the founder decides whether to accept the gap or to add one product from this category.',
  },
];

export type ImageRole = 'front' | 'back' | 'side' | 'detail' | 'flatlay';

export interface ImageClassification {
  /** Shopify image position (1-based). */
  position: number;
  role: ImageRole;
  onModel: boolean;
  background: 'plain' | 'busy';
  garmentFullyVisible: boolean;
  notes: string;
}

/**
 * "plain" = seamless studio backdrop or white with nothing else in the frame; every set here has
 * props (vases, pampas, rattan chairs, macramé), so all are "busy".
 */
export const SHOP_IMAGE_CLASSIFICATION: Readonly<Record<string, readonly ImageClassification[]>> = {
  'azure-palm-baby-doll-dress': [
    { position: 1, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Full body, cream studio set with niches and vases. Hand lifts the hem on one side; sleeve ties visible.' },
    { position: 2, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: '3/4 turn, one arm on the head (sleeve raised), hand holds the hem. Legs cropped below the hem.' },
    { position: 3, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Straight front, both arms raised behind the head, so the sleeves and bodice are lifted. Best view of the button placket and tiers.' },
    { position: 4, role: 'back', onModel: true, background: 'busy', garmentFullyVisible: true, notes: '3/4 back, head turned, one arm on the wall. Shows the back yoke seam and two tiers; slight turn, not a straight back.' },
  ],
  'rosewater-blouse': [
    { position: 1, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Straight front, cropped at the thigh; hem pulled slightly by both hands. Neck ties, crochet trim on the yoke, elastic cuffs visible. Worn over white pants.' },
    { position: 2, role: 'side', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Profile to the left; hand in pocket lifts the hem on one side.' },
    { position: 3, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Full body, garment small in frame (about 400 px tall), untucked over white wide-leg pants.' },
    { position: 4, role: 'back', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Straight back, head turned. Back yoke with lace trim and gathers, curved hem, elastic cuffs. Best back photo in the set.' },
    { position: 5, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: false, notes: 'Styled as a set with the matching palazzo pants; the blouse is worn open and knotted above the midriff, so its shape is not representative. Same file (sha256) as rosewater-palazzo-pants image 5.' },
  ],
  'rosewater-palazzo-pants': [
    { position: 1, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: false, notes: 'Different shoot (stone wall, macramé, baskets). A blue crochet knit hangs over the waistband; hands in pockets. Hem to the floor visible.' },
    { position: 2, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Crop from the midriff to the floor: paper-bag elastic waist, drawstring, side pocket; one leg stepped out so the wide leg spreads.' },
    { position: 3, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Full body with a white crop top; waistband and full leg width visible. Best front photo for the pants.' },
    { position: 4, role: 'back', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Back crop from the waist down; one leg on a step, so the legs are asymmetric. Elastic back waist visible.' },
    { position: 5, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Set with the matching blouse (worn open); waistband partly visible. Same file (sha256) as rosewater-blouse image 5.' },
  ],
  'crimson-wildflower-maxi-skirt': [
    { position: 1, role: 'side', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Side/3-4 back view from the left; shows a high side slit, the tier seam with the border print, and the drawstring. White tee tucked at the waist.' },
    { position: 2, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Straight front, full length to the feet; shirred waistband with drawstring and tassels visible; tee over the top edge.' },
    { position: 3, role: 'back', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Straight back, full length; shirred waistband visible below the tee.' },
  ],
  'woodstock-wanderer-knit-cardi': [
    { position: 1, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Front, cropped at the thigh; argyle intarsia front, 4 buttons, deep V, lace cami under it; hands pull the hem slightly. Sleeves differ in colour (brown and tan).' },
    { position: 2, role: 'side', onModel: true, background: 'busy', garmentFullyVisible: true, notes: '3/4 back over the shoulder; drop shoulder and ribbed hem visible; hair covers part of the back.' },
    { position: 3, role: 'back', onModel: true, background: 'busy', garmentFullyVisible: true, notes: 'Straight back: plain cream back, drop shoulders, contrast sleeves (tan left, brown right), ribbed hem.' },
  ],
};
