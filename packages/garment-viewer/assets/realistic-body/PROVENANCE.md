# Provenance: `female-v1.crb` (realistic body spike)

`female-v1.crb` is baked by `packages/garment-viewer/scripts/bake-realistic-body.ts` from MakeHuman assets read
through the MPFB2 repository. Nothing else went into it: no skin texture, no hair, no eyebrows or lashes, no photo
texture on the face (D27), no SMPL, SMPL-X, FLAME, STAR, Anny or other body/face model, no scan, no photo of a person.

- File: `female-v1.crb`, 455,556 bytes (297,356 B gzip, 201,139 B brotli; +45.1 KB gzip over the pre-WO-020 bake), sha256 `8c45a55ce26baee415f01e96787cb336a077ca2e72fbc85e20b79e3d861ff8ee`
  (the bake is deterministic: the same sources give the same bytes).
- Format: `curtain.realistic-body` version 1 (`src/realisticBody.ts`, `encodeRealisticBody` / `decodeRealisticBody`), carrying 4 body shape targets (`weight±`, `cup±`) and 12 signed CC0 face shape targets (`faceWidth`, `faceHeight`, `jawWidth`, `chinWidth`, `chinHeight`, `chinProminence`, `cheekbones`, `noseLength`, `noseWidth`, `eyeSpacing`, `browHeight`, `lipWidth`, WO-020 / CUR-34).
- Read and baked on 21 November 2026 (body) and 23 November 2026 (face targets, WO-020) by AI agents. Not a lawyer's reading.

## Source

- Repository: https://github.com/makehumancommunity/mpfb2
- Commit: `9de0707fdc88438d7c53a1a2ac7937d9221e2431` (committed 2026-11-12T18:40:10+01:00, the head of `master`
  when fetched)
- Fetched with `git clone --depth 1 --filter=blob:none` and `git checkout` of the paths below; the bake's `--fetch`
  gets the same files from `https://raw.githubusercontent.com/makehumancommunity/mpfb2/9de0707fdc88438d7c53a1a2ac7937d9221e2431/<path>`.
  The bake refuses any file whose sha256 differs from this table.

| Path in the repository | What is taken | sha256 |
|---|---|---|
| `LICENSE.md` | licence statement (checked by the bake to still say CC0 for the assets) | `5cefb60680cb9efd4550a2e65d719021cfbec9dad3658481d11d48ae863ce04d` |
| `LICENSE.ASSETS.md` | the CC0 1.0 legal code | `f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c` |
| `src/mpfb/data/3dobjs/base.obj` | base mesh hm08: the `body` group (13,380 vertices, 13,378 quads) and the two low-poly eye helpers `helper-l-eye`, `helper-r-eye` (72 vertices each); the joint cubes `joint-l-shoulder`, `joint-l-hand`, `joint-l-knee` as landmarks | `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c` |
| `src/mpfb/data/targets/macrodetails/african-female-young.target.gz` | the default female (1/3 of each of the three ethnic female-young targets, MakeHuman's default mix) | `1147ae55ecb0f66bade3f45176b3af187e265878322db172ad1090e9f3108e84` |
| `src/mpfb/data/targets/macrodetails/asian-female-young.target.gz` | the same | `ee17da733288434e5b6fa120497f1fa6e72bf7faad5d694b0431d7275139170d` |
| `src/mpfb/data/targets/macrodetails/caucasian-female-young.target.gz` | the same | `e9d6212373ac5f1e2c596fa145e363385f4d169c3c6c88ede3bab93b681af041` |
| `src/mpfb/data/targets/macrodetails/universal-female-young-averagemuscle-maxweight.target.gz` | shape target `weight+` (sparse deltas in the asset) | `eaec00c7fe67738765170b94648e6cdf1078ff15a2c0f745645750eb6fef45bf` |
| `src/mpfb/data/targets/macrodetails/universal-female-young-averagemuscle-minweight.target.gz` | shape target `weight-` | `5c65527e5d6e83b98ffa3da5bd61372eff70f89e95585bdacd0e3f70e48062aa` |
| `src/mpfb/data/targets/breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness.target.gz` | shape target `cup+` | `70e67e082034a80cb6a88abac95d6e11d305f769c98f2d70374dea97fa98c604` |
| `src/mpfb/data/targets/breast/female-young-averagemuscle-averageweight-mincup-averagefirmness.target.gz` | shape target `cup-` | `d891d82f4514e72f7d5691d8c83b934a195006ecd7b37954158b7b5fd9fb0804` |
| `src/mpfb/data/rigs/standard/rig.default.json` | bone hierarchy (which bones are the arm's and the head's) | `8b949de35c2dd70dbb5094e57a8586c3b9a9f650775a293212581a8f67be6797` |
| `src/mpfb/data/rigs/standard/weights.default.json` | skin weights of the arm bones (to pose the arms and to blend the fitted arm into the torso) and of the head bones | `154b866774a8c2b055a8e86419f22a87b76c60440fdcb70bcb78345f00924e89` |
| `src/mpfb/data/targets/head/head-scale-horiz-incr.target.gz` | face target `faceWidth` (+) | `671542640aec14d1740c1263deb0e274f3044edec761e6d4171329f0419be084` |
| `src/mpfb/data/targets/head/head-scale-horiz-decr.target.gz` | face target `faceWidth` (−) | `ddec139b27d1f9b7a90f6474450c56897a4e417334af083e87e988fdf94ca343` |
| `src/mpfb/data/targets/head/head-scale-vert-incr.target.gz` | face target `faceHeight` (+) | `be8b270ec67817578128396433d6e8ab9d530c9d81ea21db92cd1b9627a8110b` |
| `src/mpfb/data/targets/head/head-scale-vert-decr.target.gz` | face target `faceHeight` (−) | `64e86d59a469eeeb0201026880bcd6ebb0cbd590a74b179f58efa879b3772f6c` |
| `src/mpfb/data/targets/head/head-triangular.target.gz` | face target `jawWidth` (+) | `4fed43891a15d76507b8062e69ebf8482438ecbf281e3f6f9876407ea98ee308` |
| `src/mpfb/data/targets/head/head-invertedtriangular.target.gz` | face target `jawWidth` (−) | `70ba80d2c8da216be56c6edaaa8386d5390aa92094859bf83096fb3acb33f12a` |
| `src/mpfb/data/targets/chin/chin-width-incr.target.gz` | face target `chinWidth` (+) | `68764b6ec7c923597beaaf643f71c41f00c93639d9bb522c169c279db2ad299e` |
| `src/mpfb/data/targets/chin/chin-width-decr.target.gz` | face target `chinWidth` (−) | `6c3aaca074630e89951184130a4a158b6f62c9d0cf57cf8eb828c445ff40c21a` |
| `src/mpfb/data/targets/chin/chin-height-incr.target.gz` | face target `chinHeight` (+) | `4f05b61b39266801b0a333c208d274ff109250fe9e4512c486a455806878e15c` |
| `src/mpfb/data/targets/chin/chin-height-decr.target.gz` | face target `chinHeight` (−) | `1f4196d330b418d576e9400a754cb99d7e60b069ee8fdef645713f84db984e0c` |
| `src/mpfb/data/targets/chin/chin-prominent-incr.target.gz` | face target `chinProminence` (+) | `e0d5ec5e213b88719def0f43ddaa7107796fc02f7447e2b2f140d9fe513a6ac8` |
| `src/mpfb/data/targets/chin/chin-prominent-decr.target.gz` | face target `chinProminence` (−) | `4ed14cb51e7ea7b3ecd469a537733924353c683f3cfe545be182d18a220dcb4e` |
| `src/mpfb/data/targets/cheek/l-cheek-bones-incr.target.gz` | face target `cheekbones` (L+) | `ea5aa60abcc2926e61cdabf5d40701c2b23b3f8027f949cea0b80bcbc55df301` |
| `src/mpfb/data/targets/cheek/r-cheek-bones-incr.target.gz` | face target `cheekbones` (R+) | `c608528b9e5e1c670179cfb502dab3d9478a77bb942f7c8186cd072a7369e9b9` |
| `src/mpfb/data/targets/cheek/l-cheek-bones-decr.target.gz` | face target `cheekbones` (L−) | `109d88ec6394cb3455073ae9f2a6038b8b4d6b57feeaf4633611bc60f27ed212` |
| `src/mpfb/data/targets/cheek/r-cheek-bones-decr.target.gz` | face target `cheekbones` (R−) | `f128fdcf1d91769a907dc2c74056edac427196c1900f875c34c03b01dee5b7af` |
| `src/mpfb/data/targets/nose/nose-scale-vert-incr.target.gz` | face target `noseLength` (+) | `63d297c237e7054a1ea700b83454ef508bf5f42ba8f2eb6bc1eb747ad261f34b` |
| `src/mpfb/data/targets/nose/nose-scale-vert-decr.target.gz` | face target `noseLength` (−) | `3eea81bc82ddca8e20c8fc4279092eb2c8540d05e0c2aacf868af5da4ebac108` |
| `src/mpfb/data/targets/nose/nose-scale-horiz-incr.target.gz` | face target `noseWidth` (+) | `ba550cc15c894a4412bb368acc92bd6ad94bbb63d0135c561fe30230ef6344bd` |
| `src/mpfb/data/targets/nose/nose-scale-horiz-decr.target.gz` | face target `noseWidth` (−) | `95d8dc4a3589bbb6105191abc6e3cae47c3c424ce189b5f0a611dc098806060d` |
| `src/mpfb/data/targets/eyes/l-eye-trans-out.target.gz` | face target `eyeSpacing` (L+) | `b74b2e4266f3db6122baaad9a4f793b81285cb2ac405f9fa4163bc72e72e56fc` |
| `src/mpfb/data/targets/eyes/r-eye-trans-out.target.gz` | face target `eyeSpacing` (R+) | `1fc70679c7c086d10adc405b57be80d757417e925f1884625d6bc24b6a9fd05d` |
| `src/mpfb/data/targets/eyes/l-eye-trans-in.target.gz` | face target `eyeSpacing` (L−) | `2129b8e5ea7b3875f32f7a50733eb4f61ea313f7dcc7e38491573b0cbd2cddc0` |
| `src/mpfb/data/targets/eyes/r-eye-trans-in.target.gz` | face target `eyeSpacing` (R−) | `5c0fbc8e74ac1450aa517a98f5522855a73d67dad2b759ebc2f9a3001bb7d5af` |
| `src/mpfb/data/targets/eyebrows/eyebrows-trans-up.target.gz` | face target `browHeight` (+) | `fdaf3fb2ee5d1790202ede605d097e7666567237f1ab62a90729f72df0c16c52` |
| `src/mpfb/data/targets/eyebrows/eyebrows-trans-down.target.gz` | face target `browHeight` (−) | `9f5bbb848e40d3a320492dd08ef8d1a926b50c7fd1ca279cf8f573e0f0cdd589` |
| `src/mpfb/data/targets/mouth/mouth-scale-horiz-incr.target.gz` | face target `lipWidth` (+) | `3bd6ff8195f77f0bcb586f3efec0eea1ae615eecba516e4d121025e40ed0ead2` |
| `src/mpfb/data/targets/mouth/mouth-scale-horiz-decr.target.gz` | face target `lipWidth` (−) | `aed1a3c27224d12828de1ffc3fe9c2895f4389417d016016dd4f1fefccdbc6c9` |

## Licence, quoted from the files themselves

`LICENSE.md`, section "C. The license for the bundled assets":

> The assets are defined as any data contributing to the output from MPFB.
> This includes:
>
> * The base mesh and proxies
> * Targets and modifiers
> * Textures
> * Clothes (any MHCLO-based asset)
> * Rigs, poses and expressions
> * JSON data with mesh information
>
> These assets have been released under CC0 1.0 Universal. In summary this means
> that to the fullest extent possible, it is the intention of the MakeHuman
> team that anyone can do whatever they want with it.

`LICENSE.md`, section "B": the MPFB source code (python files, shell scripts and configuration files) is GPLv3. None
of it is used: the bake and the loader are this repository's own TypeScript, written against the file formats (OBJ,
`index dx dy dz` target lines, the JSON weight lists). No MakeHuman or MPFB code, shader or algorithm was copied or
ported.

`src/mpfb/data/3dobjs/base.obj`, header:

> This asset was explicitly released as CC0 in september 2020. The license
> text for CC0 can be found in the root of this repository.
>
> The copyright holders at the point of the release to CC0 were:
>
> Copyright (C) 2020 Data Collection AB, https://www.datacollection.se
> Copyright (C) 2020 Joel Palmius
> Copyright (C) 2020 Jonas Hauquier

`src/mpfb/data/rigs/standard/weights.default.json`, its own fields: `"license": "CC0"`, `"name": "MakeHuman weights"`.

The `.target.gz` files carry no header of their own; they are "Targets and modifiers" under section C above.

`LICENSE.ASSETS.md` is the Creative Commons CC0 1.0 Universal legal code (its heading: "Creative Commons CC0 1.0
Universal"). Section 2 (Waiver) covers use "for any purpose whatsoever, including without limitation commercial,
advertising or promotional purposes"; section 4(b) disclaims every warranty, including non-infringement, and 4(c)
disclaims responsibility for other persons' rights.

## What CC0 asks of us

Nothing: no credit, no notice, no share-alike. We keep this file so the origin can be shown. CC0 gives no warranty
(section 4); whether a generic body shape can raise any person's rights was not examined (the base mesh is a generic
average, not a scan).

## Not taken in this spike

- MakeHuman skins (community uploads, CC0 per author with no warranty), hair packs (Hair 02 and 03 are CC-BY), eyebrows,
  eyelashes, proxies, clothes: none.
- The MakeHuman Python or GLSL code (AGPL), the MPFB code (GPLv3): none.
- Anny, SMPL, SMPL-X, FLAME, STAR, any NVIDIA or non-commercial asset: none.
