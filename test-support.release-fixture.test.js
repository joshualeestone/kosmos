'use strict';

/**
 * #1633: `test-support/release-fixture.js` is a SHARED helper, and its
 * siblings each have a test. This is the missing one, and it exists mostly for
 * the refusal:
 *
 * 🛑 IT LIVES AT THE REPO ROOT, NOT BESIDE THE HELPER, AND THAT IS NOT A STYLE
 * CHOICE. `tools/run-tests.sh:103` is `node --test engine/*.test.js *.test.js`.
 * It globs engine/ and the root and NOTHING ELSE, so a test placed in
 * test-support/ is never run. I put it there first and the suite total stayed
 * at 3254 with four new tests written, which is the only reason I noticed: three private
 * `serveRelease` copies in `engine/` take DIFFERENT positional arguments, so a
 * call copied between files must fail loudly rather than serve a manifest
 * keyed "[object Object]".
 */
const { test } = require('node:test');
const assert = require('node:assert');
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
});

test('CONTROL: the refusal is not unconditional, a correct call still resolves', async (t) => {
  const base = await serveRelease(t, { platformKey: 'darwin-arm64' });
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/,
    'the helper refuses everything, so the refusals above prove nothing');
});
