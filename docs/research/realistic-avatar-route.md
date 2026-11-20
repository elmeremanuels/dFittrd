# Realistic avatar: how the mannequin reaches the level of the three references

Research for the founder's question: the mannequin looks too much like a grey doll, and three references show "the level it has to reach". How do we get there?

- References: https://hyper3d.ai/features/api , https://www.meshy.ai/tags/human , https://free3d.com/3d-model/sophia-animated-001-idling-130876.html
- All sources below were read on **2026-11-20**, unless a row says otherwise. Each fact has its URL.
- Rows marked **not verified** could not be opened or were not read at the source. No price or licence term in this document is a guess. Where arithmetic is ours, it says so.
- Licence readings are by an AI agent, not a lawyer. Not legal advice.
- Code facts are from branch `claude/garment-engine` at commit 1241292. Tests and the build were not run for this document.
- Nothing is built. This is a route and a one-week spike.

## 1. The answer in ten lines

1. None of the three references is a product we can ship. Two are generators that make one fixed mesh from a text or a picture. One is a scan of one real, clothed person.
2. None of them takes body measurements. So none can carry the size. Our measured body (rings, girths) stays the source of truth.
3. The grey-doll look has six causes: body shape, skin, face and hair, lighting, garment surface, and the final image. Each needs its own fix (section 3).
4. Recommended route: keep the ring table, and draw a **realistic parametric base body fitted to our rings**. The candidate is the MakeHuman base mesh with its morph targets. Its licence file says CC0.
5. In the same step, fix the cheap things: an environment map for lighting, a skin texture with UVs, and a normal map on the fabric.
6. The **AI realism layer** (D22, already planned) stays the last step. It makes the picture photoreal. The better body gives it better depth and normals to start from.
7. Hyper3D and Meshy can only be an **offline source of look parts** (head, hair, hands, skin), never with a shopper photo, and only after written licence answers. Not now.
8. Scanned people (the Sophia kind) are closed: the licences we could read forbid an open mesh served to shop visitors, and a scan cannot follow measurements.
9. A spike of one week proves or kills it: girth error against the ring table, bytes and frame time on a real phone, side-by-side pictures (section 7).
10. Not solved by this route: a face and hair at scan level, proof of the skin textures' origin, and the rebuild of every garment bundle on the new body shape.

## 2. The three references, and why none is the product by itself

### 2.1 Hyper3D Rodin (https://hyper3d.ai/features/api)

What it is: a cloud generator. It makes one textured 3D mesh from a text prompt or from 1 to 5 images of the same object.

| Fact | Source |
|---|---|
| Async job: submit, poll, download. Gen-2.5: "Custom Polycount Up to 2M", "Up to 12K Textures with HighPack", "Quad or Raw Topology", "GLB, FBX, OBJ, USDZ, STL Export", "Text, single-image, or up to 5-image input". | https://hyper3d.ai/features/api |
| Inputs: text up to 1,024 characters, or 1 to 5 images. The full parameter list has **no parameter for body measurements or girths**. | https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5 |
| Size control is only a bounding box: three integers, 1 to 2048, in unnamed "units". It caps overall proportions. It is not a girth control. One of our two readers found `bbox_condition` and `TAPose` on the Gen-2.5 spec; the other fetch of the same page did not show them. Either way there is no metric input. | https://docs.hyper3d.ai/en/api-specification/bbox-control |
| No garment, cloth or try-on function. Observed as an absence on the API page and the spec. | https://hyper3d.ai/features/api |
| Rigging exists in Hyper3D's own API. For an uploaded model "The geometry, materials, and textures are preserved without a remesh step or texture generation". Not tested by us. | https://docs.hyper3d.ai/en/api-specification/rigging |
| A low-poly endpoint exists (PolyGen): 200 to 10,000 faces. Quality for human bodies was not checked. | https://docs.hyper3d.ai/en/api-specification/polygen |
| API data: payloads and output kept "a fixed period of 7 days", "not used to train models". Effective 3 August 2026. The general terms are wider: prompts and output may be used "to provide, maintain and improve our services, and conduct and support research", with human review. Which text wins for API use is not stated. | https://docs.hyper3d.ai/en/legal/data-retention-policy ; https://hyper3d.ai/legal/terms |

Why it is not the product:

- **Not parametric.** It cannot build a body to typed measurements. A Rodin human cannot carry the size truth.
- **Privacy rule.** A body in the shopper's own shape would need a body photo sent to a cloud that keeps it 7 days plus backups. That breaks D19, D20 and D22. A face photo there does not meet "processed in memory and deleted".
- **Licence.** The right to ship Rodin output inside merchants' shops is not established by the published terms (section 6).
- **Look.** Nobody on this task has viewed a Rodin human. Its visual quality is **not verified**.

### 2.2 Meshy human gallery (https://www.meshy.ai/tags/human)

What it is: a gallery of community models made with Meshy's generator. **The page returned HTTP 403 to both readers. Nobody on this task has seen one gallery human.** A person with a normal browser has to look.

| Fact | Source |
|---|---|
| Community 3D models are CC0 when posted to the Community page (terms section 3.3, "Last Updated: September 19, 2026"). Uploaded images there are CC BY-NC 4.0, which we cannot use. | https://www.meshy.ai/terms-of-use |
| CC0 on a gallery human says nothing about likeness rights. The uploader holds that duty (section 3.4). | https://www.meshy.ai/terms-of-use |
| The Free plan has no community model downloads. Paid plans show unlimited downloads. | https://www.meshy.ai/pricing |
| Image to 3D has no parameter for proportions, girths or measurements. Resize takes one height or one longest side. `auto_size` "estimates the object's real-world height with AI vision". | https://docs.meshy.ai/en/api/image-to-3d ; https://docs.meshy.ai/en/api/resize |
| Meshy's own words on photo to human: "The result is a likeness, not a body scan, so generate two or three times and keep the closest one." | https://www.meshy.ai/3d-tools/realistic-character-generator |
| Raw meshes are heavy: 890,226 faces (meshy-7.1) and 678,776 (meshy-6) for one example image. Light models give 4,353 to 30,513. | https://docs.meshy.ai/en/api/models |
| One first-hand review of Meshy 7: "Faces, especially eyeballs, are also…problematic for 3D renders." The author received 1,000 free tokens from Meshy. | https://3dprint.com/331847/meshy-7-all-the-fingers-and-toes/ |
| Non-Enterprise inputs and outputs may be used for training unless you opt out by email. Inputs must not contain data "that could identify a specific person". | https://www.meshy.ai/terms-of-use |
| API output is deleted after 3 days. | https://docs.meshy.ai/en/api/asset-retention |

Why it is not the product:

- **Not parametric.** Whole-model height scaling only. A Meshy human cannot be made to match typed girths.
- **Privacy rule.** Server only. A shopper photo as input breaks our rules and sits against Meshy's own terms.
- **One fixed mesh.** Each gallery model is one fixed figure, often with clothes sculpted in. It cannot be redressed by our cloth engine.
- **Look.** Unproven for us. The gallery was not seen, and the one review read names faces and eyes as the weak point.

### 2.3 "Sophia animated 001 idling" on free3d

What it is: **not verified.** The free3d page, its licence page and its terms page all returned HTTP 403. Author, licence label, price, formats and polygon count of this listing were not read.

| Fact | Source |
|---|---|
| Renderpeople released "a ready-to-use animated 3D People freebie called Sophia" (article of 30 April 2018). That the free3d listing is this file is an inference from the name. | https://80.lv/articles/free-animated-3d-people |
| Renderpeople models are scans: "Each 3D model corresponds to a real human being captured by our state-of-the-art 3D Scanner." Rigged People: "10-15k polycount (retopologized quads)", "8k high-resolution textures". Sophia 001's own specs are inferred from the product line. | https://renderpeople.com/free-3d-people/ |
| Sophia Animated 003 on Sketchfab: 16.5k triangles, 8.3k vertices, 8k textures. | https://sketchfab.com/3d-models/sophia-animated-003-animated-3d-woman-dc448c3be0e74f96a55fb475a13433cf |
| Renderpeople free models: "Free Commercial Use", but "all free models are subject to the same terms of use as the charged models". Sophia is not named on that page today. | https://renderpeople.com/free-3d-people/ |
| Free3D is a brand of TurboSquid. Its terms incorporate the TurboSquid licence. That licence asks for a proprietary format that cannot be opened in public software, and advance approval for other WebGL use. | https://intercom.help/free3d-787715/en/articles/9937612-terms-conditions ; https://blog.turbosquid.com/turbosquid-3d-model-license/ |

Why it is not the product:

- **One fixed person.** A scan has that person's girths. Her clothes are baked into mesh and texture. It cannot follow measurements and cannot be redressed. (Our reasoning, not a vendor statement.)
- **Its own licence.** If it is the Renderpeople file, their terms need written consent for use in an application or SaaS, and forbid making the files easy to download or extract. A GLB sent to a browser is both (our reading). If the free3d listing falls under the TurboSquid licence, an open glTF loaded by three.js fails its format test (our reading).
- **AI layer.** The Sketchfab listing forbids use "as inputs to generative AI programs". TurboSquid has a similar clause. That collides with D22.

### 2.4 What the references do tell us

Read as a wish list, the three references share these things: a body with real anatomy, skin with texture, a real face and hair, soft believable light, and (Sophia) cloth with visible weave and folds. That is the gap in section 3. It is our reading of the references; two of the three pages could not be opened.

## 3. The gap, named concretely

State today is from the repo (`packages/mannequin`, `packages/garment-viewer`, READMEs and `scene.ts`).

| Part | Today | What is missing | What closes it |
|---|---|---|---|
| **Body mesh** | Bodies lofted through 12 measured rings. Female sections are pure ellipses (no bust, no seat). Male shape v2 has drawn sections fitted to ANSUR II. Girths are exact; widths and depths are 6 to 9 % off at waist and hip, about 22 % at the male chest (mannequin README). | Anatomy: bust, seat, clavicle, knees, hands, feet. | A realistic base mesh fitted to the ring table, entered as a new opt-in shape. |
| **Skin** | No UVs, no texture maps. Default one grey material (#8C8C8C). Picked tone gives one flat colour. Opt-in `skin-v2` adds subsurface scattering from a table computed in code. | Albedo detail, normal detail, roughness variation, for Monk tones 1 to 10. | UV-mapped body, a skin albedo tinted per tone, a normal map. |
| **Face and hair** | Four hand-written heads (egg, neutral, v2, v3). No scan, no face model. README self-assessment: "a shop-window mannequin", eyes "a little doll-like". Hair is sculpted into the head surface (v3). | A believable face, eyes, brows, hair as its own geometry. | Hardest part. A parametric head and hair assets, or the AI layer. See section 5. |
| **Lighting** | One hemisphere light plus directional lights. No environment map. Contact shadow is a painted spot. No shadow maps. | Image-based light, soft reflections, grounded shadow. | An environment map (three.js `RoomEnvironment`, about 1.7 KB, or a CC0 HDRI). |
| **Garment surface** | One double-sided material with at most one base-colour map. No normal map, no thickness, no hem geometry (reader's reading of the code, not re-read line by line). | Weave, seams, hems, sheen. | Tiling fabric normal and roughness maps, hem and seam treatment, sheen where it fits. |
| **Final image** | A real-time WebGL render. | Photoreal image. | The AI realism layer (docs/research/ai-realism-layer.md), checked against the 3D estimate. |

Two more facts that shape every route:

- **No phone measurement exists.** Frame times are from a software renderer only: body alone 103 to 177 ms per frame while turning at 4x CPU throttle; with a dress 3.2 to 8.9 fps. The README says "a phone was not measured" (`packages/garment-viewer/README.md` lines 113-122).
- **The cloth never sees triangles.** It collides with a table of horizontal sections (ellipses, or 96-radius polar outlines). The drawn body and the collision body must be the same surface within about 0.5 cm (`outlines.test.ts`), with 0.35 cm cloth clearance. A realistic mesh must be sliced into that table.

## 4. The routes compared

Routes:

- **A. Polish the procedural body.** Keep today's geometry. Add environment light, skin detail, fabric maps, better eyes and hair.
- **B. Realistic parametric base body fitted to our rings.** An offline-baked base mesh with morph targets (MakeHuman CC0, through the Anny free install or our own bake), deformed so every ring has the table girth, sliced into a collision outline, loaded as a separate asset.
- **C. Licensed scan-quality body per shape.** Buy or license scanned or artist bodies, one per size or shape.
- **D. Generative 3D per shopper.** Make each shopper's body with Rodin, Meshy or similar at runtime.
- **E. AI layer over the render.** Planned under D22. Makes the final image; the 3D stays the base.
- **F. Combination A + B + E**, with generator-made look parts (head, hair) as a later, optional add-on.

| | Look | Truth to measurements | Privacy rule | Licence | Bytes and frame time on a phone | Cost per shopper | Work |
|---|---|---|---|---|---|---|---|
| **A. Polish procedural** | Better light and surfaces. Still a mannequin: the female body stays ellipses, the face stays hand-drawn. | Unchanged. Girths exact. | Holds. No new data flow. | Clean. Own code, plus CC0 light and fabric maps (Poly Haven CC0, self-hosted). | Small. Environment map and tile maps are separate assets. Physical materials cost more per pixel (three.js docs, no numbers). Phone not measured. | None. | Small. Days per item. Body UVs are needed for skin detail. |
| **B. Parametric base on our rings** | Real anatomy. Skin as good as the texture we can clear. Face and hair remain the weak part. Not proven to reach the references. | Kept by construction if the fit works: rings stay at table girth. Not proven: the MakeHuman measure targets have no centimetre scale, and the solve has not been run. | Holds. A static asset, no shopper data. A new sixth kind of request; one e2e test and the D3 wording must be updated. | Base mesh and targets CC0 per the project licence files. Skins are per-author community uploads marked CC0, no warranty. Realistic hair is CC-BY. | Base mesh 19,158 vertices, 18,486 faces. Skin pack is 2048x2048 diffuse only (first reader's measurement). Download size and phone frame time not measured. The viewer chunk does not grow from a fetched asset; a loader adds code (GLTFLoader about 25.9 KB gzip, reader's measurement). | None at runtime. | Large. New shape variant, slicer, head seam, loader, and a rebuild and re-gate of every garment bundle and server bake on the new shape. |
| **C. Licensed scan body per shape** | Highest for the body it shows. | Fails. A scan is one person. A few fixed bodies cannot follow typed girths across bust 60-160, waist 45-150, hip 65-170 cm. | Holds. | Closed off the shelf. Renderpeople, TurboSquid/Free3D, CGTrader, AXYZ: none allows an open mesh served to web visitors. Reallusion and Daz likewise. Consent prices are not published. | 8K textures would need downscaling. 10 to 16.5k polygons is fine. | Unknown. No negotiated price is published anywhere. | Medium for the asset, plus a negotiation per vendor. Still needs a fit that scans cannot give. |
| **D. Generative 3D per shopper** | Unknown. No output was viewed. Faces and eyes are the named weak point in the one review. | Fails. No measurement input at Rodin or Meshy. Meshy calls its own result "a likeness, not a body scan". | **Fails.** Needs the shopper's body photo on a server (Rodin keeps payloads 7 days; Meshy may train on non-Enterprise inputs). Forbidden by D19, D20, D22. | Rodin: commercial redistribution not established. Meshy paid: customer owned, no warranty. TRELLIS.2: non-commercial NVIDIA parts in the pipeline. Hunyuan3D: banned, EU and UK excluded. | Raw output 500,000 to 890,000 faces by default; low-poly modes exist. Generation time: not stated by Hyper3D; Meshy says wait up to 60 minutes before giving up. | Per generation. Hyper3D: 0.5 credit base, "Direct credits cost $1.5 per credit" (0.5 x $1.5 = $0.75 is our arithmetic). fal: "$0.4 per generations". Meshy: 30 credits with 2K textures, no dollar price per credit published. | Medium to wire up. Dead on the privacy rule, so not worth it. |
| **E. AI layer over the render** | The only route to a photoreal image. | Guarded: every AI image is compared with the 3D estimate and refused on a failed check (ai-realism-layer.md). | Holds by design: the input never contains a body photo. | Apache-2.0 weights (ai-realism-layer.md, read 2026-11-19, not re-read here). | Server image, not real-time. The interactive 3D view stays what it is. | $0.0065 per megapixel at the primary host; pilot estimate about USD 1 per shop per month (ai-realism-layer.md, read 2026-11-19, not re-read here). | Plumbing exists behind a flag that is off. |
| **F. A + B + E** | Best reachable: real anatomy and light in the live 3D view, photoreal in the still image. | As B, with E's checks on top. | Holds. | As A, B and E. Each asset needs its own row in docs/LICENSES.md. | As B. | As E. | A is days. B is the large item. E is already planned. |

Notes on the table:

- D is the only route that would give the shopper's own likeness. It is exactly what the hard rules forbid. A face under D19 is a separate, existing path (face overlay), not a body route.
- C could also mean "one scan as a base, then morphed". The licences read forbid that use too without written consent, and several also forbid feeding renders to an AI model.
- A variant of B is to use a generator offline, from a text prompt only, to make look parts (head, hair, hands). That is licence-possible on paper for Meshy paid plans, and unresolved for Rodin. See section 6.

## 5. Recommendation

**Do F, in this order, and let a one-week spike decide B before any promise is made.**

1. **Measure on a real mid-range Android phone first.** There is no phone number in the project. Every later choice depends on it.
2. **Route A items that are cheap and stay useful whatever body is drawn:** an environment map, a fabric normal map, the true-tone lighting rig (already built, waiting for the founder's approval).
3. **Route B as a new opt-in body shape**, the way male shape v2 was added: its own sliced outlines, rings at table girth, old defaults byte-identical, bundles named by shape.
4. **Route E stays the last step** for the photoreal still. Decide B and E together: a new body changes the depth, normal and mask passes the AI layer reads.
5. **Generators (Rodin, Meshy) only later, offline, text-prompted, for look parts**, and only after the written answers in section 8.

Reasons:

- **Size truth.** Only routes A, B and E keep the ring table as the body. C and D cannot follow typed girths.
- **Privacy.** A, B and E need no shopper photo at all. D cannot exist without one.
- **Licence.** The only body source whose licence we read in full and that allows shipping is MakeHuman's bundled base mesh and targets: "These assets have been released under CC0 1.0 Universal". The project already accepts CC0 and CC BY 4.0 items (docs/LICENSES.md).
- **The code is already organised for it.** Male shape v2 is the precedent: non-elliptical sections, the same 12 rings, polar outlines for the collider, a bundle that names its shape.
- **Phone.** The base mesh is 19,158 vertices. That is in the range of today's bodies (14.9k to 60.7k triangles). A fetched asset is not counted against the 400 KB viewer chunk.
- **It helps the AI layer.** Better anatomy in depth and normals is better conditioning. (Our expectation, not measured.)

What this recommendation does **not** solve:

- **Face and hair at reference level.** MakeHuman's only CC0 hair pack is described by the project as "mostly low-poly and stylized". The realistic pack is CC-BY (version not stated on the page). A believable face in real-time 3D is not delivered by any cleared source here. Expect the AI layer to carry the face in the still image, and the live 3D face to stay stylised for now.
- **Skin provenance.** The skins are community uploads that each author marked CC0. MakeHuman does not warrant them. The texture is 2048x2048, diffuse only (first reader's measurement, not re-checked).
- **Widths and depths.** A mesh fitted to the same ring table is true at the typed girths only, as today. More truth needs section shape data.
- **Concavities.** The collider is star-shaped per height. Bust, seat cleft, armpit and inner thigh can only be represented as their outer surface. Male v2 already needed special cases.
- **The catalogue.** Every garment bundle and server bake is tied to a named body shape. A new shape means rebuilding and re-gating all of them, and running the drape tests again on the new body.
- **Whether the result reaches the references.** Unproven until the side-by-side pictures of the spike exist. Two of the three reference pages could not even be opened.
- **Fallback honesty.** If the asset fails to load, a fallback to the procedural body is only honest if it has the same collision shape, or the garment is re-draped.

## 6. Licence table

Status words: **usable** = licence text read and it allows shipping in a commercial web product; **blocked** = text read and it forbids our use off the shelf; **banned** = in `bannedModels.ts` or a banned licence class; **unresolved** = text read, the answer is not in it; **not verified** = page could not be opened or was not read at the source. Read 2026-11-20 unless stated. "Our reading" marks an application of the text to Curtain that the vendor does not state.

### 6.1 Parametric and open bodies

| Source | What | Status | Detail | URL |
|---|---|---|---|---|
| MakeHuman / MPFB2 base mesh, targets, rigs | CC0 1.0 | **usable** | "These assets have been released under CC0 1.0 Universal." Code is GPLv3 (MPFB) and AGPL (MakeHuman): do not link, port or copy the code or the MakeHuman GLSL shaders. Writing our own loader is our reading. | https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/LICENSE.md ; https://raw.githubusercontent.com/makehumancommunity/makehuman/master/LICENSE.md |
| MakeHuman skins 01, 02, 03 | CC0 per author | **usable with a caveat** | Each skin: "Source: asset repo", "License: CC0", set by its author. MakeHuman: third-party assets are "your own responsibility". No licence file in the zip (first reader, not re-checked). | https://static.makehumancommunity.org/assets/assetpacks/skins01.html |
| MakeHuman Hair 01, eyebrows, eyelashes | CC0 | **usable** | Hair 01 is "mostly low-poly and stylized". | https://static.makehumancommunity.org/assets/assetpacks.html |
| MakeHuman Hair 02, Hair 03 | CC-BY | **usable with credit; version not verified** | The page does not say which CC-BY version. A credit per asset would be owed. | https://static.makehumancommunity.org/assets/assetpacks.html |
| Anny (NAVER Labs Europe) | Apache-2.0 code, CC0 data | **usable, free or minimal install only** | `pip install anny[smpl,examples]` is labelled "non-free dependencies". The `smpl` extra pulls `smplx`. The "smplx" topology is "non-commercial use only". v0.6.2 added optional SMPL-H support. All of these must stay off. docs/LICENSES.md lists Anny for research spikes only and asks for confirmation "if Anny geometry ever ships". | https://raw.githubusercontent.com/naver/anny/main/README.md |
| MHR (Meta) | Apache-2.0 code | **unresolved** | Model assets are downloaded from a release; their licence was not checked. A conversion tool touches SMPL files and must not be used. No textures. | https://raw.githubusercontent.com/facebookresearch/MHR/main/README.md |
| SOMA-X (NVIDIA) | Apache-2.0 | **unresolved** | Acknowledges "SMPL-Body was used to create the SMPL-to-SOMA topology correspondence". The SMPL-Body licence was not read. Ask a lawyer before shipping SOMA topology data. | https://raw.githubusercontent.com/NVlabs/SOMA-X/main/README.md |
| Google GNM Head | Apache-2.0 | **usable on paper; head geometry only** | "suitable for both non-commercial and commercial applications". No body model, no textures. Not evaluated for the phone. | https://raw.githubusercontent.com/google/GNM/main/README.md |
| Microsoft Rocketbox | MIT per README | **usable on paper; not parametric** | 115 rigged, clothed characters, "relatively low-poly". One reader saw the repository "archived by the owner on Oct 2, 2026"; the other could not confirm it and got a 404 on the raw LICENSE path. | https://github.com/microsoft/Microsoft-Rocketbox |
| Blender Studio Human Base Meshes | claimed CC0 | **not verified** | blender.org demo-files returned HTTP 403. The release notes name no licence. CC0 rests on a search snippet. | https://www.blender.org/download/demo-files/ |
| SMPL, SMPL-X, STAR, SUPR | non-commercial | **banned** | "Any other use, in particular any use for commercial purposes, is prohibited." The SMPL-X licence page itself was not opened. No commercial price published. | https://smpl.is.tue.mpg.de/modellicense.html ; https://raw.githubusercontent.com/ahmedosman/STAR/master/LICENSE ; https://raw.githubusercontent.com/ahmedosman/SUPR/master/LICENSE |
| FLAME | named banned in the task rules | **banned by rule; note** | `bannedModels.ts` has no `flame` token today. The head READMEs say no FLAME is used. | `packages/tryon-providers/src/bannedModels.ts` |

### 6.2 Commercial character systems

| Source | Status | Detail | URL |
|---|---|---|---|
| Reallusion Character Creator | **blocked** | EULA "Updated November 1st, 2026". Content must be packaged so it "cannot be opened, extracted, or imported into third-party 3D software". Runtime body morphing is a "Character Generation System" and needs an Enterprise licence; no price published. An Enterprise licence is not shown to lift the anti-extraction duty. That a browser glTF is extractable is our reading. | https://www.reallusion.com/Content/EULA/EULA.htm |
| Daz 3D | **blocked** | Content must not be "available to end users in their native formats". Interactive licence is per product. The licence "expressly excludes the use, incorporation, or input of any Content ... in connection with i) any AI engine" that auto-generates derivative material: collides with the AI layer. No price read. | https://www.daz3d.com/eula ; https://www.daz3d.com/interactive-license-info |
| Unreal MetaHuman | **not verified** | Epic's FAQ: usable "with any engine or creative software"; no training or testing of AI. The contract behind it, the Unreal Engine EULA, returned HTTP 403. One reader got a login wall on the licence page. Web delivery, extraction and the seat price are unread. Do not plan on it. | https://www.metahuman.com/license?lang=en-US ; https://www.unrealengine.com/en-US/eula/unreal |
| Ready Player Me | **not verified** | Site did not answer. Shutdown on 31 January 2026 is a secondary-source claim. No decision rests on it. | https://readyplayer.me/ |

### 6.3 Scanned people and marketplaces

| Source | Status | Detail | URL |
|---|---|---|---|
| free3d "Sophia animated 001 idling" | **not verified** | HTTP 403 on the model page, the royalty-free licence page and the terms page. | https://free3d.com/3d-model/sophia-animated-001-idling-130876.html |
| Renderpeople (probable maker of Sophia) | **blocked without written consent** | General Terms "version date: 13.12.2024". 4.2 needs written consent for machine learning use, for transfer or sublicensing, and for "Implementation of the 3D data in applications (especially, but not exclusively with the SaaS model)". 4.3 forbids making the data easy to download or extract. Read as a close paraphrase with short quotes, not full verbatim. That a shop plugin with a GLB is covered is our reading. No price for the consent is published. | https://renderpeople.com/general-terms-and-conditions/ |
| Sophia Animated 003 on Sketchfab | **unresolved, not a clearance** | Label "CC Attribution" (version not visible). NoAI notice: "may not be used in datasets for, in the development of, or as inputs to generative AI programs". The CC label conflicts with Renderpeople's own terms. | https://sketchfab.com/3d-models/sophia-animated-003-animated-3d-woman-dc448c3be0e74f96a55fb475a13433cf |
| TurboSquid 3D Model License (governs Free3D by reference) | **blocked** | "3D Models must be contained in proprietary formats so that they cannot be opened or imported in a publicly available software application or framework". Other WebGL use "must be approved in advance". No AI-generative use of imagery "without prior authorization". Free downloads "are not indemnified". | https://blog.turbosquid.com/turbosquid-3d-model-license/ |
| CGTrader Royalty Free | **blocked off the shelf** | "all commercially reasonable measures to prevent the end user from gaining access to the Product". The No AI variant forbids machine learning use. No effective date on the page. | https://www.cgtrader.com/pages/terms-and-conditions |
| AXYZ design (anima, metropoly) | **blocked** | Standard: "you may not place the Stock Media ... within your software, web site". Extended: "You may NOT publish or distribute Stock Media Products in an open format". A Distribution License is quoted on request. | https://secure.axyz-design.com/en/licensing-info |
| Humano 3D People (Evermotion) | **not verified** | Licence PDF returned HTTP 403. | https://evermotion.org/files/licence/Humano_License.pdf |
| 3DPeople | **not verified** | No licence page found. | https://3dpeople.com/en/license-agreement/ |

### 6.4 Generators

| Source | Status | Detail | URL |
|---|---|---|---|
| Hyper3D Rodin output | **unresolved; needs a written answer** | Section 5(b): "we will not limit your use of such Output, subject to any restrictions set forth in these Agreements". No sentence assigns ownership or grants a licence. Section 6.3 forbids to "sell, resell or commercially use the Content" and to distribute or modify it unless expressly permitted, and makes the user answer for any receiving party; it is not clear that output is outside "Content". No revision date on the terms. | https://hyper3d.ai/legal/terms |
| Hyper3D plan wording | **read** | Creator and above: "Unlimited export and any use". That commercial use needs a paid plan is an inference. | https://hyper3d.ai/pricing |
| Hyper3D ChatAvatar (heads) | **blocked for our use** | Purchased licence is "non-exclusive, revocable, non-transferable and non-sublicensable" and "in effect so long as you have an Account". Cannot be passed on to merchants. | https://hyper3d.ai/legal/terms |
| Hyper3D training data | **not verified** | No page says what Rodin or its rigging was trained on. | https://hyper3d.ai/legal/terms |
| Hyper3D via fal.ai | **not verified for licence** | The fal pages state no licence terms for output. | https://fal.ai/models/fal-ai/hyper3d/rodin/v2/llms.txt |
| Meshy, paid plans | **usable on paper, no warranty** | "such customers on a paid Meshy plan own their Customer Output". Section 7.2: no guarantee of uniqueness; non-infringement disclaimed; the customer indemnifies Meshy. Not stated: ownership after cancelling, whether private is the default. Outputs may not train AI models "competitive with Meshy". Read through a summarising fetch; a lawyer should read sections 2.2, 2.6, 2.9, 3.2, 3.3 and 7.2. | https://www.meshy.ai/terms-of-use |
| Meshy, free plan | **usable with credit; Meshy owns it** | "Creative Commons Attribution 4.0 International License" with credit to Meshy. No API. | https://www.meshy.ai/terms-of-use ; https://www.meshy.ai/pricing |
| Meshy community models | **CC0 for the 3D model; likeness not covered** | Paid plan needed to download. Uploaded images are CC BY-NC 4.0: banned class. | https://www.meshy.ai/terms-of-use |
| Meshy gallery page and privacy policy | **not verified** | Both HTTP 403. Retention and sub-processors for uploaded images unknown. | https://www.meshy.ai/tags/human ; https://www.meshy.ai/privacy |
| TRELLIS.2 (Microsoft) | **blocked as shipped** | Model and code MIT. The pipeline uses nvdiffrast and nvdiffrec, both "only may be used or intended for use non-commercially". Needs a 24 GB NVIDIA GPU; server-side only. | https://github.com/microsoft/TRELLIS.2 ; https://raw.githubusercontent.com/NVlabs/nvdiffrast/main/LICENSE.txt ; https://raw.githubusercontent.com/NVlabs/nvdiffrec/main/LICENSE.txt |
| Hunyuan3D 2.1 | **banned** | Territory excludes "the European Union, United Kingdom and South Korea"; the ban covers the Output too. `hunyuan` is in `bannedModels.ts`. | https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE |

### 6.5 Light and surface assets

| Source | Status | Detail | URL |
|---|---|---|---|
| Poly Haven HDRIs and textures | **usable** | "Our assets are all licensed as CC0"; "You can redistribute them". Download and self-host; the site's API has its own terms. | https://polyhaven.com/license |
| ambientCG | **not verified** | Not checked. | (not opened) |
| three.js `RoomEnvironment` | **usable** | Part of three.js, already a dependency. About 1.7 KB gzip (reader's measurement). | `node_modules/three` 0.186.1 |

## 7. The spike: at most one week

Goal: prove or kill route B. One body family, no garment catalogue rebuild, nothing switched on for shoppers.

### What is built

1. **Offline bake script.** Take the MakeHuman CC0 base mesh and targets (through Anny's free or minimal install, never the `[smpl]` extra, or straight from the MPFB2 data). Pose it to the mannequin's A-pose (arms 32 degrees from vertical), origin and axes. Label vertices per part (torso, legs, arms, head). Output a quantised, meshopt-compressed GLB with UVs and one 2K skin albedo from Skins 01 or 02.
2. **Fit.** For one family, drive the mesh to the ring table. First try: the existing `radialMorph` with all 12 rings as knots (a uniform scale per height, exact for any section shape). Second try if the first looks wrong: the `measure-*-circ` targets solved to the girths, then a final radial correction.
3. **Slicer.** Mesh to `MannequinOutlines` (96 radii every 0.5 cm, per part), with the hull bridging that seat and crotch already need.
4. **Loader and a test page.** A body loaded as a separate asset, shown in the viewer behind a spike option, with an environment map and the true-tone rig. One existing garment draped on it (the tee or the dress) without changing its bundle, as a look test only.
5. **Five test bodies.** Sizes S, M and XXL from the table, plus the two corners of the input box (bust 60 / waist 45 / hip 65 and bust 160 / waist 150 / hip 170 cm), at height 130, the table height and 220 cm for one of them.

### What is measured

| Measure | How |
|---|---|
| Girth error per ring, loop | `meshRingCircumference` on all 12 rings against the ring table. |
| Girth error, tape | `sectionGirthCm` (convex hull, arms left out) at bust, waist and hip. Reported next to the loop value, because the two differ on a concave body and a shopper's tape reads the hull. |
| Drawn body against collision outline | Largest distance between the sliced outline and the drawn mesh, torso from the seat up and arms. |
| Closed and sane | Manifold check, no self-crossing, at all five bodies. |
| Bytes | Transferred size of mesh, morph data and textures. Viewer chunk gzip after adding the loader (`check-viewer-chunk.mjs`). |
| Frame time | On a **real mid-range Android phone** and on the existing SwiftShader profile (412x915 CSS px, 2x, CPU throttle 4x): body alone turning, and body with one garment. Today's body measured the same way on the same phone as the baseline. |
| Pictures | Side by side at the same camera and light: today's default, today's best (head v3, skin-v2, neutral-v2 rig), the spike body, and each of the three references as the founder sees them in a browser. Front, three-quarter and back. Monk tones 2, 5 and 9. |

### Pass and fail

The girth and outline bounds are the ones the repo already enforces. The byte and frame bounds are proposals of this document; the founder may change them before the spike starts.

| Check | Pass | Fail (kills B as planned) |
|---|---|---|
| Loop girth, all 12 rings, S / M / XXL | within 0.5 % of the table girth | any ring over 0.5 % after the final correction |
| Loop girth at the two corner bodies | within 0.5 %, mesh closed, no self-crossing | mesh breaks or crosses itself inside the input box |
| Tape girth at bust, waist, hip | reported; difference from loop girth under 1.0 cm, or a written rule which one the typed value means | difference over 1.0 cm and no rule agreed |
| Outline against drawn mesh | at most 0.5 cm, torso from the seat up and arms | over 0.5 cm outside the bridged zones |
| Viewer chunk | under 400 KB gzip | over |
| Body asset, transferred | at most 1.5 MB for mesh plus one 2K skin | over 3 MB with no clear way down |
| Frame time on the real phone, body with one garment, turning | at most 33 ms per frame, and at most 1.25 times today's body on the same phone | over 50 ms per frame |
| Pictures | the founder, shown the side-by-side sheet, says the spike body is clearly closer to the references than today's best | the founder sees no clear step |

Anything between pass and fail is a "continue with a named fix" result, written down with the fix.

Out of the spike: a new head and face, hair assets, the second family, rebuilding bundles and bakes, the twin test suites, generator-made parts, the AI layer.

## 8. What is needed from the founder

**Decisions**

1. Which reference matters most: the anatomy, the skin, the face and hair, or the photographed look? Please look at https://www.meshy.ai/tags/human and the free3d Sophia page in a browser and say what exactly is "the level". We could not open either page.
2. Start family for the spike: female or male. The female body gains most (today it is ellipses with no bust or seat). The male family has the v2 pattern ready.
3. What a typed girth means on a concave body: the loop along the skin or the tape (hull). Today the rings use the loop.
4. Approval of the byte and frame bounds in section 7, or other numbers.
5. Approval to switch on the true-tone lighting rig, which is built and waiting.
6. Whether CC-BY assets with a visible credit are acceptable for hair (the project already carries one CC BY 4.0 credit).
7. Agreement that the live 3D face stays stylised for now and the photoreal face is the AI layer's job, or a wish to fund a separate head study.

**Accounts and devices**

- One real mid-range Android phone for measurements. None has been used so far.
- No paid account is needed for the spike. All spike inputs are CC0 or our own code.

**Money**

- Spike: no licence cost found. Work time only.
- Later and optional, only after the written answers below. Prices as read on 2026-11-20:
  - Meshy Pro $20 per month, 1,000 credits, API included; Premium $40; Ultra $100; Studio $70 plus $10 per seat. "50% Off first month" was advertised. Yearly prices not read. Source: https://www.meshy.ai/pricing
  - Hyper3D Creator $30 per month ($24 yearly billing), "About 60 models"; Business $120 per month ($96 yearly billing), "About 416 models", "Full API access"; "Direct credits cost $1.5 per credit". The raw page also showed "Prices can't be shown right now. Try again", so re-read in a browser before budgeting. Source: https://hyper3d.ai/pricing
  - Renderpeople single rigged model 79.00 USD list. This buys the standard licence only, which does not cover our use. Source: https://renderpeople.com/3d-people/?_product=rigged-people

**Letters to send, if a generator or a scan vendor is wanted at all**

- To Deemos (Hyper3D): (a) may Rodin output be redistributed inside merchants' shops, given section 6.3; (b) what Rodin and its rigging were trained on; (c) which text governs API use, the terms or the API retention policy.
- To Meshy: ownership after cancelling a paid plan; whether private is the default; the training opt-out confirmed in writing.
- To Renderpeople: only if a scan is still wanted. Consent and price for use in a web application, and whether renders may go into an AI layer.
- A lawyer's reading of the MakeHuman skin provenance and of any CC-BY hair before either ships.

## 9. Not verified

**Could not be opened**

- https://www.meshy.ai/tags/human (HTTP 403). No gallery human was seen.
- https://www.meshy.ai/privacy (HTTP 403).
- https://free3d.com/3d-model/sophia-animated-001-idling-130876.html , https://free3d.com/royalty-free-license , https://free3d.com/terms-conditions (all HTTP 403).
- https://www.unrealengine.com/en-US/eula/unreal (HTTP 403). MetaHuman stays uncleared.
- https://www.blender.org/download/demo-files/ (HTTP 403).
- https://evermotion.org/files/licence/Humano_License.pdf (HTTP 403).
- https://readyplayer.me/ (no response).
- The CGTrader listing of Sophia 003 (empty body).
- GitHub repository pages and API for Rocketbox and MHR were refused for one reader.

**Not known**

- That the free3d Sophia is the Renderpeople file, who uploaded it, and its licence label.
- How realistic Rodin humans and Meshy humans look. No output was viewed.
- Hyper3D: generation time; credits per plan and so the dollar price per model; whether HighPack costs +1 credit on Gen-2.5; Enterprise and on-premises price and retention; the revision date of the terms; training data; whether a separate API terms page exists.
- Hyper3D `bbox_condition` and `TAPose`: one reader read them on the Gen-2.5 spec, another fetch of the same page did not show them.
- Meshy: gallery size and formats (search snippets only); median generation times; the 8K image-to-3D credit cost (one read returned 35 and 20, the other did not return it); yearly prices; whether plan credits and API credits are one pool; the dollar price of a credit.
- All prices for negotiated licences: Renderpeople consent, AXYZ Distribution License, Reallusion Enterprise, Daz interactive, Unreal seat, SMPL commercial. None is published; none is quoted here.
- MakeHuman: whether the `measure-*` targets can reach typed girths within tolerance; whether `measure-ankle-circ` exists; the CC-BY version of the hair packs; the contents of the skins zip (first reader only).
- MHR release-asset licence; the SMPL-Body licence behind SOMA-X; the SMPL-X licence page.
- Real-phone frame time for any body, today's included.
- Download size of a baked base mesh with a 2K skin.
- three.js decoder sizes, KTX2 and meshopt guidance, tone-mapping and subsurface notes, Khronos commerce guidelines: reader's measurement or reading, not re-checked.
- How other try-on products deliver realistic avatars (Bods, Zalando, Avaturn): search summaries only.
- The figures quoted from docs/research/ai-realism-layer.md were read on 2026-11-19 by that document and not re-read here.

**How the sources were read**

- Hyper3D pages, MakeHuman, Anny, SMPL family, Reallusion, Daz, MHR, SOMA-X and GNM were read as raw text.
- Meshy pages, the Renderpeople terms and several others came through a fetch tool that summarises. Quotes from those are short fragments as returned; full clause text was not seen.
- Repo facts are from reading code and READMEs. Triangle counts, the 159.6 KB chunk figure and frame times are the READMEs' own numbers, not re-measured. The garment-viewer README gives two chunk figures (about 150 KB at line 23, 159.6 KB at line 159); the later one is used here.
