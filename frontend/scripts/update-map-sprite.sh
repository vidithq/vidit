#!/usr/bin/env bash
# Vendors the OpenFreeMap icon sprite into public/map-sprites/, where the Vidit styles load it.
#
# OpenFreeMap publishes each sprite under a folder named by a hash of its content (ofm_<hash>) and
# keeps every published folder online. The script reads the current folder from OpenFreeMap's dark
# style and downloads the four files (1x and @2x, JSON and PNG) only when it differs from the one
# recorded in manifest.json, so a rerun with no new sprite changes no file.
#
# Usage, from frontend/: scripts/update-map-sprite.sh
set -euo pipefail

STYLE_URL="https://tiles.openfreemap.org/styles/dark"
SPRITE_PREFIX="https://tiles.openfreemap.org/sprites/"

OUT="$(cd "$(dirname "$0")/.." && pwd)/public/map-sprites"
MANIFEST="$OUT/manifest.json"

sprite="$(curl -fsSL "$STYLE_URL" | jq -er '.sprite | strings')"
if [[ "$sprite" != "$SPRITE_PREFIX"* ]]; then
  echo "unexpected sprite URL in $STYLE_URL: $sprite" >&2
  exit 1
fi

if [[ -f "$MANIFEST" && "$(jq -r '.sprite' "$MANIFEST")" == "$sprite" ]]; then
  echo "map sprite is current: $sprite"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for suffix in .json .png @2x.json @2x.png; do
  curl -fsSL -o "$tmp/ofm$suffix" "$sprite$suffix"
done
for json in "$tmp/ofm.json" "$tmp/ofm@2x.json"; do
  jq -e 'type == "object" and length > 0' "$json" >/dev/null
done
for png in "$tmp/ofm.png" "$tmp/ofm@2x.png"; do
  [[ "$(head -c 4 "$png" | tail -c 3)" == "PNG" ]] || { echo "not a PNG: $png" >&2; exit 1; }
done

mkdir -p "$OUT"
cp "$tmp"/ofm* "$OUT/"
jq -n --arg style "$STYLE_URL" --arg sprite "$sprite" '{style: $style, sprite: $sprite}' >"$MANIFEST"
echo "map sprite updated: $sprite"
