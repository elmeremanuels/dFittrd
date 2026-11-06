# bohohippychic.com.au: validation set

This is an internal validation of the garment engine on a real shop, before anything is installed on it. Boho Hippy Chic (Australia, AUD, Shopify) gave the founder its consent to use its **public** product data and photos for this. No plugin, no admin access, and no shop credentials are involved.

```sh
pnpm --filter @curtain/garment-spike shop:bohohippychic             # offline, from raw/
pnpm --filter @curtain/garment-spike shop:bohohippychic -- --fetch  # re-download the catalogue and images into raw/
```

| File | Committed | Contents |
| --- | --- | --- |
| `raw/` | **no** (gitignored) | `products-page1..3.json` (`/products.json?limit=250&page=N`, 667 products) and `raw/<handle>/NN.jpg`, the images as served |
| `products.json` | yes | Five GarmentPayload v1 drafts with completeness, evidence per value, warnings, the 3D-readiness check, the selection notes and the rejected product types |
| `images.json` | yes | Every image of the five products: URL, size, sha256, and a classification made by eye (role, on model, background, garment fully visible, notes). No image bytes. |
| `fixtures/products.sample.json` | yes | A trimmed text-only copy of 3 products for `src/shop.test.ts` |

The code is in `src/shop.ts` (parsing and payloads), `src/shopSelection.ts` (selection and image classification) and `src/shopCli.ts` (I/O). The AU chart is documented in `docs/research/au-size-chart.md`.

## The five products

| Collection | Product | Sizes | Fabric (from text) | Measurements in text | Images | Completeness |
| --- | --- | --- | --- | --- | --- | --- |
| Dresses | `azure-palm-baby-doll-dress` | AU 8–16 | rayon → viscose 100 | garment bust and length per size → ease bust +7 cm, shoulder_to_hem 91 cm at AU 12 | 4 (3 front, 1 back) | 0.697, incomplete |
| Tops | `rosewater-blouse` | AU 8–16 | 100% rayon | none | 5 (3 front, side, back) | 0.576, incomplete |
| Pants | `rosewater-palazzo-pants` | AU 8–16 | 100% rayon | waist, hips and length per size → ease hip +14 cm, outseam 99 cm; elastic waist not used (see warnings) | 5 (4 front, back) | 0.676, incomplete |
| Skirts | `crimson-wildflower-maxi-skirt` | AU 8–16 | rayon | none | 3 (side, front, back) | 0.559, incomplete |
| Jackets & Knits | `woodstock-wanderer-knit-cardi` | S-M = AU 8–12, M-L = AU 14–16 | 65% acrylic, 35% wool | none | 3 (front, 3/4 back, back) | 0.576, incomplete |

The reasons for each choice, the runners-up and the rejected collections (Jewellery, Bags, Gift Ideas, Gift Card, Body Care, Clothing, Jumpsuits & Sets, untyped) are in `products.json` → `selection` and `rejectedProductTypes`.

## What this shows

1. **The text → payload part works on real copy.** Sizes, fabric, garment tables in two layouts, S-M/M-L ranges and elastic waists all parse. The fabric parser has to skip styling advice ("pair it with denim"), or a rayon blouse becomes denim. Every value in a payload carries its source text in `evidence`.
2. **No product is "active".** All five lack `flatLayPhoto` (heavy). None has a colour or a price in EUR either; neither is invented. The full v1 schema rejects all five on `priceEur` and `primaryColorHex` (`fullSchemaIssues`).
3. **No product meets the photo contract for a 3D asset (D13).** Every photo is worn by a model in a styled set, and Shopify serves them at 800 × 1200 at most (requesting `&width=3000` returns the same 800 × 1200), below the 1600 px long edge. A GPU run on these photos tests the `--on-model` path (stage 1b dresses our mannequin from shop photos) and nothing else. For a real asset the shop has to add hanger, flat-lay or ghost-mannequin shots. Two runners-up already have one: `seraphina-embroidered-mirror-work-maxi-dress` and `byron-barrel-denim-jeans`.
4. **The base size is ours, not the shop's.** It is AU 12 (S-M for the cardigan) for every product. The shop does not say which size was photographed.
5. **Data quality issues found in the shop copy:**
   - The palazzo waist goes 94 → 110 → 112 cm between AU 8 and 12 (an elastic waist, measured stretched or mixed).
   - One "Bust/Waist/Hip" table is printed on both a poncho top and a pair of jeans.
   - The capri dress is "cut oversize to allow for shrinkage".
6. **Library gaps:** the fabric library has no generic sweater-knit construction, so the cardigan's stretch comes from the fibres alone and is too low. No AU chart gives a shoulder width, so tops and dresses skip the shoulder fit point.

No GPU run has been made on these products. Results from a run belong in `docs/STATUS.md`, with the run id, once the orchestrator has triggered it.
