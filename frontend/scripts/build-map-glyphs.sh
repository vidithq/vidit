#!/usr/bin/env bash
# Builds the MapLibre glyph ranges in public/map-glyphs/ with maplibre/font-maker, inside Docker.
#
# Each fontstack is Montserrat merged with Noto Sans fonts: font-maker takes a glyph from the first
# font that has it, so Montserrat draws every character it covers and Noto fills the scripts it
# lacks. MapLibre fetches one URL per fontstack, which static hosting cannot merge at request time.
# Arabic, Hebrew and the scripts that need complex shaping are left out: the style shows their
# Latin name instead (`is-supported-script` in basemap.ts). CJK renders from a local system font
# (`localIdeographFontFamily`), so no ideograph glyph is fetched.
#
# Every source is pinned to a commit, so a rerun reproduces the committed files.
#
# Usage, from frontend/: scripts/build-map-glyphs.sh
set -euo pipefail

FONT_MAKER_REF=714ccaea67d384717890a3c2c27143dfdd4189b7
MONTSERRAT_REF=555facfb2a18c72c3c0380f0d9c0f060453a9058
NOTO_REF=31c61988e76a48706c4a96a872fc3178dbd82121

# Fallback families, in priority order. A family with no Medium cut falls back to its Regular.
NOTO_FAMILIES="NotoSans NotoSansArmenian NotoSansGeorgian NotoSansEthiopic NotoSansThai NotoSansLao"

OUT="$(cd "$(dirname "$0")/.." && pwd)/public/map-glyphs"
rm -rf "$OUT"
mkdir -p "$OUT"

docker run --rm \
  -e FONT_MAKER_REF="$FONT_MAKER_REF" \
  -e MONTSERRAT_REF="$MONTSERRAT_REF" \
  -e NOTO_REF="$NOTO_REF" \
  -e NOTO_FAMILIES="$NOTO_FAMILIES" \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -v "$OUT:/out" \
  debian:bookworm-slim \
  bash -euo pipefail -c '
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends \
      ca-certificates curl git cmake make clang libboost-dev libfreetype-dev >/dev/null

    git clone -q https://github.com/maplibre/font-maker /src
    cd /src
    git checkout -q "$FONT_MAKER_REF"
    git submodule -q update --init
    cmake -DCMAKE_BUILD_TYPE=Release . >/dev/null
    make >/dev/null

    mkdir /fonts /build
    montserrat=https://raw.githubusercontent.com/JulietaUla/Montserrat/$MONTSERRAT_REF
    noto=https://raw.githubusercontent.com/notofonts/notofonts.github.io/$NOTO_REF/fonts
    curl -sSfL "$montserrat/OFL.txt" -o /out/OFL-Montserrat.txt
    curl -sSfL "$noto/LICENSE" -o /out/OFL-Noto.txt

    for weight in Regular Medium; do
      faces=(/fonts/Montserrat-$weight.ttf)
      curl -sSfL "$montserrat/fonts/ttf/Montserrat-$weight.ttf" -o "${faces[0]}"
      for family in $NOTO_FAMILIES; do
        file=/fonts/$family-$weight.ttf
        if ! curl -sSfL "$noto/$family/hinted/ttf/$family-$weight.ttf" -o "$file" 2>/dev/null; then
          file=/fonts/$family-Regular.ttf
          [ -f "$file" ] || curl -sSfL "$noto/$family/hinted/ttf/$family-Regular.ttf" -o "$file"
        fi
        faces+=("$file")
      done
      # font-maker refuses an existing output directory, and the mounted /out always exists.
      ./font-maker --name "Montserrat $weight" "/build/$weight" "${faces[@]}"
      cp -r "/build/$weight/Montserrat $weight" /out/
    done

    chown -R "$HOST_UID:$HOST_GID" /out
  '

du -sh "$OUT"
