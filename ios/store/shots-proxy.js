'use strict';
/* #6262: the address the iPhone app opens for the App Store screenshots (ios/store/shoot-app.sh).
 *
 *   node ios/store/shots-proxy.js <listen-host> <listen-port> <board-base> <checkout-root>
 *
 * Passes every request to the throwaway board that docs/browser-checks/mobile-shots.js --keep --data store
 * serves, for two reasons:
 * - The app must open the board at an address that is not loopback. The board picks its phone-app layout
 *   (html.kremote, kplusRemote() in web/index.html) from its own address, and the real app always opens a
 *   computer at <computer>.kosmosplus.com. The board is asked as itself (Host, Origin and Referer say the
 *   board's own loopback address), the same as mobile-shots.js --remote does through the browser's router.
 * - /api/status says the Claude subscription is connected, as mobile-shots.js does in the page for the store
 *   set (DATA_SETS.store.connected): the sandbox has no Claude account on purpose, and a customer's Mac does.
 *   Every other field, and every other route, is the board's own.
 * - THE LEAK GUARD for this path. mobile-shots.js reads each page in its browser; the app's pictures never pass
 *   through it, so every answer the board gives (all but the shipped page itself, web/index.html, the same for
 *   everyone) is read here with the same checks (docs/browser-checks/lib-leak-guard.js: an email the board
 *   injected, a key, this Mac's home path, user name or host name). A hit is refused, never passed on, and
 *   printed as "LEAK" by kind and length only; shoot-app.sh then files nothing.
 *   One value is replaced before the check, not let through: the board writes where its `kosmos` command lives
 *   into every agent's instructions, and the throwaway board runs from this checkout, whose path holds this Mac's
 *   user name. On a customer's computer that is the installed command, ~/.local/share/kosmos/bin/kosmos, so the
 *   checkout's path becomes that path for a made-up user (/Users/you). None of the four screens shows it.
 * Prints "listening <url>" once it is up. Stop it with a signal.
 */
const http = require('node:http');
const path = require('node:path');
const { hitsIn } = require(path.join(__dirname, '..', '..', 'docs', 'browser-checks', 'lib-leak-guard.js'));
const leak = (where, hits) => { process.stderr.write('LEAK ' + where + ': ' + hits.join(', ') + '\n'); };

const [host, port, boardBase, checkout] = process.argv.slice(2);
if (!host || !/^\d+$/.test(port || '') || !/^http:\/\/127\.0\.0\.1:\d+$/.test(boardBase || '') || !path.isAbsolute(checkout || '')) {
  process.stderr.write('usage: shots-proxy.js <listen-host> <listen-port> http://127.0.0.1:<board-port> <checkout-root>\n');
  process.exit(2);
}
const INSTALLED = '/Users/you/.local/share/kosmos';
const asInstalled = (t) => t.split(checkout + '/install/kosmos').join(INSTALLED + '/bin/kosmos').split(checkout).join(INSTALLED + '/app');
const board = new URL(boardBase);
const ours = `http://${host}:${port}`;

http.createServer((req, res) => {
  const headers = { ...req.headers, host: board.host };
  for (const h of ['origin', 'referer']) {
    if (typeof headers[h] === 'string' && headers[h].startsWith(ours)) headers[h] = board.origin + headers[h].slice(ours.length);
  }
  const status = req.method === 'GET' && new URL(req.url, board).pathname === '/api/status';
  delete headers['accept-encoding'];   // every answer is read (and /api/status rewritten), so ask for it plain
  const up = http.request({ host: board.hostname, port: board.port, method: req.method, path: req.url, headers }, (r) => {
    const out = { ...r.headers };
    if (typeof out.location === 'string' && out.location.startsWith(board.origin)) out.location = ours + out.location.slice(board.origin.length);
    const type = String(r.headers['content-type'] || '');
    const pathname = new URL(req.url, board).pathname;
    // The shipped page and binary files pass as they are; everything else is read whole before it is sent on.
    if (/^text\/html/.test(type) || /^(image|font|audio|video)\//.test(type) || /\.(png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(pathname)) {
      res.writeHead(r.statusCode, out); r.pipe(res); return;
    }
    if (/^text\/event-stream/.test(type)) {   // a stream never ends: read it as it passes
      res.writeHead(r.statusCode, out);
      r.on('data', (c) => { const t = asInstalled(c.toString('utf8')); const h = hitsIn(t); if (h.length) { leak(pathname, h); res.destroy(); r.destroy(); } else res.write(t); });
      r.on('end', () => res.end());
      return;
    }
    if (r.headers['content-encoding'] && r.headers['content-encoding'] !== 'identity') {
      leak(pathname, ['an encoded answer the guard cannot read (' + r.headers['content-encoding'] + ')']);
      res.writeHead(502); res.end(); r.resume(); return;
    }
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const text = asInstalled(raw);
      const hits = hitsIn(text);
      if (hits.length) { leak(pathname, hits); res.writeHead(502); res.end(); return; }
      let body = text === raw ? Buffer.concat(chunks) : Buffer.from(text);
      delete out['content-length'];
      if (!status || r.statusCode !== 200) { res.writeHead(r.statusCode, { ...out, 'content-length': body.length }); res.end(body); return; }
      try {
        const j = JSON.parse(body.toString('utf8'));
        if (j && typeof j === 'object') {
          j.connection = { ...(j.connection || {}), state: 'connected' };
          body = Buffer.from(JSON.stringify(j));
        }
      } catch { /* not JSON: pass it through as the board sent it */ }
      res.writeHead(r.statusCode, { ...out, 'content-length': body.length });
      res.end(body);
    });
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(Number(port), host, () => console.log('listening ' + ours));
