# Translation packs (not shipped)

DECISIONS.md D21: the interface is English only for now; other languages come later as packs.

`curtain-woocommerce-nl_NL.po` is the Dutch translation that used to sit in `languages/`. It is a
**draft: not shipped, not reviewed**. It is no longer merged with the `.pot`, so it will fall
behind the English source.

The build (`scripts/build.mjs`) checks and compiles every `.po` in `languages/` into the zip, so a
file there is live on every site in that language. That is why the draft lives here. To ship a
language later:

1. move the `.po` to `languages/`;
2. `php scripts/i18n.php po` (merges the current `.pot` into it), translate what is new, have it reviewed;
3. `pnpm build` (fails while a string is untranslated or a placeholder differs, then compiles the `.mo`).

No code changes: WordPress loads `languages/curtain-woocommerce-<locale>.mo` by the site language
through `load_plugin_textdomain`. The SDK's own text (overlay, toast) is a separate pack: see
`packages/sdk/src/i18n.ts`.
