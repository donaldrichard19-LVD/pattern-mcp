# Pattern demo video

`pattern-demo.mp4` (about 53 s, 1280x720) shows the experience Pattern is for: you ask an agent to build UI, and the agent builds from your design system.

| Scene | You ask | What happens |
|---|---|---|
| 1 | "Create a Toast component..." | The agent asks Pattern first. Pattern finds `Snackbar` in the design system (`use_existing`), so the agent reuses it and writes no new component. |
| 2 | "Create PriceBreakdown.tsx..." | Nothing in the design system fits (`custom_build`). The agent reuses `Card`, builds only the missing line items, and Pattern verifies the file. |

## How it was made

- The runs are real: headless `claude -p` sessions in `sandbox/stayly` (a small booking app with 25 components), with Pattern 0.23.1 connected and the gate hook installed. Transcripts are in `source/runs/`.
- `source/agent-scenes.mjs` replays selected events from those transcripts in a terminal. Prompts, tool calls, verdicts and agent sentences are copied from the runs. Long agent text is cut to its first sentence(s) and routine tool calls (`ls`, `cat`, `ToolSearch`) are left out.
- Takes were selected. Reuse: 3 attempts, 1 where the agent consulted Pattern (the others reused `Snackbar` without calling Pattern). Gap: 2 attempts, both consulted Pattern, the one without the agent skill was used. One earlier attempt did not block only because my own earlier runs had left a ledger entry for the same path; later takes use a fresh project id.

## Things the footage shows that are worth knowing

- With the MCP server connected, the agent often checks Pattern on its own, and often reuses a component it spots by name without calling Pattern at all. A third scene, where the gate blocks a skipped check, was recorded and cut; see the repo history for its transcript.
- Scene 1's verdict is `use_existing` with **low** confidence and 6 of 8 requirements met. Two of the unmet ones are wrong (Snackbar is already fixed to the bottom and has `role="status"`).

## Regenerate

From `docs/demo/source`, set `PLAYWRIGHT` (a playwright-core `index.mjs`) and `CHROMIUM`, then run `./assemble.sh` (needs `ffmpeg`). To record new runs, `cd ../sandbox/stayly`, register `src/components` as project `stayly-demo`, set `DEMO_PATTERN_KEY` to an Anthropic key, and run `claude -p` with `--mcp-config .mcp.json`.
