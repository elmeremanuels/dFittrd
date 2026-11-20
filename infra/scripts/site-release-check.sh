#!/usr/bin/env bash
# Is <dir> a site *release* build? Only `pnpm --filter @curtain/site build:release` with every launch gate
# closed writes <dir>/curtain-release.txt, with the sha256 of index.html and 404.html. A preview build (the
# plain `build`, also run by `pnpm check`) has no marker and its launch gates may be open (docs/SITE.md), so
# the deploy refuses to publish it. Used by scripts/deploy.sh (laptop or runner) and infra/scripts/deploy.sh.
#   infra/scripts/site-release-check.sh <dir>   exit 0 = release build, 1 = not (reason on stderr)
set -euo pipefail
dir="${1:?usage: $0 <site dir>}"
marker="$dir/curtain-release.txt"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else echo "site-release-check: no sha256sum or shasum" >&2; return 1
  fi
}

for f in index.html 404.html; do
  [ -f "$dir/$f" ] || { echo "site-release-check: no $f in $dir (not a site build)" >&2; exit 1; }
done
if [ ! -f "$marker" ]; then
  echo "site-release-check: $dir is not a release build (no curtain-release.txt): build it with 'pnpm --filter @curtain/site build:release', which refuses while a launch gate is open (docs/SITE.md)" >&2
  exit 1
fi
[ "$(head -n 1 "$marker")" = "curtain-site-release 1" ] || { echo "site-release-check: $marker is not a release marker" >&2; exit 1; }
for f in index.html 404.html; do
  want="$(awk -v f="$f" '$1 == f { print $2 }' "$marker")"
  have="$(sha256 "$dir/$f")"
  if [ -z "$want" ] || [ "$want" != "$have" ]; then
    echo "site-release-check: $dir/$f does not match the release marker (changed after build:release?)" >&2
    exit 1
  fi
done
