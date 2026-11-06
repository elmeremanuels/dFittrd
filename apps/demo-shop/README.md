# @curtain/demo-shop: the "Aalter Studio" demo storefront

A pretend fashion boutique for trying Curtain **standalone** (no app needed, decision D11,
`docs/STANDALONE.md` §4). Plain HTML, CSS and JS, served by a small `node:http` server. No
framework, no build step, no external images or fonts: the product imagery is inline SVG.

```bash
pnpm demo          # at the repo root: api :8787 + web :3000 + this storefront :5180
pnpm demo:e2e      # Playwright smoke test of the whole flow (not part of pnpm check)
```

| URL | What it is |
|---|---|
| `http://localhost:5180/` | Home page with the product grid (WooCommerce shop). `?theme=dawn` shows the Shopify shop. |
| `/product/<id>` | WooCommerce-style product page: `form.variations_form` with `select[name=attribute_pa_color]` and `select[name=attribute_pa_size]`, and the button markup of `class-frontend.php`. |
| `/products/<id>` | Shopify Dawn-style product page: `<variant-radios>` with Color and Size radios owned by `form[action="/cart/add"]` (the `form` attribute, as in Dawn), and the "Try it on" app block markup with the real `curtain-try.css`. |
| `/demo.json` | `<repo>/.demo-db/demo.json` as written by `pnpm --filter @curtain/api demo` (shop keys, product ids). |
| `/catalog.json` | The same, with colours, fabric, size chart and fit notes from `@curtain/schema`'s `MOCK_GARMENTS`. |
| `/img/<id>.svg` | The product's flat-lay illustration as an SVG file. The demo seed points `productPhotos` and `flatLayPhoto` here, so the fitting room's header shows the same garment as the storefront and no third-party image host is contacted. |

Both product pages load `http://localhost:8787/sdk/v1.js` with `data-shop`, `data-api`,
`data-mode="embed"`, `data-size-option`, `data-peek="on"` and `data-app` (the fitting room,
`http://localhost:3000`), as the plugins render them. Add `?mode=app` to a product URL to compare
with the Curtain app flow.

**Size peek.** After a shopper found their size once in the overlay ("Remember me" on, the
default), every product page shows "Your size: M", one fit note and a small drawing of their figure
in that size right under the button, without a click. It lives in an iframe on
`http://localhost:3000/embed/peek`, so this page cannot read it; "See how size M fits you" opens the
overlay. A first visit shows nothing there. `?peek=off` turns it off for comparison. Choosing a size in the overlay selects it on the
page; a small theme-level listener for the `curtain:size-selected` DOM event shows a note under
the button. "Add to basket" / "Add to cart" only updates a pretend bag.

Run the storefront alone with `pnpm --filter @curtain/demo-shop start` (`PORT`, `HOST` and
`DEMO_JSON` override the defaults). `test` runs the server tests (`node --test`); `typecheck` and
`lint` run `scripts/check.mjs` (syntax, no external URLs, no secret-looking strings, English copy).
