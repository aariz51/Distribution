#!/usr/bin/env bash
# Stage a promo project's real output into public/demo for the marketing site.
# Videos are re-encoded small and muted; the page is a shop window, not delivery.
#
#   ./scripts/stage-demo.sh ../../storage/promo/<projectId>
set -euo pipefail
SRC="${1:?usage: stage-demo.sh <promo project dir>}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/demo"
mkdir -p "$OUT"

for f in promo_vertical promo_landscape promo_store_portrait-appstore; do
  ffmpeg -v error -y -i "$SRC/out/$f.mp4" \
    -vf "scale='min(720,iw)':-2" -c:v libx264 -crf 30 -preset veryfast \
    -movflags +faststart -an "$OUT/$f.mp4"
done

cp "$SRC/out/promo_vertical.png"  "$OUT/poster-vertical.png"
cp "$SRC/out/promo_landscape.png" "$OUT/poster-landscape.png"
cp "$SRC/CREATIVE_DIRECTION.md"   "$OUT/CREATIVE_DIRECTION.md"
cp "$SRC/storyboard.json"         "$OUT/storyboard.json"

du -sh "$OUT"
