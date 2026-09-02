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
 *     test-support/release-fixture.js      (t, {platformKey, version, binary, checksum})
 *     engine/connect.nobinary-1580.test.js (t, binary, checksum)
 *     engine/connect.test.js               (t, {version, binary, checksum})
 *     engine/connect.install-997.test.js   (t, {version, binary, checksum}, opts)
 *
 * ⚠️ COUNT THESE BEFORE EDITING THE LINE ABOVE, DO NOT REMEMBER THEM:
 * `git grep -n 'function serveRelease'`. This comment's whole job is counting
 * copies and it has been wrong by 2x.
 *
 * 🔑 WHICH IS WHY THIS TAKES A SINGLE NAMED-OPTIONS ARGUMENT. The four
 * disagree about what the SECOND positional parameter means -- three take an
 * options object and no two of those three accept the same keys, while the
 * fourth takes a raw Buffer -- so a call copied
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
  /* 🛑 RESIDUAL, NAMED RATHER THAN GUARDED. A platformKey that is well-formed but
     WRONG (not what connect.platformKey() returns on this machine) still produces
     "the download service has no build for this kind of Mac" -- the same
     download-shaped error the guards above exist to prevent. It is not checkable
     here without importing connect, which this helper deliberately does not do.
     Pass connect.platformKey(); a hardcoded 'darwin-arm64' works until somebody
     runs the suite on x64. */
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
     from the body, which is exactly the class the guard exists to prevent.

     🛑 THIS RUNS AFTER THE platformKey GUARD, AND THE ORDER IS LOAD-BEARING.
     The reverse has been proposed, reasoning that a typo'd key deserves the
     more diagnostic message. MEASURED, AND IT IS WRONG: `Object.keys()` on a
     BUFFER returns its numeric indices, so the sibling positional shape
     `serveRelease(t, Buffer.from('x'))` -- connect.nobinary-1580's call, the
     likeliest migration mistake there is -- stops reporting "needs a
     platformKey string" and reports "unknown option(s): 0, 1, ..." instead.
     That names nothing the caller can act on. The typo case the reorder would
     help already has its own arm and is answered correctly either way, so the
     swap trades a real regression for no gain. Keep this second. */
  const unknown = Object.keys(opts).filter((k) => !KNOWN_OPTIONS.includes(k));
  if (unknown.length) {
    throw new TypeError(
      `serveRelease() got unknown option(s): ${unknown.join(', ')}. `
      + `Known options are ${KNOWN_OPTIONS.join(', ')}. `
      + 'A silently-dropped option is how a fixture mistake becomes a download error.');
  }
  /* `download()` validates the version (connect.js:758,
     `^\d+\.\d+\.\d+[A-Za-z0-9.-]*$` -- quoted in FULL because the guard below
     copies it character for character, and an abbreviated `^\d+\.\d+\.\d+`
     here would read as the fixture being MORE PERMISSIVE than the production it
     mirrors), and a
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
  /* 🔑 THE FORMAT, NOT JUST THE TYPE. A non-hex value does not surface as a
     checksum problem: `download()` reports "the download service has no build for
     this kind of Mac", a DOWNLOAD-shaped error for a FIXTURE-shaped mistake. Same
     class the version guard above closes, one field over.

     ⚠️ CASE-INSENSITIVE ON PURPOSE, AND MIRRORING PRODUCTION RATHER THAN BEING
     STRICTER THAN IT. `download()` lowercases before testing `^[a-f0-9]{64}$`,
     and its own comment says rejecting uppercase "would blame the Mac" for a
     formatting difference. 🛑 DO NOT TIGHTEN THIS TO `[a-f0-9]`: production
     accepts uppercase, and a guard stricter than the production it mirrors
     forecloses a fixture exercising the normalisation path. */
  if (checksum !== undefined && (typeof checksum !== 'string' || !/^[a-fA-F0-9]{64}$/.test(checksum))) {
    throw new TypeError(
      `serveRelease({checksum}) must be 64 hex characters, which is what download() requires after `
      + `lowercasing; got ${typeof checksum === 'string' ? JSON.stringify(checksum) : Object.prototype.toString.call(checksum)}. `
      + 'A malformed checksum surfaces as a download error rather than a fixture one.');
  }
  if (binary !== undefined && !Buffer.isBuffer(binary)) {
    throw new TypeError(
      `serveRelease({binary}) must be a Buffer; got ${Object.prototype.toString.call(binary)}.`);
  }
  const body = binary || crypto.randomBytes(8 * 1024);
  /* An explicit checksum is HONOURED, not overridden: ALL THREE sibling copies
     take one so a test can serve a body that does NOT match its manifest, which
     is the only way to exercise the checksum-mismatch path. Without this the
     migration this docblock recommends could not be done for connect.test.js. */
  /* The guard above narrowed this to undefined or 64 hex chars. */
  const served = checksum !== undefined
    ? checksum
    : crypto.createHash('sha256').update(body).digest('hex');
  /* `Object.create(null)` rather than a literal: the lookup below is
     `paths[req.url]`, and on a literal that reaches Object.prototype, so a
     request for `/constructor` would find a function and CALL it. Not reachable
     through a real `req.url` (it always has a leading slash), but this is a
     shared helper and the class costs one line to remove. */
  const paths = Object.assign(Object.create(null), {
    '/latest': () => version,
    [`/${version}/manifest.json`]: () => JSON.stringify({ platforms: { [platformKey]: { checksum: served } } }),
    [`/${version}/${platformKey}/claude`]: () => body,
  });
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
          /* A callback so a close on an already-closed server reports rather
             than throwing ERR_SERVER_NOT_RUNNING out of the teardown. */
          server.close(() => {});
        });
      } catch (err) {
        /* A `t` without `after` throws INSIDE the listen callback. MEASURED
           with this catch deleted: the promise never settles, the other arms
           still pass, and the FILE fails ~120s later with "Promise resolution
           is still pending but the event loop has already resolved". It does
           NOT kill the process, which is the intuitive guess and is wrong. A two-minute hang blamed on the
           file is worse than a fast red on the arm, because a hang reads as a
           flake and gets retried. Converting it to a rejection is the point.
           Armed by test-support.release-fixture.test.js. */
        server.close(() => {});
        reject(err);
        return;
      }
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

module.exports = { serveRelease };
