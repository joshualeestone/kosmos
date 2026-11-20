/**
 * kosmos#8790: over Kosmos+, a browser that sends no Sec-Fetch-Site (Safari before 16.4) gets no board token on a
 * navigation, so the board's downloads were refused there. The page's real download-link listener (lifted from
 * web/index.html, dlKeyClick and its helpers) asks the board for a key first and opens the same address with ?bdl=.
 *
 * A local server plays the board: a download opens only with a key it minted for that exact address. It does not
 * apply the real board's rule that refuses a key on a request carrying Sec-Fetch-Site (both engines here send one);
 * that rule is tested in server.download-key-8790.test.js. The page is a
 * small one carrying the real listener, with kplusRemote() answering true (a Kosmos+ address) or false. Run in
 * Chromium and in WebKit, the engine old Safari is made of, because the download is opened after the key's fetch
 * returns, outside the click itself, and an engine could refuse a download started that way.
 * Checked: a link the person clicks, and a link a script makes and clicks (kplusDownload's way), each save the file;
 * a route the board will not key opens as it always did; a link that is not a download route is left alone; at the
 * computer itself (kplusRemote false) no key is asked for (control).
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dlkey-8790.js
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const playwright = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE_SRC = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const START = '/* kosmos#8790: over Kosmos+, a browser that sends no Sec-Fetch-Site';
const END = "if (b && b.needed === false) DL_KEY_NOT_NEEDED = true; }).catch(() => {});\n}";   // the load-time look included
const at = PAGE_SRC.indexOf(START);
const listener = at < 0 ? '' : PAGE_SRC.slice(at, PAGE_SRC.indexOf(END, at) + END.length);
chk(!!listener, 'the page\'s download-link listener was found in web/index.html');
// The attachment card's own click handler, as it ships: a plain click opens the preview (preventDefault).
const CARD = '/* A plain click on a file card opens the preview; a modifier-click (or a middle click) keeps the download. */';
const cat = PAGE_SRC.indexOf(CARD);
const card = cat < 0 ? '' : PAGE_SRC.slice(cat, PAGE_SRC.indexOf('});', cat) + 3);
chk(!!card, 'the attachment card\'s click handler was found in web/index.html');

const html = (remote) => `<!doctype html><html><head><meta charset="utf-8"><title>dlkey</title></head><body>
<a class="diag" href="/api/diagnostics" download>Save diagnostics</a>
<a class="exp" href="/api/agent/max/export" download>Export</a>
<a class="plain" href="/api/status" download>Not a download route</a>
<a class="att" data-att="0123456789abcdef01234567" href="/api/attachment/0123456789abcdef01234567" download="report.pdf">An attachment card</a>
<a class="att nopv" data-att="fedcba9876543210fedcba98" href="/api/attachment/fedcba9876543210fedcba98" download="data.bin">A card with no preview</a>
<script>function kplusRemote() { return ${remote ? 'true' : 'false'}; }
  window.previews = [];
  function pvOpen(id, el) { window.previews.push(id); return !el.classList.contains('nopv'); }</script>
<script>${listener}</script>
<script>${card}</script>
<script>
  window.scriptDownload = () => {   // the kplusDownload way: a link made, clicked and removed in one go
    const a = document.createElement('a');
    a.href = '/api/agent/max/files/download?name=' + encodeURIComponent('my notes.txt');
    a.download = 'my notes.txt'; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
  };
</script></body></html>`;

const keys = new Map();   // key -> target
let MODERN = false;       // the board's rule: a mint from a browser that sends Sec-Fetch-Site needs no key
let REFUSE_ASK = false;   // a board that refuses the load-time look (403)
let LATE_NOT_NEEDED = false;   // the look said keys are needed, but a mint answers needed:false (a click before the look)
let MINT_DELAY_MS = 0;    // a slow board: the key comes back long after the click
let MINT_HANG = false;    // a board that never answers the mint
const seen = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/remote' || u.pathname === '/local') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html(u.pathname === '/remote')); return; }
  if (u.pathname === '/api/download-key' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let b = {};
      try { b = JSON.parse(body) || {}; } catch { b = {}; }
      if (b.ask === true) {   // the page's one look at load: no key made
        seen.push({ ask: true });
        if (REFUSE_ASK) { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"sign in"}'); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, key: null, needed: !(MODERN && req.headers['sec-fetch-site']) }));
        return;
      }
      const p = typeof b.path === 'string' ? b.path : '';
      seen.push({ mint: p });
      if (MINT_HANG) return;   // never answered
      if (MINT_DELAY_MS) await new Promise((r) => setTimeout(r, MINT_DELAY_MS));
      if ((MODERN && req.headers['sec-fetch-site']) || LATE_NOT_NEEDED) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"key":null,"needed":false}'); return; }
      if (p.startsWith('/api/agent/max/export')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"an older board"}'); return; }
      const k = crypto.randomBytes(32).toString('hex');
      keys.set(k, p);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, key: k }));
    });
    return;
  }
  if (u.pathname.startsWith('/api/')) {
    const k = u.searchParams.get('bdl');
    u.searchParams.delete('bdl');
    const target = u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
    const ok = k && keys.get(k) === target;
    if (ok) keys.delete(k);
    seen.push({ get: target, key: !!k, ok: !!ok });
    if (!ok && !u.pathname.startsWith('/api/agent/max/export') && u.pathname !== '/api/status') { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"sign in"}'); return; }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="got.bin"' });
    res.end('file for ' + target);
    return;
  }
  res.writeHead(404); res.end();
});

async function saved(page, act, timeout = 5000) {
  const dl = page.waitForEvent('download', { timeout }).catch(() => null);
  await act();
  const d = await dl;
  if (!d) return null;
  const p = await d.path().catch(() => null);
  return p ? fs.readFileSync(p, 'utf8') : '';
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const engine of ['chromium', 'webkit']) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    try {
      const ctx = await browser.newContext({ acceptDownloads: true });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      const tag = '[' + engine + '] ';

      await page.goto(base + '/remote');
      seen.length = 0;
      const a = await saved(page, () => page.click('a.diag'));
      chk(a === 'file for /api/diagnostics', tag + 'a clicked download link saves the file, through a key', JSON.stringify({ a, seen }));
      chk(seen.some((s) => s.mint === '/api/diagnostics') && seen.some((s) => s.get === '/api/diagnostics' && s.ok), tag + 'the key was minted for that address and accepted', JSON.stringify(seen));

      seen.length = 0;
      const b = await saved(page, () => page.evaluate(() => window.scriptDownload()));
      chk(b === 'file for /api/agent/max/files/download?name=my+notes.txt', tag + 'a link a script makes and clicks saves the file too', JSON.stringify({ b, seen }));

      seen.length = 0;
      const c = await saved(page, () => page.click('a.exp'));
      chk(c === 'file for /api/agent/max/export' && seen.some((s) => s.get === '/api/agent/max/export' && !s.key), tag + 'no key given (an older board): the link opens as it always did', JSON.stringify({ c, seen }));

      seen.length = 0;
      await saved(page, () => page.click('a.plain'));
      chk(!seen.some((s) => 'mint' in s), tag + 'a link that is not a download route asks for no key', JSON.stringify(seen));

      seen.length = 0;
      const pv = await saved(page, () => page.click('a.att:not(.nopv)'));
      chk(pv === null && (await page.evaluate(() => window.previews.slice())).includes('0123456789abcdef01234567') && !seen.some((x) => 'mint' in x),
        tag + 'a plain click on an attachment card opens its preview: no key, no download', JSON.stringify({ pv, seen }));
      seen.length = 0;
      const np = await saved(page, () => page.click('a.att.nopv'));
      chk(np === 'file for /api/attachment/fedcba9876543210fedcba98', tag + 'a card with no preview downloads, through a key', JSON.stringify({ np, seen }));
      seen.length = 0;
      await saved(page, () => page.click('a.diag', { modifiers: ['Meta'] }));
      chk(!seen.some((x) => 'mint' in x), tag + 'a Cmd-click is left to the browser', JSON.stringify(seen));
      seen.length = 0;
      await saved(page, () => page.click('a.diag', { modifiers: ['Shift'] }));
      chk(!seen.some((x) => 'mint' in x), tag + 'a Shift-click is left to the browser (Safari: Reading List)', JSON.stringify(seen));
      seen.length = 0;
      const alt = await saved(page, () => page.click('a.diag', { modifiers: ['Alt'] }));
      chk(alt === 'file for /api/diagnostics' && seen.some((x) => x.mint === '/api/diagnostics'), tag + 'an Option-click (Safari: download linked file) still takes a key', JSON.stringify({ alt, seen }));

      // A current browser (it sends Sec-Fetch-Site): told no key is needed once, then its links are left alone.
      MODERN = true;
      seen.length = 0;
      await page.goto(base + '/remote');
      await page.waitForTimeout(300);
      chk(seen.filter((x) => x.ask).length === 1, tag + 'a page over Kosmos+ asks once, at load, whether keys are needed', JSON.stringify(seen));
      seen.length = 0;
      const m1 = await saved(page, () => page.click('a.exp'));
      const m2 = await saved(page, () => page.click('a.exp'));
      chk(m1 === 'file for /api/agent/max/export' && m2 === 'file for /api/agent/max/export', tag + 'a current browser: both downloads save', JSON.stringify({ m1, m2 }));
      chk(!seen.some((x) => 'mint' in x) && !seen.some((x) => x.key), tag + 'told at load that no key is needed, so neither click asks for one (the download starts in the click)', JSON.stringify(seen));
      MODERN = false;

      // A board that refuses the look (403): it cannot give keys either, so the links are left as they were.
      REFUSE_ASK = true;
      seen.length = 0;
      await page.goto(base + '/remote');
      await page.waitForTimeout(300);
      seen.length = 0;
      await saved(page, () => page.click('a.exp'));
      chk(!seen.some((x) => 'mint' in x), tag + 'a board that refused the look: a click asks for no key', JSON.stringify(seen));
      REFUSE_ASK = false;

      // The look said keys are needed, but the first click's mint says not (a click before the look, say): from then on
      // the links are left alone.
      LATE_NOT_NEEDED = true;
      await page.goto(base + '/remote');
      await page.waitForTimeout(300);
      seen.length = 0;
      const l1 = await saved(page, () => page.click('a.exp'));
      const l2 = await saved(page, () => page.click('a.exp'));
      chk(l1 === 'file for /api/agent/max/export' && l2 === 'file for /api/agent/max/export' && seen.filter((x) => 'mint' in x).length === 1,
        tag + 'a mint answered "not needed" stops the next click asking', JSON.stringify({ l1, l2, seen }));
      LATE_NOT_NEEDED = false;

      // A slow key (6.5 s): the download starts long after the click's own moment, and still saves.
      MINT_DELAY_MS = 6500;
      await page.goto(base + '/remote');
      seen.length = 0;
      const slow = await saved(page, () => page.click('a.diag'), 12000);
      chk(slow === 'file for /api/diagnostics' && seen.some((x) => x.get === '/api/diagnostics' && x.ok), tag + 'a key that comes 6.5 s after the click still saves the file', JSON.stringify({ slow, seen }));
      MINT_DELAY_MS = 0;

      // A board that never answers the mint: after 8 s the link opens as it always did (here, the plain address).
      MINT_HANG = true;
      seen.length = 0;
      const hang = await saved(page, () => page.click('a.exp'), 12000);
      chk(hang === 'file for /api/agent/max/export' && seen.some((x) => x.get === '/api/agent/max/export' && !x.key), tag + 'a mint that never answers: after 8 s the link opens as before', JSON.stringify({ hang, seen }));
      MINT_HANG = false;

      await page.goto(base + '/local');
      seen.length = 0;
      await saved(page, () => page.click('a.diag'));
      chk(!seen.some((s) => 'mint' in s) && seen.some((s) => s.get === '/api/diagnostics' && !s.key), tag + 'CONTROL: at the computer itself no key is asked for', JSON.stringify(seen));
      chk(errs.length === 0, tag + 'no page errors', JSON.stringify(errs));
    } finally {
      await browser.close();
    }
  }
  server.close();
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
