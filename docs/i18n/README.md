# Interface languages: English first, translation packs later

Decision: `docs/DECISIONS.md` D21 (15 Nov 2026). The shopper and merchant interface is English only.
No interface text switches on the browser language or the shop's language, and no second language
is written in shipped code. Other languages come later as packs.

## Where the English lives, and how a pack is added

| Surface | English source | Lookup | Adding a pack |
| --- | --- | --- | --- |
| Embed (`apps/web/src/embed`) | `strings/en.ts` (`EmbedCatalogue`) | `embedStrings(locale)` in `strings/index.ts`; the embed asks for `EMBED_LOCALE` (`'en'`) | add `strings/<locale>.ts`, register it in `CATALOGUES` |
| SDK (`packages/sdk`: button, QR modal, overlay chrome, toast, size peek) | `src/strings/en.ts` (`Strings`) | `pickStrings(locale)` in `src/i18n.ts` | add `src/strings/<locale>.ts`, register it in `STRINGS` |
| Shopify theme extension | `extensions/try-button/locales/en.default.json`, `en.default.schema.json` | Shopify's own (`\| t`, `t:`) | put `<locale>.json` and `<locale>.schema.json` in `locales/` and in the list in `src/extension.test.ts` |
| WooCommerce plugin (PHP: admin, button label) | `languages/curtain-woocommerce.pot` (from the `__()` calls) | WordPress's own (`load_plugin_textdomain`) | put `curtain-woocommerce-<locale>.po` in `languages/`; the build checks it and compiles the `.mo` |

In the two TypeScript surfaces a pack is a full catalogue: TypeScript refuses one that misses a
string. The lookup takes the exact locale, else its language (`nl-BE` reads `nl`), else English.
Tests prove the fallback and that a test-only pack is picked up: `apps/web/src/embed/__tests__/strings.test.ts`,
`packages/sdk/src/sdk.test.ts`, `packages/woocommerce-plugin/tests/i18n.test.php`.

Not decided yet, on purpose: how the locale is chosen once a pack exists (shop setting, shop page
language or browser language). Today the embed passes the constant `EMBED_LOCALE`, the Shopify block
and the WooCommerce plugin send `data-locale="en"`, and the SDK reads only an explicit `data-locale`.

## What is not in a catalogue yet

- The embed's other screens (About you, the result, the size chart, the footer's "Forget me", the 3D
  view, the camera scan) and the whole consumer app and merchant console in `apps/web` still have
  their English text inline in the components. They are English only, but a pack cannot reach them
  until they move into the catalogue.
- `apps/site`, `apps/api` error messages, the Shopify admin page: English, inline.

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
