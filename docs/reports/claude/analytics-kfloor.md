# Analytics k floor against differencing (branch `claude/analytics-kfloor`, 19 Nov 2026)

Base: `claude/garment-engine` at `302748e`. Task: launch-readiness open finding 1 (medium). `/v1/merchant/analytics/*`
accepted any `from`/`to`, so `[d1, d3] − [d1, d2]` showed a group below `K_ANON`. Fix it for every merchant
analytics and cohort route, keep the console working, prove it with property tests, and re-check the report's other
open findings.

## What was wrong (more than the one finding)

Reading every k-floored route turned up four ways to get a group below the floor. The launch-readiness report named
only the first.

| # | Route | Attack | Before |
|---|---|---|---|
| 1 | `analytics/swipes`, `fit-sizes`, `abandoned` | difference of two overlapping date ranges | any `from`/`to` |
| 2 | same | **re-ask the same range later**: an erasure, or a late swipe upload dated by the client's clock, changes the answer by exactly one shopper | recomputed live; swipes bucketed by the client's `at` |
| 3 | `fit-sizes`, `abandoned`, `swipes` | **total minus shown rows**: the usage page gives the day's session count; minus the shown sizes = the hidden size | rows floored one by one, no complementary suppression |
| 4 | `swipes` | **colour minus product**: colour and fabric counted every product, while the product table hid small ones. Red − (shown red products) = the hidden red product. The same for `bySize` against each product's size histogram | — |
| 5 | `/v1/fit/cohort/:productId` (any device token, so a merchant too) | `n` minus the shown histogram = the hidden size (the old test shows `n: 6, {M: 5}`, which gives away the one XL); polling the live cohort shows every single wardrobe change; with and without `shopId` | live, all-time, `n` always shown |

## What I built

The rules are written down in `apps/api/src/services/kfloor.ts` (pure code) and in the new decision **D23** in
`docs/DECISIONS.md`.

1. **Fixed, disjoint periods.** Analytics take `?period=YYYY-MM` (one calendar month in UTC). `from`/`to` are
   refused: the query schema is strict, so `?from&to` and `?period&from` both get a 400. Two allowed questions cover
   either the same rows or no shared rows. There is one period size only: months and weeks together would leak,
   because a month minus its whole weeks is a few days. New `GET /v1/merchant/analytics/periods` lists the closed
   months (newest first, from the shop's creation, at most 24), the next month and when it opens.
2. **Closed and frozen.** A month is served only from 24 h after it ends (`period_not_closed` before that, with the
   date it opens). The first answer is stored in the new table `analytics_snapshots` (migration
   `0007_analytics_snapshots.sql`, aggregates only, cascades with the shop) and served from then on. Erasing a shopper
   afterwards changes nothing anyone can see; a route test erases a shopper and gets the same answer back. Swipes are
   bucketed by the server's `received_at`, not the client's `at`. If `K_ANON` is raised, a month frozen under the
   lower floor is served with every row hidden instead of being recomputed (tested).
3. **Complementary suppression** (`floorPartition`). A cell is shown only with at least K distinct shoppers. If the
   hidden cells of a table together hold fewer than K, the smallest shown cells are hidden too, until they hold at
   least K. Cells that are never shown ("no size given", the cohort's `unknown`) belong to the hidden remainder.
   Swipes: products are the base table, and each product's sizes are a nested table with the same rule. Colour,
   fabric and `bySize` are **sums of shown cells only**, so they never contain a hidden product.
4. **Cohort**: a sum of one floored, frozen cell per (shop, product, closed month by the row's last change). A month
   below the floor is left out entirely (`n` counts only the months shown). Polling changes the answer only by a whole
   month that cleared the floor. The response gains an optional `through: 'YYYY-MM'`. The men's gate now filters
   cells by shop, as it filtered rows before.
5. **Responses** gain `period`, `suppression: { belowFloor, complementary }` (`suppressedGroups` stays and is their
   sum). `from`/`to` remain as the month's first and last day. Hidden cells are counted, never named.
6. **Merchant console** (`apps/web/src/merchant`): a month picker (closed months only), "Figures for October 2026. A
   finished month never changes. November 2026 appears on 2 December 2026.", one line on why there are no free dates,
   and a plain-English note per table, for example: *"2 products or sizes are hidden because fewer than 5 shoppers
   were in each. 2 products or sizes are hidden as well, although each had enough shoppers, so the small hidden
   products or sizes cannot be worked out by subtracting the rows shown from a total."* A new shop sees "Your first
   month of shopper analytics appears on …". The strings are in catalogues (D21): `ANALYTICS_EN` in
   `merchant/strings.ts`, plus `components/cohortStrings.ts` for the shopper's cohort card, which now says "Counted in
   whole months, up to the end of October 2026". The demo (mock) data has the new shapes.

## The property tests (`apps/api/src/kfloor.property.test.ts`)

The attacker is **linear and exhaustive**. Each published number is the sum of a set of atoms: the finest cells over
the **full grid**, empty ones included (month × product × size × action for swipes, and so on). The attacker learns
every published number of every allowed query: every month, every cohort version as months are added, each shop and
all shops together. It also learns side knowledge a merchant really has: each month's grand totals (the usage page),
per action for swipes and both opens and fits for abandoned. A group is **recovered** if its vector lies in the span
of all of these, checked by Gaussian elimination mod 1,000,003. If a vector is outside the span mod p, it is outside
the span over the rationals too. So the test covers differencing any pair of queries and subtracting cells from
totals, plus every other linear combination.

- Before a number enters the attacker's knowledge, it is checked against the value the server actually published, so
  the model cannot drift from the code.
- The groups attacked are every product, product × size, size over all products, colour, fabric and cohort cell, plus
  **every union of hidden cells** of a table. A group is attacked if it has at least one row and fewer than K
  shoppers.
- Each shop's data is random: 120 seeded shops per table, with skewed popularity so small groups are common.
- Measured on this run: **7,156 / 8,000 / 6,819 / 14,633** sub-floor groups attacked (swipes / fit-sizes / abandoned
  / cohort). **0 recovered.**
- **Negative controls** feed the same attacker the old behaviour, which must leak:
  - old fit-sizes over every day range: 759 groups recovered;
  - old live cohort: 437;
  - complementary suppression switched off: 17;
  - colour counted over every product: 499.

  This shows the attacker is strong enough to catch each bug, and that each rule is needed.
- There are also properties of the periods themselves: every instant falls in exactly one month; two different months
  share no instant; a month is servable only after its end plus the grace day; the newest servable month is never
  open. `floorPartition` is tested on its own: shown cells clear K, and the hidden remainder holds K shoppers or
  nothing.

Writing the tests also caught two weaknesses in my first version of the attacker, both now fixed. Targets made only
from non-empty atoms were too narrow, so the colour negative control found nothing. And atoms made only from observed
rows told the attacker which hidden cells were empty, which gave false hits.

## Measured, assumed, not covered

- **Measured:** the numbers above; the route tests in `analytics.test.ts` (every refusal, the periods list, each
  table's complementary suppression with exact expected rows, the freeze across an erasure, the raised floor, the
  cohort months). `npm_config_workspace_concurrency=1 pnpm check`: see the final line of this report.
- **Assumed / design calls:**
  - Counts inside a shown group (love/pass/save/less, pass reasons, resolved/withFit, the kept rate) stay **measures**
    of that group, as D3 always treated them. "1 of the 7 shoppers loved it" is shown. Treating actions as groups too
    would hide nearly everything for a pilot shop.
  - Billing counters (`/v1/merchant/usage`, `usage/anomalies`) keep their daily range. They are session counts with
    no shopper attribute, and the property tests give the attacker exactly these totals as side knowledge.
  - A **month** rather than an ISO week, so a small shop sees more. That is one constant (`ANALYTICS_PERIOD_GRANULARITY`)
    and is in D23 for the founder to overrule.
- **Not covered by the linear model:**
  - inference from non-negativity and bounds;
  - rates as such;
  - a merchant who runs K−1 fake shoppers next to one real one (a sybil attack; device creation is open). Rate limits
    help; a real fix needs paired devices only, which is a product decision;
  - which product a hidden count belongs to is never sent, but a merchant knows whether the complementary rule fired,
    which tells them "the hidden ones together had fewer than K".
- **Cost:** a new shop sees its first analytics on the 2nd of the next month; the cohort never shows the current
  month; a wardrobe item changed in a later month counts in both months' cells (the cohort is an estimate; this
  over-counts `n` slightly and mixes kept-rate months).

## Other open findings of the launch-readiness report

| # | Finding | Done |
|---|---|---|
| 2 | `docs/LICENSES.md` did not list Anny | **Fixed.** Row added: Anny 0.6.2, default topology only, research spikes only (`serverdrape/anny_bodies.py`, the spike viewer). Not shipped: the pilot bundle is draped on the device avatar. Apache-2.0 code / CC0 assets **as recorded in the spike's tool table**, not read from the upstream licence file here; the closing note says so |
| 3 | `infra/.env.example` defaults `MEN_3D_GATE=0` against D20 | **Left.** It is founder decision F6 in `docs/LAUNCH-RUNBOOK.md` |
| — | committed go-live smoke script (open issue, not a finding) | not done here; out of scope |

## Screenshots (`docs/screens/claude/analytics-kfloor/`)

Phone, 390 × 844 at deviceScaleFactor 2. The console runs against a live api from a scratch script (not committed): an
in-memory database, one shop created 20 Aug 2026, and October 2026 swipes and fit sessions inserted directly. Every
number on screen is a real api answer.

| File | Shows |
|---|---|
| `phone-1-overview-month.png` | Overview, scrolled to "Sizes recommended" for October 2026: M and S on the product page, M in swipes. Below it, the note "1 size is hidden because fewer than 5 shoppers were in it. 1 size is hidden as well…" (XL had 1 shopper, so L was hidden with it) |
| `phone-2-swipes-hidden-note.png` | Swipes: the month picker (October, September, August 2026), the month note, why whole months, the plain-English hidden note (2 below the floor, 2 hidden with them), and the product table with only aalter-studio-1 (monochrome-02 hidden with raw-denim-01; inside aalter, L hidden with XS) |
| `phone-3-swipes-tables.png` | The colour / fabric / size tables, sums of shown cells only |
| `phone-4-new-shop.png` | A shop with no closed month: "Your first month of shopper analytics appears on 2 December 2026" |

## Commands

```sh
pnpm install --frozen-lockfile
pnpm --filter @curtain/api exec vitest run src/kfloor.property.test.ts src/analytics.test.ts
npm_config_workspace_concurrency=1 pnpm check
```
