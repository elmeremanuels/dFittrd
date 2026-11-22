# Procedural skin and studio light on the realistic body spike, 21 Nov 2026

Branch `claude/realistic-body`. This report covers the skin and light commits e3099be, 50752e3, 5a8f45a and 7dce780. The
viewer README (`packages/garment-viewer/README.md`, "Procedural skin and studio light") describes how it is built.
The agent that built the skin stopped at the usage limit before it measured frame times and wrote this report. The
coordinator wrote the report from the commits and the pictures. It contains no number that was not measured.

## What is there

- `MountOptions.realisticSkin` turns the skin on. It works only with `bodyShape: 'realistic-spike'` and is off by
  default. Without it nothing changes.
- The skin is generated in code: wrap lighting, translucency at thin parts, a pore and crease tile, redness at set
  places, and a sheen. Every value per skin tone comes from the one skin-tone colour (D20). Nothing is a downloaded
  texture.
- The studio light is generated in code too: an environment plus one soft key light.
- Both live in the realistic body's lazy chunk, so the viewer chunk does not grow.
- Pictures are in `docs/screens/claude/realistic-body-skin/`. There are three tones (light, medium, deep) on five
  bodies (slim, mid, full, tall, petite). Each comes before and after, as a body alone and in a dress, with upper-body
  close-ups.

## Not measured or not verified

- **Frame time with the skin on.** The agent stopped at this step. Without it there is no proof the skin stays within
  the phone budget.
- **No real phone.** All pictures come from headless Chromium with SwiftShader.
- **No founder look review**, and no independent review of the skin code yet.
- **No embed build flag** for the skin yet. Only `avatar.html` (`skinlook=procedural`) shows it.
- The body's own open items (OI-141 to OI-151) are unchanged. That includes the arms being too long, which was
  reported by the founder on 21 Nov and is not yet fixed.
