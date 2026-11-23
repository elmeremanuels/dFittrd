# WO-025: Real cloth per key pose (route B) (phase F)

**Tier** full · **Builder** Claude (engine work), with a visual check by Google · **Linear** CUR-40 · Start after CUR-39.

## Goal

At each **key pose**, where the shopper pauses and looks, the garment shows the real drape for that pose: for example a top riding up with the arms up, or the fabric pulling across the back. It is computed with the cloth engine on the server (the existing serverdrape bake), per garment, size and pose. Between key poses, the route-A skinning (CUR-39) blends from one baked drape to the next.

## Points to settle in the work

- The bake cost and the bundle size per garment × size × pose. Five poses must not make a bundle five times as large: delta-encode against the rest drape.
- Choosing which key poses get a bake. Start with "arms up" only, as a pilot.
- It is labelled an estimate. It changes no fit and no size.
- **GPU spend needs the founder's approval** (standing rule) before any GPU bake.

## Done when

The "arms up" pose shows the baked drape for the azure dress and a top on five bodies, with a measured ride-up in cm. There are sheets, the gates are green, the report and the handoff are written, and Google has done the visual check.
