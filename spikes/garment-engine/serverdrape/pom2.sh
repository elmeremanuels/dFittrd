#!/usr/bin/env bash
# POM v2 (docs/research/step3-serverdrape-spike.md section 9), run from spikes/garment-engine:
#   serverdrape/pom2.sh            bodies, rest geometries, every drape of section 9, measurements
#   RENDERS=/some/dir serverdrape/pom2.sh   also the review renders (never into the repo)
# Tape measurements in, draped skirt out, with the founder's answers of 15 Nov 2026 applied: the band is PLACED just
# below the navel (wear_rule.py), pull-on only, the panel gathered into the band, no slit, no tier.
# Needs an Anny venv (ANNY_PY) and Blender 4.2 LTS (BLENDER). At most two drapes run at a time (run_pom2.py).
set -euo pipefail
ANNY_PY="${ANNY_PY:-/opt/tools/anny-venv/bin/python}"
export BLENDER="${BLENDER:-/opt/tools/blender-4.2.23-linux-x64/blender}"
R=out/pom2          # profile tube (the v2 default), mesh edge 1.0 cm
C=out/pom2-cone     # profile cone (the comparison)
M=out/pom2-e13      # profile tube on the v1 mesh density (edge 1.3 cm): mesh sensitivity
H=t-0.40            # the held-out body (hip 100, waist 73.5)
mkdir -p "$R/bodies" "$C" "$M"
# Bodies: the chart's AU 8, 12, 16 (t -1, 0, 1), the held-out body, and the chart's AU 10 and 14 (t -0.5, 0.5).
[ -f "$R/bodies/bodies.json" ] || "$ANNY_PY" -I serverdrape/anny_bodies.py "$R/bodies" -1,0,1,-0.4,-0.5,0.5
for d in "$C" "$M"; do [ -e "$d/bodies" ] || ln -s ../pom2/bodies "$d/bodies"; done
[ -f "$R/rest/rest.json" ] || python3 serverdrape/pom_rest.py "$R/rest" --profile tube --edge 1.0
[ -f "$C/rest/rest.json" ] || python3 serverdrape/pom_rest.py "$C/rest" --profile cone --edge 1.0
[ -f "$M/rest/rest.json" ] || python3 serverdrape/pom_rest.py "$M/rest" --profile tube
python3 serverdrape/pom2_measure.py fit "$R" 8,10,12,14,16 --json "$R/fit.json"
ALL="$H:8,$H:10,$H:12,$H:14,$H:16"
OWN="t-1.00:8,t-0.50:10,t+0.00:12,t+0.50:14,t+1.00:16"
GRID="t-1.00:10,t-1.00:12,t-1.00:14,t-1.00:16,t+0.00:8,t+0.00:10,t+0.00:14,t+0.00:16"   # for the blend (with OWN)
python3 serverdrape/run_pom2.py "$R" wear "$ALL,$OWN,t+1.00:8,$GRID"      # t+1.00:8 is refused: cannot be worn
python3 serverdrape/run_pom2.py "$C" wear "$ALL"
python3 serverdrape/run_pom2.py "$M" wear "$H:10"
python3 serverdrape/run_pom2.py "$R" light "$H:10,$H:14" 144 -- --massscale 0.727   # 120 gsm against the preset's 165
python3 serverdrape/run_pom2.py "$R" heavy "$H:10,$H:14" 144 -- --massscale 1.212   # 200 gsm
python3 serverdrape/run_pom2.py "$R" repeat "$H:10,$H:14"                           # run-to-run noise
FLOOR_CM=0 python3 serverdrape/run_pom2.py "$R" floor0 "$H:10,$H:14"                # the floor where it is
python3 serverdrape/run_pom2.py "$R" long "$H:10" 288                               # does it stay at rest?
python3 serverdrape/pom2_measure.py drapes "$R" wear "$ALL,$OWN,t-1.00:16" --json "$R/measure-wear.json" > /dev/null
python3 serverdrape/pom2_measure.py drapes "$C" wear "$ALL" --json "$C/measure-wear.json" > /dev/null
python3 serverdrape/pom2_measure.py drapes "$M" wear "$H:10" --json "$M/measure-wear.json" > /dev/null
for s in light heavy repeat floor0; do python3 serverdrape/pom2_measure.py drapes "$R" $s "$H:10,$H:14" --json "$R/measure-$s.json" > /dev/null; done
python3 serverdrape/pom2_measure.py drapes "$R" long "$H:10" --json "$R/measure-long.json" > /dev/null
for s in 8 10 12 14 16; do python3 serverdrape/pom2_measure.py blend "$R" wear $s; done | tee "$R/blend.jsonl"
[ -n "${RENDERS:-}" ] || { echo "measurements in $R/measure-*.json; set RENDERS=<dir> for the review renders"; exit 0; }
mkdir -p "$RENDERS"
V1=out/serverdrape-pom-v1   # section 8's drapes (band force 3 x, set measured+f3p), copied from the earlier run if present
r() { python3 serverdrape/render_pom2.py "$@"; }
T="ESTIMATE (simulation, not a photo). POM v2: band PLACED 2 cm under the navel (rule), gathered into the band, no slit.|Cloth ASSUMED. Body on a plinth so the hem hangs free."
for v in front side; do
  r "$RENDERS/pom2-all-$v.png" $v "$T Held-out body, hip 100." "$R:wear:$H:8:auto" "$R:wear:$H:10:auto" "$R:wear:$H:12:auto" "$R:wear:$H:14:auto" "$R:wear:$H:16:auto"
  r "$RENDERS/pom2-own-$v.png" $v "$T Each size on its own chart body." "$R:wear:t-1.00:8:auto" "$R:wear:t-0.50:10:auto" "$R:wear:t+0.00:12:auto" "$R:wear:t+0.50:14:auto" "$R:wear:t+1.00:16:auto"
  r "$RENDERS/pom2-tube-vs-cone-$v.png" $v "$T |Top edge = hip girth: straight tube to the hip line (ASSUMED default) against one cone." \
    "$R:wear:$H:8:auto|TUBE" "$C:wear:$H:8:auto|CONE" "$R:wear:$H:14:auto|TUBE" "$C:wear:$H:14:auto|CONE"
  if [ -d "$V1/drapes/measured+f3p" ]; then
    r "$RENDERS/pom2-v1-vs-v2-$v.png" $v "ESTIMATE (simulation, not a photo). Held-out body, hip 100. Cloth ASSUMED.|Left three: POM v1 (band held by an ASSUMED force 3 x weight, plain cone). Right three: POM v2 (band placed by rule, gathered)." \
      "$V1:measured+f3p:$H:8:v1 AU 8 measured" "$V1:measured+f3p:$H:14:v1 AU 14 measured" "$V1:measured+f3p:$H:16:v1 AU 16 EXTRAPOLATED" \
      "$R:wear:$H:8:auto|v2" "$R:wear:$H:14:auto|v2" "$R:wear:$H:16:auto|v2"
  fi
done
r "$RENDERS/pom2-gathers-close.png" front "ESTIMATE. POM v2 close-up, raking light: the gathers under the band. Fold pitch at the seam is ASSUMED." \
  "$R:wear:$H:8:auto" "$R:wear:$H:10:auto" "$R:wear:$H:14:auto" --close
r "$RENDERS/pom2-weight-front.png" front "$T |AU 10 at three fabric weights (stiffness unchanged): 120 / 165 (preset) / 200 gsm, all ASSUMED." \
  "$R:light:$H:10:auto|120 gsm" "$R:wear:$H:10:auto|165 gsm (preset)" "$R:heavy:$H:10:auto|200 gsm"
r "$RENDERS/pom2-floor-front.png" front "ESTIMATE. POM v2 with the floor where it is (168 cm body, barefoot):|the 103-104 cm skirt reaches the floor. Cloth ASSUMED." \
  "$R:floor0:$H:10:auto" "$R:floor0:$H:14:auto" --floor 0
r "$RENDERS/pom2-edge-cases-front.png" front "$T|Edge cases of the wear rule." \
  "$R:wear:t+1.00:8:auto" "$R:wear:t-1.00:16:auto" "$R:wear:t+1.00:16:auto"
