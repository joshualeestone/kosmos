'use strict';

/**
 * #1633: `test-support/release-fixture.js` is a SHARED helper, and its
 * siblings each have a test. This is the missing one, and it exists mostly for
 * the refusal:
 *
 * 🛑 IT LIVES AT THE REPO ROOT, NOT BESIDE THE HELPER, AND THAT IS NOT A STYLE
 * CHOICE. `tools/run-tests.sh:103` is `node --test engine/*.test.js *.test.js`.
 * It globs engine/ and the root and NOTHING ELSE, so a test placed in
 * test-support/ is never run. It was placed there first and the suite total did
 * not move, which is the only reason it was noticed: three private
 * `serveRelease` copies in `engine/` take DIFFERENT positional arguments, so a
 * call copied between files must fail loudly rather than serve a manifest
 * keyed "[object Object]".
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serveRelease } = require('./test-support/release-fixture');

test('it serves a manifest and a binary for the platform key it is given', async (t) => {
  const base = await serveRelease(t, { platformKey: 'darwin-arm64', version: '1.2.3' });
  const latest = await (await fetch(`${base}/latest`)).text();
  assert.equal(latest, '1.2.3');
  const manifest = await (await fetch(`${base}/1.2.3/manifest.json`)).json();
  assert.ok(manifest.platforms['darwin-arm64'], 'the manifest is not keyed by the platform key it was given');
  const bin = Buffer.from(await (await fetch(`${base}/1.2.3/darwin-arm64/claude`)).arrayBuffer());
  const crypto = require('node:crypto');
  assert.equal(crypto.createHash('sha256').update(bin).digest('hex'),
    manifest.platforms['darwin-arm64'].checksum,
    'the served binary does not hash to the checksum the manifest publishes');
});

test('an unknown path is a 404, so a wrong URL cannot read as a served file', async (t) => {
  const base = await serveRelease(t, { platformKey: 'darwin-arm64' });
  assert.equal((await fetch(`${base}/no/such/path`)).status, 404);
});

/**
 * ⭐ THE ARM THIS FILE EXISTS FOR. Without it the helper accepts a sibling's
 * calling convention and fails later as a DOWNLOAD error, which sends the
 * reader to the wrong place entirely.
 */
test('a sibling call shape is REFUSED, not silently accepted', async (t) => {
  await assert.rejects(
    async () => serveRelease(t, { version: '9.9.5', binary: Buffer.from('x') }),
    /needs a platformKey string/,
    'an options object with no platformKey was accepted; it would key the manifest wrong');
  // connect.nobinary-1580.test.js's shape: (t, binary, checksum)
  await assert.rejects(
    async () => serveRelease(t, Buffer.from('x')),
    /needs a platformKey string/,
    "a positional Buffer was accepted; that is a sibling's second argument");
  // connect.install-997.test.js's shape: (t, {...}, opts) -- a THIRD positional
  // whose opts.dieMidStream changes what the server does. Dropped silently, a
  // migrator gets a healthy download where the test needs a mid-stream death.
  await assert.rejects(
    async () => serveRelease(t, { platformKey: 'darwin-arm64' }, { dieMidStream: true }),
    /extra positional argument/,
    'a third positional was accepted and dropped; that is install-997 shape');
});

test('a KNOWN option of the wrong TYPE or FORMAT is refused, not silently dropped', async (t) => {
  await assert.rejects(
    async () => serveRelease(t, { platformKey: 'darwin-arm64', checksum: Buffer.from('ab') }),
    /checksum.*64 hex/,
    'a Buffer checksum was dropped in favour of a hash of the body');
  /* ⭐ FORMAT, not just type. A plausible-looking string that download() would
     reject surfaces as "no build for this kind of Mac", a download-shaped error
     for a fixture mistake. A type-only guard let this through. */
  await assert.rejects(
    async () => serveRelease(t, { platformKey: 'darwin-arm64', checksum: 'not-a-real-sha' }),
    /checksum.*64 hex/,
    'a malformed hex checksum was accepted; download() would reject it as a platform error');
  /* ⭐ UPPERCASE IS ACCEPTED, because download() lowercases before testing and
     its own comment says refusing it "would blame the Mac". An earlier arm here
     asserted the opposite and was wrong about production. */
  const upper = await serveRelease(t, { platformKey: 'darwin-arm64', checksum: 'F'.repeat(64) });
  assert.match(upper, /^http:\/\/127\.0\.0\.1:\d+$/,
    'uppercase hex was refused; the guard is stricter than the download() it mirrors');
  await assert.rejects(
    async () => serveRelease(t, { platformKey: 'darwin-arm64', binary: 'not a buffer' }),
    /binary.*must be a Buffer/,
    'a string binary was accepted');
});

test('a caller-supplied binary is the body actually SERVED', async (t) => {
  const mine = Buffer.from('a body only this test would produce');
  const base = await serveRelease(t, { platformKey: 'darwin-arm64', binary: mine });
  const got = Buffer.from(await (await fetch(`${base}/9.9.5/darwin-arm64/claude`)).arrayBuffer());
  assert.deepEqual(got, mine, 'the helper served something other than the binary it was given');
});

/**
 * ⭐ THE SILENTLY-DROPPED-OPTION ARM. Guarding only a MISSING platformKey left
 * the natural migration shape accepted and silently wrong one field over: two
 * sibling copies take a `checksum`, and it was being discarded in favour of one
 * computed from the body.
 */
test('an unknown option is REFUSED rather than silently dropped', async (t) => {
  await assert.rejects(
    async () => serveRelease(t, { platformKey: 'darwin-arm64', chekcsum: 'typo' }),
    /unknown option\(s\): chekcsum/,
    'a misspelled option was accepted and ignored');
});

test('an explicit checksum is HONOURED, so the mismatch path can be exercised', async (t) => {
  const wrong = 'f'.repeat(64);
  const base = await serveRelease(t, { platformKey: 'darwin-arm64', checksum: wrong });
  const manifest = await (await fetch(`${base}/9.9.5/manifest.json`)).json();
  assert.equal(manifest.platforms['darwin-arm64'].checksum, wrong,
    'the caller checksum was overridden, so no test could serve a body that fails its manifest');
});

test('a version download() would reject is refused HERE, with a fixture-shaped message', async (t) => {
  await assert.rejects(
    async () => serveRelease(t, { platformKey: 'darwin-arm64', version: 'latest' }),
    /must look like 1\.2\.3/,
    "'latest' was accepted; download() would report it as a service fault");
});

/**
 * ⭐ THE `= {}` DEFAULT FILLS ONLY `undefined`, SO AN EXPLICIT `null` REACHES
 * THE DESTRUCTURE. Without the guard that is a raw "Cannot destructure property
 * 'platformKey' of 'opts' as it is null", which names a variable inside the
 * helper rather than the call that was wrong. Nothing exercised this until
 * iteration 8, in the file whose own docblock says it exists mostly for the
 * refusal.
 */
test('a null options object is refused in this file\'s own voice, not by the destructure', async (t) => {
  await assert.rejects(
    async () => serveRelease(t, null),
    /takes \(t, options-object\)/,
    'an explicit null reached the destructure and threw a raw language error');
  /* An array is an object to `typeof`, which is why the guard tests it. */
  await assert.rejects(
    async () => serveRelease(t, []),
    /takes \(t, options-object\)/,
    'an array was accepted as an options object');
});

/**
 * ⭐ A `t` WITHOUT `after` IS A REAL MISUSE SHAPE: the three private
 * serveRelease copies are called from inside `test()` callbacks, and a migrator
 * moving one into a helper or a `describe` block can pass something that is not
 * a test context. The catch exists so that throws as a FAILED TEST rather than
 * an uncaught exception inside a listen callback, which kills the process and
 * takes the rest of the suite with it.
 *
 * 🛑 WHAT REMOVING THE CATCH ACTUALLY DOES, MEASURED RATHER THAN ASSUMED
 * (iteration 8, by deleting the try/catch and running this file):
 *
 *   TypeError: t.after is not a function   thrown from the listen callback
 *   10 of 11 arms                          STILL PASS
 *   this arm                               never settles
 *   the FILE                               fails after 119866ms with
 *                                          "Promise resolution is still pending
 *                                           but the event loop has already
 *                                           resolved"
 *
 * ⚠️ SO THE FAILURE IS A TWO-MINUTE HANG ATTRIBUTED TO THE FILE, NOT A RED ON
 * THIS ARM. That matters more than it sounds: in CI a two-minute hang reads as
 * a timeout or a flake, which is the one failure shape people retry rather than
 * investigate. Read a green here as "the promise settled" -- the arm proves the
 * catch converts an unsettleable promise into an ordinary rejection, and the
 * run finishing in milliseconds instead of minutes is the other half of it.
 *
 * 📌 An earlier draft of this block said the throw "kills the process". That
 * was inherited from the helper's own comment and never measured; the run does
 * not die, it hangs. Corrected rather than annotated.
 */
test('a t without after() rejects instead of hanging the file', async () => {
  await assert.rejects(
    async () => serveRelease({}, { platformKey: 'darwin-arm64' }),
    /after/,
    'a non-test-context t did not reject; without the catch this file hangs ~120s instead');
});

/**
 * 📌 NOT ARMED, DEFERRED WITH REASONING (iteration 8). The third refusal path,
 * `server.on('error', reject)` before `listen`, has no arm here. Its trigger is
 * a failed bind, and this helper always calls `listen(0, '127.0.0.1')` -- an
 * ephemeral port, which the kernel picks from the free set, so the collision it
 * defends against cannot be produced through the helper's own API. Arming it
 * would mean reaching past the public surface to stub `http.createServer`,
 * which tests the stub rather than the helper. The guard stays because a future
 * caller passing a fixed port would need it; it is recorded as unarmed rather
 * than quietly counted as covered.
 */

test('CONTROL: the refusal is not unconditional, a correct call still resolves', async (t) => {
  const base = await serveRelease(t, { platformKey: 'darwin-arm64' });
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/,
    'the helper refuses everything, so the refusals above prove nothing');
});
