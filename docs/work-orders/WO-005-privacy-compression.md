# WO-005: Privacy e2e with the realistic body on, and the body file compressed

**Tier** full (a privacy path) · **Builder** Qwen · **Linear** CUR-11 · **Branch** `qwen/wo-005-privacy-compression`,
cut from **`claude/realistic-body`** (not from `claude/garment-engine`: the realistic body only exists there).

## Goal

Prove in a browser that switching the realistic body on adds exactly one request, a GET of the static body file, and
send that file compressed (OI-145, OI-150).

## Background

- `VITE_VIEWER_BODY=realistic-spike` switches the realistic body on in the embed (`apps/web/src/embed/look.ts`,
  `realisticBodyFlag`). It then fetches `female-v1.crb` once, same origin under `/assets/`, without credentials or a
  referrer, and with no body. The review of 21 Nov found this by reading the code; no test runs it.
- Caddy compresses by content type. The `.crb` file is served as `application/octet-stream`, so all 337,732 bytes go
  over the wire. Gzip gives about 251 KB, brotli about 176 KB.

## Files

You may change only these:

- `apps/web/e2e/privacyRealisticBody.spec.ts` (new)
- `apps/web/e2e/playwright.config.ts`, only if the new spec needs its own project or build step
- `apps/web/package.json`, only to add one script `e2e:realistic-body`
- `apps/web/vite.config.ts`, only for a small build step that writes `.crb.br` and `.crb.gz` next to each `.crb` file
  in the build output, with Node's built-in `zlib` (no new dependency)
- `apps/web/src/__tests__/headers.test.ts` or `apps/api/src/caddy-site.test.ts`, only if the Caddyfile test pins the line you
  change (update the pin, do not weaken it)
- `infra/Caddyfile`, only the `app.{$DOMAIN}` block's `file_server` line: `file_server { precompressed br gzip }`
- Not `docs/OPEN-ISSUES.md`: three open orders would share it. Put the new state of each open issue (fixed, and how) in your report's *Open issues* section; Claude updates `OPEN-ISSUES.md` at the merge.
- `docs/reports/qwen/privacy-compression.md` (new)

Do not touch `packages/garment-viewer/`, `spikes/`, `.github/` or any other file. Do not change D3 or any decision in
`docs/DECISIONS.md`. If D3's wording needs to change, write the proposed sentence in the report.

## Steps

1. Write `privacyRealisticBody.spec.ts`. It runs only when the build has `VITE_VIEWER_BODY=realistic-spike`, and
   skips with a clear message otherwise, so the normal `pnpm check` stays as it is.
   - Open the embed on a women's product with a typed body, and wait until the 3D view has drawn the realistic body
     (`canvas.dataset.body` is `realistic` or `realistic-conformed`).
   - Record every request the page makes.
   - Assert that, compared with the same flow with the flag off, there is **exactly one** extra request, and that it
     is a `GET` of a path ending in `.crb` under `/assets/`, same origin, with no request body, no `Cookie` or
     `Authorization` header, and no `Referer` (or the page's referrer policy forbids it).
   - Assert that no request carries a body measurement, a photo, a device id or a hair choice in its URL or body. Reuse
     the checks of `privacy.spec.ts` where you can.
2. Add the script `e2e:realistic-body` to `apps/web/package.json`: build with the flag on, then run only this spec.
3. Add the build step in `vite.config.ts` that writes `.crb.br` (brotli, quality 11) and `.crb.gz` (gzip, level 9)
   next to each `.crb` in `dist/`. Add a unit test or a check in the spec that the two files exist after the build and
   that each decompresses to bytes identical to the `.crb`.
4. Change the `app.{$DOMAIN}` block's `file_server` to `file_server { precompressed br gzip }`. If Docker is on the
   machine, run `infra/scripts/caddy-validate.sh`. If it is not, write that under *Not verified*.
5. In the report's *Open issues*, give the new state of OI-145 and OI-150 (fixed, and how).

## Done when

- `pnpm --filter @curtain/web e2e:realistic-body` passes, and **fails** if you add a second request on purpose (for
  example a second `fetch` of the `.crb` in a local, uncommitted change). Write in the report that you tried this and
  what the failure said.
- The `.crb.br` and `.crb.gz` files exist in the build and decompress to the exact `.crb` bytes. The report gives the
  three sizes in bytes.
- `pnpm install --frozen-lockfile` and `pnpm check` are green.
- The report `docs/reports/qwen/privacy-compression.md` has the sections *Done*, *Measured*, *Not verified* and
  *Open issues*, and names the model.

## Not in this order

- The hair choice in the embed (OI-170) and its privacy run (OI-176): the embed has no hair control yet.
- Any change to what the realistic body draws.
