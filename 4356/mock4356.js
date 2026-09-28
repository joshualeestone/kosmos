const path=require('path');const {chromium}=require('playwright');
const PAGE='file://'+process.argv[2]; const OUT=process.argv[3];
// Line art in the app's 24-grid stroke style, drawn larger; gold marks the agents.
const laptop=(x,y,dots)=>`<g transform="translate(${x} ${y})"><rect x="8" y="6" width="84" height="56" rx="6" class="ln"/><path d="M0 70h100l-6 8H6z" class="ln"/>${dots?'<circle cx="32" cy="34" r="6" class="ag"/><circle cx="50" cy="28" r="6" class="ag"/><circle cx="68" cy="34" r="6" class="ag"/>':'<path d="M34 34h32M34 44h20" class="ln thin"/>'}</g>`;
const desk=(x,y)=>`<g transform="translate(${x} ${y})"><rect x="0" y="0" width="92" height="62" rx="6" class="ln"/><path d="M36 62v12M26 76h40" class="ln"/><circle cx="28" cy="31" r="6" class="ag"/><circle cx="46" cy="25" r="6" class="ag"/><circle cx="64" cy="31" r="6" class="ag"/></g>`;
const link=(x1,x2,y)=>`<path d="M${x1} ${y}h${x2-x1}" class="ln dash"/><circle cx="${x1}" cy="${y}" r="3" class="dot"/><circle cx="${x2}" cy="${y}" r="3" class="dot"/>`;
const art1=`<svg viewBox="0 0 240 110" aria-hidden="true">${laptop(70,14,true)}</svg>`;
const art2=`<svg viewBox="0 0 240 110" aria-hidden="true">${laptop(6,14,false)}${link(110,138,48)}${desk(142,12)}</svg>`;
const art3=`<svg viewBox="0 0 240 110" aria-hidden="true">${laptop(6,14,true)}${link(110,138,48)}${desk(142,12)}</svg>`;
const MOCK=`<style>
 html,body{margin:0;height:100%;background:var(--k-bg);color:var(--k-ink);font-family:var(--font-ui)}
 .m{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;box-sizing:border-box}
 .m canvas{width:66px;height:77px;display:block;margin-bottom:26px}
 .m h1{margin:0 0 40px;font-size:26px;font-weight:600;letter-spacing:-.01em;text-align:center}
 .row{display:flex;gap:22px;flex-wrap:wrap;justify-content:center}
 .pick{width:280px;padding:26px 22px 24px;border:1px solid var(--k-rule);border-radius:16px;background:var(--k-surface);display:flex;flex-direction:column;align-items:center;gap:20px;font:inherit;color:inherit;cursor:pointer}
 .pick svg{width:100%;height:auto;display:block}
 .pick b{font-size:17px;font-weight:600;line-height:1.35;text-align:center}
 .ln{fill:none;stroke:var(--k-ink-2);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
 .thin{stroke-width:2;opacity:.55}
 .dash{stroke-dasharray:4 5}
 .ag{fill:var(--gold-bright,#e3b341)}
 .dot{fill:var(--k-ink-2)}
</style>
<div class="m"><canvas width="132" height="154" aria-hidden="true"></canvas>
<h1>How would you like to set up Kosmos on this computer?</h1>
<div class="row">
<button class="pick" type="button">${art1}<b>Run agents on this computer</b></button>
<button class="pick" type="button">${art2}<b>Connect to agents on another computer</b></button>
<button class="pick" type="button">${art3}<b>Run agents here and connect to other computers</b></button>
</div></div>`;
(async()=>{const b=await chromium.launch({headless:true});
for(const t of ['light','dark']){const p=await b.newPage({viewport:{width:1280,height:800},colorScheme:t,deviceScaleFactor:2});
await p.goto(PAGE);await p.waitForTimeout(800);
await p.evaluate((html)=>{document.querySelectorAll('body > *').forEach(e=>e.remove());document.body.className='';document.body.innerHTML=html;startKLoader(document.querySelector('.m canvas'),{still:true});},MOCK);
await p.waitForTimeout(300);await p.screenshot({path:path.join(OUT,'first-screen-4356-'+t+'.png')});await p.close()}
await b.close()})();
