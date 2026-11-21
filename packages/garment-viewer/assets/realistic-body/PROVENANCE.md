# Provenance: `female-v1.crb` (realistic body spike)

`female-v1.crb` is baked by `packages/garment-viewer/scripts/bake-realistic-body.ts` from MakeHuman assets read
through the MPFB2 repository. Nothing else went into it: no skin texture, no hair, no eyebrows or lashes, no face
work (D27), no SMPL, SMPL-X, FLAME, STAR, Anny or other body model, no scan, no photo of a person.

- File: `female-v1.crb`, 337,732 bytes, sha256 `426574e20b292f3c8cf74e624420e407a68ad4cd8e1c6ec3fc83d56b772f50f1`
  (the bake is deterministic: the same sources give the same bytes).
- Format: `curtain.realistic-body` version 1 (`src/realisticBody.ts`, `encodeRealisticBody` / `decodeRealisticBody`).
- Read and baked on 21 November 2026 by an AI agent. Not a lawyer's reading.

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
