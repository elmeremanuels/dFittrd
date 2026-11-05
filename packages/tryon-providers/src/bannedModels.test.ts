import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BANNED_MODELS, BANNED_MODEL_NOTES } from './bannedModels.js';
import { findBanned, isBanned } from './registry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('banned-model list (garment engine licence check, docs/research/garment-engine.md)', () => {
  it('has no duplicates and a licence note with a source for every entry', () => {
    expect(new Set(BANNED_MODELS).size).toBe(BANNED_MODELS.length);
    expect(Object.keys(BANNED_MODEL_NOTES).sort()).toEqual([...BANNED_MODELS].sort());
    for (const id of BANNED_MODELS) {
      expect(BANNED_MODEL_NOTES[id].source).toMatch(/^https:\/\//);
      expect(BANNED_MODEL_NOTES[id].licence.length).toBeGreaterThan(0);
    }
  });

  it('keeps the original try-on bans and SMPL-X', () => {
    expect(BANNED_MODELS).toEqual(expect.arrayContaining(['idm-vton', 'ootdiffusion', 'catvton', 'fitdit', 'smpl-x']));
  });

  it('catches the non-commercial video, reconstruction, garment and body models by their usual ids', () => {
    for (const id of [
      'tencent/HunyuanVideo-1.5',
      'tencent/Hunyuan3D-2.1',
      'stabilityai/sv3d',
      'black-forest-labs/FLUX.1-dev',
      'black-forest-labs/FLUX.1-Kontext-dev',
      'black-forest-labs/FLUX.2-dev',
      'graphdeco-inria/gaussian-splatting',
      'hbb1/2d-gaussian-splatting',
      'autonomousvision/gaussian-opacity-fields',
      'Anttwo/SuGaR',
      'Anttwo/MILo',
      'zju3dv/PGSR',
      'NVlabs/instant-ngp',
      '19reborn/NeuS2',
      'NVlabs/neuralangelo',
      'naver/MASt3R_ViTLarge_BaseDecoder_512',
      'naver/DUSt3R_ViTLarge_BaseDecoder_512_dpt',
      'nsarafianos/Garment3DGen',
      'boqian-li/GarmentDreamer',
      'sail-sg/sewformer',
      'zhongjinluo/GarVerseLOD',
      'eth-ait/Gaussian-Garments',
      'humansensinglab/garment-crafter',
      'SMPL',
      'SMPL+H',
      'smplx',
      'enriccorona/SMPLicit',
      'ahmedosman/STAR',
      'ahmedosman/SUPR',
      'Zheng-Chong/CatV2TON',
      'vivoCameraResearch/Magic-TryOn',
      'Mobile-VTON',
    ]) {
      expect(isBanned(id), id).toBe(true);
    }
    expect(findBanned('SMPL-X')).toBe('smpl-x');
  });

  it('does not block the commercially licensed candidates from the research doc', () => {
    for (const id of [
      'Wan-AI/Wan2.2-I2V-A14B',
      'alibaba-pai/Wan2.2-Fun-A14B-Control',
      'alibaba-pai/Wan2.2-VACE-Fun-A14B',
      'lightx2v/LightWan2.2-A14B',
      'wan2.7-i2v',
      'kling-v3-pro',
      'veo-3.1-generate-001',
      'gen4_turbo',
      'Lightricks/LTX-2',
      'stabilityai/sv4d2.0',
      'nerfstudio-project/gsplat',
      'gsplat-2dgs',
      'nv-tlabs/3dgrut',
      'ArthurBrussee/brush',
      'autonomousvision/sdfstudio',
      'bennyguo/instant-nsr-pl',
      'Totoro97/NeuS',
      'facebook/VGGT-1B-Commercial',
      'facebook/map-anything-apache',
      'microsoft/TRELLIS.2-4B',
      'facebook/sam-3d-objects',
      'facebook/sam2.1-hiera-large',
      'ZhengPeng7/BiRefNet',
      'maria-korosteleva/GarmentCode',
      'biansy000/ChatGarment',
      'Style3D/design2garmentcode',
      'dolorousrtur/hood',
      'naver/anny',
      'facebookresearch/MHR',
      'makehumancommunity/mpfb2',
      'FASHN-AI/fashn-vton-1.5',
      'Qwen/Qwen-Image-Edit',
      'flux-kontext-pro',
      'tryon-v1.6',
      'virtual-try-on-001',
      'grok-imagine-video-1.5',
      'sample',
      'start',
      'superb',
    ]) {
      expect(isBanned(id), id).toBe(false);
    }
  });

  it('the lint script reads the same list from this module', () => {
    const out = execFileSync(process.execPath, [join(root, 'scripts', 'check-banned-models.mjs')], { encoding: 'utf8' });
    expect(out).toContain(`(${BANNED_MODELS.length} names checked)`);
  });
});
