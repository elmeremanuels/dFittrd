import sizes from './image-sizes.json';
import credits from './photo-credits.json';

/** photo: CC0 stock; partner: Bohohippychic's own images (used with permission); screen: our demo shop; render: our garment engine. */
export type ImageKind = 'photo' | 'partner' | 'screen' | 'render';

export interface ImageInfo {
  id: string;
  kind: ImageKind;
  w: number;
  h: number;
  widths: number[];
  alt: string;
  /** Photographer credit for photos; for our own screens and renders a short source note. */
  credit: string;
  creditUrl?: string;
  license?: string;
  licenseUrl?: string;
  sourceTitle?: string;
  /** Anchor on /credits/ (a crop shares the credit of its source photo). */
  anchor: string;
  /** True for anything that shows a 3D garment: it must carry the ESTIMATE tag (AGENTS.md rule 3). */
  estimate?: boolean;
  /** Made by or from Bohohippychic's images (their photos, or our 3D estimate built from them). */
  partnerDerived?: boolean;
}

/** The Bohohippychic product a partner image or estimate shows, for captions and the credits page. */
export const partnerProducts: Record<string, { title: string; url: string }> = {
  azure: { title: 'Azure Palm Baby Doll Dress', url: 'https://bohohippychic.com.au/products/azure-palm-baby-doll-dress' },
  skirt: { title: 'Crimson Wildflower Maxi Skirt', url: 'https://bohohippychic.com.au/products/crimson-wildflower-maxi-skirt' },
  blouse: { title: 'Rosewater Blouse', url: 'https://bohohippychic.com.au/products/rosewater-blouse' },
  palazzo: { title: 'Rosewater Palazzo Pants', url: 'https://bohohippychic.com.au/products/rosewater-palazzo-pants' },
  cardi: { title: 'Woodstock Wanderer Knit Cardi', url: 'https://bohohippychic.com.au/products/woodstock-wanderer-knit-cardi' },
};

/** The permission behind every partner image (docs/DECISIONS.md, "Pilot permission (8 Nov 2026)"; docs/REFINEMENT.md B1). */
export const PARTNER_CREDIT = 'Courtesy of Bohohippychic, used with permission';

const alts: Record<string, { alt: string; estimate?: boolean }> = {
  'photos/knits-pampas-rail': { alt: 'Cream and camel knitwear on hangers along a white wall, with dried pampas grass in front.' },
  'photos/minimal-rail': { alt: 'A brass clothes rail against a white wall with grey trousers, a navy top and a striped tee.' },
  'photos/draped-fabric': { alt: 'Soft folds of draped fabric in coral and lilac, gathered with a beaded trim.' },
  'photos/pattern-scissors': { alt: "Tailor's scissors on brown paper sewing patterns, with a wooden ruler." },
  'photos/fabric-rolls': { alt: 'Rolls of patterned fabric standing side by side in many colours.' },
  'partner/logo': { alt: 'Boho Hippy Chic logo.' },
  'partner/azure-front': { alt: 'A model in the Azure Palm Baby Doll Dress, a short tiered dress with a pastel palm print, in a cream studio with arched niches.' },
  'partner/azure-arms': { alt: 'The Azure Palm Baby Doll Dress from the front, arms raised, showing the button placket and the tiered skirt.' },
  'partner/azure-back': { alt: 'The Azure Palm Baby Doll Dress from the back, with its yoke seam and two tiers.' },
  'partner/skirt-side': { alt: 'The Crimson Wildflower Maxi Skirt from the side, with a high slit and a border print, worn with a white tee among rattan chairs.' },
  'partner/skirt-front': { alt: 'The Crimson Wildflower Maxi Skirt from the front, full length, with a shirred drawstring waist, worn with a white tee.' },
  'partner/blouse-front': { alt: 'The Rosewater Blouse, a loose floral blouse with neck ties and short puffed sleeves, worn over white trousers.' },
  'partner/blouse-back': { alt: 'The Rosewater Blouse from the back: a gathered yoke with lace trim and a curved hem.' },
  'partner/palazzo-knit': { alt: 'The Rosewater Palazzo Pants, wide floral trousers, worn with a pale blue crochet knit in a room with macramé and baskets.' },
  'partner/palazzo-wide': { alt: 'The Rosewater Palazzo Pants mid-step, showing the full width of one wide floral leg and the drawstring waist.' },
  'partner/cardi-front': { alt: 'The Woodstock Wanderer Knit Cardi, a cream cardigan with brown and tan argyle panels, worn over jeans.' },
  'partner/cardi-back': { alt: 'The Woodstock Wanderer Knit Cardi from the back: a plain cream back with one tan and one brown sleeve.' },
  'product/desktop-02-product-form': { alt: 'Demo shop product form for a terracotta linen wrap dress: colour, size, Add to basket, and a black "Try it on" button under the size picker.' },
  'product/desktop-05-size-result-dialog': { alt: 'The Curtain overlay recommending size L with a 69% fit score, the fit at bust, waist and hip, and a small figure labelled as an estimate.', estimate: true },
  'product/desktop-07-size-peek-crop': { alt: 'Under the Try it on button: "Your size: L. Size L fits you well. Only you can see this. The shop can\'t."', estimate: true },
  'product/desktop-09-3d-estimate-dialog': { alt: 'A 3D estimate of a white shirt dress in size XL on a grey mannequin, badge "Estimate · not measured".', estimate: true },
  'product/desktop-09-3d-estimate-viewer': { alt: 'A 3D estimate of a white shirt dress in size XL on a grey mannequin, with size buttons XS to XL and the badge "Estimate · not measured".', estimate: true },
  'product/mobile-02-product-page': { alt: 'Phone view of the demo product page: a terracotta wrap dress.' },
  'product/mobile-04-about-you-filled': { alt: 'Phone view of the "About you" step: height 170 cm, weight 64 kg, fit preference Regular, and a "See my size" button.' },
  'product/mobile-05-size-result': { alt: 'Phone view of the result: "We recommend L", fit score 69%, compare sizes M and L.', estimate: true },
  'product/mobile-06-size-selected': { alt: 'Phone view of the demo product page with size L selected.' },
  'renders/engine-dress-S-col': { alt: 'The synthetic dress in size S on the standard mannequin.', estimate: true },
  'renders/engine-dress-M-col': { alt: 'The synthetic dress in size M on the standard mannequin.', estimate: true },
  'renders/engine-dress-L-col': { alt: 'The synthetic dress in size L on the standard mannequin.', estimate: true },
  'renders/azure-estimate': { alt: 'Our 3D estimate of the Azure Palm Baby Doll Dress in AU size 12 on the standard grey mannequin, front view.', estimate: true },
  'renders/azure-estimate-3q': { alt: 'Our 3D estimate of the Azure Palm Baby Doll Dress in AU size 12 on the standard mannequin, turned three-quarters.', estimate: true },
  'renders/skirt-estimate': { alt: 'Our 3D estimate of the Crimson Wildflower Maxi Skirt in AU size 12 on the standard grey mannequin, front view.', estimate: true },
  'renders/skirt-estimate-3q': { alt: 'Our 3D estimate of the Crimson Wildflower Maxi Skirt in AU size 12 on the standard mannequin, turned three-quarters.', estimate: true },
};

type SizeRec = { w: number; h: number; widths: number[] };
type CreditRec = { id: string; title: string; photographer: string; photographer_url: string; source_url: string; license: string; license_url: string; provider: string };

const sizeMap = sizes as Record<string, SizeRec>;
const creditList = credits as CreditRec[];

export const images: Record<string, ImageInfo> = {};
for (const [id, s] of Object.entries(sizeMap)) {
  const a = alts[id];
  if (!a) throw new Error(`No alt text for ${id}`);
  const kind: ImageKind = id.startsWith('photos/') ? 'photo' : id.startsWith('partner/') ? 'partner' : id.startsWith('renders/') ? 'render' : 'screen';
  const c = creditList.find((x) => x.id === id);
  if (kind === 'photo' && !c) throw new Error(`No credit for ${id}`);
  const product = partnerProducts[id.replace(/^(?:partner|renders)\//, '').split('-')[0] ?? ''];
  const partnerDerived = kind === 'partner' || (kind === 'render' && product !== undefined);
  const credit = c
    ? c.photographer
    : kind === 'partner'
      ? 'Bohohippychic'
      : kind === 'render'
        ? partnerDerived
          ? `Curtain garment engine, estimated from Bohohippychic's product photos of the ${product?.title ?? ''}`
          : 'Curtain garment engine, synthetic garment'
        : 'Curtain demo shop (fictional products)';
  images[id] = {
    id,
    kind,
    ...s,
    alt: a.alt,
    estimate: a.estimate,
    partnerDerived,
    credit,
    creditUrl: c?.source_url ?? (partnerDerived ? product?.url : undefined),
    license: c ? `${c.license} via ${c.provider}` : partnerDerived ? PARTNER_CREDIT : 'Our own work',
    licenseUrl: c?.license_url,
    sourceTitle: c?.title ?? (partnerDerived ? product?.title : undefined),
    anchor: id.replace('/', '-'),
  };
}

/** /og.jpg (public/, the social card) was made from a Bohohippychic photo: regenerate it from another image if their permission is withdrawn. */
export const ogFromPartner = true;

/** URL prefixes of every image made by or from Bohohippychic: their photos and logo, and our estimates built from them. */
export function partnerImagePrefixes(): string[] {
  return Object.values(images)
    .filter((i) => i.partnerDerived)
    .map((i) => `/img/${i.id}-`);
}

export function img(id: string): ImageInfo {
  const i = images[id];
  if (!i) throw new Error(`Unknown image ${id}`);
  return i;
}
