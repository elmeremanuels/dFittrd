# Settings slice 1b — Settings in the Shopify admin, the sign-in link into the console, and the review fixes

Branch `claude/settings-slice1b`, local, 20 Nov 2026. Not pushed, no pull request. Built by several sessions in sequence. The last session, which wrote this report, did the review fixes and ran the gates; what it says about the earlier steps comes from the commits, the code and the tests, not from having built them.

## What was built

**Before the review (commits `f4542af` to `920f09b`):**

- **One catalogue for the settings words** (`packages/schema/src/merchantSettingsText.ts`). The console and the Shopify admin read the same sentences for the Settings section and the fabric notices (D21).
- **A Settings section in the Shopify admin**: "Products with incomplete fabric details" (two choices), the switch "Show 'Fit by Curtain'", saved at once. `GET/PUT /shopify/settings` sits on the same service as `/v1/merchant/settings`. The admin's product list shows the same fabric notices as the console.
- **A one-time sign-in link into the console** (inventory S2, founder decision 11). `POST /v1/merchant/console-link` (asked with the shop's own credentials) answers a link that works once and for 10 minutes, with the token in the URL fragment. The console page `/merchant/link` takes the token out of the address bar and exchanges it (`POST /v1/merchant/console-session`) for a session of 12 hours kept in that tab. Only hashes are stored (migration 0010). "Open the Curtain console" in the WooCommerce settings page and "Open the full console" in the Shopify admin use it.

**After the review (this session):**

| Finding | Severity | What was done |
|---|---|---|
| Rotating the shop key did not end console sessions or unused links | medium | Fixed. A new key (`issueMerchantKeys`: rotate, WooCommerce reconnect) ends every session of the shop and spends every unused link (`endConsoleAccess`). |
| Sessions and links came back to life after uninstall and reinstall | low | Fixed. The `app/uninstalled` webhook ends them too. |
| The limit of 5 links per shop did not hold for requests sent together | low | Fixed. The count and the insert run in one transaction under a lock on the shop's row. |
| Shopify: a held-back product said "add the fabric stretch" with no place to do it | medium | Fixed in words, not with a form. The row now says where: "Edit in Shopify", Metafields, the field "Fabric", with an example. The value is still typed as JSON by hand (OI-124). |
| WooCommerce: "You stay signed in there for 12 hours" was not true | medium | Fixed: "until you close that tab, and for 12 hours at most". |
| Console: "You are signed out … Press 'Sign out'" | low | Fixed. The line says the session ended, names no reason, and names the button on each platform. |
| The sign-in page blamed the link for a 429 or a 5xx | low | Fixed. Four cases now: link refused (400, 401), too many tries (429), Curtain failed (anything else), not reachable. |
| WooCommerce redirect check ignored the port | low | Fixed. Only the https port; a local development host may name any port. |
| WooCommerce showed the api's raw message | low | Fixed. A plain sentence that names "Check status". |
| Phone: the Shopify product list was cut off at the chip; "Held back" above "80 / 100" | low | Fixed. Below 641 px each product is a block. A held-back row shows no score. The score no longer breaks over two lines. The same cut-off in the console's product list (known since slice 1) is fixed the same way. |
| The exchange's per-address limit follows `X-Forwarded-For` | low | Not changed in the api. Behind the repo's Caddyfile a client cannot set that header; a test now keeps the Caddyfile that way. Left because `trustProxy` is older than this work and is needed behind Caddy (OI-123). |
| A link signs any visitor into the link's shop (login CSRF) | low | Not changed. It needs a founder decision (OI-122). |
| WooCommerce: a failure shows in the new tab | low | Not changed. It needs the tab to be opened by a script; not a quick fix (OI-125). |
| Wording differences between surfaces | low | Not changed (OI-126). |

## Measured versus assumed

**Measured (run in this session):**

- `apps/api/src/console-link.test.ts`, 27 tests. New: after `POST /v1/merchant/keys/rotate` two open sessions answer 401 and the unused link is refused, while another shop's session and link still work and the new key gets a working link. After the signed `app/uninstalled` webhook and a cleared `uninstalledAt`, the old session and the old link stay dead and a new link works. Of 25 link requests sent together, 5 get 200 and 20 get 429, and 5 rows are in the table.
- I did not run the three new api tests against the code before the fix. The reviewer's throwaway tests showed the old behaviour; I did not repeat them.
- WooCommerce: 125 PHP tests pass. `:8443` and `:80` on the console host are refused, `:443` is accepted.
- Web: 59 tests in `src/merchant` pass, among them the four failure cases of the sign-in page.
- Shopify admin in Chromium at 390 px and 1280 px (`settings-shots.mjs`): each held-back row shows the where-line, only the product that gives advice shows a score, no chip passes the right edge, the list does not scroll sideways.
- Console in Chromium at 390 px against the real api on PGlite (`console-link-shots.mjs`): the walk still passes; no chip of the product list passes the right edge.
- The gates: see "Commands and results".

**Assumed, not measured:**

- That the row lock holds the limit on real Postgres. On PGlite transactions run one at a time, so the test proves the transaction, not the lock.
- That Caddy replaces a client-sent `X-Forwarded-For`. This is Caddy's documented default without `trusted_proxies`; no Caddy was run.
- That a Shopify merchant finds the pinned metafield under "Metafields" with the name "Fabric". The name comes from our own definition list; no Shopify admin was opened.
- That "wait a minute, then reload" is true for a metafield save. It rests on the existing product webhook path.

## Screenshots (`docs/screens/claude/settings-slice1b/`)

The Shopify pictures are the real admin page outside Shopify, with a stub for App Bridge and the api answered by the script. The WooCommerce picture uses a stand-in stylesheet, not WordPress. The console pictures are the real console against the real api on PGlite.

- `shopify-phone-01-settings-default.png`, `shopify-desktop-01-…`: the Settings section, "Show size advice anyway (standard)" chosen. Readable. Long on a phone because of the explanations.
- `shopify-phone-03-…`, `shopify-desktop-03-…`: "Hold back" chosen, the switch off with its focus ring, "2 products are held back right now.", "Saved." in green at the top of the section. On a phone "Saved." can be out of view when the switch lower down is used (OI-128).
- `shopify-phone-02-products-notices.png` (retaken): one block per product, the chip and the score whole. Before, the chip was cut to one letter.
- `shopify-phone-04-products-held-back.png` (retaken): two held-back products with the red chip, no score, the next step and the where-line. It is a lot of text: the where-line is six lines on a phone and is repeated for each held-back product. Boho kaftan carries two notices that say nearly the same.
- `shopify-desktop-02-…`, `shopify-desktop-04-…` (retaken): the table. "80 / 100" is on one line. In 04 the where-line makes the held-back rows tall.
- `woo-phone-01-open-the-console.png` (retaken): the button and the new sentence. The checkbox on its own line above its label comes from the stand-in stylesheet; this picture does not show how the row looks in WordPress.
- `console-phone-02-signed-in-by-link.png` (unchanged): the overview after the link, real shop data, no demo banner.
- `console-phone-03-products-after-link.png` (retaken): one block per product. Before, the status column was cut to slivers.
- `console-phone-04-used-link.png` (unchanged): the message for a used link. The new messages for 429 and for a failure at Curtain have no picture; they are tested in jsdom only.

## Not done

- **Login CSRF of the sign-in link** (OI-122): not changed, waits for a decision.
- **A fabric form in the Shopify admin**: the merchant still types JSON into a metafield (OI-124, slice 2).
- **Nothing ran in a real WordPress, a real Shopify admin or on real Postgres** (OI-127).
- **WooCommerce failure notice in the new tab** (OI-125), **wording differences** (OI-126), and the small items of OI-128 (several links from one Shopify session token; "Saved." out of view on a phone; two near-identical notices; the key change and the ending of sessions are not one transaction).
- **The api still trusts `X-Forwarded-For`** (OI-123).
- No route lets a merchant end all console sessions without rotating the key.
- The sentence for a held-back product is specific to Shopify. The console still says only "You do these in WordPress/Shopify…" above the list.
- The web end-to-end suite and the WooCommerce real-WordPress suite (`e2e:wp`) were not run beyond what `pnpm check` and `pnpm demo:e2e` include.

## Commands and results

```
pnpm install --frozen-lockfile
npm_config_workspace_concurrency=1 pnpm check
pnpm demo:e2e
DEMO_SKIRT=pom pnpm demo:e2e
pnpm --filter @curtain/api test -- console-link
pnpm --filter @curtain/shopify-app build && node packages/shopify-app/scripts/settings-shots.mjs docs/screens/claude/settings-slice1b
node packages/woocommerce-plugin/e2e/console-link-shots.mjs docs/screens/claude/settings-slice1b
```

Results, run on the final code of this branch (the commits after them change only `docs/`):

| Gate | Exit code | Note |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | |
| `npm_config_workspace_concurrency=1 pnpm check` | 0 | Third run. The first run exited 1: in `spikes/garment-engine` (not touched here) all 482 tests passed but vitest reported a worker time-out ("Timeout calling onTaskUpdate") under load. Run alone, that suite passed (42 files, 482 tests, exit 0). The second full run was stopped by my own 10-minute limit, not by a failure. The third ran to the end. |
| `pnpm demo:e2e` | 0 | 3 flows passed |
| `DEMO_SKIRT=pom pnpm demo:e2e` | 0 | 3 flows passed |
