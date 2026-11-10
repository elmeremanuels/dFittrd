/**
 * The banned-model list (AGENTS.md hard rule 6, ENGINE-HANDOFF "Rules for the builder" rule 6).
 * Every model, body model or reconstruction code base here has no licence that allows our
 * commercial use: a non-commercial licence, no licence file at all, or a licence that excludes the
 * EU. Sources and the date checked are in docs/research/garment-engine.md (licence table) and
 * docs/research/tryon-engines.md.
 *
 * Matching (see registry.ts) is a case-insensitive substring match with separators ignored, so a
 * token must be specific enough not to hit an allowed model. Where a vendor ships a commercial and a
 * non-commercial checkpoint under one prefix (VGGT-1B vs VGGT-1B-Commercial, map-anything vs
 * map-anything-apache) the substring matcher cannot tell them apart; those are recorded in the
 * research doc only and must be pinned by exact id in code review.
 *
 * This file and its test are the only files under src/ allowed to spell the names out;
 * scripts/check-banned-models.mjs reads the array below and scans every other file.
 */
export const BANNED_MODELS = [
  // Try-on (D4, docs/research/tryon-engines.md)
  'idm-vton',
  'ootdiffusion',
  'catvton',
  'fitdit',
  'catv2ton',
  'magictryon',
  'mobile-vton',
  // Body models (Max Planck non-commercial licences; commercial SMPL-family licences are sold separately)
  'smpl-x',
  'smpl',
  'ahmedosman/star',
  'ahmedosman/supr',
  // Image and video generation
  'hunyuan',
  'sv3d',
  'flux.1-dev',
  'flux.1-kontext-dev',
  'flux.2-dev',
  // Reconstruction (Inria Gaussian-Splatting licence, NVIDIA Source Code License-NC, CC BY-NC-SA)
  'graphdeco-inria',
  '2d-gaussian-splatting',
  'gaussian-opacity-fields',
  'anttwo',
  'pgsr',
  'instant-ngp',
  'neus2',
  'neuralangelo',
  'mast3r',
  'dust3r',
  // Garment-specific research code
  'garment3dgen',
  'garmentdreamer',
  'sewformer',
  'garverselod',
  'gaussian-garments',
  'garment-crafter',
  'nvidiawarp-garmentcode',
  // Human parsing (stage 1b research, docs/research/garment-engine.md "Stage 1b")
  'fashn-human-parser',
  'facebook/sapiens',
] as const;

export type BannedModel = (typeof BANNED_MODELS)[number];

export type BanReason = 'non-commercial' | 'no-licence' | 'territory-excludes-eu';

export interface BanNote {
  readonly reason: BanReason;
  /** Licence name as published, or what we found instead. */
  readonly licence: string;
  /** Primary page the licence was read from. */
  readonly source: string;
}

/** One note per banned entry; the Record type makes a missing note a compile error. */
export const BANNED_MODEL_NOTES: Readonly<Record<BannedModel, BanNote>> = {
  'idm-vton': { reason: 'non-commercial', licence: 'CC BY-NC-SA 4.0', source: 'https://github.com/yisol/IDM-VTON/blob/main/LICENSE' },
  ootdiffusion: { reason: 'non-commercial', licence: 'CC BY-NC-SA 4.0', source: 'https://github.com/levihsu/OOTDiffusion/blob/main/LICENSE' },
  catvton: { reason: 'non-commercial', licence: 'CC BY-NC-SA 4.0', source: 'https://github.com/Zheng-Chong/CatVTON/blob/main/LICENSE' },
  fitdit: { reason: 'non-commercial', licence: 'CC BY-NC-SA 4.0', source: 'https://github.com/BoyuanJiang/FitDiT/blob/main/LICENSE' },
  catv2ton: { reason: 'no-licence', licence: 'no licence file in the repository', source: 'https://github.com/Zheng-Chong/CatV2TON' },
  magictryon: { reason: 'no-licence', licence: 'no licence file in the repository', source: 'https://github.com/vivoCameraResearch/Magic-TryOn' },
  'mobile-vton': { reason: 'non-commercial', licence: 'CC BY-NC-SA per docs/research/tryon-engines.md; no licence file in the repository', source: 'https://github.com/tmllab/2026_CVPR_Mobile-VTON' },
  'smpl-x': { reason: 'non-commercial', licence: 'MPI non-commercial scientific research licence; commercial via Max Planck Innovation', source: 'https://github.com/vchoutas/smplx/blob/main/LICENSE' },
  smpl: { reason: 'non-commercial', licence: 'MPI non-commercial scientific research licence (SMPL, SMPL+H, SMPL-X, SMPLicit)', source: 'https://smpl.is.tue.mpg.de/' },
  'ahmedosman/star': { reason: 'non-commercial', licence: 'MPI non-commercial scientific research licence', source: 'https://github.com/ahmedosman/STAR/blob/master/LICENSE' },
  'ahmedosman/supr': { reason: 'non-commercial', licence: 'MPI non-commercial scientific research licence', source: 'https://github.com/ahmedosman/SUPR/blob/master/LICENSE' },
  hunyuan: { reason: 'territory-excludes-eu', licence: 'Tencent Hunyuan Community License: "does not apply in the European Union, United Kingdom and South Korea"', source: 'https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/blob/main/LICENSE' },
  sv3d: { reason: 'non-commercial', licence: 'sv3d-nc-community (Hugging Face licence tag; licence text is gated)', source: 'https://huggingface.co/stabilityai/sv3d' },
  'flux.1-dev': { reason: 'non-commercial', licence: 'FLUX.1 [dev] Non-Commercial License', source: 'https://huggingface.co/black-forest-labs/FLUX.1-dev' },
  'flux.1-kontext-dev': { reason: 'non-commercial', licence: 'FLUX.1 [dev] Non-Commercial License', source: 'https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev' },
  'flux.2-dev': { reason: 'non-commercial', licence: 'FLUX Non-Commercial License', source: 'https://huggingface.co/black-forest-labs/FLUX.2-dev' },
  'graphdeco-inria': { reason: 'non-commercial', licence: 'Gaussian-Splatting License (Inria, MPII): research and evaluation only', source: 'https://github.com/graphdeco-inria/gaussian-splatting/blob/main/LICENSE.md' },
  '2d-gaussian-splatting': { reason: 'non-commercial', licence: 'Gaussian-Splatting License (Inria, MPII)', source: 'https://github.com/hbb1/2d-gaussian-splatting/blob/main/LICENSE.md' },
  'gaussian-opacity-fields': { reason: 'non-commercial', licence: 'Gaussian-Splatting License (Inria, MPII)', source: 'https://github.com/autonomousvision/gaussian-opacity-fields/blob/main/LICENSE.md' },
  anttwo: { reason: 'non-commercial', licence: 'Gaussian-Splatting License (SuGaR, MILo)', source: 'https://github.com/Anttwo/MILo' },
  pgsr: { reason: 'non-commercial', licence: 'custom: commercial use only by permission of the authors', source: 'https://github.com/zju3dv/PGSR/blob/main/LICENSE.md' },
  'instant-ngp': { reason: 'non-commercial', licence: 'NVIDIA Source Code License-NC', source: 'https://github.com/NVlabs/instant-ngp/blob/master/LICENSE.txt' },
  neus2: { reason: 'non-commercial', licence: 'NVIDIA Source Code License-NC (instant-ngp)', source: 'https://github.com/19reborn/NeuS2/blob/main/LICENSE.txt' },
  neuralangelo: { reason: 'non-commercial', licence: 'NVIDIA Source Code License (non-commercial, NVIDIA processors only)', source: 'https://github.com/NVlabs/neuralangelo/blob/main/LICENSE.md' },
  mast3r: { reason: 'non-commercial', licence: 'CC BY-NC-SA 4.0', source: 'https://github.com/naver/mast3r/blob/main/LICENSE' },
  dust3r: { reason: 'non-commercial', licence: 'CC BY-NC-SA 4.0', source: 'https://github.com/naver/dust3r/blob/main/LICENSE' },
  garment3dgen: { reason: 'non-commercial', licence: 'CC BY-NC 4.0', source: 'https://github.com/nsarafianos/Garment3DGen/blob/main/LICENSE.md' },
  garmentdreamer: { reason: 'non-commercial', licence: 'CC BY-NC 4.0', source: 'https://github.com/boqian-li/GarmentDreamer/blob/main/LICENSE' },
  sewformer: { reason: 'no-licence', licence: 'no licence file in the repository', source: 'https://github.com/sail-sg/sewformer' },
  garverselod: { reason: 'no-licence', licence: 'no licence file in the repository', source: 'https://github.com/zhongjinluo/GarVerseLOD' },
  'gaussian-garments': { reason: 'no-licence', licence: 'no licence file in the repository', source: 'https://github.com/eth-ait/Gaussian-Garments' },
  'garment-crafter': { reason: 'no-licence', licence: 'no licence file in the repository', source: 'https://github.com/humansensinglab/garment-crafter' },
  'nvidiawarp-garmentcode': { reason: 'non-commercial', licence: 'NVIDIA Source Code License, clause 3.3 (research or evaluation only); Design2GarmentCode\'s default simulation path points to it', source: 'https://github.com/maria-korosteleva/NvidiaWarp-GarmentCode/blob/main/LICENSE.md' },
  'fashn-human-parser': { reason: 'non-commercial', licence: 'NVIDIA Source Code License for SegFormer (research or evaluation only); the pip package wrapper inherits it', source: 'https://huggingface.co/fashn-ai/fashn-human-parser' },
  'facebook/sapiens': { reason: 'non-commercial', licence: 'CC BY-NC 4.0 (Hugging Face licence tag of the Sapiens checkpoints)', source: 'https://huggingface.co/facebook/sapiens-seg-1b' },
};
