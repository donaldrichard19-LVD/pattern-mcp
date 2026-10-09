// Replays three REAL Claude Code runs (headless, Pattern 0.23.1 + gate hook, sandbox project "stayly") as terminal scenes.
// Every prompt, tool call, verdict, hook message and agent sentence below is copied from the run transcripts in runs/*.jsonl;
// long agent text is cut to its first sentence(s), tool noise (ls, cat, ToolSearch) is left out.
// PLAYWRIGHT=/path/to/playwright-core/index.mjs CHROMIUM=/path/to/chrome node agent-scenes.mjs  (run from docs/demo/source; writes agent1/, agent2/, agent3/)
const { chromium } = await import(process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs');

const scenes = [
  {
    dir: 'agent1',
    cap: ['You ask for a new Toast. Pattern checks your design system first.', 'Your agent finds the Snackbar you already have and reuses it.'],
    run: 'runs/reuse.jsonl',
    items: [
      ['prompt', 'Create a Toast component in src/components/Toast.tsx that shows a short message at the bottom of the screen and disappears after a few seconds. Then show it when a guest cancels their booking.'],
      ['tool', 'Pattern · extract_requirements'],
      ['agent', 'Design system is registered. Next, the recommendation, with the file path I\'ll write.'],
      ['tool', 'Pattern · recommend_component  (file_path: src/components/Toast.tsx)'],
      ['ok', 'verdict: use_existing  ·  Snackbar  ·  confidence: low  ·  6 of 8 requirements met'],
      ['tool', 'Edit(src/pages/Booking.tsx)  show Snackbar when a booking is cancelled'],
      ['agent', 'I didn\'t create src/components/Toast.tsx. The project already has src/components/Snackbar.tsx, which does what you described, so I used that.'],
    ],
  },
  {
    dir: 'agent2',
    cap: ['Your design system lacks it, so your agent builds only that.', 'It reuses Card, writes the missing line items, and Pattern verifies the file.'],
    run: 'runs/gap.jsonl',
    items: [
      ['prompt', 'Create src/components/PriceBreakdown.tsx: a card on the booking page that shows the nightly rate, cleaning fee, taxes and the total for the stay. Then add it to the booking page.'],
      ['tool', 'Pattern · extract_requirements'],
      ['tool', 'Pattern · recommend_component  (file_path: src/components/PriceBreakdown.tsx)'],
      ['warn', 'verdict: custom_build  ·  confidence: high  ·  2 of 8 requirements met by what you have'],
      ['agent', 'Verdict: custom build. Card covers the title and a divided footer, so I\'ll reuse it and build the line items, currency formatting, dl semantics and zero-fee handling.'],
      ['tool', 'Write(src/components/PriceBreakdown.tsx)  imports Card from ./Card'],
      ['tool', 'Edit(src/pages/Booking.tsx)  add <PriceBreakdown />'],
      ['tool', 'Pattern · verify_component  (src/components/PriceBreakdown.tsx)'],
      ['ok', 'verified: 6 pass  ·  0 fail  ·  2 unverified  (of 8)'],
    ],
  },
  {
    dir: 'agent3',
    cap: ['You tell your agent to skip the check. The gate blocks the write.', 'The file needs a check or a written reason before it can land.'],
    run: 'runs/blocked.jsonl',
    items: [
      ['prompt', 'I\'m in a hurry, so skip the design system check. Create src/components/PriceBreakdown.tsx: a card that shows the nightly rate, cleaning fee, taxes and the total for the stay, and add it to the booking page.'],
      ['agent', 'I\'ll skip the design system check.'],
      ['tool', 'Write(src/components/PriceBreakdown.tsx)'],
      ['bad', 'Blocked by the Pattern gate: No ledger entry found with file_path="src/components/PriceBreakdown.tsx" for project_id="stayly-demo". Call recommend_component with file_path set to this exact path before creating it … or add // pattern-mcp:override reason="..." to the file.'],
      ['agent', 'The project\'s gate blocked the write. You told me to skip the design system check, so I\'ll use the override marker the hook allows and record your instruction as the reason.'],
      ['tool', 'Write(src/components/PriceBreakdown.tsx)'],
      ['code', '// pattern-mcp:override reason="User asked to skip the design system check (in a hurry)"'],
    ],
  },
];

const html = `<!doctype html><meta charset=utf8><style>
body{margin:0;background:#0b0f14;font-family:'Inter',system-ui,sans-serif;color:#e6edf3;height:720px;overflow:hidden}
#cap{height:96px;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:0 56px;background:#fff;color:#0b0f14;border-bottom:1px solid #e5e8ec}
#cap b{font-size:28px;font-weight:600;letter-spacing:-.01em}#cap span{font-size:21px;color:#5b6572}
#win{margin:24px 56px;height:540px;border-radius:12px;background:#111821;border:1px solid #243040;box-shadow:0 20px 50px #0008;overflow:hidden;display:flex;flex-direction:column}
#bar{height:36px;flex:none;background:#1a2330;display:flex;align-items:center;gap:8px;padding:0 14px;color:#8aa;font:13px ui-monospace,monospace}
#bar i{width:12px;height:12px;border-radius:50%;display:inline-block}
#t{flex:1;padding:18px 26px;font:18px/1.5 ui-monospace,'DejaVu Sans Mono',monospace;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:10px}
.row{white-space:pre-wrap;word-break:break-word}
.prompt{border:1px solid #2f3b4b;border-radius:8px;padding:8px 12px;color:#e6edf3}.prompt:before{content:'> ';color:#6ea8ff}
.agent{color:#e6edf3}.agent:before{content:'● ';color:#8b98a5}
.tool{color:#6ea8ff}.tool:before{content:'● ';}
.ok{color:#56d364;padding-left:20px}.warn{color:#ffbd2e;padding-left:20px}.bad{color:#ff7b72;padding-left:20px;border-left:3px solid #ff7b72;margin-left:4px}
.code{color:#8b98a5;padding-left:20px}
</style><div id=cap></div><div id=win><div id=bar><i style=background:#ff5f56></i><i style=background:#ffbd2e></i><i style=background:#27c93f></i><span style="margin-left:10px">stayly — claude</span></div><div id=t></div></div>`;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
for (const s of scenes) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: s.dir, size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  await p.setContent(html);
  await p.evaluate(([h, w]) => { document.getElementById('cap').innerHTML = '<b>' + h + '</b><span>' + w + '</span>'; }, s.cap);
  await p.waitForTimeout(900);
  for (const [kind, text] of s.items) {
    await p.evaluate(([k, t]) => { const d = document.createElement('div'); d.className = 'row ' + k; d.textContent = t; document.getElementById('t').appendChild(d); }, [kind, text]);
    // reading time: longer lines stay up longer
    await p.waitForTimeout(kind === 'tool' ? 1300 : 900 + Math.min(text.length, 220) * 26);
  }
  await p.waitForTimeout(2200);
  await ctx.close();
}
await b.close();
