# Translation packs (not shipped)

DECISIONS.md D21: the interface is English only for now; other languages come later as packs.

`try-button/nl.json` and `try-button/nl.schema.json` are the Dutch locale files that used to sit in
`extensions/try-button/locales/`. They are a **draft: not shipped, not reviewed**, and they are not
kept in sync with the English source (`en.default.json`, `en.default.schema.json`).

Shopify deploys every file in an extension's `locales/` folder, so a file there is live. That is
why the drafts live here. To ship a language later:

1. bring the pack up to date with the English keys and have it reviewed;
2. move it to `extensions/try-button/locales/<locale>.json` (and `<locale>.schema.json`);
3. add the locale to the list in `src/extension.test.ts`.

No code changes: Shopify picks the storefront locale file by the shop's language itself.
