# Settings slice 1: the console and the popup

Phone size (390 × 844 CSS px, deviceScaleFactor 2). Made with `apps/web/scripts/settings-slice1-shots.mjs`
against a dev build. The console shows its demo data (the api is not reachable in the script) and the
popup uses `mock:` tokens, so nothing here comes from a real shop.

| File | What it shows |
|---|---|
| `01-settings-page.png` | The Settings page: incomplete fabric details (two choices, "show size advice anyway" is the standard), the "Fit by Curtain" switch, shop name, colour and logo. |
| `02-settings-hold-back-wordmark-off.png` | The same page after choosing "hold back" and switching the wordmark off; "Saved." |
| `03-products-notice-and-held-back.png` | The product list: a stretch value that was left out, a product without a stretch, and a held-back product with its reason and a link to the setting. |
| `04-popup-stretch-line.png` | The popup's result with the line "…this size advice does not take stretch into account." |
| `05-popup-about-with-wordmark.png` | The popup's first screen, no age-range question, with "Fit by Curtain". |
| `06-popup-about-without-wordmark.png` | The same screen for a shop that switched "Fit by Curtain" off. |
| `07-popup-result-without-wordmark.png` | The whole result for that shop: no wordmark, the estimate labels are still there. |

In `04` the demo garment itself has a stretch value and a stretch zone, so the fit panel says
"stretch fabric there" under the new line. That is the `mock:nostretch:` token setting only the
flag; a real product without a stretch value has stretch 0 in the garment the popup receives.
