#!/usr/bin/env bash
# POM bundle (docs/research/step3-serverdrape-spike.md section 10), run from spikes/garment-engine after pom2.sh:
#   serverdrape/pom-bundle.sh      the device avatar of each chart body, the drapes on them, the bake into a garment
#                                  bundle the embed loads (out/pom2-bundle/crimson-wildflower-maxi-skirt), its report
# Serve it in the demo with DEMO_SKIRT=pom (apps/api/src/demo.ts); the photo bundle stays the default.
# Needs Blender 4.2 LTS (BLENDER). At most two drapes run at a time (run_pom2.py). About 20 drapes, 3-4 CPU-min each.
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
GRID="t+0.00:12,t-1.00:12,t+1.00:12,t+0.00:8,t-1.00:8,t+1.00:8,t+0.50:8,t+0.00:10,t-1.00:10,t+1.00:10,t+0.00:14,t-1.00:14,t+1.00:14,t+0.00:16,t-1.00:16,t+1.00:16"
python3 serverdrape/run_pom2.py "$A" wear "$GRID,$H:8,$H:10,$H:12,$H:14,$H:16"   # t+1.00:8 is refused by the wear rule; t+0.50:8 stands in
tsx viewer/scripts/serverdrape/bake-pom.ts "$A" wear "$B" --payload "$PHOTO"
echo "bundle in $B; report in $A/bake-report-wear.json"
