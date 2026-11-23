# WO-024: The garment follows the pose (route A) (phase F)

**Tier** full · Iterations:
1. **Qwen** builds.
2. **Google** does the visual check.

**Linear** CUR-38 · **Branch** `qwen/wo-024-garment-follows`. Start after CUR-9 (garments on the realistic body) and CUR-37 (skeleton and poses) are merged. Each iteration ends with a handoff.

## Goal

During the pose pattern, the draped garment moves with the body as a second skin. Each garment vertex takes the skin weights of the nearest body surface. A skirt or dress hem gets a light lag, so it does not look glued.

## Done when

- There is no visible clipping of the garment into the body in any key pose or transition: test the five bodies with the dress and with the skirt, with a clearance of at least 0.2 cm, measured.
- In rest the garment is exactly the static drape. There is a test that it is identical.
- The fit and the sizes do not change. It is labelled an estimate, as everywhere.
- The frame time on SwiftShader is within budget and measured. There are sheets, the gates are green, and the handoffs are written.
