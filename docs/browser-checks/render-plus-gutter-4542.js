// Browser-check-surface: plus-active
'use strict';

/**
 * kosmos#4542: on a machine that draws classic scrollbars, Settings > Kosmos Plus showed a pure white 15px strip down
 * the whole right edge beside a navy page (measured 255,255,255 beside 12,21,41). The #1309 gutter paints the canvas's
 * COLOUR only, and the Plus navy is a gradient IMAGE on the body. The canvas now takes the gradient's outer stop.
 *
 * Harness: the real board, reached by the real route ?tab=settings&sec=plus (and the settings nav if the route has
 * not opened it yet). A Mac's headless Chromium draws OVERLAY scrollbars, so no gutter is reserved there: the check
 * gives the root a real 15px scrollbar (::-webkit-scrollbar, as render-talk-fill-2622 does) and sets the page's own
 * data-scrollbar-classic, as render-tasks-view-3559 does for #4216, so the #1309 gutter really exists to read. Pixels
 * are read with a 1x1 screenshot.
 *   G1  precondition: Plus is up (body.plus-active), classic scrollbars are on, and a gutter of ~15px is reserved
 *   G2  the gutter is the navy of the gradient's edge, not white, top to bottom, in a light and a dark OS setting
 *   G3  CONTROL: with the canvas colour taken away in the page, the same read is white again (the reported bug), so
 *       G2 is reading the gutter and can go red
 *   G4  the rule does not leak: on another settings section the canvas is not the Plus navy (after proving the
 *       control's style is gone, so the arm is not reading the control)
 *   G5  a window taller than the Plus page (1280x2400): the body fills the window, and the ground near the bottom is
 *       the gradient as it paints without the rule, not a flat band; CONTROL: without the body's min-height, the band
 *       shows (flat outer-stop navy), so the arm can go red
 * Not modelled: a native classic TRACK (a Mac with a mouse) painting over the gutter while the page scrolls; the forced
 * scrollbar here has a transparent track and thumb, like the win32 skin's track.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-plus-gutter-4542.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kpg-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}

const EDGE = [11, 20, 40];      // #0b1428, the Plus gradient's outer stop
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const port = server.address().port;
  // Classic scrollbars: Playwright hides them by default, which would leave no gutter to read.
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto('http://127.0.0.1:' + port + '/?tab=settings&sec=plus', { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('#boot-cover', { state: 'hidden', timeout: 60000 }).catch(() => {});
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      if (!(await page.evaluate(() => document.body.classList.contains('plus-active')))) {
        await page.evaluate(() => { if (typeof showTab === 'function') showTab('settings'); });
        await page.waitForTimeout(400);
        await page.click('#s-nav button[data-go="plus"]').catch(() => {});
      }
      await page.waitForFunction(() => document.body.classList.contains('plus-active'), null, { timeout: 30000 }).catch(() => {});
      // A real classic gutter (see the header): a 15px root scrollbar and the page's own classic flag. The thumb is
      // transparent so every read lands on what the gutter paints (the canvas), not on a drawn thumb.
      await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: transparent; }' });
      await page.evaluate(() => document.documentElement.setAttribute('data-scrollbar-classic', ''));
      await page.waitForTimeout(500);
      const pre = await page.evaluate(() => ({
        plus: document.body.classList.contains('plus-active'),
        classic: document.documentElement.hasAttribute('data-scrollbar-classic'),
        gutter: Math.round(innerWidth - document.documentElement.getBoundingClientRect().right),
        overflows: document.documentElement.scrollHeight > innerHeight,
      }));
      chk(pre.plus && pre.classic && pre.gutter >= 10 && pre.overflows, `[${scheme}] G1 precondition: Plus is up, a classic gutter is reserved, and the page overflows (a gutter shows the canvas only while a scrollbar is up)`, JSON.stringify(pre));
      const px = async (x, y) => {
        const b64 = (await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64');
        return page.evaluate((src) => new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas');
          c.width = 1; c.height = 1; const g = c.getContext('2d'); g.drawImage(i, 0, 0); ok([...g.getImageData(0, 0, 1, 1).data].slice(0, 3)); };
          i.src = 'data:image/png;base64,' + src; }), b64);
      };
      const gx = 1280 - Math.max(2, Math.floor(pre.gutter / 2));
      const reads = [];
      for (const y of [120, 400, 780]) reads.push(await px(gx, y));
      chk(reads.every((c) => near(c, EDGE, 3)), `[${scheme}] G2 the gutter is the navy of the gradient's edge, top to bottom, not white`, JSON.stringify(reads));
      // G3 CONTROL: take the canvas colour away and the same read must show the reported white strip.
      await page.addStyleTag({ content: 'html { background-color: transparent !important; }' });
      await page.waitForTimeout(150);
      const bare = await px(gx, 400);
      chk(!near(bare, EDGE, 3) && bare.every((v) => v > 200), `[${scheme}] G3 CONTROL: without the canvas colour the gutter reads white again`, JSON.stringify(bare));
      // G4: another settings section must not get the Plus canvas (the rule is scoped to body.plus-active).
      await page.evaluate(() => { const s = document.querySelector('style:last-of-type'); if (s && /transparent !important/.test(s.textContent)) s.remove(); });
      const restored = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      chk(restored === 'rgb(11, 20, 40)', `[${scheme}] G4 precondition: the control's style is gone and the Plus canvas is back`, restored);
      await page.click('#s-nav button[data-go]:not([data-go="plus"])').catch(() => {});
      await page.waitForTimeout(400);
      const other = await page.evaluate(() => ({ plus: document.body.classList.contains('plus-active'), canvas: getComputedStyle(document.documentElement).backgroundColor }));
      chk(!other.plus && other.canvas !== 'rgb(11, 20, 40)', `[${scheme}] G4 on another section the canvas is not the Plus navy (no leak)`, JSON.stringify(other));
      chk(errs.length === 0, `[${scheme}] no script errors on the page`, errs.join(' | '));
      await page.close();
    }

    // G5: a window taller than the Plus page. Without the body's min-height the root's colour would leave a flat band.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 2400 }, colorScheme: 'dark' });
      await page.goto('http://127.0.0.1:' + port + '/?tab=settings&sec=plus', { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('#boot-cover', { state: 'hidden', timeout: 60000 }).catch(() => {});
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      if (!(await page.evaluate(() => document.body.classList.contains('plus-active')))) {
        await page.evaluate(() => { if (typeof showTab === 'function') showTab('settings'); });
        await page.waitForTimeout(400);
        await page.click('#s-nav button[data-go="plus"]').catch(() => {});
      }
      await page.waitForFunction(() => document.body.classList.contains('plus-active'), null, { timeout: 30000 }).catch(() => {});
      await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: transparent; }' });
      await page.evaluate(() => document.documentElement.setAttribute('data-scrollbar-classic', ''));
      await page.waitForTimeout(500);
      const px = async (x, y) => {
        const b64 = (await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64');
        return page.evaluate((src) => new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas');
          c.width = 1; c.height = 1; const g = c.getContext('2d'); g.drawImage(i, 0, 0); ok([...g.getImageData(0, 0, 1, 1).data].slice(0, 3)); };
          i.src = 'data:image/png;base64,' + src; }), b64);
      };
      const natural = await page.evaluate(() => { const b = document.body; const was = b.style.minHeight; b.style.minHeight = '0px';
        const h = b.getBoundingClientRect().height; b.style.minHeight = was; return Math.round(h); });
      const fills = await page.evaluate(() => Math.round(document.body.getBoundingClientRect().bottom));
      chk(natural < 2400 - 100, 'G5 precondition: the Plus body is shorter than a 2400px window', 'natural body ' + natural + 'px');
      const y = 2400 - 20;
      const withRule = await px(640, y);
      // The same point as the page paints WITHOUT the rule (the root's colour gone, so the body's gradient reaches the canvas).
      await page.addStyleTag({ content: 'html { background-color: transparent !important; }' });
      await page.waitForTimeout(150);
      const noRule = await px(640, y);
      await page.evaluate(() => { const s = document.querySelector('style:last-of-type'); if (s && /transparent !important/.test(s.textContent)) s.remove(); });
      // CONTROL: the root keeps its colour but the body does not fill the window: the band below it is flat navy.
      await page.addStyleTag({ content: 'body { min-height: 0 !important; }' });
      await page.waitForTimeout(150);
      const band = await px(640, y);
      chk(fills >= 2400 - 1, 'G5 the body fills the window under the rule', 'body bottom ' + fills);
      chk(near(withRule, noRule, 4), 'G5 near the bottom the ground is the gradient as it paints without the rule (no flat band)', JSON.stringify({ withRule, noRule }));
      chk(near(band, EDGE, 2) && !near(band, noRule, 2), 'G5 CONTROL: without the body\'s min-height the band shows (flat outer-stop navy)', JSON.stringify({ band, noRule }));
      await page.close();
    }
  } finally {
    await browser.close();
    try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(`\nrender-plus-gutter-4542: ${pass} passed, ${fail.length} failed`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.log('FAIL  render-plus-gutter-4542 threw: ' + (e && e.message || e)); process.exit(1); });
