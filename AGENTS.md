# Curtain — instructions for AI agents and contributors

Read `docs/HANDOFF.md` (product truth) and `docs/DECISIONS.md` (architecture decisions) before changing anything substantial. `docs/ARCHITECTURE.md` describes the layout.

## Hard rules

1. **Body photos and video never leave the device; a face photo may, only after the shopper's explicit yes (D19).** No backend route may accept a photo or video of a body. The one exception is the opt-in face route of decision D19: head and neck only, processed in memory, deleted when the result is returned, never stored, logged or passed to a merchant. The hero render's `PersonInput.kind` type must never gain a `'userPhoto'` member. Capture code lives only in `apps/web/src/features/capture/` and runs in a Web Worker.
2. **Secrets are server-only.** They are read only in `apps/api/src/env.ts`. Nothing under `apps/web`, `packages/sdk`, `packages/shopify-app/extensions` or `packages/woocommerce-plugin` may contain a provider key. `scripts/check-bundle-secrets.mjs` runs in CI.
3. **Every generated render is labelled an estimate.** Never present a Path B or neural render as measured.
4. **Fit and size are computed by `@curtain/fit-engine`, on-device.** No server-side fit path. Merchants never receive a measurement, a photo, or a device id.
5. **Engines stay pure.** `packages/fit-engine` and `packages/taste-engine` have zero runtime dependencies and keep their test vectors green.
6. **No non-commercial models in the provider registry** (IDM-VTON, OOTDiffusion, CatVTON, FitDiT, SMPL-X).

## Conventions

- pnpm workspaces, TypeScript strict (`tsconfig.base.json`), vitest for tests, ESLint flat config.
- Package names are `@curtain/<name>`. Wire types come from `@curtain/schema` only.
- Design tokens (handoff §7): coral `#FF5A3C`, cream `#F5EFE7`, ink `#1A1612`; Fraunces for display, Inter for UI. Fonts and ML model files are self-hosted.
- Commit messages: conventional (`feat:`, `fix:`, `docs:`, `chore:`), scope = package name.
- The repo at `/home/user/CV-Builder-Bold` and its Next.js notes are unrelated to this project.

- Never write a literal in real token format (`sk_live_…`, `sk_test_…`, `pk_live_…`, `shpat_…`, `shpss_…`, `whsec_…`, `xai-…`, `AIza…`) anywhere in the repo, tests included. GitHub push protection rejects the push. Build fake keys by concatenation, e.g. `'sk_' + 'test_abc…'`.
