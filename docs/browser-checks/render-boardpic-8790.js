/**
 * kosmos#8790: on a browser that sends no Sec-Fetch-Site (Safari before 16.4) a Kosmos+ computer's connector refuses
 * the board's pictures, since an image load cannot carry X-Kosmos-Board-Page. The real service worker (web/sw.js) asks
 * again for a refused picture with that header, and the page's first-visit reloader (lifted from web/index.html) asks
 * again for the pictures drawn before the worker was in charge.
 *
 * A local server plays the connector: every /api/ picture is refused (401) unless the request carries
 * X-Kosmos-Board-Page: 1. It serves the real web/sw.js and a small page carrying the real reloader. Checked:
 *   1. first visit: a picture drawn before the worker is in charge shows once the worker takes charge;
 *   2. a page the worker controls: a refused picture shows, asked for with the header, at its own address (the element's
 *      src never changes, so the board's "only redraw when it changed" checks still match);
 *   3. a picture that answers 404 is asked for once, not again (control: a real failure is left as it was);
 *   4. a picture that loads is never asked for twice (control).
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-boardpic-8790.js
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SW = fs.readFileSync(path.join(ROOT, 'web', 'sw.js'), 'utf8');
const PAGE_SRC = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

// The page's real first-visit reloader, as it ships.
const at = PAGE_SRC.indexOf('/* kosmos#8790: on a browser that sends no Sec-Fetch-Site');
const reloader = at < 0 ? '' : PAGE_SRC.slice(at, PAGE_SRC.indexOf('})();', at) + 5);
chk(!!reloader, 'the page\'s first-visit reloader was found in web/index.html');

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>boardpic</title></head><body>
<div class="pics"></div>
<script>${reloader}</script>
<script>
  window.drawPics = (list) => { document.querySelector('.pics').innerHTML = list.map((u) => '<img src="' + u + '" alt="">').join(''); };
  window.drawSvg = (u) => { document.querySelector('.pics').insertAdjacentHTML('beforeend', '<svg width="10" height="10"><image href="' + u + '" width="10" height="10"/></svg>'); };
  window.readPics = () => [...document.querySelectorAll('.pics img')].map((i) => ({ src: i.getAttribute('src'), loaded: i.complete && i.naturalWidth > 0 }));
  if (navigator.serviceWorker) navigator.serviceWorker.register('/sw.js');
</script></body></html>`;

const asked = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const marked = req.headers['x-kosmos-board-page'] === '1';
  if (u.pathname === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(SW); return; }
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(HTML); return; }
  if (u.pathname.startsWith('/api/')) {
    asked.push({ path: u.pathname + u.search, marked, dest: req.headers['sec-fetch-dest'] || '' });
    if (u.pathname === '/api/gone/avatar') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no such agent"}'); return; }
    if (u.pathname === '/api/open/avatar' || marked) { res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); res.end(PNG_1X1); return; }
    res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"sign in to this computer"}'); return;
  }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    const count = (p, marked) => asked.filter((a) => a.path === p && (marked === undefined || a.marked === marked)).length;

    // 1. First visit: drawn before the worker is in charge.
    await page.goto(base + '/');
    const before = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
    const drawnBefore = await page.evaluate(() => { window.drawPics(['/api/agent/first/avatar?v=1']); window.drawSvg('/api/agent/firstsvg/avatar'); return !!navigator.serviceWorker.controller; });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const first = await page.evaluate(() => window.readPics());
    chk(!before && !drawnBefore, 'first visit: the pictures were drawn before a worker was in charge', String(before) + ' ' + String(drawnBefore));
    chk(asked.some((a) => a.path === '/api/agent/first/avatar?v=1' && a.dest === 'image' && !a.marked), 'and the browser asked for it itself (Sec-Fetch-Dest: image), so the worker did not handle it', JSON.stringify(asked));
    chk(count('/api/agent/first/avatar?v=1', false) >= 1, 'CONTROL: the picture was first refused (asked without the header)', JSON.stringify(asked));
    chk(first[0] && first[0].loaded, 'first visit: once the worker took charge, the refused picture shows', JSON.stringify(first));
    chk(first[0] && first[0].src === '/api/agent/first/avatar?v=1', 'and its address on the page is unchanged', JSON.stringify(first));
    chk(count('/api/agent/first/avatar?v=1', true) >= 1, 'the reloader asked again, through the worker (with the header)', JSON.stringify(asked.filter((a) => a.path.includes('first'))));
    chk(count('/api/agent/firstsvg/avatar', true) >= 1, 'first visit: an SVG <image> avatar is asked for again too', JSON.stringify(asked.filter((a) => a.path.includes('firstsvg'))));

    // 2 to 4. A page the worker controls from the start.
    await page.reload();
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    chk(controlled, 'after a reload the worker is in charge of the page');
    const pics = ['/api/agent/max/avatar?v=3', '/api/gone/avatar', '/api/open/avatar'];
    await page.evaluate((l) => window.drawPics(l), pics);
    await page.waitForTimeout(1200);
    const got = await page.evaluate(() => window.readPics());
    chk(got[0].loaded, 'a refused picture shows', JSON.stringify(got[0]));
    chk(got[0].src === pics[0], 'at its own address (src unchanged)', JSON.stringify(got[0]));
    chk(count(pics[0], true) === 1, 'it was asked for again once, with X-Kosmos-Board-Page: 1', JSON.stringify(asked.filter((a) => a.path === pics[0])));
    chk(!got[1].loaded && count(pics[1]) === 1, 'CONTROL: a picture that answers 404 stays failed and is asked for once', JSON.stringify(asked.filter((a) => a.path === pics[1])));
    chk(got[2].loaded && count(pics[2]) === 1 && count(pics[2], true) === 0, 'CONTROL: a picture that loads is asked for once, without the header', JSON.stringify(asked.filter((a) => a.path === pics[2])));

    // A redraw with the same markup: the refused picture is asked for the way the browser does, still through the worker.
    const n = count(pics[0], true);
    await page.evaluate((l) => window.drawPics(l), pics);
    await page.waitForTimeout(800);
    const again = await page.evaluate(() => window.readPics());
    chk(again[0].loaded, 'after a redraw the refused picture still shows', JSON.stringify(again[0]));
    chk(count(pics[0], true) <= n + 1, 'and a redraw costs at most one more ask with the header', JSON.stringify(asked.filter((a) => a.path === pics[0])));
    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
