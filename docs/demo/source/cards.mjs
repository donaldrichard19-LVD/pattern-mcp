import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const icon=fs.readFileSync('/home/user/pattern-mcp/website/app/icon.svg','utf8');
const card=(h,sub,extra='')=>`<!doctype html><style>body{margin:0;width:1280px;height:720px;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;color:#0b0f14;text-align:center}
.ic svg{width:84px;height:84px}h1{font-size:60px;letter-spacing:-.02em;margin:26px 80px 14px;font-weight:600;line-height:1.1}p{font-size:26px;color:#5b6572;margin:0 100px}
code{margin-top:36px;font:24px ui-monospace,monospace;background:#f3f5f7;border:1px solid #e3e7eb;border-radius:10px;padding:16px 26px}</style><div class=ic>${icon}</div><h1>${h}</h1><p>${sub}</p>${extra}`;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage({viewport:{width:1280,height:720}});
await p.setContent(card('Pattern','Checks your coding agent’s UI decisions against your design system, before it builds.'));await p.screenshot({path:'c1.png'});
await p.setContent(card('Reuse what exists. Build only the gap.','Open source · MIT · Works with Claude Code, Cursor, Codex and Figma','<code>$ npx pattern-mcp init --yes</code>'));await p.screenshot({path:'c2.png'});
await b.close();
