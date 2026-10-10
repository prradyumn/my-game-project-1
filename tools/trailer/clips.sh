#!/bin/sh
# clips.sh [shot ...] : $TRAILER_WORK/frames/<shot> -> clips/<shot>.mp4 (30 fps). Takes recorded with 60 Hz
# sub-frames (render.mjs name:blur) are blended in pairs: a 180-degree shutter's motion blur.
W=${TRAILER_WORK:-${TMPDIR:-/tmp}/varanasi-trailer}
cd "$W" || exit 1
mkdir -p clips
for s in ${@:-$(ls frames)}; do
  [ -f frames/$s/meta.json ] || continue
  if grep -q '"blur":true' frames/$s/meta.json; then
    ffmpeg -v error -y -framerate 60 -i frames/$s/%05d.jpg -vf "tmix=frames=2:weights='1 1',select='mod(n\,2)',setpts=N/30/TB" -r 30 -c:v libx264 -preset slow -crf 13 -pix_fmt yuv420p clips/$s.mp4
  else
    ffmpeg -v error -y -framerate 30 -i frames/$s/%05d.jpg -c:v libx264 -preset slow -crf 13 -pix_fmt yuv420p clips/$s.mp4
  fi
  # a sheet: a frame every 0.5 s, 8 a row (row r, column c = r * 4 + c * 0.5 s)
  ffmpeg -v error -y -i clips/$s.mp4 -vf "fps=2,scale=320:-1,tile=8x4" -frames:v 1 clips/$s.tl.jpg
  echo "$s -> clips/$s.mp4"
done
