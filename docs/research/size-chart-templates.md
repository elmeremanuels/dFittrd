# Women's body size chart templates (AU, UK, EU, US)

Nov 6, 2026. These are the standard charts the Shopify chart builder offers (`BODY_CHART_TEMPLATES` in
`packages/schema/src/chartTemplates.ts`). A merchant who sells to a regional standard and prints no
chart of her own assigns one of them. All four are **body** charts (`sizeChartType: 'body'`): bust,
waist and hip of the body each size is cut for, in cm. The builder also offers **garment** templates
(size labels plus the points to measure) that the merchant fills in from the finished garment.

## Method

- No current public standard gives these numbers. AS 1344 (AU) was withdrawn in 2017 (see
  `au-size-chart.md`). The UK and EU EN 13402 standards define how to measure and label, not a body
  per size number. ASTM D5585 (US) is paywalled. So, as for AU, each chart is built from retailer
  body charts that we opened and read on **Nov 6, 2026**.
- Per size and point: the median of the sources (the mean when there are two), rounded to 0.5 cm.
  A published range is stored as its midpoint. Inches are converted at 2.54 cm.
- A size that rests on fewer than three sources is listed in `weakSizes`. The builder marks those
  rows "estimate".
- Aggregators are read for comparison only and never enter the median.
- `chartTemplates.test.ts` pins the values, checks that every point grows 1.5 to 7.5 cm per size,
  that every row has a body shape (hip > bust > waist), and that the four charts agree within 6 cm for
  the sizes retailers print as equivalent (AU 10 = UK 10 = DE 36 = US 6).

## AU 6–20

Reused from `AU_WOMENS_BODY_CHART` (median of Country Road, Seed Heritage and Blue Illusion). See
`au-size-chart.md`. The builder preselects 8–20. Sizes 18 and 20 are weakly sourced.

## UK 6–20

| Source | Form | Sizes |
| --- | --- | --- |
| [Kite Clothing](https://kite-clothing.com/pages/womenswear-sizing) | ranges (midpoint) | 6–20 |
| [Seasalt Cornwall](https://www.seasaltcornwall.com/size-guide) | single values | 8–28 (22+ not used) |
| [Hobbs London](https://www.hobbs.com/size-guide) | single values, “full hip”, regular (not petite) | 6–22 (22 not used) |

| UK | Bust | Waist | Hip |
| --- | --- | --- | --- |
| 6 | 79.5 (2 sources) | 61.5 | 87 |
| 8 | 83 | 66 | 91 |
| 10 | 88 | 71 | 96 |
| 12 | 93 | 76 | 102 |
| 14 | 98 | 81 | 108 |
| 16 | 104 | 87 | 114 |
| 18 | 110 | 93 | 120 |
| 20 | 116 | 99 | 126 |

Hobbs also prints the label conversion we use below: UK 8 = DE 34 = FR 36 = IT 40 = US 4.

Not readable from here: John Lewis (no numbers in the HTML), Marks & Spencer (404), ASOS (503),
Fred Perry and the Seasalt reseller page (403), Joules and White Stuff (no chart in the HTML). A
search summary quoted Seasalt at 81 cm bust for UK 8. The page itself says 83, and we use the page.

## EU 32–46 (German numbering) and 34–48 (French numbering)

| Source | Form | Sizes |
| --- | --- | --- |
| [OTTO](https://www.otto.de/shoppages/groessentabellen_damen) | ranges (midpoint). Bust from “Kleider, Blazer, Jacken und Mäntel”, waist from “Hosen und Röcke”, hip the same in both | 32–50 |
| [Lidl](https://www.lidl.de/c/lidl-groessentabelle/s10005239) | ranges (midpoint), “Oberteile” | 32–50 |
| [Jelmoli (CH)](https://www.jelmoli-shop.ch/service-hilfe/einkaufsberatung/groessentabellen-damen) | waist and hip only, identical to OTTO | comparison only |

| DE | FR | Bust | Waist | Hip |
| --- | --- | --- | --- | --- |
| 32 | 34 | 76 | 62 | 85 |
| 34 | 36 | 80 | 65.5 | 89.5 |
| 36 | 38 | 84 | 69 | 93.5 |
| 38 | 40 | 88 | 72.5 | 97 |
| 40 | 42 | 92 | 76.5 | 100.5 |
| 42 | 44 | 96 | 80.5 | 103.5 |
| 44 | 46 | 100 | 85.5 | 106.5 |
| 46 | 48 | 105 | 90.5 | 110.5 |

**Every EU size rests on two sources**, so the whole chart is marked weak. Esprit (host blocked
from this session), H&M (403), bonprix and C&A (404), Zalando (no chart on the FAQ page), Hessnatur
(503) and Tchibo (410) could not be read. A third retailer should be added before an EU pilot. The
French template is the same bodies with labels + 2 (Hobbs' conversion). Italian labels (+ 4) are not
a template yet.

The EU chart is 3–4 cm smaller in bust than UK at the "equivalent" label (DE 34 = 80, UK 8 = 83). The
German mass-market charts are cut slimmer than the UK charts, and the regional charts are meant to
differ. A shop should use the template of the labels it prints, not convert.

## US 2–16 (misses)

| Source | Form | Sizes |
| --- | --- | --- |
| [Nike](https://www.nike.com/size-fit/womens-numeric) | inches, “body measurements” | 00–22 (2–16 used) |
| [Talbots](https://www.talbots.com/size-charts/size-charts.html) | inches, the per-size “Haven Well Within” table (its Misses table pairs sizes 4–6, 8–10, …) | 2–22 (2–16 used) |
| [Lands’ End (UK site, US labels)](https://www.landsend.co.uk/Dresses/co/size-chart-women-dresses.html) | cm, waist and hip ranges (midpoint) | US 4–18 (4–16 used) |
| [sizeguide.net](https://sizeguide.net/size-guide-women-size-chart.html) | aggregator | comparison only |

| US | Bust | Waist | Hip |
| --- | --- | --- | --- |
| 2 | 81.5 (2 sources) | 64 | 89 |
| 4 | 86 | 68.5 | 94 |
| 6 | 89 | 71 | 96.5 |
| 8 | 91 | 73.5 | 99 |
| 10 | 94 | 77.5 | 101.5 |
| 12 | 98 | 81.5 | 105.5 |
| 14 | 101.5 | 86.5 | 110.5 |
| 16 | 107 | 91 | 115 |

Not readable from here: Gap and Athleta (error pages), L.L.Bean (error page), J.Crew (no chart in
the HTML), Everlane (404), Reformation, Callaway, Columbia, Brooks and Original Penguin (403),
Lululemon and Eileen Fisher (503), Patagonia (maintenance). Under Armour and Lands' End US returned 404.

## What the templates are not

- **No shoulder, thigh or inseam.** None of the read body charts gives a shoulder width per size, so
  products on a template skip the shoulder fit point (`completenessScore` reports `sizeChart.shoulder`).
- **No letter sizes.** Shops map XS–XL to numeric sizes differently. A letter-sized product gets a
  garment chart, or a custom body chart, typed in the builder.
- **Not petite, tall or plus.** These are the regular ranges only.
