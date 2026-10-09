#!/usr/bin/env bash
# Builds ../pattern-demo.mp4 from the recordings made by site2.mjs (vid/), term.mjs (tvid/) and cards.mjs (c1.png, c2.png).
# Run from docs/demo/source. Adjust the -ss/-t trim values if your site recording differs.
set -euo pipefail
N="scale=1280:720,fps=30,format=yuv420p,setsar=1"
ffmpeg -v error -y -loop 1 -t 3 -i c1.png -vf "$N,fade=in:0:10" s0.mp4
ffmpeg -v error -y -ss 1.5 -t 8 -i vid/*.webm -vf "$N" s1.mp4
ffmpeg -v error -y -ss 9.5 -t 18 -i vid/*.webm -vf "setpts=PTS/1.5,$N" s2.mp4
ffmpeg -v error -y -i tvid/*.webm -vf "$N" s3.mp4
ffmpeg -v error -y -loop 1 -t 4 -i c2.png -vf "$N,fade=out:90:30" s4.mp4
printf "file s0.mp4\nfile s1.mp4\nfile s2.mp4\nfile s3.mp4\nfile s4.mp4\n" > list.txt
ffmpeg -v error -y -f concat -i list.txt -c:v libx264 -crf 20 -preset medium -movflags +faststart ../pattern-demo.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 ../pattern-demo.mp4

# Live-verdict scene (steps 6-7): run capture-live-verdicts.mjs, then verdict.mjs (writes tvid2/), then splice it in before the 4 s end card.
# N is the same normalisation filter used above; the 55.5 s split point is where the end card (c2.png) begins.
if [ -d tvid2 ]; then
  cp ../pattern-demo.mp4 base.mp4
  ffmpeg -v error -y -t 55.5 -i base.mp4 -vf "$N" a.mp4
  ffmpeg -v error -y -i tvid2/*.webm -vf "$N" v.mp4
  ffmpeg -v error -y -ss 55.5 -i base.mp4 -vf "$N" b.mp4
  printf "file a.mp4\nfile v.mp4\nfile b.mp4\n" > l2.txt
  ffmpeg -v error -y -f concat -i l2.txt -c:v libx264 -crf 20 -preset medium -movflags +faststart ../pattern-demo.mp4
  ffprobe -v error -show_entries format=duration -of csv=p=0 ../pattern-demo.mp4
fi
