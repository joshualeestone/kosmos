'use strict';

/**
 * A local release server for tests that drive a flow into `download()`.
 *
 * ⚠️ WITHOUT ONE THE TEST HITS downloads.claude.ai FOR REAL. `download()` uses
 * plain node http/https and sits OUTSIDE the injected runner seam, so a runner
 * stub does not intercept it. Measured on #1633 before this existed: ~5.3s per
 * arm against the live service, versus ~70ms against a local fixture.
 *
 * 🛑 THIS DOES NOT DE-DUPLICATE ANYTHING YET, AND SAYING SO IS THE POINT.
 * MEASURED, four definitions of `serveRelease` exist in this repo:
 *
 *     test-support/release-fixture.js      (t, {platformKey, version, binary})
 *     engine/connect.nobinary-1580.test.js (t, binary, checksum)
 *     engine/connect.test.js               (t, {version, binary, checksum})
 *     engine/connect.install-997.test.js   (t, {version, binary, checksum}, opts)
 *
 * An earlier version of this docblock said the server had been written "twice".
 * That was wrong by 2x, in the one comment whose whole job is counting copies,
 * and a review caught it. The count is now measured rather than remembered.
 *
 * 🔑 WHICH IS WHY THIS TAKES A SINGLE NAMED-OPTIONS ARGUMENT. Three of the four
 * disagree about what the SECOND positional parameter means, so a call copied
 * between sibling files would be accepted and silently wrong: an options object
 * arriving where `platformKey` was expected produced a manifest keyed
 * `"[object Object]"`, and the flow then failed with `the download service has
 * no build for this kind of Mac` -- a DOWNLOAD error for what is really a
 * fixture mistake. The floor below turns that into an attributable one.
 *
 * ⇒ Migrating the other three is the real fix and is deliberately NOT done
 * here: they belong to tests other people are editing today, and a shared
 * fixture rewrite is not something to land inside an unrelated card.
 */
const http = require('node:http');
const crypto = require('node:crypto');

/**
 * Returns the base URL. Registers its own teardown on `t`, closing live
 * keep-alive sockets as well as the listener, so a file does not sit at exit
 * waiting for the server's `keepAliveTimeout`.
 */
function serveRelease(t, opts = {}) {
  const { platformKey, version = '9.9.5', binary } = opts;
  /* 🛑 A LOUD REFUSAL, because the alternative is a download-shaped error for a
     fixture-shaped mistake. See the docblock. */
  if (typeof platformKey !== 'string' || !platformKey) {
    throw new TypeError(
      'serveRelease({platformKey}) needs a platformKey string, e.g. connect.platformKey(). '
      + `Got ${Object.prototype.toString.call(platformKey)}. `
      + 'Note this helper takes ONE options object; the three private serveRelease '
      + 'copies in engine/ take different positional arguments.');
  }
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
    const value = answer();
    const out = Buffer.isBuffer(value) ? value : Buffer.from(value);
    res.writeHead(200, { 'content-length': out.length });
    res.end(out);
  });
  return new Promise((resolve, reject) => {
    /* Attached BEFORE listen: a failed bind emits 'error', and with no listener
       that throws and leaves this promise unsettled, which surfaces as a test
       timeout rather than a bind failure. */
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      t.after(() => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        /* A callback so a close on an already-closed server reports rather than
           throwing ERR_SERVER_NOT_RUNNING out of the teardown. */
        server.close(() => {});
      });
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

module.exports = { serveRelease };
