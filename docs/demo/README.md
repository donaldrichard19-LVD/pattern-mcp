# Pattern demo video

`pattern-demo.mp4` (about 61 s, 1280x720, plays at 0.75x, no website intro or end card) is built from real footage:

- **Terminal:** the real `pattern-check-gate` commands from this repo's build, run against a throwaway `booking-app` project. The output shown is captured verbatim in `source/terminal-output/` (the `init` JSON body is abbreviated with "…" on screen). The commands are `init`, the Claude Code PreToolUse hook denying a new component with no decision on record, the `// pattern-mcp:override` path, and `verify` failing then passing in CI.

- **Live verdicts (steps 6 and 7):** two real `recommend_component` calls against this repo's own `website/components` registered as project `pattern-website` (`use_existing` for a tab switcher, `custom_build` for a date range picker). The numbers on screen are read from `source/out/verdict-*.json`, written by `capture-live-verdicts.mjs`; `verdict.mjs` renders them. The Jev scorer reports cost as unknown, so the first verdict shows `n/a`.

Nothing in the video is simulated.

To regenerate, run the scripts in `source/` with Playwright and ffmpeg available (the Playwright import path is hard-coded for the recording environment).

To refresh the verdict scene: `npm run build`, then `DEMO_COMPONENTS_DIR=website/components DEMO_PROJECT_ID=pattern-website node docs/demo/source/capture-live-verdicts.mjs` (keys from the environment or `.env`; the directory must be inside the repo), then, from `docs/demo/source`, run `term.mjs` and `verdict.mjs` (set `PLAYWRIGHT` and `CHROMIUM` to your Playwright module and Chrome paths) and `assemble.sh`.
