# Pre-launch items (20 Nov 2026)

Branch `claude/pre-launch`, merged into `claude/garment-engine`. Two builders, two reviewers, one fix round. The fix round stopped on the usage limit after its code commits; the orchestrator committed its document changes, wrote this report and ran the gates.

## What was built

| Item | State | What |
| --- | --- | --- |
| OI-48 | done | `scripts/post-deploy-check.mjs` (`pnpm check:deployed`): 14 lines, PASS / FAIL / NOT CHECKED, exit 0 or 1. `--require-shop` turns a run without a shop into FAIL. |
| OI-49 | done | The api image did not build (`@curtain/fit-engine` copied but not built). Fixed; `apps/api/src/dockerfile.test.ts` pins it. |
| OI-66 | done | `apps/web/config/headers.ts` is the one list of security headers; a test compares it with `infra/Caddyfile`. The privacy e2e now runs cross-origin isolated. |
| OI-99 | password hint only | One sentence under setup step 5 for Shopify shops. |
| OI-69 | partly | `pnpm check:launch` runs the privacy e2e with the real models and fails instead of skipping. Not in GitHub (OI-130). |
| OI-70 | done | Demo shop and site checked under the policy. |
| OI-105 | partly | The not-drawn sentence stays in view on a phone, for the 2D figure, the 3D view and a server bake. |
| OI-83 | done | Left armpit of the female 2D figure is filled. |
| OI-104 | done | Men's ring chips read "Chest". |
| OI-45 | done | The flaky avatar-prompt test waits for the write. |
| vitest worker time-out | done | The event loop turns between tests (`vitest.setup.ts`). |

## Review findings

| Finding | Severity | Outcome |
| --- | --- | --- |
| The post-deploy check printed 14 passes while the embed could not run (a missing build file comes back as the app page with status 200). | high | Fixed: line 6 fetches every script and stylesheet the build names and requires the right type; the api address must be in the build. |
| The "after every deploy" form exited 0 with the try path unchecked. | medium | Fixed: `--require-shop`, runbook steps 9, 12 and 15 rewritten. |
| The header parity test missed four kinds of drift in the app block. | medium | Fixed: every statement of the block is pinned. |
| The check sent no Origin. | low | Fixed: lines 8, 11, 12, 13 ask the CORS preflight. |
| The riding not-drawn sentence lay over the size buttons under the 3D view. | medium | Fixed (OI-137), pictures in `docs/screens/claude/pre-launch/`. |
| The riding sentence lies over part of the figure. | low | Open, OI-138. |

## Measured versus assumed

Measured: the check against the local demo stack and against the real api image behind the real Caddy (which found doubled CORP and HSTS headers on the api, fixed); the image build; phone pictures in headless Chromium at 360, 390 and 430 px wide.

Not measured: anything on the real server, a real Shopify store, a GitHub runner or a real phone. The service worker behind Caddy (OI-132). The ten-picture bake spec was not run to the end.

## What is left

OI-129 to OI-140 in `docs/OPEN-ISSUES.md`. For the founder: OI-135 (the bar still reads "Choose size 12" for a size that is not drawn) and the two `.github/` steps written out in the runbook (OI-130), which only the founder can add.
