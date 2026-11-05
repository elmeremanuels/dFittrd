# @curtain/anchors

The one anchor vocabulary (`docs/DECISIONS.md` D15). The body scan, the fit engine, the garment pipeline and the renderer all name body places with these ids, so the size advice and the picture come from the same numbers. Pure TypeScript, zero runtime dependencies (D8); runs in the browser and in the garment worker.

- **Rings (12):** `neck`, `shoulder`, `chest`, `underbust`, `waist`, `hip`, `thigh`, `knee`, `calf`, `ankle`, `upper_arm`, `wrist`.
- **Lengths (6):** `shoulder_to_waist`, `shoulder_to_hem`, `waist_to_hem`, `sleeve`, `inseam`, `rise`.
- **Breadths (1):** `shoulder_width`, the straight width from one shoulder point to the other across the back, taken at the height of the `shoulder` ring (`BREADTH_RING`).

`shoulder` and `shoulder_width` are different anchors (review finding R1). The ring `shoulder` is the girth of the torso at the shoulder line (about 100 cm on mannequin M), measured by the scan's `shoulder` level. The fit point `shoulder` and every size chart's shoulder column are a width (about 40 cm), so `FIT_POINT_TO_ANCHOR.shoulder` is `shoulder_width`. No fit point maps onto the ring, so a fit-engine gap is never keyed under it.

## Run

```sh
pnpm --filter @curtain/anchors typecheck
pnpm --filter @curtain/anchors test
pnpm --filter @curtain/anchors build   # tsup → dist/index.{js,cjs,d.ts} + no-runtime-import guard
pnpm --filter @curtain/anchors lint    # only relative imports are allowed in src/
```

## Public API

| Export | What it does |
| --- | --- |
| `ANCHOR_RINGS`, `ANCHOR_LENGTHS`, `ANCHOR_BREADTHS`, `ANCHOR_IDS`, `AnchorRing`, `AnchorLength`, `AnchorBreadth`, `AnchorId`, `AnchorValues`, `isAnchorRing/Length/Breadth/Id` | The vocabulary |
| `BREADTH_RING` | The ring height a breadth is measured at (`shoulder_width` → `shoulder`) |
| `CATEGORY_ANCHORS`, `anchorsForCategory(category)` | The anchors a garment of each category is built against (dress, top, bottom, outerwear; shoes and accessory are empty) |
| `FIT_POINT_TO_ANCHOR`, `ANCHOR_TO_FIT_POINT`, `fitPointToAnchor`, `anchorToFitPoint` | Fit points ↔ anchors (`bust` → `chest`, `shoulder` → `shoulder_width`; `foot` has no anchor) |
| `SCAN_LEVELS`, `SCAN_LEVEL_TO_ANCHOR`, `ANCHOR_TO_SCAN_LEVEL`, `scanLevelToAnchor`, `anchorToScanLevel`, `scanValuesToAnchors` | Scan levels ↔ rings (`bust` → `chest`, `upperArm` → `upper_arm`) |
| `LENGTH_KEY_TO_ANCHOR`, `lengthKeyToAnchor` | Garment `lengthCm` keys → length anchors (`sleeve_length` → `sleeve`) |
| `ellipseCircumference(a, b)`, `girthFromWidthDepth(w, d)` | Ramanujan II ring girth (same formula as the scan) |
| `ellipseFromCircumference(c, aspect)`, `scaleEllipseToCircumference(e, c)`, `ellipseRingPoints(e, n)` | Exact inverse (circumference is homogeneous of degree one), uniform rescale, sampled ring |
| `gradingMorph(base, target, { heights? })` | Per-anchor scale `target / base`, the anchors known on one side only, and `girthScaleAt(height, chain)` |
| `gradeSizes(base, [{ size, target }])` | One morph per size; throws on duplicate size labels (finding #2) |
| `monotoneProfile(knots)`, `ANCHOR_CHAINS`, `NOMINAL_RING_HEIGHTS` | The interpolation behind `girthScaleAt` |

## Grading morph

Stage 6 of the garment pipeline stores, per size, only the per-anchor targets; the device morphs the base mesh. A ring's scale is `target / base`; scaling its cross-section uniformly by that factor gives exactly the target girth. Between rings the scale follows a monotone cubic (Fritsch–Carlson) along the ring heights of a chain (`body`: neck → ankle; `arm`: upper_arm → wrist). It passes exactly through every ring's scale, is C1 (zero slope at the ends, constant beyond them) and never leaves the range of the two neighbouring rings, so the mesh never grades past what the chart says. Heights default to nominal fractions of stature; the canonical mannequin passes its own heights once it exists. Length and breadth anchors get a scale but take no part in the girth profile.

The mappings are declared as literals so the package has no dependencies; the tests compare them with `@curtain/schema` (`FIT_POINTS`, `FS_GIRTH_LEVELS`, `GARMENT_CATEGORIES`, `CATEGORY_POINTS`, `LENGTH_KEYS`).
