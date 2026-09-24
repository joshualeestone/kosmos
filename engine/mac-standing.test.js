'use strict';

/**
 * Federation Kosmos+ gate, W1 refresh: engine/mac-standing.js -- the board-side
 * READ of POST /v1/mac/standing, SIGNED through the tunnel's `mac-request` verb (#3626).
 *
 *   node --test engine/mac-standing.test.js
 *
 * The tunnel binary is FAKED (test-support/fake-mac-request.js): enrolment, the switch
 * gate, remote.macRequest's argv and stdin, and the answer parsing all run for real;
 * only the binary that signs and dials is replaced. Every arm that expects a call runs
 * inside a TRIPWIRE on http.request / https.request, so a return to the old unsigned
 * direct call (which the coordinator refuses 401 "missing signature headers", measured
 * in kosmos#3626) turns the arm red, and the fake's own record must show the call, so a
 * module that quietly sends nothing is red too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeFakeTunnel, tripwire } = require('../test-support/fake-mac-request');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-macstanding-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-macstanding-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example';
const fake = makeFakeTunnel();
process.env.AGENT_WORKFORCE_TUNNEL_BIN = fake.bin;
const remote = require('../engine/remote');
const macStanding = require('../engine/mac-standing');

function enroll(on) {
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: on !== false, standing: '' }) + '\n');
}
function unenroll() { for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) { try { fs.rmSync(path.join(STATE, f), { force: true }); } catch { /* ignore */ } } }

/* Run fn with the fake answering `mode`, the network tripwire armed, and stderr
   captured. Returns { value, stderr, calls, dialled }. */
async function run(mode, fn) {
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = mode;
  const wire = tripwire();
  const realWrite = process.stderr.write;
  let stderr = '';
  process.stderr.write = (chunk, ...rest) => { stderr += String(chunk); return true; };
  try {
    const value = await fn();
    return { value, stderr, calls: fake.calls(), dialled: wire.dialled };
  } finally {
    process.stderr.write = realWrite;
    wire.restore();
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
}

test('parseStanding: standing string wins; kosmos_plus bool maps; else null; object or text', () => {
  assert.equal(macStanding.parseStanding({ standing: 'good', kosmos_plus: false }), 'good');
  assert.equal(macStanding.parseStanding('{"standing":"off"}'), 'off');
  assert.equal(macStanding.parseStanding({ kosmos_plus: true }), 'good');
  assert.equal(macStanding.parseStanding({ kosmos_plus: false }), 'none');
  assert.equal(macStanding.parseStanding({}), null);
  assert.equal(macStanding.parseStanding('not json'), null);
  assert.equal(macStanding.parseStanding(null), null);
});

test('fetchStanding: goes out SIGNED -- one `mac-request` POST /v1/mac/standing with {} on stdin, and no direct dial', async () => {
  enroll();
  const r = await run('ok:{"standing":"good","valid_until":1,"grace_until":2,"receipt":"kst1.x"}', () => macStanding.fetchStanding());
  assert.deepEqual(r.dialled, [], 'no direct http/https request: that is the unsigned path the coordinator refuses');
  assert.equal(r.value, 'good');
  assert.equal(r.calls.length, 1, 'exactly one tunnel call, so a module that sends nothing is red here too');
  const c = r.calls[0];
  assert.equal(c.args[0], 'mac-request', 'the signing verb, not a plain request');
  assert.equal(fake.flag(c, '--method'), 'POST');
  assert.equal(fake.flag(c, '--path'), '/v1/mac/standing');
  assert.equal(fake.flag(c, '--state-dir'), remote.stateDir(), 'signed with THIS Mac\'s key directory');
  assert.equal(fake.flag(c, '--coordinator'), 'https://coord.example');
  assert.deepEqual(JSON.parse(c.stdin), {}, 'the body goes on stdin, never argv');
  assert.equal(r.stderr, '', 'a success logs nothing');
});

test('fetchStanding: NULL and NO tunnel call when not enrolled', async () => {
  unenroll();
  const r = await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
  assert.equal(r.value, null);
  assert.equal(r.calls.length, 0);
});

test('fetchStanding: NULL and NO tunnel call when the switch is off (a paid route is not called)', async () => {
  enroll(false);
  const r = await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
  assert.equal(r.value, null);
  assert.equal(r.calls.length, 0);
});

test('fetchStanding: the kosmos_plus bool shape maps too', async () => {
  enroll();
  assert.equal((await run('ok:{"kosmos_plus":true}', () => macStanding.fetchStanding())).value, 'good');
  assert.equal((await run('ok:{"kosmos_plus":false}', () => macStanding.fetchStanding())).value, 'none');
});

test('fetchStanding: a refusal, an old tunnel, or an unreadable answer -> null, never throws', async () => {
  enroll();
  for (const mode of ['refused', 'old-tunnel', 'garbage', 'ok:{"nothing":"here"}']) {
    const r = await run(mode, () => macStanding.fetchStanding());
    assert.equal(r.value, null, mode + ' must resolve to null so upstream keeps the last-known standing');
    assert.deepEqual(r.dialled, [], mode + ': still no direct dial');
  }
});

test('fetchStanding: a failure is LOGGED ONCE, not swallowed, and a success re-arms the log', async () => {
  enroll();
  const first = await run('refused', () => macStanding.fetchStanding());
  assert.match(first.stderr, /kosmos#3626: \/v1\/mac\/standing failed: .*missing signature headers/,
    'the reason reaches the board log (it was silent before #3626)');
  const again = await run('refused', () => macStanding.fetchStanding());
  assert.equal(again.stderr, '', 'the same failure on the next TTL refresh is not logged again');
  const other = await run('old-tunnel', () => macStanding.fetchStanding());
  assert.match(other.stderr, /unrecognized subcommand/, 'a DIFFERENT reason is logged');
  await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
  const afterOk = await run('old-tunnel', () => macStanding.fetchStanding());
  assert.match(afterOk.stderr, /unrecognized subcommand/, 'after a success the same failure is logged again');
});

test('fetchStanding: a hung tunnel is bounded, resolves null', async () => {
  enroll();
  process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS = '300';
  try {
    const t0 = Date.now();
    const r = await run('hang', () => macStanding.fetchStanding());
    assert.equal(r.value, null);
    assert.ok(Date.now() - t0 < 5000, 'resolved at the bound, not left hanging');
  } finally { delete process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS; }
});

test('the SUITE GUARD: under the test runner with NO test tunnel binary, nothing is run -- non-vacuous', async () => {
  // NODE_TEST_CONTEXT is set by node --test. Without a test-supplied tunnel binary the
  // real bundled tunnel would sign with the sandbox key and reach the PAID coordinator.
  // Non-vacuous: the same call with the seam restored DOES reach the fake (arm above),
  // so this arm proves the guard and not a broken fake.
  enroll();
  assert.ok(process.env.NODE_TEST_CONTEXT, 'precondition: running under node --test');
  const seam = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  delete process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  try {
    const r = await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
    assert.equal(r.value, null);
    assert.equal(r.calls.length, 0, 'no tunnel ran');
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = seam; }
});
