#!/usr/bin/env bash
# POM bundle (docs/research/step3-serverdrape-spike.md section 10), run from spikes/garment-engine after pom2.sh:
#   serverdrape/pom-bundle.sh      the device avatar of each chart body, the drapes on them, the bake into a garment
#                                  bundle the embed loads (out/pom2-bundle/crimson-wildflower-maxi-skirt), its report
# Serve it in the demo with DEMO_SKIRT=pom (apps/api/src/demo.ts); the photo bundle stays the default.
# Needs Blender 4.2 LTS (BLENDER). At most two drapes run at a time (run_pom2.py). About 16 drapes, 3-4 CPU-min each.
set -euo pipefail
R=out/pom2              # section 9: Anny bodies, rest geometry from the tape
A=out/pom2-avatar       # the same rest geometry, draped on the device avatar of each chart body
B=out/pom2-bundle/crimson-wildflower-maxi-skirt
PHOTO=${PHOTO_BUNDLE:-out/eval/crimson-wildflower-maxi-skirt}   # payload.json (the product) and material.json
[ -f "$R/rest/rest.json" ] || { echo "run serverdrape/pom2.sh first"; exit 1; }
tsx() { pnpm exec tsx "$@"; }
tsx viewer/scripts/serverdrape/pom-body-gap.ts "$R" wear > "$A-body-gap.txt" || true   # why: the Anny bodies are not the drawn body
[ -f "$A/bodies/bodies.json" ] || tsx viewer/scripts/serverdrape/avatar-bodies.ts "$A/bodies" "$R/bodies"
[ -e "$A/rest" ] || ln -s ../pom2/rest "$A/rest"
H=t-0.40   # the held-out body (hip 100, waist 73.5): direct drapes only to measure the device blend against
# Each size on the chart bodies t = -1, 0, +1 where its band can be pulled over the drawn body's widest part below the
# waist (the fit engine's pullOnCheck; bake-pom.ts declares the others not draped, section 10.9), and on its own chart
# body where the next one up is refused (t-0.50 for AU 10, t+0.50 for AU 14 and AU 16). body:size:frames re-runs a
# drape longer: the at-rest reading of the last 24 frames is noisy at 144 frames (0.14-0.22 cm per frame against 0.25).
GRID="t-1.00:8:288,t-1.00:10:288,t-0.50:10,t-1.00:12:288,t+0.00:12,t-1.00:14,t+0.00:14,t+0.50:14:288,t-1.00:16,t+0.00:16,t+0.50:16:288"
python3 serverdrape/run_pom2.py "$A" wear "$GRID,$H:10,$H:12,$H:14,$H:16"   # AU 8 cannot be pulled over the held-out body's 100 cm hips
tsx viewer/scripts/serverdrape/bake-pom.ts "$A" wear "$B" --payload "$PHOTO"
echo "bundle in $B; report in $A/bake-report-wear.json"
