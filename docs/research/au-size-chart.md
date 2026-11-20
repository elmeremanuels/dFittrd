# Australian women's body size chart (AU 6–20)

Nov 6, 2026. Used by the bohohippychic.com.au validation (`spikes/garment-engine/data/bohohippychic/`). Exported from `@curtain/schema` as `AU_WOMENS_BODY_CHART` (`packages/schema/src/fixtures/charts.ts`), with the sources (`AU_WOMENS_CHART_SOURCES`) and the per-cell spread (`AU_WOMENS_BODY_CHART_SPREAD`).

## Why we need it

The shop sells most clothing in AU sizes 8–16 and prints no size chart for most products. To fit these products we need the body each AU size is cut for: a body chart (`sizeChartType: 'body'`), with bust, waist and hip in cm.

## Lineage: AS 1344

- AS 1344, *Size coding scheme for women's clothing: underwear, outerwear and foundation garments* (Standards Australia). Editions: 1972, 1975, 1997. Its stated aim is a size code that "indicates in a simple, direct and meaningful manner the body size of the person for whom all ready-made garments … are intended to fit". Source: [shop.standards.ie, AS 1344-1997](https://shop.standards.ie/en-ie/standards/as-1344-1997-127936_saig_as_as_270395/) (opened Nov 6, 2026).
- The 1997 edition was **withdrawn on 30 June 2017, with no replacement edition** (same page). There is no current Australian standard for women's size codes.
- The standard's tables are not public. The [Standards Australia store page](https://store.standards.org.au/product/as-1344-1997) and the SAI Global preview PDF were not readable from here (the store page renders client-side; the preview link returned 404). **We therefore do not quote AS 1344 numbers.** A web search summary says the control dimensions are bust, waist and hip measured over foundation garments, and that the 1975 edition stepped 5 cm per size. We could not open a page that confirms either point, so the chart below does not rely on them.
- In practice, Australian retailers publish their own body charts on the AS 1344 numbering: size 8, 10, 12 and so on, about 5 cm per size step in bust, waist and hip. The chart is built from those.

## Sources (all opened and read on Nov 6, 2026)

| Source | Kind | Sizes | Form | Used in the median |
| --- | --- | --- | --- | --- |
| [Country Road size guide](https://www.countryroad.com.au/size-guide) | AU retailer | 4–16 | single values | yes |
| [Seed Heritage woman clothing chart](https://www.seedheritage.com/size-chart-woman-clothing.html) | AU retailer | 4–18 | 5 cm ranges (midpoint used) | yes |
| [Blue Illusion size guide](https://blueillusion.com/pages/size-guide) | AU/NZ retailer | 6–20 | single values | yes |
| Boho Hippy Chic product descriptions ([example](https://bohohippychic.com.au/products/black-haven-midi-dress)), described by the shop as "Australian/New Zealand sizing standards" | the validation shop | 8–18 | single values | no: comparison only, so the standard stays independent of the shop we test it on |
| [SizeChart.com, AUS women](https://sizechart.com/clothing/women/aus) | aggregator | 2–28 | ranges (midpoint used) | no: an aggregator, not a retailer; consistently smaller from size 10 up |

Tried without success: The Iconic's brand charts (HTTP 403), Myer, Portmans and Forever New (charts render client-side, no numbers in the HTML), David Jones and Kmart (403), Target AU (404). Search snippets of those pages are not used.

Also seen but not used: [aim'n](https://www.aimn.com.au/pages/sizeguide) publishes ranges that group two AU sizes per letter size (S = AU 8–10), so it cannot be read per AU size.

## The chart

The median per size and point of the three retailers, rounded to 0.5 cm. Size 18 rests on two retailers (their mean), size 20 on one (Blue Illusion). In brackets: the range across the median sources, how many there are, and the range across all five sources.

| AU | Bust (cm) | Waist (cm) | Hip (cm) |
| --- | --- | --- | --- |
| 6 | 81 (80–82.5, n=3; all 79.5–82.5) | 62.5 (60–63.5, n=3; all 60–64) | 89 (88–89.5, n=3; all 86.5–89.5) |
| 8 | 85 (85–87.5, n=3; all 83.5–87.5) | 67.5 (64–68.5, n=3; all 64–68.5) | 94 (92–94.5, n=3; all 90.5–94.5) |
| 10 | 90 (90–92.5, n=3; all 87–92.5) | 72.5 (69–73.5, n=3; all 69–73.5) | 99 (97–99.5, n=3; all 94–99.5) |
| 12 | 95 (95–97.5, n=3; all 90.5–97.5) | 77.5 (74–79.5, n=3; all 74–79.5) | 104 (102–104.5, n=3; all 98–104.5) |
| 14 | 100 (100–102.5, n=3; all 94–102.5) | 82.5 (79–85.5, n=3; all 78.5–85.5) | 109 (107–109.5, n=3; all 102–109.5) |
| 16 | 105 (105–107.5, n=3; all 99–107.5) | 87.5 (84–91.5, n=3; all 84–91.5) | 114 (112–114.5, n=3; all 106–114.5) |
| 18 | 111.5 (110–112.5, n=2; all 104.5–112.5) | 91 (89–92.5, n=2; all 89–93) | 118.5 (117–119.5, n=2; all 111–119.5) |
| 20 | 115 (one source; all 107.5–115) | 94 (one source; all 94–95) | 122 (one source; all 116–122) |

Steps per size are 5 cm in all three points from 8 to 16, as the retailers print them (6 → 8: +4 bust, +5 waist, +5 hip). From 16 up the steps follow the sources (18: +6.5/+3.5/+4.5, 20: +3.5/+3/+3.5). Sizes 18 and 20 are weakly sourced. Use them only when a shop sells them, and treat them as an estimate.

### Spread between the sources

- **Bust and hip agree within 2.5 cm** across the three retailers at every size 6–16. The retailers differ in level (Seed's bust and hip are 0.5–2.5 cm larger, because we use its range midpoints), not in step.
- **Waist is where the charts disagree:** 4.5 cm at size 8 and 7.5 cm at size 16 (Blue Illusion 84 vs Country Road 91.5). Country Road grades the waist 6 cm per size from 10 up, Blue Illusion 5 cm. The median (Seed's value) sits in the middle.
- **The shop's own chart** (84/68/93 at size 8, +5 per size) lies within 1 cm of ours in bust and hip and within 0.5 cm in waist at sizes 8–16. For this shop the choice of standard is not a significant source of error.
- **The aggregator** is 4.5–6 cm smaller in bust at 12–16. A chart like that would push every shopper one size up. This is why aggregators are kept out of the median.

## Height

None of the opened charts states a height per size. AS 1344 tabulates height and other dimensions in an appendix that is not public. Country Road prints an inside leg of 78.5 cm for sizes 8–16 (77.5 at 6), which is a trouser length, not a height. The model heights shops print (Boho Hippy Chic: 172 cm and 165 cm) describe the model, not the chart. **The chart carries no height.** The avatar's height comes from the shopper's own measurements, and length points (`lengthCm`) come from the product.

## Not in the chart

- **Shoulder width.** No opened AU chart gives one. Products on this chart therefore skip the `shoulder` fit point (the completeness score reports `sizeChart.shoulder` as missing).
- **Thigh and inseam** for bottoms. Country Road's inside leg is the only source, so they are left out.
- **Letter sizes.** Shops map letters to AU sizes differently (Country Road: XS = 8; Seed: XS = 8; Blue Illusion: XS = 8; aim'n: S = 8–10). The validation maps a letter or range option only when the product text states the AU sizes it covers (e.g. "S-M Fits Australian Size 8 to 12"). The row is then the mean of the AU rows it covers.

## Tests

`packages/schema/src/fixtures/charts.test.ts` checks that:

- the chart is valid and its values for sizes 8–16 are pinned;
- every point is strictly increasing, with a step of 2.5–7.5 cm per size;
- every row has a plausible body shape (hip > bust > waist, drops of 15–30 cm);
- each value is the median of its sources;
- sizes 8–16 rest on at least three retailers that agree within 8 cm.
