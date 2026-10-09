#!/usr/bin/env bash
# Builds ../pattern-demo.mp4 from tvid/ (term.mjs, gate steps 1-5) and tvid2/ (verdict.mjs, steps 6-7).
# The video opens on step 1 (no website intro, no cards) and plays at 0.75x so the captions and terminal output are easy to read.
# Run from docs/demo/source. SLOW=1 plays at full speed.
set -euo pipefail
N="scale=1280:720,fps=30,format=yuv420p,setsar=1"
S="${SLOW:-0.75}"
ffmpeg -v error -y -ss 0.6 -i tvid/*.webm -vf "$N" s1.mp4
ffmpeg -v error -y -i tvid2/*.webm -vf "$N" s2.mp4
printf "file s1.mp4\nfile s2.mp4\n" > list.txt
ffmpeg -v error -y -f concat -i list.txt -vf "setpts=PTS/$S,fps=30" -c:v libx264 -crf 20 -preset medium -movflags +faststart ../pattern-demo.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 ../pattern-demo.mp4
