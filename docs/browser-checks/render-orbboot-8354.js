'use strict';
// Browser-check-surface: boot-cover boot-spin orb-wait korb-on

/**
 * kosmos#8354 (Josh 11-10): opening the app showed the old dots for two seconds, then the orb. On the real page, in light
 * and dark:
 *  - with the page's script not run (its first paint: the script tag is emptied): the eight dots are not drawn, and the
 *    cover's middle really has gold pixels in the shape of the still frame;
 *  - with the script run: the live canvas is on and the still frame is gone (one orb, not two);
 *  - CONTROL: the same page with the still frame's paint removed draws nothing there, so the pixel read can fail.
 *
 *   HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-orbboot-8354.js
 */
const nodePath = require('node:path');
const fs = require('node:fs');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-orbboot-8354: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const FILE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };
const HTML = fs.readFileSync(FILE, 'utf8');
// First paint: the board's own script is what has not run yet. The small theme script keeps running.
const FIRST = HTML.replace(/<script>[\s\S]*?<\/script>/g, '<script></script>');

const inkPixels = async (page) => {   // gold-ish pixels inside the cover's spinner, read off a screenshot of it
  const png = await page.locator('#boot-cover .boot-spin').screenshot({ type: 'png' });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; const bg = [d[0], d[1], d[2]]; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) n += 1;
    return n;
  }, png.toString('base64'));
};

(async () => {
  const browser = await pw.chromium.launch({ headless: process.env.HEADED === '0' });
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    const t = `[${scheme}]`;
    let page = await context.newPage();
    await page.setContent(FIRST, { waitUntil: 'load' });
    const present = await page.evaluate(() => document.querySelectorAll('#boot-cover .boot-spin i').length);
    say(present === 8, `${t} premise: the cover's eight dots are in the page`, 'present=' + present);
    const dots = await page.evaluate(() => [...document.querySelectorAll('#boot-cover .boot-spin i')].filter((i) => getComputedStyle(i).display !== 'none').length);
    say(dots === 0, `${t} first paint: none of the dots are drawn`, 'drawn=' + dots);
    const lit = await inkPixels(page);
    say(lit > 300, `${t} first paint: the orb's still frame is on screen`, 'pixels=' + lit);
    await page.addStyleTag({ content: '#boot-cover .boot-spin::before { -webkit-mask: none !important; mask: none !important; background: none !important; }' });
    const off = await inkPixels(page);
    say(off < 20, `${t} CONTROL: with the frame removed the same read finds nothing`, 'pixels=' + off);
    await page.close();

    page = await context.newPage();
    await page.addInitScript(() => { window.fetch = async () => new Response('{}', { status: 200 }); });
    await page.goto('file://' + FILE);
    await page.waitForFunction(() => { const c = document.querySelector('#boot-cover canvas.korb'); return c && c.width > 0; }, null, { timeout: 30000 });
    const live = await page.evaluate(() => ({ on: document.querySelector('#boot-cover .boot-spin').classList.contains('korb-on'), before: getComputedStyle(document.querySelector('#boot-cover .boot-spin'), '::before').content }));
    say(live.on && live.before === 'none', `${t} once the script runs: the live orb is on and the still frame is gone`, JSON.stringify(live));
    await page.close();
    await context.close();
  }
  await browser.close();
  console.log(fails.length ? 'FAILED: ' + fails.length : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
