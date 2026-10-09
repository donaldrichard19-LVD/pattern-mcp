// Records the live-verdict scene (tvid2/) from out/verdict-*.json, written by capture-live-verdicts.mjs.
// PLAYWRIGHT=/path/to/playwright-core/index.mjs CHROMIUM=/path/to/chrome node verdict.mjs  (run from docs/demo/source)
import fs from 'fs';
const { chromium } = await import(process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const need = JSON.parse(fs.readFileSync('needs.json', 'utf8'));
const verdict = l => JSON.parse(fs.readFileSync(`out/verdict-${l}.json`, 'utf8'));
const cost = v => (v._meta?.estimated_cost_usd ? `$${v._meta.estimated_cost_usd}` : 'n/a (Jev scorer)');

const scene = (label, cap) => {
  const n = need.find(x => x.label === label), v = verdict(label);
  const m = v.design_system_match ?? v.jev_screen?.closest;
  const lines = [
    `verdict:     ${v.verdict}   (confidence: ${v.confidence})`,
    `closest:     ${m.file}  ·  score ${m.score}`,
    v.verdict === 'use_existing' ? `reuse:       ${v.recommendation.component_description}` : `build:       nothing in the design system fits`,
    `latency:     ${v._meta.total_ms} ms  ·  cost ${cost(v)}`,
  ];
  return {
    cap,
    cmd: `recommend_component  component_need="${n.component_need}"  project_id=pattern-website`,
    out: lines.join('\n'),
    ok: v.verdict === 'use_existing',
    pause: 4500,
  };
};
const scenes = [
  scene('use-existing', '6 · Ask first. Pattern finds your tab switcher and says reuse it||Your agent uses what your product already has.'),
  scene('custom-build', '7 · Nothing fits a date picker, so Pattern says build it||Your team builds only what is actually missing.'),
];

const html = `<!doctype html><meta charset=utf8><style>
body{margin:0;background:#0b0f14;font-family:'Inter',system-ui,sans-serif;color:#e6edf3;height:720px;overflow:hidden}
#cap{height:96px;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:0 56px;background:#fff;color:#0b0f14;border-bottom:1px solid #e5e8ec}#cap b{font-size:30px;font-weight:600;letter-spacing:-.01em}#cap span{font-size:21px;color:#5b6572}
#win{margin:28px 56px;height:520px;border-radius:12px;background:#111821;border:1px solid #243040;box-shadow:0 20px 50px #0008;overflow:hidden}
#bar{height:36px;background:#1a2330;display:flex;align-items:center;gap:8px;padding:0 14px;color:#8aa;font:13px ui-monospace,monospace}
#bar i{width:12px;height:12px;border-radius:50%;display:inline-block}
#t{padding:20px 26px;font:20px/1.5 ui-monospace,'DejaVu Sans Mono',monospace;white-space:pre-wrap;word-break:break-word}
.p{color:#6ea8ff}.ok{color:#56d364}.warn{color:#ffbd2e}
</style><div id=cap></div><div id=win><div id=bar><i style=background:#ff5f56></i><i style=background:#ffbd2e></i><i style=background:#27c93f></i><span style="margin-left:10px">pattern-website — MCP tool call</span></div><div id=t></div></div>`;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: 'tvid2', size: { width: 1280, height: 720 } } });
const p = await ctx.newPage();
await p.setContent(html);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
await p.waitForTimeout(600);
for (const s of scenes) {
  await p.evaluate(c => { const [h, w] = c.split('||'); document.getElementById('cap').innerHTML = '<b>' + h + '</b><span>' + w + '</span>'; document.getElementById('t').innerHTML = ''; }, s.cap);
  await p.waitForTimeout(500);
  let typed = '';
  for (const ch of s.cmd) {
    typed += ch;
    await p.evaluate(h => (document.getElementById('t').innerHTML = h), `<span class=p>&gt; </span>${esc(typed)}`);
    await p.waitForTimeout(ch === ' ' ? 22 : 14);
  }
  await p.waitForTimeout(500);
  await p.evaluate(([o, c]) => { document.getElementById('t').innerHTML += '\n\n<span class="' + c + '">' + o + '</span>'; }, [esc(s.out), s.ok ? 'ok' : 'warn']);
  await p.waitForTimeout(s.pause);
}
await ctx.close();
await b.close();
