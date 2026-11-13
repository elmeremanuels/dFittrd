# nobodyschild.com: second validation shop (test shop, NOT a partner)

**Status: a test shop chosen by Curtain for internal validation (refinement P4).** Nobody's Child (UK, GBP, Shopify) has not been contacted, has given no consent and has no relationship with Curtain. We read only its public storefront data: `/products.json`, the public size guide page and the product pages of the five products below (robots.txt allows all three; requests are spaced 3 s apart with an honest user agent). **Nothing derived from it, its name, photos, renders or bundles, may be shown publicly, in a demo or to a third party without the shop's written permission.** Raw downloads stay in `raw/` (gitignored).

**Fetching rule.** Every fetch uses only the honest user agent (`curtain-garment-validation/0.1 …`, as in the `shop:import` CLI). A page that refuses it is skipped, not retried with another user agent. (One attempt with a browser user agent was made during this work; our own tooling blocked it before it ran and it was not repeated. Nothing in the data comes from it.)

```sh
pnpm --filter @curtain/garment-spike shop:import -- --shop nobodyschild                     # offline, from raw/: rebuilds products.json and images.json
pnpm --filter @curtain/garment-spike shop:import -- --shop nobodyschild --fetch-images      # images of the committed images.json into raw/, checked against its sha256
pnpm --filter @curtain/garment-spike shop:import -- --shop nobodyschild --fetch-catalogue   # catalogue pages, size guide and the five product pages into raw/
pnpm --filter @curtain/garment-spike shop:import -- --shop nobodyschild --fetch             # all of the above, then rebuild both JSON files
pnpm --filter @curtain/garment-spike export:phase0 -- --shop nobodyschild --product <handle> --front-image N --back-image M
pnpm --filter @curtain/garment-spike size-advice:shop -- --shop nobodyschild
python -I spikes/garment-engine/modal/stage1b_preflight.py spikes/garment-engine/out/phase0/<handle> ...
```

| File | Committed | Contents |
| --- | --- | --- |
| `raw/` | **no** (gitignored) | `products-page1..15.json` (3,680 products), `size-guide.html`, `pages/<handle>.html`, `<handle>/NN.jpg` |
| `products.json` | yes | The shop's parsed body chart (with its defects), five GarmentPayload v1 drafts with evidence, warnings, the product-page facts, the selection reasons and the 3D-readiness check |
| `images.json` | yes | Every image of the five products: URL, size, sha256 and a classification made by eye. No image bytes |
| `fixtures/` | yes | Text-only fixtures for `src/shopImport.test.ts`: the size guide's table cells and a trimmed copy of 4 products |

Code: `src/shopImport.ts` (shop-agnostic parsing and payloads), `src/shops/nobodyschild.ts` (the adapter: product types, selection, image classification), `src/shopImportCli.ts` (I/O), `src/shopSizeAdvice.ts` + `scripts/size-advice-shop.ts` (size advice on test bodies), `modal/stage1b_preflight.py` (stage 1b checks on CPU).

| Kind | Product | Sizes | Fabric (product page) | Base size | Length used | Front / back photo |
| --- | --- | --- | --- | --- | --- | --- |
| dress | `ezra-midi-dress-2616487001` | UK 4–18 | 100% cotton (lining 100% cotton) | UK 8 (model wears) | shoulder_to_hem 130 cm | #3 / #5 |
| top | `sallie-top-2617136001` | UK 4–18 | 100% cotton | UK 8 | shoulder_to_hem 53 cm | #4 / #5 (3/4 back, hair over the back) |
| skirt | `ronda-skirt-2614903002` | UK 4–18 | 100% cotton | UK 8 | waist_to_hem 90 cm | #4 / #5 |
| trousers | `topaz-trousers-2616025001` | UK 4–18 | 100% cotton | UK 8 | none (inside leg 79 cm from the length tag) | #5 / #4 |
| outerwear | `tie-neck-df-jacket-2616863001` | XS–XL | 51% wool, 49% polyester (binding cotton) | S (model wears) | shoulder_to_hem 59 cm | #9 / #5 |

Findings, gaps and the proposed GPU run: `docs/research/second-shop.md`.
