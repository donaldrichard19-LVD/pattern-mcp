# Pattern demo video

`pattern-demo.mp4` (about 60 s, 1280x720) is built from real footage:

- **Website:** a Playwright screen recording of https://usepattern.sh (hero, verdict card tabs, scroll through the sections).
- **Terminal:** the real `pattern-check-gate` commands from this repo's build, run against a throwaway `booking-app` project. The output shown is captured verbatim in `source/terminal-output/` (the `init` JSON body is abbreviated with "…" on screen). The commands are `init`, the Claude Code PreToolUse hook denying a new component with no decision on record, the `// pattern-mcp:override` path, and `verify` failing then passing in CI.

It does not show a live `recommend_component` verdict. That needs an Anthropic API key, which the recording environment did not have, so nothing in the video is simulated.

To regenerate, run the scripts in `source/` with Playwright and ffmpeg available (the Playwright import path is hard-coded for the recording environment).
