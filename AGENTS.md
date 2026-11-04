# Paskamer — instructions for AI agents and contributors

Read `docs/HANDOFF.md` (product truth) and `docs/DECISIONS.md` (architecture decisions) before changing anything substantial. `docs/ARCHITECTURE.md` describes the layout.

## Hard rules

1. **Raw photos and video never leave the device.** No backend route may accept a user photo except the opt-in hero render, whose `PersonInput.kind` type must never gain a `'userPhoto'` member. Capture code lives only in `apps/web/src/features/capture/` and runs in a Web Worker.
2. **Secrets are server-only.** They are read only in `apps/api/src/env.ts`. Nothing under `apps/web`, `packages/sdk`, `packages/shopify-app/extensions` or `packages/woocommerce-plugin` may contain a provider key. `scripts/check-bundle-secrets.mjs` runs in CI.
3. **Every generated render is labelled an estimate.** Never present a Path B or neural render as measured.
4. **Fit and size are computed by `@paskamer/fit-engine`, on-device.** No server-side fit path. Merchants never receive a measurement, a photo, or a device id.
5. **Engines stay pure.** `packages/fit-engine` and `packages/taste-engine` have zero runtime dependencies and keep their test vectors green.
6. **No non-commercial models in the provider registry** (IDM-VTON, OOTDiffusion, CatVTON, FitDiT, SMPL-X).

## Conventions

- pnpm workspaces, TypeScript strict (`tsconfig.base.json`), vitest for tests, ESLint flat config.
- Package names are `@paskamer/<name>`. Wire types come from `@paskamer/schema` only.
- Design tokens (handoff §7): coral `#FF5A3C`, cream `#F5EFE7`, ink `#1A1612`; Fraunces for display, Inter for UI. Fonts and ML model files are self-hosted.
- Commit messages: conventional (`feat:`, `fix:`, `docs:`, `chore:`), scope = package name.
- The repo at `/home/user/CV-Builder-Bold` and its Next.js notes are unrelated to this project.
