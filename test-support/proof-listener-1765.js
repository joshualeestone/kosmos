'use strict';
/* #1765: a plain local HTTP listener for the Windows senders' board-proof tests.

   mode 'board'    answers GET /api/board-proof the way the real board does (engine/boardproof.answer) for the one
                   token it holds, and every other request with `reply`.
   mode 'squatter' holds no token. It answers EVERY request, the proof route included, with 200 and a body that
                   looks right ({ proof: <64 hex>, recorded: true, nonce: ... }), so only a real check can tell.

   Every request is recorded with its headers and body, so a test can assert that no token ever arrived. */
const http = require('node:http');
const boardproof = require('../engine/boardproof');

const TOKEN_HEADERS = ['x-kosmos-board-token', 'x-kosmos-agent-token', 'cookie', 'authorization'];

function startListener(opts) {
  const o = opts || {};
  const mode = o.mode || 'squatter';
  const reply = o.reply || { recorded: true, kept: true, nonce: 'ab'.repeat(16), ok: true };
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
      const u = new URL(req.url, 'http://127.0.0.1');
      if (mode === 'board' && u.pathname === boardproof.PROOF_PATH) {
        const out = boardproof.answer(Object.fromEntries(u.searchParams), function* () { if (o.holds) yield o.holds; },
          req.socket.localPort, req.socket.localAddress);
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.body));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(mode === 'squatter' ? { ...reply, proof: 'c'.repeat(boardproof.PROOF_HEX) } : reply));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        url: 'http://127.0.0.1:' + port,
        seen,
        proofRequests: () => seen.filter((r) => r.url.startsWith(boardproof.PROOF_PATH)),
        // Every request that carried any of the given secrets, in a header or the body or the url.
        carrying: (secrets) => seen.filter((r) => secrets.filter(Boolean).some((s) =>
          r.url.includes(s) || r.body.includes(s) || TOKEN_HEADERS.some((h) => String(r.headers[h] || '').includes(s)))),
        close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); }),
      });
    });
  });
}

/* A port on 127.0.0.1 with nothing listening (taken and released at once). */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

module.exports = { startListener, freePort, TOKEN_HEADERS };
