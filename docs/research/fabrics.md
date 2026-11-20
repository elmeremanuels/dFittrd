# Fabric library v1: sources and estimates

Code: `packages/schema/src/fabrics.ts` (`FABRIC_LIBRARY_VERSION = '1.0.0'`), text parsing in `packages/schema/src/mappings/fabricText.ts`. Plan: `docs/ENGINE-HANDOFF.md`, "Prefill: fabric library".

The library is prefill only. The merchant confirms or corrects it, and per-product calibration from merchant video beats it. Every entry lists its `sources` and the fields that are our `estimated` values. Most look and handling values (drape, bend stiffness, sheen, opacity) are estimates until we measure swatches in Phase 1 calibration. Treat them as starting points.

## Conventions and units

| Field | Unit and meaning | Basis |
| --- | --- | --- |
| `weightGsm` | g/m², a typical range | Published supplier specs and sewing references (below) |
| `stretchPct` | (stretched − relaxed) / relaxed × 100, hand-stretched in the most elastic direction | Measuring method from Blackbird Fabrics, "How to calculate stretch percentage": "(Stretched Amount − Starting Amount) / Starting Amount × 100" (https://www.blackbirdfabrics.com/blogs/resources/how-to-calculate-stretch-percentage). On fibre entries this is a plain fabric of that fibre, not the fibre itself. |
| `fibreElongationPct` | Fibre elongation at break, %, only where a source gives it | See the fibres section |
| `drape` | 0 = stiff, 1 = fluid, read as 1 − Cusick drape coefficient (DC) | Viswanaath et al. 2018 (JTATM 10(3)) report DCs "from 30 to 98 %" for fabrics "limp to stiff". Their shirting samples average DC ≈ 34–35 % (Table 2), which anchors poplin and chambray near 0.55–0.65. https://jtatm.textiles.ncsu.edu/index.php/JTATM/article/view/11259/5989 |
| `bendStiffness` | KES-F bending rigidity B per unit width, gf·cm²/cm | The unit is the KES-F convention. The KTU study (Materials Science, "The Relationship between Fabrics Bending Rigidity Parameters Defined by KES-F and FAST Equipment") covers heavy woven outer fabrics of 211–398 g/m², 1.01–2.28 mm thick, and gives KES-F ↔ FAST conversions for swatch calibration (https://matsc.ktu.lt/index.php/MatSc/article/view/26098). The page we could open gives no B values, so **every B value in v1 is an estimate**: a relative scale with denim ≈ 0.8, poplin ≈ 0.07 and chiffon ≈ 0.01. |
| `sheen`, `opacity` | 0..1, as in the GarmentPayload `fabric` block | Estimates |
| `texture` | Preset id that names a normal + roughness map pair | Our own list (`FABRIC_TEXTURE_PRESETS`) |

### Simulation defaults (`deriveFabricSimulation`, all estimates)

- `massKgM2` = weightGsm / 1000 (exact).
- `bendStiffness` (N·m) = B × 9.80665e-5, a unit conversion of gf·cm²/cm.
- `stretchStiffness` (N/m) = 600 / strain, where strain = max(stretchPct, 0.5) / 100. This assumes the stretch reading is taken at about 30 N on a 5 cm strip (600 N/m) and is an estimate to calibrate. A woven at 0 % is capped at 120 000 N/m.
- `damping` = 0.02 + 0.1 × (1 − drape). Stiff cloth settles faster. This is an estimate.

## Resolution rules (`resolveFabric`)

1. **Fibre blend:** the base. Known fibres are weighted by share after leaving out elastane. Unknown names are reported in `unknown`, and the remaining shares are normalised to 100. Cashmere and merino count as wool, and fleece, faux leather and microfibre suede count as polyester (`baseFibre`). Leather and suede in a composition become the construction.
2. **Construction:** overrides the blend's weight, stretch, drape, bend stiffness, sheen, opacity and texture. Cotton jersey stretches 15–40 %. Cotton poplin stretches 0–2 %.
3. **Elastane:** adds `ELASTANE_STRETCH_PER_PCT` = 4 % stretch per percent of elastane, on the blend or on the construction. This is an **estimate**. 2 % elastane gives +8 % and 5 % gives +20 %. Threads Magazine reports elastane contents from 1–2 % (common in denim) to more than 10 %, with most stretch wovens stretching in two ways. We found no lab table for stretch per elastane percent: the claims of "2 % elastane ≈ 10–25 % stretch" that turn up came from unreliable marketing pages. We did not use them, and the factor is set for calibration.
4. **Product values win:** an explicit `weightGsm`, `stretchPct`, `drape`, `sheen` or `opacity` replaces the library value. An explicit weight also rescales bend stiffness by (weight / typical)², clamped to ×0.25..×4 (estimate). Thickness rises with weight, and bending rigidity rises faster than thickness.
5. **Nothing known:** a plain cotton woven, with provenance `default`.

`provenance` records for each field whether the value came from `product`, `construction`, `blend` or `default`.

## Sources per group

### Synthetic fibres: polyester, nylon, acrylic

Wikipedia, "Fiber", Table 2 "Properties of Selected Artificial Fibers" (https://en.wikipedia.org/wiki/Fiber):

| Fibre | Specific gravity | Elongation at break | Water absorption |
| --- | --- | --- | --- |
| Nylon | 1.14 | 20–30 % | 2.8–5.0 % |
| Polyester | 1.38 | 8–30 % | 0.4 % |
| Acrylic | 1.14–1.18 | 20–40 % | 1.0–2.5 % |

These fill `fibreElongationPct`. Fabric weight for polyester comes from the Spoonflower polyester bases: chiffon 50, satin 75, crepe de chine 65, Minky 225, velvet 313–389 and fleece 251 g/m² (https://support.spoonflower.com/hc/en-us/articles/360050418771-Fabric-Specifications-and-Details). Brand aliases: Coolmax, Repreve, Dacron, Trevira and Terylene for polyester. Cordura, Tactel, Supplex and Econyl for nylon. Dralon and Orlon for acrylic. These are common trade names, assigned from general knowledge rather than a cited page.

### Elastane

Wikipedia, "Spandex" (https://en.wikipedia.org/wiki/Spandex): it can stretch "up to five times its length", which we store as `fibreElongationPct` 400 %. The page cites no source for this claim. Brands listed there, all used as aliases: Lycra and Elaspan (The Lycra Company), Acepora (Taekwang), Creora (Hyosung), INVIYA (Indorama), ROICA and Dorlastan (Asahi Kasei) and Linel (Fillattice). We left out ESPA (Toyobo) because the word is too ambiguous in text. The fabric-level stretch of 60–100 % for an elastane-rich fabric is an estimate.

### Cellulosics: viscose, lyocell, modal

Wikipedia, "Lyocell" (https://en.wikipedia.org/wiki/Lyocell): "originally trademarked as Tencel in 1992" (Lenzing). Other brands are Newcell (Akzo Nobel), Seacell (Zimmer) and Excel (Aditya Birla). Excel is not an alias because the word is too ambiguous. The page also says lyocell "drapes well" and is "very closely related chemically" to viscose rayon. On that basis lyocell and viscose share a high drape of 0.85. All numeric values for viscose, lyocell and modal are estimates. EcoVero (Lenzing viscose), cupro and Micromodal are aliases based on common trade usage.

### Natural fibres: cotton, linen, wool, silk, hemp

- Weights come from Sew Guide, "Fabric GSM in dressmaking" (https://sewguide.com/gsm-of-fabric/): cotton jersey 120–150, cotton poplin 120–150, cotton voile 50–80, linen 100–300, wool suiting 200–300, flannel 150–300 and velvet 200–300 g/m². Its "flimsy" to "higher quality" cotton bands run from below 130 to about 200 g/m².
- Spoonflower gives Belgian linen at 360 g/m² (100 % linen), Essex linen-cotton at 186, cotton lawn at 81, poplin at 115, canvas at 360 and denim at 395 g/m².
- We could not open a primary table for natural-fibre elongation, density or moisture regain. A search summary pointed to a hemp/flax cultivar study in *Bioresources and Bioprocessing* (doi 10.1186/s40643-020-00339-1), but the page redirected to a login. Those numbers are **not** used, so the natural fibres carry no `fibreElongationPct`. A follow-up item is to read Saville, *Physical Testing of Textiles*, or Morton & Hearle, *Physical Properties of Textile Fibres*, and fill these in.
- Silk, hemp and every drape, sheen and opacity value in this group are estimates.

### Constructions with a published weight

| Construction | Library range (g/m²) | Published points |
| --- | --- | --- |
| Denim | 200–450 | Sew Guide: thin dressmaking denim 200–300, light 250–350, midweight 350–400, heavy 400 and up. Spoonflower Dogwood Denim: 395. |
| Jersey | 120–220 | Sew Guide: cotton jersey 120–150, T-shirt standard 180. Spoonflower: Modern Jersey 210 (95/5 poly/spandex). |
| Flannel | 150–300 | Sew Guide: 150–300 |
| Canvas | 215–500 | Spoonflower: 215 (linen-cotton), 240 (recycled), 360 (cotton) |
| Poplin | 100–150 | Sew Guide: 120–150. Spoonflower: 115. |
| Seersucker | 100–150 | Spoonflower: 110 |
| Fleece | 100–350 | Wikipedia "Polar fleece": sold as micro, 100, 200 and 300, which "refer to grams per square meter". Spoonflower: Polartec 251. (https://en.wikipedia.org/wiki/Polar_fleece) |
| Velvet | 200–390 | Sew Guide: 200–300. Spoonflower: 313 and 389. |
| Satin | 75–150 | Sew Guide: polyester satin 80–100. Spoonflower: 75, sateen 120–220. |
| Chiffon | 30–70 | Sew Guide: polyester chiffon 40–70. Spoonflower: 50. |
| Piqué | 140–250 | Spoonflower: Sport Piqué 145 |

Polar fleece is "made from polyester" and the page names the brands PolarFleece (Malden Mills, now Polartec) and Synchilla. That gives the `baseFibre: 'polyester'` and the aliases Polartec and Synchilla.

### Constructions that are estimates in full

Chambray, corduroy, molton, terry, French terry, teddy, faux fur, cashmere, merino, tweed, felt, tulle, lace, organza, taffeta, brocade, jacquard, softshell, mesh, neoprene, ripstop, membrane laminate, gabardine, leather, faux leather, suede and microfibre suede. Weights and stretch come from common trade ranges. Every field is listed in `estimated`.

- **Membrane laminate:** Wikipedia "Gore-Tex" (https://en.wikipedia.org/wiki/Gore-Tex) describes an expanded PTFE (ePTFE) membrane, a "coating that is bonded to a fabric". Windstopper is the sister product, windproof but not waterproof. Gore-Tex, Windstopper, Sympatex and ePTFE are aliases. eVent was left out because the word is too ambiguous in text.
- **Microfibre suede:** Wikipedia "Alcantara (material)" (https://en.wikipedia.org/wiki/Alcantara_(material)) gives "about 68% polyester and 32% polyurethane" with a "suede-like microfibre pile". The infobox says 69/31. That gives `baseFibre: 'polyester'` and the aliases Alcantara and Ultrasuede.
- **Tweed and gabardine:** fall in the heavy-woven range of the KTU bending study (211–398 g/m²). Their B values are still estimates.
- **Cashmere and merino:** listed as constructions in the handoff, with `baseFibre: 'wool'`, so "100% cashmere" resolves to wool with the cashmere construction, through `parseFabricText` and through `resolveFabric` alike (a construction in the composition is kept as the construction; fixed after review finding R3).

## Text parsing

`parseFabricText` matches every id, English and Dutch name and alias as a whole word, longest first, so "faux leather" beats "leather" and "French terry" beats "terry". Matching ignores accents ("Suède", "piqué"). An optional ending -s, -n or -en allows plurals and Dutch adjectives ("katoenen", "zijden", "fluwelen"). Irregular forms are aliases ("wollen", "leren", "kunstleren").

Percentages are paired both ways ("95% katoen" and "katoen 95%"), and the reading that ties more percentages to fibres wins. After the first block reaches 100 %, later blocks ("Voering: 100% viscose") are ignored. Without percentages, one fibre is 100 %. Several fibres share equally, except elastane, which is assumed at 3 %; these shares are flagged `sharesAssumed`. The table test in `fabricText.test.ts` covers 51 English, Dutch and German care-label strings.

## Open for calibration (Phase 1)

- Measure B (KES-F or FAST, converted with the KTU equations), DC (Cusick) and stretch for one swatch per construction, and replace the estimates.
- Fit `ELASTANE_STRETCH_PER_PCT` and the stretch-stiffness reference load to measured stretch woven and jersey swatches.
- Fill fibre elongation and density for the natural fibres from a primary reference.
