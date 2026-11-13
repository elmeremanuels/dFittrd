/**
 * Cases for the audience inference, shared by the TypeScript test and the PHP twin
 * (`packages/woocommerce-plugin/scripts/export-fixtures.mjs` writes them with the answers of
 * `inferAudienceDecision`; `tests/audience.test.php` replays them).
 */
import type { GarmentAudience } from '../garment';
import type { AudienceHints, AudienceSource } from './audience';

export interface AudienceCase {
  name: string;
  hints: AudienceHints;
  /** `null` = no audience on the payload. */
  audience: GarmentAudience | null;
  source: AudienceSource | null;
}

const c = (name: string, hints: AudienceHints, audience: GarmentAudience | null, source: AudienceSource | null): AudienceCase => ({ name, hints, audience, source });

export const AUDIENCE_CASES: readonly AudienceCase[] = [
  // Title words.
  c('men in a title', { title: 'Men Oxford Shirt' }, 'men', 'title'),
  c('mens in a title', { title: 'Mens Slim Jeans' }, 'men', 'title'),
  c("men's in a title", { title: "Men's Oxford Shirt" }, 'men', 'title'),
  c('typographic apostrophe', { title: 'Men’s Oxford Shirt' }, 'men', 'title'),
  c('upper case', { title: "MEN'S CREW NECK TEE" }, 'men', 'title'),
  c('heren in a title', { title: 'Overhemd heren wit' }, 'men', 'title'),
  c('Dutch compound', { title: 'Herenjeans slim fit' }, 'men', 'title'),
  c('German compound', { title: 'Herrenhemd Oxford' }, 'men', 'title'),
  c('French', { title: "Chemise pour l'homme" }, 'men', 'title'),
  c('menswear', { title: 'Menswear Chino' }, 'men', 'title'),
  c("women's in a title", { title: "Women's Linen Shirt" }, 'women', 'title'),
  c('dames in a title', { title: 'Jurk dames zwart' }, 'women', 'title'),
  c('Dutch women compound', { title: 'Damesjas wol' }, 'women', 'title'),
  c('ladies', { title: "Ladies' Cardigan" }, 'women', 'title'),

  // False positives: a word that only contains "men" is not the word "men".
  c('women contains men', { title: 'Women Linen Shirt' }, 'women', 'title'),
  c('womens contains mens', { title: 'Womens Slim Jeans' }, 'women', 'title'),
  c("women's contains men's", { title: "Women's Oxford Shirt" }, 'women', 'title'),
  c('womenswear contains menswear', { productType: 'Womenswear' }, 'women', 'productType'),
  c('female contains male', { tags: ['female'] }, 'women', 'tags'),
  c('garment contains men', { title: 'Garment-dyed tee' }, null, null),
  c('element, cement, moment', { title: 'Element Cement Moment Tee' }, null, null),
  c('amendment, mental, menu', { title: 'Amendment mental menu tee' }, null, null),
  c('mensen is Dutch for people', { title: 'T-shirt voor alle mensen' }, null, null),
  c('herenhuis is a town house', { title: 'Herenhuis poster' }, null, null),
  c('hereniging is a reunion', { title: 'Hereniging sweater' }, null, null),
  c('damast is a fabric', { title: 'Damast blouse' }, null, null),
  c('boyfriend jeans are not men’s', { title: 'Boyfriend Jeans' }, null, null),
  c("women's boyfriend jeans", { title: "Women's Boyfriend Jeans" }, 'women', 'title'),
  c('menswear-inspired is a style', { title: 'Menswear-inspired blazer' }, null, null),
  c('menswear-inspired on a women’s product', { title: "Women's menswear-inspired blazer" }, 'women', 'title'),
  c('man in a title is not read', { title: 'Iron Man Tee' }, null, null),
  c('woman in a title is not read', { title: 'Wonder Woman Hoodie' }, null, null),
  c("no man's land", { title: "No Man's Land Tee" }, null, null),
  c('human, Manchester, mango', { title: 'Human Manchester Mango Tee' }, null, null),
  c('nothing to read', { title: 'Linen Wrap Dress', productType: 'Dresses', tags: ['summer', 'linen'] }, null, null),
  c('empty hints', {}, null, null),

  // Unisex.
  c('unisex word', { title: 'Unisex Hoodie' }, 'unisex', 'title'),
  c('men and women in one title', { title: 'Hoodie for men and women' }, 'unisex', 'title'),
  c('dames en heren', { title: 'Sjaal dames en heren' }, 'unisex', 'title'),
  c('gender neutral', { title: 'Gender-neutral overshirt' }, 'unisex', 'title'),
  c('both tags', { tags: ['men', 'women'] }, 'unisex', 'tags'),
  c('both collections', { collections: ['Men', 'Women', 'Sale'] }, 'unisex', 'collections'),

  // Structured fields and their order.
  c('product type', { productType: "Men's Shirts", title: 'Oxford Shirt' }, 'men', 'productType'),
  c('product type Man', { productType: 'Man', title: 'Oxford Shirt' }, 'men', 'productType'),
  c('category path', { category: ['Heren > Jeans'], title: 'Slim jeans' }, 'men', 'category'),
  c('category path, women', { category: ['Women > Dresses'], title: 'Wrap dress' }, 'women', 'category'),
  c('tags', { tags: ['summer', 'mens', 'linen'], title: 'Linen shirt' }, 'men', 'tags'),
  c('tag with a prefix', { tags: ['gender:men'] }, 'men', 'tags'),
  c('collections', { collections: ['Heren', 'Nieuw binnen'], title: 'Overhemd' }, 'men', 'collections'),
  c('collection handle', { collections: ['mens-shirts'] }, 'men', 'collections'),
  c('attribute', { attribute: ['Heren'], title: 'Jeans' }, 'men', 'attribute'),
  c('attribute beats the title', { attribute: ['Dames'], title: "Men's style shirt" }, 'women', 'attribute'),
  c('product type beats tags', { productType: 'Womens tops', tags: ['men'] }, 'women', 'productType'),
  c('tags beat the title', { tags: ['women'], title: 'Men in Black Tee' }, 'women', 'tags'),
  c('title beats collections', { title: "Women's scarf", collections: ['Gifts for men'] }, 'women', 'title'),
  c('a title can be wrong (known limit)', { title: 'Men in Black Tee' }, 'men', 'title'),

  // Merchant override.
  c('override wins', { override: 'women', productType: "Men's Shirts", title: "Men's Oxford Shirt" }, 'women', 'override'),
  c('override men', { override: 'men', title: "Women's shirt" }, 'men', 'override'),
  c('override unisex', { override: 'Unisex', title: "Men's tee" }, 'unisex', 'override'),
  c('override synonym', { override: ' Heren ', title: 'Jeans' }, 'men', 'override'),
  c('override none switches inference off', { override: 'none', title: "Men's Oxford Shirt" }, null, 'override'),
  c('empty override is no override', { override: '', title: "Men's Oxford Shirt" }, 'men', 'title'),
  c('unknown override is ignored', { override: 'kids', title: "Men's Oxford Shirt" }, 'men', 'title'),
];
