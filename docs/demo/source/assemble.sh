#!/usr/bin/env bash
# Builds ../pattern-demo.mp4 from: vid/ (site2.mjs), tvid/ (term.mjs, gate steps 1-5) and tvid2/ (verdict.mjs, steps 6-7).
# The video opens on the website and ends on the last verdict; there are no intro or end cards.
# Run from docs/demo/source. Adjust the -ss/-t trim values if your site recording differs.
set -euo pipefail
N="scale=1280:720,fps=30,format=yuv420p,setsar=1"
ffmpeg -v error -y -ss 1.5 -t 8 -i vid/*.webm -vf "$N" s1.mp4
ffmpeg -v error -y -ss 9.5 -t 18 -i vid/*.webm -vf "setpts=PTS/1.5,$N" s2.mp4
ffmpeg -v error -y -i tvid/*.webm -vf "$N" s3.mp4
ffmpeg -v error -y -i tvid2/*.webm -vf "$N" s4.mp4
printf "file s1.mp4\nfile s2.mp4\nfile s3.mp4\nfile s4.mp4\n" > list.txt
ffmpeg -v error -y -f concat -i list.txt -c:v libx264 -crf 20 -preset medium -movflags +faststart ../pattern-demo.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 ../pattern-demo.mp4
