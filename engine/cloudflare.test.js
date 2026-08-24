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
