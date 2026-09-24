// Headless screenshots of the message-bubble tail (#3267), built on the same real-app
// render path as docs/browser-checks/render-room-msgbox-2806.js: web/index.html over
// file://, polls stubbed, real pjRoomRow output inside a real .thread ground.
// Usage: NODE_PATH=~/work/pw-runtime/node_modules node shot-tail.cjs <index.html> <outdir> <label>
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const [, , indexHtml, outDir, label] = process.argv;
if (!indexHtml || !outDir || !label) { console.error('usage: shot-tail.cjs <index.html> <outdir> <label>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const PAGE = 'file://' + path.resolve(indexHtml);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const made = [];
  try {
    for (const layout of ['classic', 'consolidated']) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 760), height: 360 }, colorScheme: theme, deviceScaleFactor: 3 });
      await page.addInitScript(() => {
        window.setInterval = () => 0;
        window.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      });
      await page.goto(PAGE);
      const ok = await page.evaluate(({ ts, layout }) => {
        if (layout === 'consolidated') { document.documentElement.setAttribute('data-layout', 'consolidated'); document.body.classList.add('consolidated'); }
        else { document.documentElement.removeAttribute('data-layout'); document.body.classList.remove('consolidated'); }
        if (typeof pjRoomRow !== 'function') return false;
        const p = { agents: [{ sessionName: 'april', name: 'April' }] };
        // Real ground: the room paints it on .pjmid / .pjmid .thread (classic) or .pj3 > .pjmid
        // (consolidated), so the thread must sit inside those, or the tail mask is judged
        // against the wrong ground.
        const pj3 = document.createElement('div'); pj3.className = 'pj3';
        pj3.style.cssText = 'position:fixed;left:0;top:0;width:760px;height:360px;z-index:99999;display:block;';
        const mid = document.createElement('div'); mid.className = 'pjmid'; mid.style.cssText = 'width:760px;height:360px;display:block;';
        const host = document.createElement('div');
        host.className = 'thread'; host.setAttribute('data-shot', '1');
        host.style.cssText = 'width:760px;height:360px;overflow:hidden;padding:24px 40px;box-sizing:border-box;';
        mid.appendChild(host); pj3.appendChild(mid);
        host.innerHTML = pjRoomRow({ from: 'april', at: ts, text: 'on it, board cleared. Two agents moved to the new account.' }, p)
          + pjRoomRow({ operator: true, at: ts, text: 'can everyone enter a task of 100 character max, please and thanks.' }, p);
        document.body.appendChild(pj3);
        const g = (el) => getComputedStyle(el).backgroundColor;
        const bd = host.querySelector('.msg.you .msg-bd');
        return { ground: [g(mid), g(host)], mask: bd ? getComputedStyle(bd, '::after').backgroundColor : null };
      }, { ts: new Date().toISOString(), layout });
      console.log(`${layout} ${theme} ground(pjmid,thread)=${JSON.stringify(ok.ground)} tailmask=${ok.mask}`);
      if (!ok) throw new Error('pjRoomRow missing');
      await page.waitForTimeout(150);
      const full = path.join(outDir, `${label}-${layout}-room-${theme}.png`);
      await page.screenshot({ path: full });
      made.push(full);
      // Tight crops on each tail: bottom corner of each bubble, +-40px around the tail side.
      const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('.thread[data-shot="1"] .msg .msg-bd')).map((bd) => {
        const r = bd.getBoundingClientRect();
        return { you: bd.closest('.msg').classList.contains('you'), left: r.left, right: r.right, bottom: r.bottom };
      }));
      for (const b of boxes) {
        const cx = b.you ? b.right : b.left;
        const clip = { x: Math.max(0, cx - 40), y: Math.max(0, b.bottom - 44), width: 80, height: 60 };
        const f = path.join(outDir, `${label}-${layout}-tail-${b.you ? 'operator' : 'agent'}-${theme}.png`);
        await page.screenshot({ path: f, clip });
        made.push(f);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(made.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
