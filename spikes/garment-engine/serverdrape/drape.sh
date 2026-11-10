#!/usr/bin/env bash
# R2 spike pipeline (docs/research/step3-serverdrape-spike.md), run from spikes/garment-engine:
#   BAND=W-6 serverdrape/drape.sh              # an ASSUMED band variant from band-model.json
#   BAND=measured serverdrape/drape.sh         # after filling `measured` in band-model.json with the tape numbers
# Needs: the eval bundle in out/eval/crimson-wildflower-maxi-skirt (copied from the main tree, gitignored),
# an Anny venv (ANNY_PY, `pip install anny==0.6.2` + CPU torch, no extras) and Blender 4.2 LTS (BLENDER).
set -euo pipefail
BAND="${BAND:-W-6}"
ANNY_PY="${ANNY_PY:-/opt/tools/anny-venv/bin/python}"
export BLENDER="${BLENDER:-/opt/tools/blender-4.2.23-linux-x64/blender}"
OUT=out/serverdrape
EVAL=out/eval/crimson-wildflower-maxi-skirt
mkdir -p "$OUT/bodies"
[ -f "$OUT/bodies/bodies.json" ] || "$ANNY_PY" -I serverdrape/anny_bodies.py "$OUT/bodies"
[ -f "$OUT/rest/rest.json" ] || pnpm exec tsx viewer/scripts/serverdrape/export-rest.ts "$EVAL" "$OUT/rest"
python3 serverdrape/run_grid.py "$OUT" t-1.00,t+0.00,t+1.00,t-0.40 8,12,16 "$BAND" 72
pnpm exec tsx viewer/scripts/serverdrape/bake.ts "$OUT" "$BAND"
echo "report: $OUT/report-$BAND.json; page: pnpm viewer, then /morph.html?band=$BAND"
