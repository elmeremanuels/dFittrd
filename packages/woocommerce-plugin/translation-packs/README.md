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
through `load_plugin_textdomain`. One string of the catalogue is not text but the pack's own
language tag (msgid `en`, context "language tag of this translation"; translate it to `nl`, the
build refuses a tag that is not the file's language). The plugin sends it to the SDK as
`data-locale`, which also asks the embed for that language, so the admin, the button, the modal
and the overlay change together. The SDK and embed catalogues for the language must ship in the
same change (`docs/i18n/README.md`); `node scripts/check-language-packs.mjs` (part of `pnpm check`)
fails while one is missing. The draft here predates that string.
