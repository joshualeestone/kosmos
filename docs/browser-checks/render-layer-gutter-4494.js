// Browser-check-surface: fr-back upd-back uc-go updconfirm firstrun
'use strict';

/**
 * kosmos#4494: on a Mac that draws classic scrollbars the tab layout reserves a scrollbar gutter on
 * <html> (#1309), and a fixed full-window layer cannot paint over it, so a strip of the page showed
 * down the right edge beside the first-run wizard and the update overlay (#4489's CI found it on the
 * first screen). While either layer is up the page must reserve no gutter and not scroll.
 *
 * Harness: a tiny static server that serves web/index.html and answers /api/status with a minimal
 * board, /api/first-run with a finished run (the wizard is forced open by ?first-run=1, the real deep
 * link), and POST /api/update with a started update. Every machine gets a real 15px scrollbar (a
 * ::-webkit-scrollbar width, Chromium's --hide-scrollbars dropped, and a page tall enough to scroll,
 * which a custom scrollbar needs before it takes width), so the strip is measurable here and not only
 * on a Mac with a mouse attached. The not-scrolling case (a reserved gutter on a short page) is the
 * same rule's other half and is not reproducible with a custom scrollbar; CI's classic runner has it.
 *
 * Arms:
 *   - positive control, before each layer opens: the tab layout really reserves the 15px gutter and
 *     nothing of the page is under the right edge (so a green below is not a harness with no gutter);
 *   - the wizard, opened by the real deep link: no gutter, the page does not scroll, and the wizard
 *     covers the right edge; closed by the real frClose, the gutter comes back;
 *   - the update overlay, opened by the real Update button: no gutter, no scroll, and the overlay
 *     covers the right edge.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-layer-gutter-4494.js
 */

const fs = require('node:fs');
const http = require('node:http');
const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-layer-gutter-4494: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const ROOT = nodePath.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(nodePath.join(ROOT, 'web', 'index.html'));
const BAR = 15;

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/status')) return json(res, { agents: [], counts: { total: 0, working: 0, idle: 0, unreadableLines: 0 }, checkedAt: new Date().toISOString() });
  if (req.url.startsWith('/api/first-run')) return json(res, { done: true });
  if (req.url === '/api/update' && req.method === 'POST') return json(res, { ok: true, updating: '0.7.99' });
  if (req.url.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
  if (req.url === '/' || req.url.startsWith('/?')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML); return; }
  res.writeHead(404); res.end();
});

// What the right edge shows: the page's gutter width, its computed gutter and overflow, and whether
// the layer (or nothing at all, i.e. the strip) is under points down the right-hand column.
const edge = (page, sel) => page.evaluate(([sel, bar]) => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const layer = sel ? document.querySelector(sel) : null;
  const x = window.innerWidth - Math.ceil(bar / 2);
  const hits = [60, 400, 740].map((y) => {
    const h = document.elementFromPoint(x, y);
    return layer ? !!h && layer.contains(h) : h;
  });
  return {
    width: window.innerWidth - root.clientWidth,
    gutter: cs.scrollbarGutter, overflow: cs.overflowY,
    covered: layer ? hits.every(Boolean) : null,
    empty: layer ? null : hits.every((h) => h === null),
    up: layer ? !layer.hidden : null,
  };
}, [sel, BAR]);

const control = async (page, t) => {
  const s = await edge(page, null);
  ok(t + ' control: the page has a real scrollbar gutter before the layer opens', s.width === BAR && s.gutter === 'stable', JSON.stringify(s));
  ok(t + ' control: and nothing of the page is under the right edge (the strip exists here)', s.empty, JSON.stringify(s));
};

const upAndCovering = (s, t) => {
  ok(t + ' is up', s.up, JSON.stringify(s));
  ok(t + ' the page reserves no gutter and does not scroll under it', s.width === 0 && s.gutter === 'auto' && s.overflow === 'hidden', JSON.stringify(s));
  ok(t + ' covers the right edge (no strip of the page beside it)', s.covered, JSON.stringify(s));
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] }); }
  catch (err) {
    console.error('FAIL  render-layer-gutter-4494: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    server.close();
    process.exit(1);
  }
  const open = async (url) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // A classic, space-taking scrollbar on every machine (an overlay scrollbar gives the gutter no width).
    await ctx.addInitScript((bar) => {
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '::-webkit-scrollbar { width: ' + bar + 'px; height: ' + bar + 'px; } ::-webkit-scrollbar-thumb { background: #999; }';
        document.head.appendChild(st);
        // A long board: a custom scrollbar takes its width only on a page that really scrolls (measured on
        // Chromium 151, headless and headed: a stable gutter alone reads 0 here). A spacer, not a product node.
        const tall = document.createElement('div');
        tall.dataset.testSpacer = '4494';
        tall.style.height = '3000px';
        document.body.appendChild(tall);
      });
    }, BAR);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    return page;
  };

  // ── The first-run wizard. ──
  {
    const page = await open(base + '?tab=agents');
    await control(page, '[wizard]');
    await page.context().close();
  }
  {
    const page = await open(base + '?tab=agents&first-run=1');
    const drawn = await page.waitForSelector('#firstrun:not([hidden])', { timeout: 8000 }).then(() => true, () => false);
    ok('[wizard] the real deep link opens the wizard', drawn);
    if (drawn) {
      upAndCovering(await edge(page, '#firstrun'), '[wizard]');
      await page.evaluate(() => frClose());
      const s = await edge(page, null);
      ok('[wizard] closed by frClose, the page keeps its gutter and scrolls again', s.width === BAR && s.gutter === 'stable' && s.overflow !== 'hidden', JSON.stringify(s));
    }
    await page.context().close();
  }

  // ── The update overlay, through the real Update button. ──
  {
    const page = await open(base + '?tab=agents');
    await control(page, '[update]');
    await page.evaluate(() => { document.getElementById('updconfirm').hidden = false; });
    await page.click('#uc-go');
    const drawn = await page.waitForSelector('body > .upd-back', { timeout: 8000 }).then(() => true, () => false);
    ok('[update] the real Update button puts up the overlay', drawn);
    if (drawn) upAndCovering(await edge(page, '.upd-back'), '[update]');
    await page.context().close();
  }

  await browser.close();
  server.close();
  if (problems.length) {
    console.error('FAIL  render-layer-gutter-4494: ' + problems.length + ' problem(s), ' + pass + ' passed');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-layer-gutter-4494: ' + pass + ' passed (with a real 15px scrollbar and the gutter measured present first: the first-run wizard and the update overlay each leave no gutter and no page scroll while up, and cover the right edge; the wizard gives the gutter back on close). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-layer-gutter-4494: ' + (e && e.message ? e.message.split('\n')[0] : e)); server.close(); process.exit(1); });
