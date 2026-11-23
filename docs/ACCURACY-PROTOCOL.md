# Accuracy protocol: tape measure against scan

A protocol for comparing the scan's measurements to a tape measure's, on real volunteers. No data is collected yet; no photo is ever taken of a volunteer (D19). The founder reviews the consent wording with Naomi before the first run.

## 1. The measurement points

Six points, all in centimetres, all round (the tape's full loop):

| Point       | How to tape                                                                                          |
|-------------|------------------------------------------------------------------------------------------------------|
| **height**  | Stadiometer, no shoes, heels against the wall, Frankfurt plane horizontal.                            |
| **shoulder**| Biacromial: the outer edges of the acromion processes, tape flat across the back.                     |
| **bust**    | The fullest part of the chest, tape horizontal round the back and over the nipples. Arms down.        |
| **waist**   | The natural waist: the narrowest part between the ribs and the hip bones. Ask the volunteer to breathe out normally. |
| **hip**     | The fullest part of the seat, usually 18–22 cm below the waist. Tape horizontal.                     |
| **inseam**  | From the crotch seam to the floor along the inside of the leg, no shoes.                              |

Every point except **height** is a circumference. Height is a single vertical length.

## 2. Standing and tension

- The volunteer stands on a hard floor, feet together, arms relaxed at the sides.
- The tape is snug but does not indent the skin. The measurer can slide a flat finger under it.
- Measurements are taken at the end of a normal exhale (not a held breath).
- Two readings per point. If they differ by more than 1 cm, take a third and keep the median.

## 3. Running the scan

The scan runs on the volunteer's own phone (or the measurer's), in the Shopify storefront's "Try it on" overlay. The order:

1. **Tape first, scan second.** The tape reading is not influenced by the scan's.
2. The volunteer opens the overlay on a product page, taps *Try it on*, and follows the on-screen prompts.
3. The scan captures **one front photo and one side photo**, both processed on the device. No photo leaves the device (D19). The scan returns the six points in cm.
4. Record the scan's values. The volunteer may not see them; the overlay shows only a size recommendation.

## 4. What is recorded

For each volunteer, one row in the CSV:

| Column                | Type   | Notes                                                        |
|-----------------------|--------|--------------------------------------------------------------|
| `volunteer_id`        | string | An anonymous code the measurer assigns (`v01`, `v02`, …).     |
| `sex`                 | string | `f` or `m`, to allow grouping later.                         |
| `age_band`            | string | `18-29`, `30-44`, `45-59`, `60+`. No exact date of birth.     |
| `tape_height`         | number | cm                                                           |
| `tape_shoulder`       | number | cm                                                           |
| `tape_bust`           | number | cm                                                           |
| `tape_waist`          | number | cm                                                           |
| `tape_hip`            | number | cm                                                           |
| `tape_inseam`         | number | cm                                                           |
| `scan_height`         | number | cm                                                           |
| `scan_shoulder`       | number | cm                                                           |
| `scan_bust`           | number | cm                                                           |
| `scan_waist`          | number | cm                                                           |
| `scan_hip`            | number | cm                                                           |
| `scan_inseam`         | number | cm                                                           |
| `notes`               | string | Free text: clothing worn, anything unusual about the reading. |

The CSV lives under `scripts/data/accuracy-*.csv` (gitignored by `scripts/data/.gitignore`). Nothing else is recorded.

## 5. Consent (wording for the founder to review with Naomi)

> You are helping us check that our phone scan reads the same numbers as a tape measure. We will ask you to stand for a tape measure, then for a scan.
>
> **What we record:** six numbers (your height, shoulder, bust, waist, hip and inseam, all in cm) from each method, an anonymous code we assign you, your sex, and an age band. No name, no address, no e-mail, no photo.
>
> **What we do with them:** we compare the scan's numbers to the tape's and publish the mean error and spread. The numbers themselves are not published; only the summary.
>
> **How long we keep them:** three years, on the founder's laptop, in a file that is not in source control. You can ask us to delete yours at any time.
>
> **Your rights:** you can stop at any time, and you can ask to see what we have on your code.
>
> Do you agree?  ( ) Yes  ( ) No

If the volunteer says no, thank them and move on. If they say yes, record the row and hand them the printed copy of this wording.

## 6. Privacy

- **No photo of a volunteer is ever taken.** D19 is the rule. The scan's front and side photos are processed in a Web Worker on the device, and only the six numbers leave the worker. The photos are dropped from memory after the result is returned.
- **No device identifier is recorded.** The volunteer's code is assigned by the measurer, not by the app.
- **No real data is committed.** The CSV path is gitignored. The script's tests use synthetic data checked into the repo.
- **No shopper data is in the test fixtures.** D3.

## 7. Running the report

```bash
pnpm exec tsx scripts/accuracy-report.ts scripts/data/accuracy-2026-11.csv
```

The script prints per point: the mean signed error (scan − tape, cm), the median absolute error, the 90th-percentile absolute error, and the share within 1, 2 and 3 cm. It also writes `docs/reports/qwen/accuracy-report-YYYY-MM.md` with a markdown table.

## 8. Acceptance

A point is *good* when its median absolute error is at most 1.5 cm and at least 80 % of readings are within 2 cm. A point that misses either threshold is flagged in the report; the founder and Naomi decide whether to adjust the scan or re-measure.
