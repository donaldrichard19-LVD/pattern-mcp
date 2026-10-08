# Updating the Pattern demo video with live verdicts

`pattern-demo.mp4` currently shows the real website and the real enforcement gate, but no live `recommend_component` verdict, because it was recorded without API keys. This guide adds one by running Pattern against your design system with your Anthropic and Jev (TypeSafe) keys, then rebuilding the video.

Everything on screen should come from a real run. Don't hand-edit captured output; if you trim it for space, mark the cut with "…" as the existing scenes do.

## 1. Prerequisites

- Node 22 and `npm ci && npm run build` at the repo root.
- `ffmpeg` and Playwright with Chromium. Update the hard-coded import path (`/opt/node22/lib/node_modules/playwright/index.mjs`) at the top of `source/site2.mjs`, `source/term.mjs` and `source/cards.mjs` to where Playwright lives on your machine (`npm root -g` shows the global folder), or `npm i -D playwright` and import `playwright` normally.
- A components folder to score against (your own app's `src/components`, or any folder of `.tsx` files).

## 2. Set your keys

Put the keys in the repo's `.env` (already git-ignored), or export them in your shell:

```
ANTHROPIC_API_KEY=sk-ant-...
TYPESAFE_API_KEY=...        # the Jev key
```

Never paste a key into a file you commit or a command you record. Run `git status` before committing and confirm no `.env` appears.

Which scorer runs is controlled by `PATTERN_SCORER`:

| Setting | Behaviour |
| --- | --- |
| unset, both keys set | Jev scores first; Anthropic writes the gap list only when nothing fits (best for the demo: you can show both paths) |
| `jev` | Jev only, sub-second, no gap list |
| `anthropic` | Anthropic only |

Telemetry is off for the capture script (`PATTERN_TELEMETRY=0`) so demo runs don't reach production analytics.

## 3. Capture live verdicts

Edit `source/needs.json` if you want different component needs. The defaults are one that should come back `custom_build` and one that should come back `use_existing` against a typical library. Then, from the repo root:

```
export DEMO_COMPONENTS_DIR=/path/to/your/src/components
export DEMO_PROJECT_ID=booking-app      # optional, defaults to booking-app
node docs/demo/source/capture-live-verdicts.mjs
```

It registers your design system, calls `recommend_component` for each need, and writes `source/out/verdict-<label>.json` and `.txt`, plus `register.json`. The console prints the verdict and elapsed time per need. Check the files: if a need returned a different verdict than its label says, rename the label or change the need. Don't relabel to fit a story you want to tell.

Cost is a few cents per full check; Jev matches are sub-second.

## 4. Add the verdicts to the terminal scene

Run the following from `docs/demo/source`. `term.mjs` reads captured text from `out/`, so bring the existing gate output across without overwriting the new files:

```
cd docs/demo/source
cp -n terminal-output/*.txt out/
```

In `term.mjs`, add scenes to the `scenes` array before the gate scenes. Each scene is `{cap, cmd, out, ok|bad, pause}`. For example:

```js
{ cap:'Pattern checks the need against your design system', cmd:'recommend_component  "confirmation dialog with confirm and cancel actions"',
  out: trimmed('verdict-use-existing.json'), ok:true, pause:4500 },
```

The terminal window shows about 14 lines, so show the useful fields (verdict, confidence, coverage, the chosen component, the missing requirements) rather than the whole JSON. A small helper keeps that honest:

```js
const trimmed = (f) => { const j = JSON.parse(fs.readFileSync('out/'+f,'utf8'));
  const pick = {verdict:j.verdict, confidence:j.confidence, coverage:j.coverage, chosen:j.chosen_candidate ?? j.recommendation, missing:j.missing};
  return JSON.stringify(pick, null, 2); };
```

Check the real field names in your `.json` first and adjust. Fields you leave out should be ones you didn't capture, not ones you made up. You can also record an actual Claude Code session in a real terminal instead and drop that clip into step 6; this scene is just the quickest way to get a clean, readable shot.

## 5. Re-record the footage

From `docs/demo/source`:

```
rm -rf vid tvid
node site2.mjs     # website screen recording, writes vid/
node term.mjs      # terminal scenes, writes tvid/
node cards.mjs     # title and outro cards, writes c1.png and c2.png
```

Open `tvid/*.webm` after `term.mjs` and watch it once: scenes need a long enough `pause` to read the output.

## 6. Assemble and review

```
./assemble.sh
```

This writes `docs/demo/pattern-demo.mp4` (about 60 s, longer with the new scenes) and prints its duration. If you recorded your own clip, add it to `assemble.sh` as another normalized segment and to the `list.txt` order.

Before committing, watch the full video once and check that:

- no key, token or personal path is visible on screen;
- every verdict shown matches the `.json` in `source/out/`;
- the captions say what the footage shows (don't call a Jev-only result a full check).

Then update the "does not show a live verdict" paragraph in `docs/demo/README.md`, commit the new `pattern-demo.mp4`, and refresh the screenshots in `docs/demo/screenshots/` if the site changed. The `out/`, `vid/` and `tvid/` folders and the build intermediates are git-ignored.

## Troubleshooting

- **`Missing key` / 401:** `pattern doctor` and the capture script print which key is missing. A key that needs a workspace id also needs `ANTHROPIC_WORKSPACE_ID`.
- **Everything comes back `custom_build`:** the design system probably didn't register. Check `out/register.json` for a candidate count above zero.
- **Jev finds nothing and there's no gap list:** `PATTERN_SCORER=jev` skips Anthropic. Unset it, or set `PATTERN_SCORER=anthropic`, to get the requirements checklist.
- **Blank or cut-off terminal text:** shorten the output you print, or raise `pause` for the scene.
