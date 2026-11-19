# Privacy wall: CSP, a privacy e2e with the real models, and a third-party audit

Branch `claude/privacy-wall`, from `claude/garment-engine` (19 Nov 2026). Follow-up to the face-on-head
spike's finding that `@mediapipe/tasks-vision` 1.2.2 POSTs usage logs to `odml.pa.googleapis.com` from the
scan worker (D3: onboarding makes zero third-party requests). The spike added the first wall
(`sameOriginOnly.ts`, the worker refuses off-origin requests). This branch adds the second and third.

## Summary

| Wall | What | Shown by |
|---|---|---|
| 1 (spike) | The scan worker refuses every off-origin `fetch`/XHR | unit test; negative control below |
| 2 (new) | A Content-Security-Policy, `connect-src 'self' <api>`, on **every** response of the app origin, worker scripts included | `src/__tests__/csp.test.ts` pins Caddy to it; the e2e reads the violation reports, page and workers |
| 3 (new) | `e2e/privacyModels.spec.ts`: the whole capture step with the **real** models; fails on any request off the app origin and on any CSP violation | passes; fails, as it should, with either wall taken away (below) |

Two bugs turned up on the way, both fixed here:

1. **The capture step never loaded its models in the production build** (pre-existing; not caused by
   the CSP). MediaPipe sets `self.ModuleFactory = void 0` after it creates each task. In the module worker
   the loader is an ES module, and a second `import()` of the same URL returns the cached module without
   running it, so only the first task (the segmenter) could be created. The pose landmarker failed with
   "ModuleFactory not set", the GPU→CPU retry failed the same way, and onboarding always fell back to
   manual entry. Fix: `moduleFactoryRearmer` (`models.ts`) puts the module's default export back before
   each `createFromOptions`. That is also why the spike's finding never showed in the existing
   `privacy.spec` with models present: no task beyond the first ever ran.
2. **zod probes `eval`.** zod 4 calls `new Function('')` whenever it builds a `z.object(...)`, to decide
   whether to JIT. Under the CSP that is refused and reported on every page load. zod caught the refusal
   and used its interpreted parser anyway, so the fix (`packages/schema/src/csp.ts`, `jitless` in browsers,
   the package's first module so it runs before any schema is built) changes nothing but the report.

## 1. The Content-Security-Policy

One source: `apps/web/config/csp.ts` (`appCsp('app' | 'embed', { api })`); its header comment gives the
reason for every source. Production (`infra/Caddyfile`, `app.{$DOMAIN}`):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; style-src-attr 'unsafe-inline';
connect-src 'self' https://api.{$DOMAIN}; img-src 'self' data: blob: https://api.{$DOMAIN};
media-src 'self' blob: https://api.{$DOMAIN}; font-src 'self'; worker-src 'self'; manifest-src 'self';
object-src 'none'; frame-src 'none'; frame-ancestors 'none' | https:; base-uri 'self'; form-action 'self'
```

- `frame-ancestors 'none'` for the app; `https:` for `/embed/*`, which covers the overlay **and the size
  peek** (`/embed/peek`): Shopify and WooCommerce storefronts are on any domain (custom domains,
  `*.myshopify.com`, the theme editor inside `admin.shopify.com`). Narrowing to each shop's own origins
  would need the embed HTML served per shop by the api; the try token and the publishable key stay the
  access control (D11). The preview adds `http://localhost:* http://127.0.0.1:*` for the demo shop.
- Tightened against the policy that was already in the Caddyfile: `style-src` lost `'unsafe-inline'`
  (only `style-src-attr` keeps it), `worker-src` lost `blob:` (no blob worker exists; meshopt's own blob
  workers are not switched on), and `object-src 'none'`, `frame-src 'none'`, `manifest-src 'self'` were
  added. `script-src` has no `'unsafe-inline'` (the built `index.html` has none) and no `'unsafe-eval'`;
  `'wasm-unsafe-eval'` stays for the MediaPipe runtime and the meshopt decoder.
- **Workers.** A dedicated worker loaded from an https URL is governed by the CSP of its own script
  response, not by the page's. Caddy's `header @app` matches every path that is not `/embed`, so
  `/assets/scan.worker-*.js` and `/assets/drape.worker-*.js` get the policy; the preview does the same.
  Measured: with the worker guard removed, the report names
  `document-uri: /assets/scan.worker-….js`, `connect-src`, `blocked-uri: https://odml.pa.googleapis.com/v1/log`.
- **Pinned.** `apps/web/src/__tests__/csp.test.ts` asserts that the two Caddy policies are exactly
  `appCsp(...)` with the api origin, that production has no `report-uri` (a report would carry page URLs
  with try tokens), and what the preview sends on pages, worker scripts, the embed and the peek.
  `apps/api/src/caddy-csp.test.ts` (img-src, connect-src) still passes unchanged.
- **Vite preview** (what the e2e suite runs): `vite.config.ts` `previewHeaders` sends the same policy on
  every response, with `report-uri /__csp-report`; the preview keeps the reports in memory and
  `GET /__csp-report` returns and clears them. `CURTAIN_PREVIEW_CSP=off` turns the preview's policy off
  (only for the negative control). The **dev** server keeps the framing directive only: it needs the inline
  React-refresh preamble and the HMR WebSocket.
- Not changed: COOP/COEP (Caddy unchanged; the preview still sends none), and the api's own responses
  (helmet with `contentSecurityPolicy: false`; it serves JSON, the SDK and the Shopify admin page, which
  sets its own `frame-ancestors`).

## 2. The privacy e2e with the real models

`apps/web/e2e/privacyModels.spec.ts`, on the production build in the preview, Pixel 7, SwiftShader:

1. onboarding to the capture step; **the models must load** (the spec fails otherwise);
2. face: "Choose a photo" with `e2e/fixtures/synthetic-faces/person-b.jpg` (the mannequin's own painted
   head, no person) → FaceLandmarker + multiclass segmenter; the face must be found;
3. body: the 8-second scan. Chromium's fake camera plays a Y4M built at test time from
   `e2e/fixtures/mannequin-camera/{front,side}.pgm.gz` (crops of our own mannequin preview
   `packages/mannequin/preview/families-M.png`, greyscale): 3 s front, 3 s side, looped. The scan must
   measure the mannequin (PoseLandmarker in VIDEO mode, then the segmenter);
4. the worker is kept alive past MediaPipe's 60-second log interval, then manual → fusion → done, which
   disposes the session (MediaPipe flushes its log when a task closes);
5. it fails on any request (page or worker) to an origin other than the app, any body on a non-API
   request, any image/multipart/protobuf content type, any CSP violation report, any CSP console message;
6. last, a canary `POST https://odml.pa.googleapis.com/v1/log` from the page must be refused **and**
   reported, which proves the report channel works.

### Measured

| Run | Result |
|---|---|
| Both walls in place | **passed** (≈ 71 s). Face found (Monk 6), mannequin measured. Origins seen: `http://127.0.0.1:4173` only; 65 requests, 12 of them model files fetched by the scan worker. No CSP report. |
| Negative control 1: worker guard removed (`installSameOriginOnly` commented out, rebuilt) | **failed**, as it should: one CSP report, `connect-src`, `blocked-uri https://odml.pa.googleapis.com/v1/log`, `document-uri /assets/scan.worker-….js`. The CSP alone stops it. |
| Negative control 2: guard removed and `CURTAIN_PREVIEW_CSP=off` | **failed**, as it should: `POST https://odml.pa.googleapis.com/v1/log` ×3 seen at the network level (the test's route aborts them, so none left the machine). |

The guard was restored before committing (`git diff` of `scan.worker.ts` shows only the rearm lines).

Screenshots (`docs/screens/claude/privacy-wall/`): `01-face-found-real-models.png` (the face step after the
real FaceLandmarker found the synthetic face), `02-after-body-scan-of-mannequin.png` (the step after the
body scan measured the mannequin).

### The existing `privacy.spec`

It **failed before this branch** too (checked on the base commit `b9eb1d2`, with and without models):
"swipe batch happened". Since `store.ts` keeps the bundled demo rail's swipes on the device
(`shopId !== MOCK_SHOP_ID`), no `/v1/swipes` call happens in that flow. The assertion is now the stricter
fact (demo swipes never leave the page; a batch for a real shop keeps the field check), and the spec also
fails on any CSP violation. It passes, with and without the models.

### Models and licences

Fetched with the repo's script (`pnpm --filter @curtain/web models`); recorded in `docs/LICENSES.md`, the
two new model cards read at source:

| File | sha256 | Licence |
|---|---|---|
| `face_landmarker.task` (float16/1) | `64184e22…c9ff` | Apache-2.0 (already recorded by the spike) |
| `pose_landmarker_full.task` / `_lite.task` (float16/1) | `5134a3aa…11b1` / `59929e1d…574a` | Apache-2.0, model card "BlazePose GHUM 3D" p. 1 |
| `selfie_multiclass_256x256.tflite` (float32/1) | `c6748b12…e0e0` | Apache-2.0, model card "Multiclass Segmentation" p. 1 |
| `wasm/vision_wasm_*` (from `@mediapipe/tasks-vision@1.2.2`) | see `models.manifest.json` | Apache-2.0 (package `license`) |

## 3. 3D viewer under the CSP

The viewer specs need a bundle that is not in git; the committed fixture
`packages/garment-viewer/fixtures/pom-v2-rest` (a drape bake: `anchors.json` `drapeBake: base.glb`, the GLB
with `EXT_meshopt_compression` + `KHR_mesh_quantization`) works once a `payload.json` sits next to it. I
copied the fixture into the scratchpad and added the skirt's payload from
`spikes/garment-engine/data/bohohippychic/products.json` (nothing committed). Under the CSP, on the preview:

| Spec | What it exercises | Result |
|---|---|---|
| `avatar3d.spec.ts` | the embed's 3D estimate: WebGL (SwiftShader), the drape workers (`drape.worker-*.js`, same-origin module workers), the bake reader with the meshopt wasm decoder, colour switching, a lost and restored WebGL context | **passed** (17 s); 0 CSP reports |
| `garment3dBake.spec.ts` "load and settle time" | the bake bundle loading and settling in the throttled phone page | **passed** (4 s); 0 CSP reports |
| `garment3dBake.spec.ts` "past the draped bodies" | per-size refusals | **not run to the end**: needs a full bake's `qa.json` `sizes`, which the small fixture lacks (fails reading it, before any page loads; not a CSP matter) |
| `garment3dBake.spec.ts` ten pictures | every size front and side | not run to the end: the first combined run (`avatar3d` + all four bake cases) hit my 30-minute limit on SwiftShader, mostly here (the spec itself allows an hour) |

The capture worker under the CSP: `privacyModels.spec.ts` above (MediaPipe wasm with `'wasm-unsafe-eval'`,
GPU delegate through the worker's OffscreenCanvas WebGL, no violation). `faceOnHead.spec.ts` runs on the dev
server, which keeps the framing directive only, and passes as before.

## 4. Audit: what else could phone home

Every origin any test run saw: **`http://127.0.0.1:4173` only** (the app; the api is mocked on the same
origin). The static audit below covers what the e2e runs do not reach.

| Package / surface | What was checked | Result |
|---|---|---|
| `@mediapipe/tasks-vision` (scan worker bundle) | URL literals in `dist/assets/scan.worker-*.js` and `/models/wasm/*.js` | `https://odml.pa.googleapis.com/v1/log` (the usage logger, `this.o.send({url:…})`) is the only request URL. Stopped by wall 1 and wall 2. The other hits are a protobuf type name (`type.googleapis.com/…`) and Emscripten comment links. |
| three.js and `@curtain/garment-viewer` | loaders in use; decoder paths | No `GLTFLoader`, `DRACOLoader`, `KTX2Loader` or transcoder path (the usual gstatic/jsdelivr defaults): the viewer parses the GLB itself; only `three/addons/controls/OrbitControls.js` is imported. `meshoptimizer/decoder` carries its wasm inline and its blob workers are not switched on (`useWorkers` never called). No URL literals. |
| Fonts | `dist/assets/index-*.css` | Every `url()` is `/assets/*.woff2` (`@fontsource-variable/fraunces`, `/inter`, bundled). No Google Fonts. |
| Analytics | grep for gtag, GTM, Segment, PostHog, Sentry, Plausible, Mixpanel, Amplitude, Hotjar, Datadog, New Relic, Clarity, fbq across web, SDK, viewer, Shopify extension, WooCommerce plugin | none (the site's ESLint even bans them) |
| Web bundle, all chunks | every `https?://` literal | Request-capable: only odml (above) and `https://placehold.co`, the photo URLs of the schema's mock garments (`packages/schema/src/fixtures/helpers.ts`). The deck does not load them as `<img>` (the e2e saw no request), and `img-src` would refuse them. The rest: size-chart source citations (otto.de, nike.com, …), docs links in error strings (react.dev, reactrouter.com, github.com, MDN), XML namespaces, an IndexedDB help link (Dexie), `app.curtain.fit` as an input placeholder. |
| Merchant SDK (`packages/sdk`, shipped as `sdk.v1.js` in both plugins; the two copies are byte-identical) | requests in source and build | One `fetch` to `${apiBase()}/v1/sdk/sessions` (the shop's `data-api`), the peek iframe on `data-app`, the QR as a `data:` image. No hard-coded host. |
| Shopify theme block (`try-it-on.liquid`, snippet, `curtain-try.css`) | script/link/url | Loads `sdk.v1.js` from the theme's own `asset_url` (Shopify's CDN, where the storefront already is); passes `data-api`/`data-app`. No `url()` in the CSS, no other host. |
| WooCommerce front-end (`includes/class-frontend.php`) | enqueues | Only `assets/sdk.v1.js` from the plugin's own URL; no style, no font, no third-party script. `https://curtain.fit` appears in the JSON schemas' `$id` only (not fetched). The admin screens (`meta-box.css`, admin JS) have no external host. |

## Open issues

1. **COEP/COOP in the preview.** Production isolates the app (`require-corp`); the preview does not, so the
   e2e runs MediaPipe without threads. The CSP is the same; the isolation is not tested.
2. **Embed framing is `https:`, not per shop.** See section 1. A per-shop `frame-ancestors` would need the
   embed document served by the api.
3. **No production CSP reporting.** Deliberately (reports carry URLs with try tokens). A violation in
   production is silent; the e2e suite is the detector.
4. **`privacyModels.spec` needs the models** (≈ 50 MB, not in git, not in CI): it skips without them, like
   the spike's spec. To run it in CI, a job would fetch the models first (`pnpm --filter @curtain/web
   models`) and cache them; that is a workflow change, not made here. The CSP pin, the rearm test and the
   CSP check in `privacy.spec` run in CI as they are.
5. **What the odml message holds** is still not decoded (from the code: task type, running mode, timings).
   Irrelevant now that it is refused twice, but worth a line in the privacy terms review.
6. The demo storefront (`apps/demo-shop`) and the marketing site were not re-run; the site's own CSP is
   unchanged.

## Commands

```
pnpm install --frozen-lockfile
pnpm --filter @curtain/web models                       # MediaPipe models into apps/web/public/models (git-ignored)
pnpm --filter @curtain/schema build && pnpm --filter @curtain/web build
cd apps/web
PRIVACY_SHOTS=../../docs/screens/claude/privacy-wall pnpm exec playwright test -c e2e/playwright.config.ts --trace off privacyModels
pnpm exec playwright test -c e2e/playwright.config.ts --trace off privacy.spec
E2E_SKIRT_BUNDLE=<dir with the pom-v2-rest fixture + payload.json> pnpm exec playwright test -c e2e/playwright.config.ts --trace off avatar3d garment3dBake
# negative controls: comment out installSameOriginOnly(...) in scan.worker.ts, rebuild, rerun privacyModels
#   (fails on the CSP report); add CURTAIN_PREVIEW_CSP=off (fails on the odml requests). Restore the line.
npm_config_workspace_concurrency=1 pnpm check
```
