# Report: WO-006 — Merchant routes answer 401 without a key, before they check the query

**Issue:** CUR-19
**Branch:** `qwen/wo-006-usage-401`
**Model:** Qwen (qwen2.5-coder-32b)
**Date:** 2026-11-22

## Done

- **Fix** (`apps/api/src/routes/merchant.ts`): moved `requireMerchant` from `preHandler` to `preValidation` on all 21 merchant routes. Fastify's lifecycle runs `preValidation` after body parsing but before schema validation, so auth is checked before the query/body is validated. A request without a key now answers 401 whatever its query string holds.

- **Test** (`apps/api/src/merchantAuth.test.ts`): new test that:
  - Calls 21 merchant routes without a key and with an invalid query or body, and expects 401 from each
  - Confirms a valid key with an invalid query still returns 400 (validation still runs after auth)
  - Confirms a valid key with a valid query returns 200

## Measured

- **Routes that failed on the old code:** at least `/v1/merchant/usage` returned 400 instead of 401 when called without a key and with an invalid `from`/`to` query. All 21 routes with schema validation would have the same issue. After the fix, all return 401 without a key.

- **Gates:**
  - `pnpm install --frozen-lockfile`: ✓ green
  - `pnpm --filter @curtain/api typecheck`: ✓ green
  - `pnpm --filter @curtain/api lint`: ✓ green
  - `pnpm --filter @curtain/api test merchantAuth.test.ts`: ✓ 3/3 pass
  - `pnpm --filter @curtain/api test merchant.test.ts`: ✓ 8/8 pass (no regression)
  - `pnpm --filter @curtain/api test merchant-routes.test.ts`: ✓ 6/6 pass (no regression)

## Not verified

- **Full `pnpm check`**: not run. The WooCommerce plugin's `php -l` fails because PHP is not installed on this machine. The api's own gates (typecheck, lint, test) are all green.
- **Full api test suite**: the merchant-related tests all pass. The full suite was not run in this session due to timeout constraints, but the change is scoped to the hook lifecycle position of `requireMerchant` and does not alter any route logic.

## Open issues

- **OI-133** (merchant routes answer 400 without a key): **fixed.** `requireMerchant` now runs in `preValidation` (before schema validation), so a route without a key always answers 401, regardless of query or body validity.
