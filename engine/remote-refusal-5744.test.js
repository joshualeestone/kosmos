'use strict';
/**
 * kosmos#5744: remote.macRequest reads the refusal line a tunnel since relay epochfield-5744 prints on stdout
 * ({"refusal":{"status","code","current_epoch"}}) and returns it as `refusal: { status, code, currentEpoch }`.
 * The line is never `because`, even when stderr is empty, and an older tunnel (no line) gives no `refusal`.
 * The tunnel binary is faked (test-support/fake-mac-request.js); macRequest and setupRun run for real.
 *
 *   node --test engine/remote-refusal-5744.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeFakeTunnel } = require('../test-support/fake-mac-request');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-refusal-5744-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-refusal-5744-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example';
const fake = makeFakeTunnel();
process.env.AGENT_WORKFORCE_TUNNEL_BIN = fake.bin;
const remote = require('./remote');

const ROUTE = '/v1/org/backup/member-key';
function enroll() {
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: true, standing: '' }) + '\n');
}
async function ask(mode) {
  process.env.FAKE_MAC_REQUEST_MODE = mode;
  try { return await remote.macRequest('POST', ROUTE, { epoch: 1 }); } finally { delete process.env.FAKE_MAC_REQUEST_MODE; }
}
test.before(enroll);
test.after(() => { fake.cleanup(); for (const d of [SANDBOX, STATE]) fs.rmSync(d, { recursive: true, force: true }); });

test('#5744: a wrong-epoch refusal comes back as fields, and because is the stderr text', async () => {
  const r = await ask('refusal:{"refusal":{"status":400,"code":"member_key_wrong_epoch","current_epoch":2}}');
  assert.equal(r.ok, false);
  assert.deepEqual(r.refusal, { status: 400, code: 'member_key_wrong_epoch', currentEpoch: 2 });
  assert.match(r.because, /\(HTTP 400 on \/v1\/org\/backup\/member-key, code member_key_wrong_epoch\)$/, r.because);
  assert.equal(fake.calls().at(-1).args.includes('mac-request'), true, 'the fake never ran');
});

test('#5744: epoch 0 (no key registered yet) is kept; a null epoch is null', async () => {
  assert.equal((await ask('refusal:{"refusal":{"status":400,"code":"member_key_wrong_epoch","current_epoch":0}}')).refusal.currentEpoch, 0);
  assert.deepEqual((await ask('refusal:{"refusal":{"status":429,"code":"member_key_rotation_wait","current_epoch":null}}')).refusal,
    { status: 429, code: 'member_key_rotation_wait', currentEpoch: null });
  // An epoch beside another code is not read: only member_key_wrong_epoch carries one.
  assert.equal((await ask('refusal:{"refusal":{"status":429,"code":"member_key_rotation_wait","current_epoch":3}}')).refusal.currentEpoch, null);
});

test('#5744: malformed fields read as null, and a line with no usable status is no refusal at all', async () => {
  const bad = await ask('refusal:{"refusal":{"status":400,"code":"a b","current_epoch":9007199254740992}}');
  assert.deepEqual(bad.refusal, { status: 400, code: null, currentEpoch: null });
  for (const line of ['{"refusal":{"status":"400"}}', '{"refusal":{"status":42}}', '{"refusal":null}', '{"other":1}']) {
    const r = await ask('refusal:' + line);
    assert.equal(r.ok, false);
    assert.equal('refusal' in r, false, line);
  }
});

test('#5744: a refusal line spaced or keyed differently is still never because', async () => {
  const r = await ask('refusal-quiet:{ "other": 1, "refusal": {"status":400,"code":"member_key_wrong_epoch","current_epoch":2} }');
  assert.equal(r.because, 'setup failed (exit 1)', r.because);
  assert.equal(r.refusal.currentEpoch, 2);
});

test('#5744: the refusal line is never because, even with an empty stderr', async () => {
  const r = await ask('refusal-quiet:{"refusal":{"status":400,"code":"member_key_wrong_epoch","current_epoch":2}}');
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.because, /refusal/, r.because);
  assert.equal(r.because, 'setup failed (exit 1)');
  assert.equal(r.refusal.currentEpoch, 2, 'the fields are still read');
});

test('#5744 CONTROL: an older tunnel (stderr only, no line) gives no refusal, and an answer is unchanged', async () => {
  const old = await ask('refused');
  assert.equal(old.ok, false);
  assert.equal('refusal' in old, false);
  assert.match(old.because, /missing signature headers/);
  const ok = await ask('ok:{"epoch":1,"kept":true}');
  assert.deepEqual(ok, { ok: true, data: { epoch: 1, kept: true } });
});

test('#5744: another verb never gets a failed run\'s stdout, and a refusal line there is not its because either', async () => {
  // company-start returns its failed setupRun result whole: no `said` (keepStdout is mac-request's alone).
  process.env.FAKE_MAC_REQUEST_MODE = 'refusal-quiet:{"refusal":{"status":400,"code":"x","current_epoch":null}}';
  let r;
  try { r = await remote.companyStart('person@example.com'); } finally { delete process.env.FAKE_MAC_REQUEST_MODE; }
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal('said' in r, false, 'a failed run of another verb carried its stdout: ' + JSON.stringify(r));
  assert.doesNotMatch(String(r.because), /refusal/, r.because);
  assert.ok(fake.calls().some((c) => c.args.includes('company-start')), 'company-start never reached the fake');
});
