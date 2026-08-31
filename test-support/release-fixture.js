'use strict';

/**
 * A local release server for tests that drive a flow into `download()`.
 *
 * 🛑 WHY THIS EXISTS AS A SHARED HELPER (#1633). The same server was written
 * twice, verbatim, in `engine/connect.nobinary-1580.test.js` and again in
 * `engine/connect.becomestuck-arm-1633.test.js`, down to the `9.9.5` version
 * string and the manifest shape. Two copies of a fixture that models a
 * PRODUCTION URL LAYOUT drift the moment that layout changes: one copy gets
 * updated and the other keeps passing against a shape nothing serves. This
 * repo already carries a standing note about a three-way copy of
 * `claudeBinPath` that "silently disagreed" once one rung changed.
 *
 * ⚠️ WITHOUT IT THE TEST HITS downloads.claude.ai FOR REAL. `download()` uses
 * plain node http/https and is OUTSIDE the injected runner seam, so a runner
 * stub does not intercept it. Measured on #1633 before this was added: ~5.3s
 * per arm against the live service versus ~65ms against a dead port, and BOTH
 * arms passed either way, so the suite could never have revealed it.
 *
 * Returns the base URL. Registers its own teardown on `t`, and closes live
 * keep-alive sockets as well as the listener, so a file does not sit at exit
 * waiting for `keepAliveTimeout`.
 */
const http = require('node:http');
const crypto = require('node:crypto');

function serveRelease(t, platformKey, { version = '9.9.5', binary } = {}) {
  const body = binary || crypto.randomBytes(8 * 1024);
  const checksum = crypto.createHash('sha256').update(body).digest('hex');
  const paths = {
    '/latest': () => version,
    [`/${version}/manifest.json`]: () => JSON.stringify({ platforms: { [platformKey]: { checksum } } }),
    [`/${version}/${platformKey}/claude`]: () => body,
  };
  const server = http.createServer((req, res) => {
    const answer = paths[req.url];
    if (!answer) { res.writeHead(404); res.end(); return; }
    const out = Buffer.isBuffer(answer()) ? answer() : Buffer.from(answer());
    res.writeHead(200, { 'content-length': out.length });
    res.end(out);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => {
        /* closeAllConnections first: close() alone leaves established
           keep-alive sockets open and the process lingers. */
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close();
      });
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

module.exports = { serveRelease };
