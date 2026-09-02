'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cloudflare-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const cloudflare = require('./cloudflare');

const good = { ok: true, status: 200, body: { success: true, result: { id: 'abc123abc123abc123abc123abc123ab', status: 'active' } } };
const revoked = { ok: false, status: 401, body: { success: false, errors: [{ message: 'Invalid API Token' }], result: null } };
const saw = [];
const fake = (answer) => async (url, tok) => { saw.push(tok); return answer; };

test.beforeEach(() => { saw.length = 0; try { fs.unlinkSync(cloudflare.FILE); } catch { /* none */ } });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('not connected until a token is held, and what is not a token is refused before Cloudflare is asked', async () => {
  const s = await cloudflare.state();
  assert.deepEqual([s.connected, s.held, s.kind], [false, false, 'token']);
  cloudflare.setFetcher(fake(good));
  assert.equal((await cloudflare.connect('')).refused, 'paste the token first');
  assert.match((await cloudflare.connect('abc def ghijklmnopqrstuvwxyz')).refused, /no spaces/);
  assert.match((await cloudflare.connect('short')).refused, /too short/);
  assert.equal(saw.length, 0, 'Cloudflare was asked about something that was not a token');
  assert.ok(!fs.existsSync(cloudflare.FILE), 'a refused token was stored');
});

test('a token Cloudflare calls active is stored mode 600 and the state is read back from Cloudflare, never from the file alone', async () => {
  cloudflare.setFetcher(fake(good));
  const s = await cloudflare.connect('cf_test_token_abcdefghijklmnopqrstuvwxyz');
  assert.equal(s.refused, undefined);
  assert.equal(s.connected, true);
  assert.equal(s.tokenId, 'abc123abc123abc123abc123abc123ab');
  assert.ok(!JSON.stringify(s).includes('cf_test_token'), 'the answer must never carry the token');
  assert.equal((fs.statSync(cloudflare.FILE).mode & 0o777), 0o600);
  assert.equal(fs.readFileSync(cloudflare.FILE, 'utf8').trim(), 'cf_test_token_abcdefghijklmnopqrstuvwxyz');
  // Revoked on Cloudflare's side: the file is still there, and the door says so instead of "connected".
  cloudflare.setFetcher(fake(revoked));
  const later = await cloudflare.state();
  assert.deepEqual([later.connected, later.held], [false, true]);
  assert.match(later.because, /did not accept that token: Invalid API Token/);
  const gone = await cloudflare.forget();
  assert.deepEqual([gone.connected, gone.held], [false, false]);
  assert.ok(!fs.existsSync(cloudflare.FILE));
});

test('a token Cloudflare rejects is not stored, and an unreachable Cloudflare says so', async () => {
  cloudflare.setFetcher(fake(revoked));
  const s = await cloudflare.connect('cf_bad_token_abcdefghijklmnopqrstuvwxyz');
  assert.match(s.refused, /did not accept that token/);
  assert.ok(!fs.existsSync(cloudflare.FILE));
  cloudflare.setFetcher(async () => { throw new Error('ENOTFOUND'); });
  const off = await cloudflare.connect('cf_any_token_abcdefghijklmnopqrstuvwxyz');
  assert.match(off.refused, /could not reach Cloudflare/);
});

/* 🛑 #1787: THE MODE ASSERTION ABOVE PASSES WHETHER OR NOT THIS IS FIXED, and that
   is why the defect survived. Both shapes end at 0600: the old one wrote the
   credential into a pre-existing 0644 file (where the `mode:` option is silently
   IGNORED) and chmodded it afterwards, so the secret bytes sat readable in
   between. No END-STATE assertion can separate them.
   ⭐ THE INODE CAN. `rename` REPLACES the target's inode; a write in place REUSES
   it. That is the only observable difference and it is exactly the property the
   temp-then-rename writer exists to provide.
   ⚠️ VERIFIED BY REVERTING THIS CALL SITE to the old shape: with only the tests
   that existed before this arm, everything stayed green. A guard on the writer is
   NOT a guard on its invocation. */
test('#1787: a pre-existing loose credential file is REPLACED, not rewritten in place', async () => {
  fs.mkdirSync(path.dirname(cloudflare.FILE), { recursive: true });
  fs.writeFileSync(cloudflare.FILE, 'OLD-TOKEN\n');
  fs.chmodSync(cloudflare.FILE, 0o644);
  assert.equal(fs.statSync(cloudflare.FILE).mode & 0o777, 0o644,
    'the loose plant did not take, so this arm would pass without the fix');
  const inodeBefore = fs.statSync(cloudflare.FILE).ino;

  cloudflare.setFetcher(fake(good));
  let s;
  try {
    s = await cloudflare.connect('cf_test_token_abcdefghijklmnopqrstuvwxyz');
    assert.equal(s.connected, true, 'the connect failed, so nothing was tested');

    assert.notEqual(fs.statSync(cloudflare.FILE).ino, inodeBefore,
      'the credential was written IN PLACE into the pre-existing loose file: same inode '
      + 'means no rename, so the token bytes were on disk at 0644 before the chmod');
    assert.equal(fs.statSync(cloudflare.FILE).mode & 0o777, 0o600,
      'the credential was left loose');
  } finally {
    /* Restore on EVERY path, matching the two sibling arms added in this change. A
       failing assertion above would otherwise leak a live fetcher AND a stored
       credential into any test added after this one. */
    cloudflare.setFetcher(null);
    try { fs.unlinkSync(cloudflare.FILE); } catch { /* nothing stored */ }
  }
});

/* 🛑 A WRITER THROW MUST COME BACK AS A REFUSAL, NOT PROPAGATE. The route's
   `.catch(() => …)` in server.js DISCARDS the error and answers "we could not read
   that request", so without this the operator is told their paste was unreadable on
   a token Cloudflare just verified.
   ⭐ The arm pins the SENTENCE, not merely `refused` being truthy: a verify failure
   also sets `refused`, so a bare truthiness check would pass while the bug is live. */
test('#1787: a writer throw comes back as a refusal, not an unreadable-request error', async () => {
  const securewrite = require('./securewrite');
  const realWriteSecret = securewrite.writeSecret;
  securewrite.writeSecret = () => {
    const e = new Error('refusing to write a secret through a symlink at /x');
    e.code = 'ERR_KOSMOS_SYMLINK'; // the writer's own code since iteration 7, not the kernel's ELOOP
    throw e;
  };
  cloudflare.setFetcher(fake(good));
  let st = null;
  let threw = null;
  try {
    st = await cloudflare.connect('cf_test_token_abcdefghijklmnopqrstuvwxyz');
  } catch (e) {
    threw = e;
  } finally {
    securewrite.writeSecret = realWriteSecret;
    cloudflare.setFetcher(null);
  }

  assert.equal(threw, null,
    'connect() threw instead of refusing, so server.js answers "we could not read that '
    + 'request" on a token Cloudflare accepted');
  assert.match(String((st && st.refused) || ''), /could not save the token/,
    'the write failure was not reported as a refusal');
  assert.equal(st.connected, false, 'a failed write reported as connected');
});
