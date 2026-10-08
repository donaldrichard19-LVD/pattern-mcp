import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx = await b.newContext({viewport:{width:1280,height:720}, recordVideo:{dir:'vid',size:{width:1280,height:720}}});
const p = await ctx.newPage();
await p.goto('https://usepattern.sh',{waitUntil:'networkidle'});
await p.waitForTimeout(2000);
// click verdict tab "What your agent sees"
await p.mouse.move(640,360);
const t0=Date.now();
await p.evaluate(()=>window.scrollTo(0,0));
await p.waitForTimeout(1500);
await p.getByText('What your agent sees').first().click().catch(()=>{});
await p.waitForTimeout(2500);
await p.getByText('What you see').first().click().catch(()=>{});
// smooth scroll
const h = await p.evaluate(()=>document.documentElement.scrollHeight);
const marks=[];
for (let y=0;y<h-720;y+=12){ await p.mouse.wheel(0,12); await p.waitForTimeout(16);
  if (y%600===0) { marks.push([y,(Date.now()-t0)/1000]); }
  if (y%1200===0) await p.screenshot({path:`s-${String(y).padStart(5,'0')}.png`}); }
await p.waitForTimeout(2000);
console.log(JSON.stringify(marks));
await ctx.close(); await b.close();
