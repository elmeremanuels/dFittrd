# Interface languages: English first, translation packs later

Decision: `docs/DECISIONS.md` D21 (15 Nov 2026). The shopper and merchant interface is English only.
No interface text switches on the browser language or the shop's language, and no second language
is written in shipped code. Other languages come later as packs.

## Where the English lives, and how a pack is added

| Surface | English source | Lookup | Adding a pack |
| --- | --- | --- | --- |
| Embed (`apps/web/src/embed`) | `strings/en.ts` (`EmbedCatalogue`) | `embedStrings()` in `strings/index.ts` | add `strings/<locale>.ts`, register it in `CATALOGUES` |
| Shared components, camera scan, consumer app (`apps/web/src/components`, `render`, `features/capture`, `routes`, `store`) | `apps/web/src/strings/en.ts` (`AppCatalogue`, in three parts under `strings/en/`) | `appStrings()` in `apps/web/src/strings/index.ts`; the locale is the embed's (`setEmbedLocale` hands it on) | add `strings/<locale>.ts`, register it in `CATALOGUES` |
| Merchant console (`apps/web/src/merchant`) | `merchant/strings.ts` (`MerchantCatalogue`) | `merchantStrings()` | a second catalogue of that type and a lookup by locale (the console has no locale setting yet) |
| SDK (`packages/sdk`: button, QR modal, overlay chrome, toast, size peek title) | `src/strings/en.ts` (`Strings`) | `pickStrings(locale)` in `src/i18n.ts` | add `src/strings/<locale>.ts`, register it in `STRINGS` |
| Shopify theme extension | `extensions/try-button/locales/en.default.json`, `en.default.schema.json` | Shopify's own (`\| t`, `t:`) | put `<locale>.json` (with its `curtain.interface_locale`) and `<locale>.schema.json` in `locales/` and in the list in `src/extension.test.ts` |
| WooCommerce plugin (PHP: admin, button label) | `languages/curtain-woocommerce.pot` (from the `__()` calls) | WordPress's own (`load_plugin_textdomain`) | put `curtain-woocommerce-<locale>.po` in `languages/`; the build checks it and compiles the `.mo` |

In the two TypeScript surfaces a pack is a full catalogue: TypeScript refuses one that misses a
string. The lookup takes the exact locale, else its language (`nl-BE` reads `nl`), else English.

A pack is those files and registry entries, and nothing else changes. A pack for one language
ships on every surface in one change: `node scripts/check-language-packs.mjs` (part of
`pnpm check`) fails when a language is present on one surface and missing on another, because that
would put two languages on one page.

## Which language a shop gets

One value, the **interface locale of the shop's integration**, decides every surface. It is never
the browser language and never read from `<html lang>`.

1. The platform picks its own pack the way it always does: Shopify the storefront locale file,
   WordPress the plugin's translation. With no pack for the shop's language that is English.
2. The pack names its own language: `curtain.interface_locale` in the Shopify locale file (`"en"`
   in `en.default.json`), the string `en` with context "language tag of this translation" in the
   WooCommerce catalogue. The block and the plugin send that as the SDK's `data-locale`. A custom
   integration writes `data-locale` on its script tag itself.
3. The SDK shows its catalogue for `data-locale` (`pickStrings`) and adds `?ui=<locale>` to the
   iframe URL of the overlay and the size peek. The embed sets its locale from that once
   (`mountRouter.tsx`) and every screen reads `embedStrings()`.

Today no pack exists, so step 1 always ends in English, both plugins send `data-locale="en"`, and a
custom `data-locale="nl"` reads English in the SDK and the embed. With a complete Dutch pack, a
Dutch shop gets Dutch on every surface and every other shop stays English, with no code change.
This follows the shop's language once a pack exists; the founder can still choose a shop setting
instead when the first pack lands (one place per plugin: the block's `data-locale` line,
`Settings::effective_locale()`).

Tests: `apps/web/src/embed/__tests__/strings.test.tsx` (fallback, a test-only pack on the real
screens, nobody passes a locale of their own, no text outside the catalogue),
`packages/sdk/src/sdk.test.ts`, `embed.test.ts` and `peek.test.ts` (fallback, test-only pack,
`?ui=`), `packages/shopify-app/src/extension.test.ts`, `packages/woocommerce-plugin/tests/i18n.test.php`
and `sync.test.php`.

## What is not in a catalogue yet

- The fit engine's own sentences (`FitResult.notes`, `fitSummary` in `packages/fit-engine`,
  including the pull-on and "not measured by the shop" sentences): English, written in the engine.
  Only the consumer app prints them (`components/FitPanel.tsx`, `routes/TryRoute.tsx`). The embed
  does not: it writes its notes from the result's structured fields with `fit.notes` of its
  catalogue, so a pack reaches them there.
- Text that comes from packages or data and is printed as it is: the taste engine's labels
  (archetypes, colour match), `ESTIMATE_DISCLAIMER` and the merchant setup and plan texts of
  `@curtain/schema`, the api's step titles and error messages.
- Developer messages of the camera scan that can still reach the screen when an error has no code
  (`e.message` of an unexpected failure): English. The one error a shopper is meant to read has a
  code and a catalogue text (`capture.scanErrors`).
- Number and date formats in the merchant console and `lib/format.ts` (`en-GB`, `en-IE`).
- `apps/site`, `apps/api` error messages, the Shopify admin page: English, inline.

Everything else in `apps/web` reads a catalogue (branch `claude/loose-ends`, 19 Nov 2026). Three
guard tests fail when interface text is written in a component again:
`apps/web/src/embed/__tests__/strings.test.tsx` (the embed's screens),
`apps/web/src/strings/strings.test.tsx` (shared components, scan, consumer app) and
`apps/web/src/merchant/strings.test.ts` (the console).

## What still follows the locale, and is not interface language

- Units: the embed's default (cm or in) follows the region of the browser locale, then the shop
  page's (`units.ts`), until the shopper chooses.
- Number and date formatting through `toLocaleString()` in the app and the merchant console.
- Recognising merchant data written in Dutch, German or French (size option names such as "Maat",
  fabric names, audience words) in `packages/schema`, `packages/sdk/src/variant.ts` and the plugins.
  That is input parsing, not interface text.

## Drafts kept as source material (not shipped, not reviewed)

- `docs/i18n/nl-drafts.md`: Dutch for the avatar prompt, the men's "coming soon" screen and the SDK.
- `docs/legal/avatar-consent-copy.md` section 3: the Dutch consent copy.
- `packages/shopify-app/translation-packs/`: the Dutch theme extension locales.
- `packages/woocommerce-plugin/translation-packs/`: the Dutch `.po`.
