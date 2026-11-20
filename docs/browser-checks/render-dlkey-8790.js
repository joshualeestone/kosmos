/**
 * kosmos#8790: over Kosmos+, a browser that sends no Sec-Fetch-Site (Safari before 16.4) gets no board token on a
 * navigation, so the board's downloads were refused there. The page's real download-link listener (lifted from
 * web/index.html, dlKeyClick and its helpers) asks the board for a key first and opens the same address with ?bdl=.
 *
 * A local server plays the board: a download opens only with a key it minted for that exact address. The page is a
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
const END = "document.addEventListener('click', dlKeyClick, true);";
const at = PAGE_SRC.indexOf(START);
const listener = at < 0 ? '' : PAGE_SRC.slice(at, PAGE_SRC.indexOf(END, at) + END.length);
chk(!!listener, 'the page\'s download-link listener was found in web/index.html');

const html = (remote) => `<!doctype html><html><head><meta charset="utf-8"><title>dlkey</title></head><body>
<a class="diag" href="/api/diagnostics" download>Save diagnostics</a>
<a class="exp" href="/api/agent/max/export" download>Export</a>
<a class="plain" href="/api/status" download>Not a download route</a>
<script>function kplusRemote() { return ${remote ? 'true' : 'false'}; }</script>
<script>${listener}</script>
<script>
  window.scriptDownload = () => {   // the kplusDownload way: a link made, clicked and removed in one go
    const a = document.createElement('a');
    a.href = '/api/agent/max/files/download?name=' + encodeURIComponent('a b.txt');
    a.download = 'a b.txt'; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
  };
</script></body></html>`;

const keys = new Map();   // key -> target
const seen = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/remote' || u.pathname === '/local') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html(u.pathname === '/remote')); return; }
  if (u.pathname === '/api/download-key' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p = '';
      try { p = JSON.parse(body).path; } catch { p = ''; }
      seen.push({ mint: p });
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

async function saved(page, act) {
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
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
      chk(b === 'file for /api/agent/max/files/download?name=a+b.txt', tag + 'a link a script makes and clicks saves the file too', JSON.stringify({ b, seen }));

      seen.length = 0;
      const c = await saved(page, () => page.click('a.exp'));
      chk(c === 'file for /api/agent/max/export' && seen.some((s) => s.get === '/api/agent/max/export' && !s.key), tag + 'no key given (an older board): the link opens as it always did', JSON.stringify({ c, seen }));

      seen.length = 0;
      await saved(page, () => page.click('a.plain'));
      chk(!seen.some((s) => 'mint' in s), tag + 'a link that is not a download route asks for no key', JSON.stringify(seen));

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
