# Settings slice 1: the console and the popup

Phone size (390 × 844 CSS px, deviceScaleFactor 2) unless the row says otherwise. Made with
`apps/web/scripts/settings-slice1-shots.mjs` against a dev build. The console shows its demo data (the api is not
reachable in the script) and the popup uses `mock:` tokens, so nothing here comes from a real shop. Retaken on
20 Nov 2026 after the review.

| File | What it shows |
|---|---|
| `01-settings-page.png` | The Settings page under the standard choice ("Show size advice anyway"): no "held back" count, the "Fit by Curtain" switch on, shop name, colour, logo address, "Save colour and logo". |
| `02-settings-hold-back-wordmark-off.png` | The same page after choosing "hold back" and switching the wordmark off: "Saved.", "2 products are held back right now." |
| `03-products-notices.png` | The product list under the standard choice: a stretch that was entered but left out (one line, with what size advice assumes), and a product without a stretch. |
| `03b-products-held-back.png` | The product list under "hold back": two held-back products, the reason and the link to the setting. At this width only the Product and Kind columns are on screen. |
| `03c-products-held-back-wide.png` | The same list at 1280 px wide: the "Held back" chip and the next-step column. |
| `04-popup-stretch-line.png` | The popup's result for a product without a stretch value: "…this size advice does not take stretch into account." |
| `05-popup-about-with-wordmark.png` | The popup's first screen, no age-range question, with "Fit by Curtain". |
| `06-popup-about-without-wordmark.png` | The same screen for a shop that switched "Fit by Curtain" off. |
| `07-popup-result-without-wordmark.png` | The top of the result for that shop (one phone screen): "Estimate · not measured" on the figure. |
| `08-popup-result-end-without-wordmark.png` | The end of the same result: the estimate line, no "Fit by Curtain", "Get the Curtain app" still there. |

`04` and `07` are the same demo dress and the same answers (168 cm, 62 kg). In `04` the garment has stretch 0 and no
marked stretchy part, as the api sends a product without a stretch value; the advice is L. In `07` the garment has
its own 2 % stretch and a marked waist tie; the advice is M. So for this shopper the missing stretch value and stretchy part together moved the advice one size up (which of the two does it was not separated).
