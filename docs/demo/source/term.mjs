const { chromium } = await import(process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
import fs from 'fs';
const rd=f=>fs.readFileSync('terminal-output/'+f,'utf8').replace(/\nexit=\d+\n?$/,'\n').trimEnd();
const rdExit=f=>fs.readFileSync('terminal-output/'+f,'utf8').match(/exit=(\d+)/)?.[1];
const init=["Setting up Pattern's enforcement boundary (hook + CI gate)...",'','  Creating .claude/settings.json:','    { "matcher": "Edit|Write", … "command": "npx --yes -p pattern-mcp pattern-check-gate-hook" }','  Written.','','Done. Review the changes with `git status` / `git diff`, then commit when ready.'].join('\n');
const scenes=[
 {cap:'1 · Turn on the gate with one command||Every agent on the project now has to check Pattern before it builds.', cmd:'npx -p pattern-mcp pattern-check-gate init --yes', out:init, ok:true, pause:2200},
 {cap:'2 · Your agent skips the check, so the hook blocks the write||Nothing new gets built until Pattern compares it with your design system.', cmd:'# Claude Code PreToolUse hook  ←  Write src/components/PriceBreakdown.tsx', out:'permissionDecision: "deny"\n'+rd('deny-reason.txt'), bad:true, pause:4200},
 {cap:'3 · Your agent records a decision or leaves a reason for you||Each call lands in the ledger, so you can audit it later.', cmd:'// pattern-mcp:override reason="Prototype for design review; will be checked before merge"\n# Write src/components/PriceBreakdown.tsx  → hook', out:'allowed  ·  receipt written to .pattern/receipts/', ok:true, pause:3000},
 {cap:'4 · A PR with a new component and no receipt fails CI||CI holds the same rule at merge, so nothing ships unchecked.', cmd:'pattern-check-gate verify --files src/components/PriceBreakdown.tsx', out:rd('verify-fail.txt')+'\n[exit '+rdExit('verify-fail.txt')+']', bad:true, pause:3800},
 {cap:'5 · Commit the receipt and the same check passes||The receipt shows what your agent decided, and you can verify it any time.', cmd:'pattern-check-gate verify --files src/components/PriceBreakdown.tsx', out:rd('verify-pass.txt')+'\n[exit '+rdExit('verify-pass.txt')+']', ok:true, pause:3800},
];
const html=`<!doctype html><meta charset=utf8><style>
body{margin:0;background:#0b0f14;font-family:'Inter',system-ui,sans-serif;color:#e6edf3;height:720px;overflow:hidden}
#cap{height:96px;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:0 56px;background:#fff;color:#0b0f14;border-bottom:1px solid #e5e8ec}#cap b{font-size:30px;font-weight:600;letter-spacing:-.01em}#cap span{font-size:21px;color:#5b6572}
#win{margin:28px 56px;height:520px;border-radius:12px;background:#111821;border:1px solid #243040;box-shadow:0 20px 50px #0008;overflow:hidden}
#bar{height:36px;background:#1a2330;display:flex;align-items:center;gap:8px;padding:0 14px;color:#8aa;font:13px ui-monospace,monospace}
#bar i{width:12px;height:12px;border-radius:50%;display:inline-block}
#t{padding:20px 26px;font:20px/1.5 ui-monospace,'DejaVu Sans Mono',monospace;white-space:pre-wrap;word-break:break-word}
.p{color:#6ea8ff}.bad{color:#ff7b72}.ok{color:#56d364}.c{color:#8b98a5}
</style><div id=cap></div><div id=win><div id=bar><i style=background:#ff5f56></i><i style=background:#ffbd2e></i><i style=background:#27c93f></i><span style="margin-left:10px">booking-app — ~/booking-app (feat)</span></div><div id=t></div></div>`;
const b = await chromium.launch({executablePath:process.env.CHROMIUM ?? '/opt/pw-browsers/chromium'});
const ctx = await b.newContext({viewport:{width:1280,height:720}, recordVideo:{dir:'tvid',size:{width:1280,height:720}}});
const p = await ctx.newPage(); await p.setContent(html);
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
await p.waitForTimeout(600);
for(const s of scenes){
  await p.evaluate(c=>{{const [h,w]=c.split('||');document.getElementById('cap').innerHTML='<b>'+h+'</b><span>'+w+'</span>';}document.getElementById('t').innerHTML=''},s.cap);
  await p.waitForTimeout(500);
  let typed='';
  for(const ch of s.cmd){typed+=ch; const line=typed.split('\n').map(l=>l.startsWith('#')||l.startsWith('//')?`<span class=c>${esc(l)}</span>`:`<span class=p>$ </span>${esc(l)}`).join('\n'); await p.evaluate(h=>document.getElementById('t').innerHTML=h,line); await p.waitForTimeout(ch===' '?22:14);}
  await p.waitForTimeout(500);
  const cls=s.bad?'bad':s.ok?'ok':'';
  await p.evaluate(([o,c])=>{document.getElementById('t').innerHTML+='\n\n<span class="'+c+'">'+o+'</span>'},[esc(s.out),cls]);
  await p.waitForTimeout(s.pause);
}
await ctx.close(); await b.close();
