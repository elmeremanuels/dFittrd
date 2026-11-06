/**
 * Fabric library v1 (docs/ENGINE-HANDOFF.md "Prefill: fabric library"): 12 base fibres and 38
 * constructions, each with typical weight, stretch, drape, bend stiffness, sheen, opacity, a surface
 * texture preset and default simulation parameters. Values come from published textile data where a
 * source gave a number and are marked as estimates everywhere else; docs/research/fabrics.md cites
 * every source. The library is prefill only: explicit product values and per-product calibration win.
 *
 * Units and conventions:
 * - weightGsm: g/m².
 * - stretchPct: fabric stretch, (stretched − relaxed) / relaxed × 100, hand-stretched across the
 *   most elastic direction. Fibre entries describe a typical plain fabric of that fibre, not the
 *   fibre itself; fibre elongation at break, where published, is kept in `fibreElongationPct`.
 * - drape: 0 = stiff, 1 = fluid, read as 1 − Cusick drape coefficient (DC 30–98 % limp to stiff).
 * - bendStiffness: KES-F bending rigidity B per unit width, gf·cm²/cm (relative scale; all values
 *   estimated until swatches are measured).
 * - sheen and opacity: 0..1, as in GarmentPayload `fabric`.
 *
 * Pure data and pure functions, no runtime dependencies.
 */
import type { FABRIC_PRIMARIES, Fabric } from './garment';

/** Bump the minor version when values change, the major version when ids or fields change. */
export const FABRIC_LIBRARY_VERSION = '1.0.0';

export const FABRIC_FIBRE_IDS = ['polyester', 'cotton', 'viscose', 'nylon', 'elastane', 'acrylic', 'wool', 'linen', 'lyocell', 'silk', 'modal', 'hemp'] as const;
export type FabricFibreId = (typeof FABRIC_FIBRE_IDS)[number];

export const FABRIC_CONSTRUCTION_IDS = [
  'denim', 'jersey', 'flannel', 'chambray', 'canvas', 'corduroy', 'molton', 'terry', 'poplin', 'seersucker',
  'fleece', 'velvet', 'french-terry', 'teddy', 'faux-fur', 'cashmere', 'merino', 'tweed', 'felt', 'satin',
  'tulle', 'lace', 'chiffon', 'organza', 'taffeta', 'brocade', 'jacquard', 'softshell', 'mesh', 'neoprene',
  'ripstop', 'membrane-laminate', 'pique', 'gabardine', 'leather', 'faux-leather', 'suede', 'microfibre-suede',
] as const;
export type FabricConstructionId = (typeof FABRIC_CONSTRUCTION_IDS)[number];

export type FabricId = FabricFibreId | FabricConstructionId;
export type FabricEntryType = 'fibre' | 'construction';

/** Surface texture presets: each names a normal + roughness map pair in the renderer. */
export const FABRIC_TEXTURE_PRESETS = [
  'plain-weave', 'twill', 'satin-weave', 'slub', 'knit-fine', 'knit-loop', 'brushed', 'pile-short', 'pile-long', 'wale',
  'puckered', 'sheer', 'mesh-open', 'lace', 'jacquard', 'felted', 'ripstop-grid', 'pique', 'smooth-coated', 'leather-grain', 'nap',
] as const;
export type FabricTexturePreset = (typeof FABRIC_TEXTURE_PRESETS)[number];

/** Published sources the values are taken from (docs/research/fabrics.md quotes what each one gave). */
export const FABRIC_SOURCES = {
  'wikipedia-fiber': { title: 'Fiber, Table 2 "Properties of Selected Artificial Fibers" (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Fiber' },
  'wikipedia-spandex': { title: 'Spandex (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Spandex' },
  'wikipedia-lyocell': { title: 'Lyocell (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lyocell' },
  'wikipedia-alcantara': { title: 'Alcantara (material) (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Alcantara_(material)' },
  'wikipedia-gore-tex': { title: 'Gore-Tex (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Gore-Tex' },
  'wikipedia-polar-fleece': { title: 'Polar fleece (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Polar_fleece' },
  'sewguide-gsm': { title: 'Fabric GSM in dressmaking (Sew Guide)', url: 'https://sewguide.com/gsm-of-fabric/' },
  'spoonflower-specs': { title: 'Fabric Specifications and Details (Spoonflower)', url: 'https://support.spoonflower.com/hc/en-us/articles/360050418771-Fabric-Specifications-and-Details' },
  'jtatm-drape': { title: 'Viswanaath et al., New Methods of Assessment of Fabric Drape, JTATM 10(3), 2018', url: 'https://jtatm.textiles.ncsu.edu/index.php/JTATM/article/view/11259/5989' },
  'ktu-bending': { title: 'The Relationship between Fabrics Bending Rigidity Parameters Defined by KES-F and FAST Equipment, Materials Science (Medžiagotyra)', url: 'https://matsc.ktu.lt/index.php/MatSc/article/view/26098' },
  estimate: { title: 'Curtain estimate (to be calibrated against swatches and merchant video)', url: '' },
} as const;
export type FabricSourceId = keyof typeof FABRIC_SOURCES;

export interface FabricRange {
  min: number;
  max: number;
}

/** Default cloth-simulation parameters, derived from the entry by `deriveFabricSimulation`. */
export interface FabricSimulationParams {
  /** In-plane stretch stiffness, N/m: force per metre of width per unit strain. */
  stretchStiffness: number;
  /** Bending stiffness per unit width, N·m (KES-F B gf·cm²/cm × 9.80665e-5). */
  bendStiffness: number;
  /** Areal mass, kg/m² (weightGsm / 1000). */
  massKgM2: number;
  /** Velocity damping, 0..1 per second of simulated time (stiffer cloth settles faster). */
  damping: number;
}

export type FabricEstimatedField = 'weightGsm' | 'stretchPct' | 'drape' | 'bendStiffness' | 'sheen' | 'opacity';

export interface FabricEntry {
  id: FabricId;
  type: FabricEntryType;
  names: { en: string; nl: string };
  /** Brand names and other words (English and Dutch, inflections included) that resolve to this entry. */
  aliases: readonly string[];
  weightGsm: FabricRange;
  stretchPct: FabricRange;
  drape: number;
  /** KES-F bending rigidity B, gf·cm²/cm. */
  bendStiffness: number;
  sheen: number;
  opacity: number;
  texture: FabricTexturePreset;
  simulation: FabricSimulationParams;
  /** Constructions named after a fibre (cashmere, merino) count as that fibre in a composition. */
  baseFibre?: FabricFibreId;
  /** Fibre elongation at break in %, where a source published it. */
  fibreElongationPct?: FabricRange;
  sources: readonly FabricSourceId[];
  /** Fields that are our estimate rather than a published value. */
  estimated: readonly FabricEstimatedField[];
}

/** Stretch readings are taken as the extension under this load per metre of width (≈ 30 N on a 5 cm strip). */
export const STRETCH_REFERENCE_LOAD_N_PER_M = 600;
/** Each percent of elastane adds this much fabric stretch (estimate: 2 % elastane ≈ +8 %, 5 % ≈ +20 %). */
export const ELASTANE_STRETCH_PER_PCT = 4;
const GF_CM2_PER_CM_TO_NM = 9.80665e-5;

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mid = (r: FabricRange) => (r.min + r.max) / 2;

/** Map fabric properties to default simulation parameters (stage 7 of the garment pipeline). */
export function deriveFabricSimulation(p: { weightGsm: number; stretchPct: number; drape: number; bendStiffness: number }): FabricSimulationParams {
  const strain = Math.max(p.stretchPct, 0.5) / 100;
  return {
    stretchStiffness: Math.round(STRETCH_REFERENCE_LOAD_N_PER_M / strain),
    bendStiffness: Number((p.bendStiffness * GF_CM2_PER_CM_TO_NM).toPrecision(4)),
    massKgM2: round(p.weightGsm / 1000, 4),
    damping: round(0.02 + 0.1 * (1 - clamp(p.drape, 0, 1)), 3),
  };
}

type EntryInput = Omit<FabricEntry, 'id' | 'type' | 'names' | 'weightGsm' | 'stretchPct' | 'simulation' | 'aliases'> & {
  gsm: [number, number];
  stretch: [number, number];
  aliases?: readonly string[];
};

function entry(id: FabricId, type: FabricEntryType, en: string, nl: string, e: EntryInput): FabricEntry {
  const { gsm, stretch, aliases = [], ...rest } = e;
  const weightGsm = { min: gsm[0], max: gsm[1] };
  const stretchPct = { min: stretch[0], max: stretch[1] };
  return {
    id,
    type,
    names: { en, nl },
    aliases,
    weightGsm,
    stretchPct,
    ...rest,
    simulation: deriveFabricSimulation({ weightGsm: mid(weightGsm), stretchPct: mid(stretchPct), drape: rest.drape, bendStiffness: rest.bendStiffness }),
  };
}

const ALL: FabricEstimatedField[] = ['weightGsm', 'stretchPct', 'drape', 'bendStiffness', 'sheen', 'opacity'];
const NO_WEIGHT: FabricEstimatedField[] = ['stretchPct', 'drape', 'bendStiffness', 'sheen', 'opacity'];

const fibre = (id: FabricFibreId, en: string, nl: string, e: EntryInput) => entry(id, 'fibre', en, nl, e);
const construction = (id: FabricConstructionId, en: string, nl: string, e: EntryInput) => entry(id, 'construction', en, nl, e);

export const FABRIC_LIBRARY: readonly FabricEntry[] = [
  // ── 12 base fibres ────────────────────────────────────────────────────────────────────────────
  fibre('polyester', 'Polyester', 'Polyester', { gsm: [60, 300], stretch: [0, 3], drape: 0.6, bendStiffness: 0.08, sheen: 0.35, opacity: 0.85, texture: 'plain-weave', fibreElongationPct: { min: 8, max: 30 }, aliases: ['pes', 'coolmax', 'repreve', 'dacron', 'trevira', 'terylene', 'recycled polyester', 'gerecycled polyester'], sources: ['wikipedia-fiber', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  fibre('cotton', 'Cotton', 'Katoen', { gsm: [80, 400], stretch: [0, 3], drape: 0.5, bendStiffness: 0.12, sheen: 0.08, opacity: 0.85, texture: 'plain-weave', aliases: ['katoenen', 'organic cotton', 'biologisch katoen', 'supima', 'pima', 'coton', 'baumwolle'], sources: ['sewguide-gsm', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  fibre('viscose', 'Viscose', 'Viscose', { gsm: [80, 250], stretch: [0, 3], drape: 0.85, bendStiffness: 0.04, sheen: 0.3, opacity: 0.8, texture: 'plain-weave', aliases: ['rayon', 'viscosa', 'ecovero', 'cupro', 'bemberg'], sources: ['estimate'], estimated: ALL }),
  fibre('nylon', 'Nylon', 'Nylon', { gsm: [40, 250], stretch: [0, 5], drape: 0.55, bendStiffness: 0.06, sheen: 0.45, opacity: 0.8, texture: 'plain-weave', fibreElongationPct: { min: 20, max: 30 }, aliases: ['polyamide', 'polyamid', 'cordura', 'tactel', 'supplex', 'econyl'], sources: ['wikipedia-fiber', 'estimate'], estimated: ALL }),
  fibre('elastane', 'Elastane', 'Elastaan', { gsm: [150, 300], stretch: [60, 100], drape: 0.5, bendStiffness: 0.05, sheen: 0.3, opacity: 0.9, texture: 'knit-fine', fibreElongationPct: { min: 400, max: 400 }, aliases: ['spandex', 'lycra', 'elasthan', 'elasthane', 'elastan', 'elastaan', 'elaspan', 'creora', 'roica', 'dorlastan', 'acepora', 'inviya', 'linel'], sources: ['wikipedia-spandex', 'estimate'], estimated: ALL }),
  fibre('acrylic', 'Acrylic', 'Acryl', { gsm: [150, 400], stretch: [0, 5], drape: 0.5, bendStiffness: 0.1, sheen: 0.1, opacity: 0.95, texture: 'brushed', fibreElongationPct: { min: 20, max: 40 }, aliases: ['polyacryl', 'polyacrylic', 'dralon', 'orlon', 'acrylique'], sources: ['wikipedia-fiber', 'estimate'], estimated: ALL }),
  fibre('wool', 'Wool', 'Wol', { gsm: [150, 450], stretch: [0, 5], drape: 0.5, bendStiffness: 0.15, sheen: 0.05, opacity: 0.97, texture: 'twill', aliases: ['wollen', 'woollen', 'woolen', 'scheerwol', 'virgin wool', 'new wool', 'lambswool', 'lamswol', 'schapenwol', 'alpaca', 'mohair', 'angora'], sources: ['sewguide-gsm', 'estimate'], estimated: NO_WEIGHT }),
  fibre('linen', 'Linen', 'Linnen', { gsm: [100, 300], stretch: [0, 2], drape: 0.55, bendStiffness: 0.2, sheen: 0.12, opacity: 0.85, texture: 'slub', aliases: ['flax', 'vlas', 'leinen'], sources: ['sewguide-gsm', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  fibre('lyocell', 'Lyocell', 'Lyocell', { gsm: [100, 250], stretch: [0, 3], drape: 0.85, bendStiffness: 0.05, sheen: 0.3, opacity: 0.85, texture: 'plain-weave', aliases: ['tencel', 'newcell', 'seacell', 'refibra'], sources: ['wikipedia-lyocell', 'estimate'], estimated: ALL }),
  fibre('silk', 'Silk', 'Zijde', { gsm: [30, 200], stretch: [0, 3], drape: 0.9, bendStiffness: 0.03, sheen: 0.65, opacity: 0.7, texture: 'satin-weave', aliases: ['zijden', 'mulberry silk', 'moerbeizijde', 'soie', 'seide'], sources: ['estimate'], estimated: ALL }),
  fibre('modal', 'Modal', 'Modal', { gsm: [120, 250], stretch: [0, 5], drape: 0.85, bendStiffness: 0.04, sheen: 0.2, opacity: 0.85, texture: 'knit-fine', aliases: ['micromodal', 'lenzing modal'], sources: ['estimate'], estimated: ALL }),
  fibre('hemp', 'Hemp', 'Hennep', { gsm: [150, 350], stretch: [0, 2], drape: 0.45, bendStiffness: 0.22, sheen: 0.08, opacity: 0.9, texture: 'slub', aliases: ['hennepvezel', 'hanf'], sources: ['estimate'], estimated: ALL }),

  // ── 38 constructions and finishes ─────────────────────────────────────────────────────────────
  construction('denim', 'Denim', 'Denim', { gsm: [200, 450], stretch: [0, 3], drape: 0.2, bendStiffness: 0.8, sheen: 0.05, opacity: 1, texture: 'twill', aliases: ['spijkerstof', 'jeansstof', 'selvedge denim'], sources: ['sewguide-gsm', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('jersey', 'Jersey', 'Tricot', { gsm: [120, 220], stretch: [15, 40], drape: 0.7, bendStiffness: 0.03, sheen: 0.08, opacity: 0.85, texture: 'knit-fine', aliases: ['single jersey', 'tricot', 'tricotstof', 'jerseystof', 'interlock'], sources: ['sewguide-gsm', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('flannel', 'Flannel', 'Flanel', { gsm: [150, 300], stretch: [0, 3], drape: 0.45, bendStiffness: 0.15, sheen: 0.02, opacity: 0.95, texture: 'brushed', aliases: ['flanel', 'flanellen'], sources: ['sewguide-gsm', 'estimate'], estimated: NO_WEIGHT }),
  construction('chambray', 'Chambray', 'Chambray', { gsm: [100, 180], stretch: [0, 2], drape: 0.55, bendStiffness: 0.1, sheen: 0.05, opacity: 0.85, texture: 'plain-weave', sources: ['estimate'], estimated: ALL }),
  construction('canvas', 'Canvas', 'Canvas', { gsm: [215, 500], stretch: [0, 1], drape: 0.1, bendStiffness: 1.5, sheen: 0.02, opacity: 1, texture: 'plain-weave', aliases: ['canvasdoek', 'duck canvas', 'zeildoek'], sources: ['spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('corduroy', 'Corduroy', 'Ribfluweel', { gsm: [200, 400], stretch: [0, 3], drape: 0.3, bendStiffness: 0.6, sheen: 0.15, opacity: 1, texture: 'wale', aliases: ['ribfluweel', 'ribcord', 'manchester', 'needlecord'], sources: ['estimate'], estimated: ALL }),
  construction('molton', 'Molton (brushed sweat)', 'Molton', { gsm: [200, 350], stretch: [10, 25], drape: 0.4, bendStiffness: 0.12, sheen: 0.02, opacity: 1, texture: 'brushed', aliases: ['sweatstof', 'sweat fabric', 'brushed fleece back'], sources: ['estimate'], estimated: ALL }),
  construction('terry', 'Terry', 'Badstof', { gsm: [250, 450], stretch: [5, 15], drape: 0.35, bendStiffness: 0.3, sheen: 0.02, opacity: 1, texture: 'knit-loop', aliases: ['badstof', 'terry cloth', 'terrycloth', 'towelling', 'toweling', 'frotte', 'badstoffen'], sources: ['estimate'], estimated: ALL }),
  construction('poplin', 'Poplin', 'Popeline', { gsm: [100, 150], stretch: [0, 2], drape: 0.55, bendStiffness: 0.07, sheen: 0.12, opacity: 0.82, texture: 'plain-weave', aliases: ['popeline', 'popelin', 'broadcloth'], sources: ['sewguide-gsm', 'spoonflower-specs', 'jtatm-drape', 'estimate'], estimated: NO_WEIGHT }),
  construction('seersucker', 'Seersucker', 'Seersucker', { gsm: [100, 150], stretch: [0, 3], drape: 0.5, bendStiffness: 0.06, sheen: 0.05, opacity: 0.8, texture: 'puckered', aliases: ['crinkle cotton'], sources: ['spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('fleece', 'Fleece', 'Fleece', { gsm: [100, 350], stretch: [15, 30], drape: 0.4, bendStiffness: 0.15, sheen: 0.02, opacity: 1, texture: 'pile-short', baseFibre: 'polyester', aliases: ['polar fleece', 'polarfleece', 'polartec', 'synchilla', 'microfleece'], sources: ['wikipedia-polar-fleece', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('velvet', 'Velvet', 'Fluweel', { gsm: [200, 390], stretch: [0, 5], drape: 0.65, bendStiffness: 0.2, sheen: 0.55, opacity: 1, texture: 'pile-short', aliases: ['fluwelen', 'velours', 'velour', 'velvet'], sources: ['sewguide-gsm', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('french-terry', 'French terry', 'French terry', { gsm: [200, 350], stretch: [15, 30], drape: 0.45, bendStiffness: 0.1, sheen: 0.03, opacity: 1, texture: 'knit-loop', aliases: ['loopback', 'loop back', 'lusjesstof'], sources: ['estimate'], estimated: ALL }),
  construction('teddy', 'Teddy', 'Teddy', { gsm: [250, 450], stretch: [5, 15], drape: 0.3, bendStiffness: 0.3, sheen: 0.05, opacity: 1, texture: 'pile-long', aliases: ['sherpa', 'teddystof', 'teddy fleece', 'boucle fleece'], sources: ['estimate'], estimated: ALL }),
  construction('faux-fur', 'Faux fur', 'Imitatiebont', { gsm: [300, 700], stretch: [0, 10], drape: 0.3, bendStiffness: 0.4, sheen: 0.2, opacity: 1, texture: 'pile-long', aliases: ['fake fur', 'nepbont', 'imitatiebont', 'kunstbont'], sources: ['estimate'], estimated: ALL }),
  construction('cashmere', 'Cashmere', 'Kasjmier', { gsm: [150, 350], stretch: [5, 20], drape: 0.6, bendStiffness: 0.08, sheen: 0.1, opacity: 0.97, texture: 'knit-fine', baseFibre: 'wool', aliases: ['kasjmier', 'kashmir', 'cashmeer', 'kaschmir'], sources: ['estimate'], estimated: ALL }),
  construction('merino', 'Merino', 'Merino', { gsm: [150, 300], stretch: [10, 25], drape: 0.6, bendStiffness: 0.06, sheen: 0.05, opacity: 0.95, texture: 'knit-fine', baseFibre: 'wool', aliases: ['merinowol', 'merino wool', 'merinos'], sources: ['estimate'], estimated: ALL }),
  construction('tweed', 'Tweed', 'Tweed', { gsm: [300, 600], stretch: [0, 3], drape: 0.2, bendStiffness: 0.8, sheen: 0.02, opacity: 1, texture: 'twill', aliases: ['harris tweed', 'visgraat'], sources: ['ktu-bending', 'estimate'], estimated: ALL }),
  construction('felt', 'Felt', 'Vilt', { gsm: [150, 1000], stretch: [0, 2], drape: 0.05, bendStiffness: 3, sheen: 0, opacity: 1, texture: 'felted', aliases: ['vilt', 'vilten', 'loden', 'boiled wool', 'gekookte wol'], sources: ['estimate'], estimated: ALL }),
  construction('satin', 'Satin', 'Satijn', { gsm: [75, 150], stretch: [0, 3], drape: 0.85, bendStiffness: 0.03, sheen: 0.75, opacity: 0.8, texture: 'satin-weave', aliases: ['satijn', 'satijnen', 'sateen', 'charmeuse', 'duchesse'], sources: ['sewguide-gsm', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('tulle', 'Tulle', 'Tule', { gsm: [10, 40], stretch: [0, 15], drape: 0.7, bendStiffness: 0.005, sheen: 0.1, opacity: 0.1, texture: 'mesh-open', aliases: ['tule', 'netting'], sources: ['estimate'], estimated: ALL }),
  construction('lace', 'Lace', 'Kant', { gsm: [50, 200], stretch: [0, 10], drape: 0.7, bendStiffness: 0.03, sheen: 0.1, opacity: 0.4, texture: 'lace', aliases: ['kant', 'kanten', 'guipure', 'broderie anglaise'], sources: ['estimate'], estimated: ALL }),
  construction('chiffon', 'Chiffon', 'Chiffon', { gsm: [30, 70], stretch: [0, 3], drape: 0.95, bendStiffness: 0.01, sheen: 0.15, opacity: 0.3, texture: 'sheer', aliases: ['georgette', 'voile', 'crepe de chine'], sources: ['sewguide-gsm', 'spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('organza', 'Organza', 'Organza', { gsm: [30, 70], stretch: [0, 1], drape: 0.2, bendStiffness: 0.08, sheen: 0.35, opacity: 0.25, texture: 'sheer', aliases: ['organdie', 'organdy'], sources: ['estimate'], estimated: ALL }),
  construction('taffeta', 'Taffeta', 'Taft', { gsm: [70, 140], stretch: [0, 1], drape: 0.25, bendStiffness: 0.15, sheen: 0.55, opacity: 0.9, texture: 'plain-weave', aliases: ['taft', 'tafzijde'], sources: ['estimate'], estimated: ALL }),
  construction('brocade', 'Brocade', 'Brokaat', { gsm: [200, 400], stretch: [0, 2], drape: 0.25, bendStiffness: 0.6, sheen: 0.45, opacity: 1, texture: 'jacquard', aliases: ['brokaat', 'damask', 'damast'], sources: ['estimate'], estimated: ALL }),
  construction('jacquard', 'Jacquard', 'Jacquard', { gsm: [150, 400], stretch: [0, 10], drape: 0.4, bendStiffness: 0.3, sheen: 0.25, opacity: 1, texture: 'jacquard', aliases: ['jacquardstof', 'jacquardbreisel'], sources: ['estimate'], estimated: ALL }),
  construction('softshell', 'Softshell', 'Softshell', { gsm: [250, 400], stretch: [5, 15], drape: 0.2, bendStiffness: 0.8, sheen: 0.15, opacity: 1, texture: 'smooth-coated', aliases: ['soft shell'], sources: ['estimate'], estimated: ALL }),
  construction('mesh', 'Mesh', 'Mesh', { gsm: [60, 200], stretch: [10, 50], drape: 0.6, bendStiffness: 0.03, sheen: 0.15, opacity: 0.4, texture: 'mesh-open', aliases: ['meshstof', 'power mesh', 'powernet', 'gaas', 'netstof'], sources: ['estimate'], estimated: ALL }),
  construction('neoprene', 'Neoprene', 'Neopreen', { gsm: [250, 600], stretch: [20, 40], drape: 0.15, bendStiffness: 1.2, sheen: 0.2, opacity: 1, texture: 'smooth-coated', aliases: ['neopreen', 'scuba', 'scubastof'], sources: ['estimate'], estimated: ALL }),
  construction('ripstop', 'Ripstop', 'Ripstop', { gsm: [40, 200], stretch: [0, 2], drape: 0.3, bendStiffness: 0.2, sheen: 0.3, opacity: 0.95, texture: 'ripstop-grid', aliases: ['rip stop', 'rip-stop'], sources: ['estimate'], estimated: ALL }),
  construction('membrane-laminate', 'Membrane laminate', 'Membraanlaminaat', { gsm: [150, 350], stretch: [0, 5], drape: 0.15, bendStiffness: 0.6, sheen: 0.3, opacity: 1, texture: 'smooth-coated', aliases: ['gore tex', 'goretex', 'sympatex', 'windstopper', 'eptfe', 'membraan', 'membrane', 'laminate', 'gelamineerd'], sources: ['wikipedia-gore-tex', 'estimate'], estimated: ALL }),
  construction('pique', 'Piqué', 'Piqué', { gsm: [140, 250], stretch: [10, 20], drape: 0.45, bendStiffness: 0.1, sheen: 0.05, opacity: 1, texture: 'pique', aliases: ['pique', 'pikee', 'pique knit'], sources: ['spoonflower-specs', 'estimate'], estimated: NO_WEIGHT }),
  construction('gabardine', 'Gabardine', 'Gabardine', { gsm: [200, 350], stretch: [0, 2], drape: 0.4, bendStiffness: 0.3, sheen: 0.15, opacity: 1, texture: 'twill', aliases: ['gabardinestof', 'chino twill'], sources: ['ktu-bending', 'estimate'], estimated: ALL }),
  construction('leather', 'Leather', 'Leer', { gsm: [500, 1300], stretch: [0, 5], drape: 0.1, bendStiffness: 5, sheen: 0.35, opacity: 1, texture: 'leather-grain', aliases: ['leer', 'leren', 'leder', 'lederen', 'nappa', 'lamsleer', 'lambskin', 'cowhide', 'rundleer', 'genuine leather', 'echt leer'], sources: ['estimate'], estimated: ALL }),
  construction('faux-leather', 'Faux leather', 'Kunstleer', { gsm: [250, 600], stretch: [0, 10], drape: 0.15, bendStiffness: 1.5, sheen: 0.4, opacity: 1, texture: 'leather-grain', baseFibre: 'polyester', aliases: ['kunstleer', 'kunstleren', 'imitatieleer', 'nepleer', 'vegan leather', 'vegan leer', 'pu leather', 'pu leer', 'leatherette', 'skai', 'pleather'], sources: ['estimate'], estimated: ALL }),
  construction('suede', 'Suede', 'Suède', { gsm: [400, 900], stretch: [0, 5], drape: 0.3, bendStiffness: 2, sheen: 0.05, opacity: 1, texture: 'nap', aliases: ['suede', 'suedeleer', 'daim', 'nubuck'], sources: ['estimate'], estimated: ALL }),
  construction('microfibre-suede', 'Microfibre suede', 'Microvezel suède', { gsm: [200, 400], stretch: [0, 10], drape: 0.4, bendStiffness: 0.5, sheen: 0.08, opacity: 1, texture: 'nap', baseFibre: 'polyester', aliases: ['microfiber suede', 'alcantara', 'ultrasuede', 'faux suede', 'imitatiesuede', 'nepsuede', 'peachskin', 'suedine'], sources: ['wikipedia-alcantara', 'estimate'], estimated: ALL }),
];

export const FABRIC_BY_ID: Readonly<Record<FabricId, FabricEntry>> = Object.fromEntries(FABRIC_LIBRARY.map((e) => [e.id, e])) as Record<FabricId, FabricEntry>;

export function isFabricFibreId(v: unknown): v is FabricFibreId {
  return typeof v === 'string' && (FABRIC_FIBRE_IDS as readonly string[]).includes(v);
}

export function isFabricConstructionId(v: unknown): v is FabricConstructionId {
  return typeof v === 'string' && (FABRIC_CONSTRUCTION_IDS as readonly string[]).includes(v);
}

/** Lowercase, strip accents, collapse everything but letters, digits, `%`, `.` and `,` to single spaces. */
export function normaliseFabricText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%.,]+/g, ' ')
    .trim();
}

let termIndex: Map<string, FabricId> | undefined;

/** Every word that resolves to a library id: the id itself, both names and every alias. */
export function fabricTerms(): ReadonlyMap<string, FabricId> {
  if (termIndex) return termIndex;
  const m = new Map<string, FabricId>();
  for (const e of FABRIC_LIBRARY) {
    for (const t of [e.id, e.names.en, e.names.nl, ...e.aliases]) {
      const k = normaliseFabricText(t);
      if (k && !m.has(k)) m.set(k, e.id);
    }
  }
  termIndex = m;
  return m;
}

/** Resolve a single name, alias or brand (English or Dutch) to a library id. */
export function lookupFabricId(name: string): FabricId | undefined {
  return fabricTerms().get(normaliseFabricText(name));
}

// ── GarmentPayload `fabric.primary` and `blend` names (schema v1) ↔ library ids ────────────────

/**
 * Library id of each v1 `FABRIC_PRIMARIES` value. Thirteen are library ids already; `tencel` is the
 * v1 name of lyocell, and `technical` names no fibre or construction (it stays valid in payloads and
 * resolves to the blend or the default fabric). Library ids that v1 does not list (acrylic, hemp,
 * satin, …) are valid primaries too: the field is an open vocabulary.
 */
export const FABRIC_PRIMARY_LIBRARY_IDS: Readonly<Record<(typeof FABRIC_PRIMARIES)[number], FabricId | null>> = {
  linen: 'linen',
  cotton: 'cotton',
  wool: 'wool',
  silk: 'silk',
  cashmere: 'cashmere',
  tencel: 'lyocell',
  modal: 'modal',
  denim: 'denim',
  jersey: 'jersey',
  technical: null,
  leather: 'leather',
  viscose: 'viscose',
  polyester: 'polyester',
  nylon: 'nylon',
  elastane: 'elastane',
};

/**
 * The name a payload uses for a library id in `fabric.primary` and `fabric.blend`: the v1 name
 * where v1 has one (lyocell → `tencel`, so v1 consumers such as the taste engine's fabric axes keep
 * matching), the library id otherwise.
 */
export function fabricPayloadName(id: FabricId): string {
  for (const [v1, libraryId] of Object.entries(FABRIC_PRIMARY_LIBRARY_IDS)) if (libraryId === id) return v1;
  return id;
}

/** Library id of a payload `fabric.primary` or blend name (v1 value, library id, name or alias); undefined for `technical` or unknown text. */
export function fabricLibraryId(name: string): FabricId | undefined {
  const key = normaliseFabricText(name);
  if (Object.prototype.hasOwnProperty.call(FABRIC_PRIMARY_LIBRARY_IDS, key)) return FABRIC_PRIMARY_LIBRARY_IDS[key as (typeof FABRIC_PRIMARIES)[number]] ?? undefined;
  return lookupFabricId(name);
}

// ── Resolution ──────────────────────────────────────────────────────────────────────────────────

export interface FabricCompositionPart {
  /** Library id, name, alias or brand (e.g. 'cotton', 'katoen', 'Tencel'). */
  fibre: string;
  pct: number;
}

export interface ResolveFabricInput {
  composition?: readonly FabricCompositionPart[];
  /** Construction id, name or alias (e.g. 'jersey', 'tricot', 'Gore-Tex'). */
  construction?: string;
  weightGsm?: number;
  stretchPct?: number;
  drape?: number;
  sheen?: number;
  opacity?: number;
}

/** Where a resolved value came from, in order of trust: product > construction > blend > default. */
export type FabricValueSource = 'product' | 'construction' | 'blend' | 'default';
export type FabricResolvedField = 'weightGsm' | 'stretchPct' | 'drape' | 'bendStiffness' | 'sheen' | 'opacity' | 'texture';

export interface ResolvedFabric {
  libraryVersion: string;
  /** Known fibres normalised to sum to 100 (elastane included). */
  fibres: Array<{ id: FabricFibreId; pct: number }>;
  construction?: FabricConstructionId;
  /** Input names that matched nothing in the library. */
  unknown: string[];
  weightGsm: number;
  stretchPct: number;
  drape: number;
  /** KES-F B, gf·cm²/cm. */
  bendStiffness: number;
  sheen: number;
  opacity: number;
  texture: FabricTexturePreset;
  simulation: FabricSimulationParams;
  provenance: Record<FabricResolvedField, FabricValueSource>;
  /** Elastane share (0..100) that added stretch. */
  elastanePct: number;
}

interface Props {
  weightGsm: number;
  stretchPct: number;
  drape: number;
  bendStiffness: number;
  sheen: number;
  opacity: number;
  texture: FabricTexturePreset;
}

const propsOf = (e: FabricEntry): Props => ({
  weightGsm: mid(e.weightGsm),
  stretchPct: mid(e.stretchPct),
  drape: e.drape,
  bendStiffness: e.bendStiffness,
  sheen: e.sheen,
  opacity: e.opacity,
  texture: e.texture,
});

/** Used when nothing is known: a plain cotton woven. */
const DEFAULT_ENTRY_ID: FabricFibreId = 'cotton';

/**
 * Resolve a product's fabric to parameters: the fibre blend gives the base behaviour, the
 * construction overrides it (cotton jersey stretches, cotton poplin does not), elastane adds
 * stretch by its share, and explicit product values win over everything.
 */
export function resolveFabric(input: ResolveFabricInput): ResolvedFabric {
  const unknown: string[] = [];
  const shares = new Map<FabricFibreId, number>();
  let compositionConstruction: FabricConstructionId | undefined;
  for (const part of input.composition ?? []) {
    if (!(part.pct > 0)) continue;
    const id = lookupFabricId(part.fibre);
    let fibreId: FabricFibreId | undefined;
    if (id && isFabricFibreId(id)) fibreId = id;
    else if (id && isFabricConstructionId(id)) {
      // A construction in the composition ("100% cashmere", "denim") is the construction, and one
      // with a base fibre also adds that fibre's share (cashmere → wool), as parseFabricText (mappings/fabricText.ts) does (R3).
      fibreId = FABRIC_BY_ID[id].baseFibre;
      compositionConstruction ??= id;
    } else unknown.push(part.fibre);
    if (fibreId) shares.set(fibreId, (shares.get(fibreId) ?? 0) + part.pct);
  }
  let construction: FabricConstructionId | undefined;
  if (input.construction !== undefined) {
    const id = lookupFabricId(input.construction);
    if (id && isFabricConstructionId(id)) construction = id;
    // A fibre given as the construction ("linen") fills in only when the composition named none.
    else if (id && isFabricFibreId(id)) {
      if (shares.size === 0) shares.set(id, 100);
    } else unknown.push(input.construction);
  }
  construction ??= compositionConstruction;
  if (shares.size === 0 && construction && FABRIC_BY_ID[construction].baseFibre) shares.set(FABRIC_BY_ID[construction].baseFibre!, 100);

  const total = [...shares.values()].reduce((a, b) => a + b, 0);
  const fibres = [...shares.entries()].map(([id, pct]) => ({ id, pct: round((pct / total) * 100, 2) })).sort((a, b) => b.pct - a.pct);
  const elastanePct = fibres.find((f) => f.id === 'elastane')?.pct ?? 0;
  const base = fibres.filter((f) => f.id !== 'elastane');

  let props: Props;
  const provenance = {} as Record<FabricResolvedField, FabricValueSource>;
  const setAll = (src: FabricValueSource) => {
    for (const k of ['weightGsm', 'stretchPct', 'drape', 'bendStiffness', 'sheen', 'opacity', 'texture'] as const) provenance[k] = src;
  };
  if (base.length) {
    const sum = base.reduce((a, f) => a + f.pct, 0);
    const avg = (pick: (p: Props) => number) => base.reduce((a, f) => a + pick(propsOf(FABRIC_BY_ID[f.id])) * (f.pct / sum), 0);
    props = {
      weightGsm: avg((p) => p.weightGsm),
      stretchPct: avg((p) => p.stretchPct),
      drape: avg((p) => p.drape),
      bendStiffness: avg((p) => p.bendStiffness),
      sheen: avg((p) => p.sheen),
      opacity: avg((p) => p.opacity),
      texture: FABRIC_BY_ID[base[0]!.id].texture,
    };
    setAll('blend');
  } else if (elastanePct > 0 && !construction) {
    props = propsOf(FABRIC_BY_ID.elastane);
    setAll('blend');
  } else {
    props = propsOf(FABRIC_BY_ID[DEFAULT_ENTRY_ID]);
    setAll('default');
  }

  if (construction) {
    props = propsOf(FABRIC_BY_ID[construction]);
    setAll('construction');
  }

  // Elastane adds stretch by its share (unless the blend is elastane alone, which already is stretch).
  if (elastanePct > 0 && (base.length || construction)) props.stretchPct += elastanePct * ELASTANE_STRETCH_PER_PCT;

  // Explicit product values win. A product weight also rescales bend stiffness (estimate: ∝ weight²).
  if (input.weightGsm !== undefined && input.weightGsm > 0) {
    const factor = clamp((input.weightGsm / props.weightGsm) ** 2, 0.25, 4);
    props.bendStiffness *= factor;
    props.weightGsm = input.weightGsm;
    provenance.weightGsm = 'product';
  }
  if (input.stretchPct !== undefined && input.stretchPct >= 0) {
    props.stretchPct = input.stretchPct;
    provenance.stretchPct = 'product';
  }
  for (const k of ['drape', 'sheen', 'opacity'] as const) {
    const v = input[k];
    if (v !== undefined && v >= 0 && v <= 1) {
      props[k] = v;
      provenance[k] = 'product';
    }
  }

  const out: ResolvedFabric = {
    libraryVersion: FABRIC_LIBRARY_VERSION,
    fibres,
    unknown,
    weightGsm: Math.round(props.weightGsm),
    stretchPct: round(clamp(props.stretchPct, 0, 100), 1),
    drape: round(props.drape, 3),
    bendStiffness: round(props.bendStiffness, 4),
    sheen: round(props.sheen, 3),
    opacity: round(props.opacity, 3),
    texture: props.texture,
    simulation: deriveFabricSimulation(props),
    provenance,
    elastanePct,
  };
  if (construction) out.construction = construction;
  return out;
}

/** The resolved fabric as the GarmentPayload `fabric` block, for the merchant to confirm. */
export function resolvedFabricToPayload(r: ResolvedFabric): Fabric {
  const out: Fabric = {
    primary: r.construction ?? r.fibres[0]?.id ?? DEFAULT_ENTRY_ID,
    weightGsm: r.weightGsm,
    stretchPct: r.stretchPct,
    drape: r.drape,
    opacity: r.opacity,
    sheen: r.sheen,
  };
  if (r.fibres.length) out.blend = r.fibres.map((f) => [f.id, f.pct] as [string, number]);
  return out;
}
