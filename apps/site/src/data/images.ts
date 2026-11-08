import sizes from './image-sizes.json';
import credits from './photo-credits.json';

export type ImageKind = 'photo' | 'screen' | 'render';

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
}

const alts: Record<string, { alt: string; estimate?: boolean }> = {
  'photos/knits-pampas-rail': { alt: 'Cream and camel knitwear on hangers along a white wall, with dried pampas grass in front.' },
  'photos/minimal-rail': { alt: 'A brass clothes rail against a white wall with grey trousers, a navy top and a striped tee.' },
  'photos/maxi-dress-corridor': { alt: 'A woman seen from behind in a flowing blue and white maxi dress, walking down a warm terracotta corridor.' },
  'photos/beach-dress-walk': { alt: 'Barefoot in a pale yellow dress, a woman walks along the waterline past a group of gulls.' },
  'photos/editorial-black-beige-1': { alt: 'Fashion editorial detail: a black and beige outfit with a clear pocket, a hand holding a pink card.' },
  'photos/editorial-black-beige-2': { alt: 'Fashion editorial close-up of a black and beige sleeve with a sheer panel, next to palm leaves.' },
  'photos/editorial-barrel': { alt: 'Fashion editorial: a model in a textured dark-grey mini outfit and black ankle boots, seated on a white barrel.' },
  'photos/editorial-black-beige-1-portrait': { alt: 'Fashion editorial detail: a black dress with a cream sleeve, a hand holding a pink card against a clear pocket.' },
  'photos/blazer-buttons': { alt: 'Someone in front of a clothing rail does up the button of a black blazer, face out of frame.' },
  'photos/draped-fabric': { alt: 'Soft folds of draped fabric in coral and lilac, gathered with a beaded trim.' },
  'photos/pattern-scissors': { alt: "Tailor's scissors on brown paper sewing patterns, with a wooden ruler." },
  'photos/fabric-rolls': { alt: 'Rolls of patterned fabric standing side by side in many colours.' },
  'photos/colour-rail': { alt: 'A crowded rail of colourful printed dresses and shirts.' },
  'photos/shell-straw-hat': { alt: 'A woven straw hat decorated with rows of cowrie shells.' },
  'product/desktop-02-product-form': { alt: 'Demo shop product form for a terracotta linen wrap dress: colour, size, Add to basket, and a black "Try it on" button under the size picker.' },
  'product/desktop-05-size-result-dialog': { alt: 'The Curtain overlay recommending size L with a 69% fit score, the fit at bust, waist and hip, and a small figure labelled as an estimate.', estimate: true },
  'product/desktop-07-size-peek-crop': { alt: 'Under the Try it on button: "Your size: L. Size L fits you well. Only you can see this. The shop can\'t."', estimate: true },
  'product/desktop-09-3d-estimate-dialog': { alt: 'A 3D estimate of a white shirt dress in size XL on a grey mannequin, badge "Estimate · not measured".', estimate: true },
  'product/desktop-09-3d-estimate-viewer': { alt: 'A 3D estimate of a white shirt dress in size XL on a grey mannequin, with size buttons XS to XL and the badge "Estimate · not measured".', estimate: true },
  'product/mobile-02-product-page': { alt: 'Phone view of the demo product page: a terracotta wrap dress.' },
  'product/mobile-04-about-you-filled': { alt: 'Phone view of the "About you" step: height 170 cm, weight 64 kg, fit preference Regular, and a "See my size" button.' },
  'product/mobile-05-size-result': { alt: 'Phone view of the result: "We recommend L", fit score 69%, compare sizes M and L.', estimate: true },
  'product/mobile-06-size-selected': { alt: 'Phone view of the demo product page with size L selected.' },
  'renders/engine-dress-M-portrait': { alt: 'Our garment engine: a synthetic white dress in size M on the standard grey mannequin, three-quarter view.', estimate: true },
  'renders/engine-dress-S-col': { alt: 'The synthetic dress in size S on the standard mannequin.', estimate: true },
  'renders/engine-dress-M-col': { alt: 'The synthetic dress in size M on the standard mannequin.', estimate: true },
  'renders/engine-dress-L-col': { alt: 'The synthetic dress in size L on the standard mannequin.', estimate: true },
};

type SizeRec = { w: number; h: number; widths: number[] };
type CreditRec = { id: string; title: string; photographer: string; photographer_url: string; source_url: string; license: string; license_url: string; provider: string };

const sizeMap = sizes as Record<string, SizeRec>;
const creditList = credits as CreditRec[];

export const images: Record<string, ImageInfo> = {};
for (const [id, s] of Object.entries(sizeMap)) {
  const a = alts[id];
  if (!a) throw new Error(`No alt text for ${id}`);
  const kind: ImageKind = id.startsWith('photos/') ? 'photo' : id.startsWith('renders/') ? 'render' : 'screen';
  const c = creditList.find((x) => x.id === id);
  if (kind === 'photo' && !c) throw new Error(`No credit for ${id}`);
  images[id] = {
    id,
    kind,
    ...s,
    alt: a.alt,
    estimate: a.estimate,
    credit: c ? c.photographer : kind === 'render' ? 'Curtain garment engine, synthetic garment' : 'Curtain demo shop (fictional products)',
    creditUrl: c?.source_url,
    license: c ? `${c.license} via ${c.provider}` : 'Our own work',
    licenseUrl: c?.license_url,
    sourceTitle: c?.title,
    anchor: id.replace(/-portrait$/, '').replace('/', '-'),
  };
}

export function img(id: string): ImageInfo {
  const i = images[id];
  if (!i) throw new Error(`Unknown image ${id}`);
  return i;
}
