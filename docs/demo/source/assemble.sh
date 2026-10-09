#!/usr/bin/env bash
# Records the three scenes from runs/*.jsonl (agent-scenes.mjs), then joins them into ../pattern-demo.mp4.
# Run from docs/demo/source with PLAYWRIGHT and CHROMIUM set (see agent-scenes.mjs).
set -euo pipefail
node agent-scenes.mjs
N="scale=1280:720,fps=30,format=yuv420p,setsar=1"
for i in 1 2 3; do ffmpeg -v error -y -ss 0.5 -i agent$i/*.webm -vf "$N" a$i.mp4; done
printf "file a1.mp4\nfile a2.mp4\nfile a3.mp4\n" > list.txt
ffmpeg -v error -y -f concat -i list.txt -c:v libx264 -crf 20 -preset medium -movflags +faststart ../pattern-demo.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 ../pattern-demo.mp4
