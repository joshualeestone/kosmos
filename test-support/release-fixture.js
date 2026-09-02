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
const KNOWN_OPTIONS = ['platformKey', 'version', 'binary', 'checksum'];

function serveRelease(t, opts = {}, ...extra) {
  /* `= {}` only fills `undefined`, so an explicit null reaches the destructure
     below and throws a raw "Cannot destructure property" instead of this file's
     attributable message. Keep every refusal in one voice. */
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError(
      `serveRelease() takes (t, options-object); got ${Object.prototype.toString.call(opts)} as the second argument.`);
  }
  /* 🛑 A THIRD POSITIONAL IS A SIBLING'S SHAPE, NOT A TYPO.
     engine/connect.install-997.test.js is serveRelease(t, {...}, opts) and its
     opts.dieMidStream changes what the server DOES (promise 1MB, deliver 64KB,
     destroy the socket). Accepted and dropped, a migrator would get a healthy
     download where the test needs a mid-stream death, and the test would pass
     for the wrong reason. */
  if (extra.length) {
    throw new TypeError(
      `serveRelease() got ${extra.length} extra positional argument(s). It takes (t, options). `
      + 'Two siblings arrive as three arguments: connect.install-997.test.js is '
      + '(t, {...}, opts) whose opts.dieMidStream changes what the server DOES, and '
      + 'connect.nobinary-1580.test.js is (t, binary, checksum). Neither shape is '
      + 'implemented here, so a dropped third argument would silently change '
      + 'behaviour or lose a checksum.');
  }
  const { platformKey, version = '9.9.5', binary, checksum } = opts;
  /* 🛑 A LOUD REFUSAL, because the alternative is a download-shaped error for a
     fixture-shaped mistake. See the docblock. */
  if (typeof platformKey !== 'string' || !platformKey) {
    throw new TypeError(
      'serveRelease({platformKey}) needs a platformKey string, e.g. connect.platformKey(). '
      + `Got ${Object.prototype.toString.call(platformKey)}. `
      + 'Note this helper takes ONE options object; the three private serveRelease '
      + 'copies in engine/ take different positional arguments.');
  }
  /* 🛑 AN UNKNOWN KEY IS REFUSED, NOT IGNORED, and this is the half the first
     version got wrong. Guarding only a MISSING platformKey left the natural
     migration shape accepted-and-silently-wrong one field over: a caller
     passing a sibling's `checksum` had it discarded in favour of one computed
     from the body, which is exactly the class the guard exists to prevent. */
  const unknown = Object.keys(opts).filter((k) => !KNOWN_OPTIONS.includes(k));
  if (unknown.length) {
    throw new TypeError(
      `serveRelease() got unknown option(s): ${unknown.join(', ')}. `
      + `Known options are ${KNOWN_OPTIONS.join(', ')}. `
      + 'A silently-dropped option is how a fixture mistake becomes a download error.');
  }
  /* `download()` validates the version (connect.js, `^\d+\.\d+\.\d+`), and a
     bad one surfaces as "the download service did not answer with a version",
     which reads as a service fault rather than a fixture one. Refuse here. */
  if (!/^\d+\.\d+\.\d+[A-Za-z0-9.-]*$/.test(version)) {
    throw new TypeError(
      `serveRelease({version}) got ${JSON.stringify(version)}, which download() will reject. `
      + 'It must look like 1.2.3.');
  }
  /* 🛑 A KNOWN OPTION OF THE WRONG TYPE IS REFUSED, NOT IGNORED. The unknown-key
     guard above catches a wrong NAME; this catches a wrong TYPE, which is the
     same silent-drop one field over: `checksum: Buffer.from(...)` or `null`
     would otherwise fall back to a hash of the body with no complaint. */
  /* 🔑 THE FORMAT, NOT JUST THE TYPE. `download()` requires ^[a-f0-9]{64}$, and a
     non-conforming value does not surface as a checksum problem: it comes back as
     "the download service has no build for this kind of Mac", a DOWNLOAD-shaped
     error for a FIXTURE-shaped mistake. That is the exact class the version guard
     above closes, and a type-only check left it open one field over. */
  if (checksum !== undefined && (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum))) {
    throw new TypeError(
      `serveRelease({checksum}) must be 64 lowercase hex characters, which is what download() requires; `
      + `got ${typeof checksum === 'string' ? JSON.stringify(checksum) : Object.prototype.toString.call(checksum)}. `
      + 'A malformed checksum surfaces as a download error rather than a fixture one.');
  }
  if (binary !== undefined && !Buffer.isBuffer(binary)) {
    throw new TypeError(
      `serveRelease({binary}) must be a Buffer; got ${Object.prototype.toString.call(binary)}.`);
  }
  const body = binary || crypto.randomBytes(8 * 1024);
  /* An explicit checksum is HONOURED, not overridden: two of the sibling copies
     take one so a test can serve a body that does NOT match its manifest, which
     is the only way to exercise the checksum-mismatch path. Without this the
     migration this docblock recommends could not be done for connect.test.js. */
  const served = typeof checksum === 'string' && checksum
    ? checksum
    : crypto.createHash('sha256').update(body).digest('hex');
  const paths = {
    '/latest': () => version,
    [`/${version}/manifest.json`]: () => JSON.stringify({ platforms: { [platformKey]: { checksum: served } } }),
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
      /* Detached once listening: leaving it attached swallows any later server
         error into an already-settled promise. */
      server.removeListener('error', reject);
      try {
        t.after(() => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        /* A callback so a close on an already-closed server reports rather than
           throwing ERR_SERVER_NOT_RUNNING out of the teardown. */
          server.close(() => {});
        });
      } catch (err) {
        /* A `t` without `after` would otherwise throw INSIDE the listen
           callback, which is uncaught and kills the process rather than
           failing the test that misused the helper. */
        server.close(() => {});
        reject(err);
        return;
      }
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

module.exports = { serveRelease };
