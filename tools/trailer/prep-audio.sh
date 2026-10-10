#!/bin/sh
# prep-audio.sh : the voice-over cut from the game's own lines, every effect peak-normalised to -1 dBFS
# (sfxn/), a sub drop and a reverse swell for the title. Run export-sounds.mjs first.
W=${TRAILER_WORK:-${TMPDIR:-/tmp}/varanasi-trailer}
A="$(cd "$(dirname "$0")/../.." && pwd)/public/assets/audio"
cd "$W" || exit 1
mkdir -p vo sfxn
vo() { # name file start end
  ffmpeg -v error -y -i "$2" -af "atrim=$3:$4,asetpts=PTS-STARTPTS,highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=8:release=200,afade=t=in:d=0.02,areverse,afade=t=in:d=0.12,areverse,loudnorm=I=-16:TP=-2:LRA=7" -ar 48000 -ac 2 vo/$1.wav
}
vo v1 "$A/kashi-older-than-history-the-city-of-lig-cmuyhulu.mp3" 0 5.55
vo v2 "$A/kashi-older-than-history-the-city-of-lig-cmuyhulu.mp3" 6.1 11.75
vo v3 "$A/voice/ch1/meet-02.mp3" 0 3.3
vo v4 "$A/voice/ch1/meet-02.mp3" 3.5 8.55
vo v5 "$A/voice/ch1/meet-02.mp3" 8.6 13.23
vo v6 "$A/voice/ch5/rise-01.mp3" 0 11.74
vo v7 "$A/voice/ch5/legend.mp3" 18.9 23.01
vo v8 "$A/voice/ch5/rise-02.mp3" 0 2.71
# Prady's last line: warmer, closer, a little room around it
ffmpeg -v error -y -i vo/v8.wav -af "equalizer=f=180:t=q:w=1:g=2.5,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=-22dB:ratio=3.5:attack=5:release=180,aecho=0.85:0.55:70|140:0.22|0.12,apad=pad_dur=1.2,loudnorm=I=-15:TP=-2" -ar 48000 vo/v8fx.wav
# (the game's sound files are mastered at very different levels: blade-hit.mp3 peaks at -41 dBFS)
for f in "$A"/sfx/*.mp3 "$A"/single-brass-temple-bell-strike-with-lon-cmuyh92b.mp3 "$A"/sacred-conch-shell-shankh-blown-one-long-cmuyh94b.mp3 "$A"/magical-sacred-chime-shimmer-small-bead-cmuyh9bt.mp3 "$A"/wooden-oar-stroke-pulling-through-calm-r-cmuyhut0.mp3 sfx/*.wav; do
  n=$(basename "$f"); n=${n%.*}
  pk=$(ffmpeg -hide_banner -i "$f" -af volumedetect -f null - 2>&1 | grep max_volume | grep -oE "[-0-9.]+ dB" | grep -oE "[-0-9.]+")
  ffmpeg -v error -y -i "$f" -af "volume=$(echo "-1 - ($pk)" | bc -l)dB" -ar 48000 -ac 2 sfxn/$n.wav
done
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.95*sin(2*PI*(62*t-6.4*t*t))*exp(-1.25*t)|0.95*sin(2*PI*(62*t-6.4*t*t))*exp(-1.25*t)':s=48000:d=3.2" -af "lowpass=f=140,afade=t=in:d=0.004,afade=t=out:st=2.6:d=0.6" sfxn/sub.wav
ffmpeg -v error -y -i sfxn/slowmo-boom.wav -af "atrim=0:1.0,areverse,afade=t=in:d=0.6" sfxn/revswell.wav
echo "voice-over and effects ready in $W"
