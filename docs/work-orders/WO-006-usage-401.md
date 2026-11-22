# WO-006: Merchant routes answer 401 without a key, before they check the query

**Tier** light · **Builder** Qwen · **Branch** `qwen/wo-006-usage-401`, cut from `claude/garment-engine`.

## Goal

A merchant route called without a key answers 401, whatever its query string holds (OI-133).

## Background

`GET /v1/merchant/usage` without a key answers 400, because Fastify validates the query before the `preHandler` that
checks the key (`requireMerchant`). Nothing leaks, but the other merchant routes answer 401, and a 400 tells a caller
which query is valid before it has a key. The same order holds for every merchant route with a `querystring` or
`body` schema in `apps/api/src/routes/merchant.ts`.

## Files

You may change only these:

- `apps/api/src/routes/merchant.ts`: run the key check before validation, for example by moving `requireMerchant`
  from `preHandler` to `onRequest` (or `preValidation`) on the merchant routes. Do not change what `requireMerchant`
  checks.
- one new test file: `apps/api/src/merchantAuth.test.ts` (next to the other api tests in `apps/api/src/`)
- Not `docs/OPEN-ISSUES.md`: three open orders would share it. Put the new state of each open issue (fixed, and how) in your report's *Open issues* section; Claude updates `OPEN-ISSUES.md` at the merge.
- `docs/reports/qwen/usage-401.md` (new)

## Done when

- A test calls every merchant route in `merchant.ts` without a key and with an invalid query or body, and expects 401
  from each. On the old code it fails for at least `/v1/merchant/usage`. Write in the report how many routes failed
  on the old code.
- The same test with a valid key and an invalid query still gets 400, so validation is not lost.
- All existing api tests stay green. `pnpm install --frozen-lockfile` and `pnpm check` are green.
- The report has the sections *Done*, *Measured*, *Not verified* and *Open issues*, and names the model.
