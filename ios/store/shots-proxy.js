'use strict';
/* #6262: the address the iPhone app opens for the App Store screenshots (ios/store/shoot-app.sh).
 *
 *   node ios/store/shots-proxy.js <listen-host> <board-base> <checkout-root>
 *
 * Passes requests to the throwaway board that docs/browser-checks/mobile-shots.js --keep --data store serves.
 * It does three things:
 * - Gives the app an address that is not loopback. The board picks its phone-app layout (html.kremote,
 *   kplusRemote() in web/index.html) from its own address, and the real app always opens a computer at
 *   <computer>.kosmosplus.com. The board is asked as itself (Host, Origin and Referer say the board's own loopback
 *   address), the same as mobile-shots.js --remote does through the browser's router.
 *   Because that disarms the board's own is-it-local checks, the proxy answers only connections from
 *   <listen-host> itself, which is where the simulator's requests come from; anything else on the network is
 *   refused ("REFUSED", which shoot-app.sh treats as a failed run).
 * - Says the Claude subscription is connected in /api/status, as mobile-shots.js does in the page for the store
 *   set (DATA_SETS.store.connected): the sandbox has no Claude account on purpose, and a customer's Mac does.
 *   Every other field, and every other route, is the board's own.
 * - Is the leak guard for this path. mobile-shots.js reads each page in its browser; the app's pictures never
 *   pass through it, so every text answer the board gives (the page itself included) is read whole here with the
 *   same checks (docs/browser-checks/lib-leak-guard.js) before any of it is sent on. Only image, font, audio and
 *   video answers pass unread. A hit, an encoded body or a stream is refused, never passed on, and printed as
 *   "LEAK" by kind and length only; shoot-app.sh then files nothing.
 *   This reads SOURCE (the page's script and comments too), not only what a screen shows, which is stricter than
 *   lib-leak-guard.js's own use on rendered text. So on a Mac whose user or host name is a word in a script or
 *   comment the board serves (other than web/index.html, whose words the lib already exempts), every run stops
 *   here. That is the safe direction: rename nothing to get past it, and do not widen an exemption.
 *   An answer the board breaks off part way is refused and printed as "UPSTREAM", which shoot-app.sh treats as a
 *   failed run (a half-loaded page would otherwise be photographed).
 *   One value is replaced before the check, not let through: the board writes where its `kosmos` command lives
 *   into every agent's instructions, and the throwaway board runs from this checkout, whose path holds this Mac's
 *   user name. On a customer's computer that is the installed command, ~/.local/share/kosmos/bin/kosmos, so the
 *   checkout's path becomes that path for a made-up user (/Users/you).
 * Listens on a free port and prints "listening <url>" once it is up. Stop it with a signal.
 */
const http = require('node:http');
const path = require('node:path');
const { hitsIn } = require(path.join(__dirname, '..', '..', 'docs', 'browser-checks', 'lib-leak-guard.js'));
const leak = (where, hits) => { process.stderr.write('LEAK ' + where + ': ' + hits.join(', ') + '\n'); };

const [host, boardBase, checkout] = process.argv.slice(2);
if (!host || !/^http:\/\/127\.0\.0\.1:\d+$/.test(boardBase || '') || !path.isAbsolute(checkout || '')) {
  process.stderr.write('usage: shots-proxy.js <listen-host> http://127.0.0.1:<board-port> <checkout-root>\n');
  process.exit(2);
}
const INSTALLED = '/Users/you/.local/share/kosmos';
const asInstalled = (t) => t.split(checkout + '/install/kosmos').join(INSTALLED + '/bin/kosmos').split(checkout).join(INSTALLED + '/app');
const board = new URL(boardBase);
let ours = '';
const fromHost = (addr) => addr === host || addr === '::ffff:' + host;

const server = http.createServer((req, res) => {
  if (!fromHost(req.socket.remoteAddress)) {
    process.stderr.write('REFUSED a request from another address\n');
    res.writeHead(403); res.end(); return;
  }
  const headers = { ...req.headers, host: board.host };
  for (const h of ['origin', 'referer']) {
    if (typeof headers[h] === 'string' && headers[h].startsWith(ours)) headers[h] = board.origin + headers[h].slice(ours.length);
  }
  const pathname = new URL(req.url, board).pathname;
  const status = req.method === 'GET' && pathname === '/api/status';
  delete headers['accept-encoding'];   // every text answer is read (and /api/status rewritten), so ask for it plain
  const broke = (why) => {
    process.stderr.write('UPSTREAM ' + pathname + ': ' + why + '\n');
    if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy();
  };
  req.on('error', () => { /* the app went away mid-request: nothing to answer */ });
  const up = http.request({ host: board.hostname, port: board.port, method: req.method, path: req.url, headers }, (r) => {
    r.on('error', () => broke('the answer broke off'));
    const out = { ...r.headers };
    if (typeof out.location === 'string' && out.location.startsWith(board.origin)) out.location = ours + out.location.slice(board.origin.length);
    const type = String(r.headers['content-type'] || '');
    // Binary media pass unread (they are files, and the store set has no pictures of anyone); SVG is text and is read.
    if (/^(image\/(?!svg)|font\/|audio\/|video\/)/.test(type)) { res.writeHead(r.statusCode, out); r.pipe(res); return; }
    const refuse = (why) => { leak(pathname, [why]); res.writeHead(502); res.end(); r.resume(); };
    if (/^text\/event-stream/.test(type)) return refuse('a stream, which cannot be read whole before it is sent');
    if (r.headers['content-encoding'] && r.headers['content-encoding'] !== 'identity') {
      return refuse('an encoded answer the guard cannot read (' + r.headers['content-encoding'] + ')');
    }
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const text = asInstalled(raw);
      const hits = hitsIn(text);
      if (hits.length) { leak(pathname, hits); res.writeHead(502); res.end(); return; }
      if (!r.complete) return;   // broken off: the 'error' handler has refused it
      let body = text === raw ? Buffer.concat(chunks) : Buffer.from(text);
      // Sent whole with its own length: the board's framing and connection headers no longer describe it.
      for (const h of ['content-length', 'transfer-encoding', 'connection', 'keep-alive']) delete out[h];
      if (status && r.statusCode === 200) {
        try {
          const j = JSON.parse(body.toString('utf8'));
          if (j && typeof j === 'object') {
            j.connection = { ...(j.connection || {}), state: 'connected' };
            body = Buffer.from(JSON.stringify(j));
          }
        } catch { /* not JSON: pass it through as the board sent it */ }
      }
      res.writeHead(r.statusCode, { ...out, 'content-length': body.length });
      res.end(body);
    });
  });
  up.on('error', () => broke('the board did not answer'));
  req.pipe(up);
});
server.listen(0, host, () => { ours = `http://${host}:${server.address().port}`; console.log('listening ' + ours); });
