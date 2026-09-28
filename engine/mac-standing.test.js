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
  // kosmos#4277: the body is this Mac's remote report, and it goes on stdin, never argv.
  const body = JSON.parse(c.stdin);
  assert.deepEqual(Object.keys(body), ['remote'], 'the body carries the remote report and nothing else');
  assert.deepEqual(Object.keys(body.remote).sort(), ['app', 'error', 'heal', 'macId', 'macKey', 'on', 'stateDir', 'tunnel'].sort());
  assert.equal(body.remote.on, true);
  assert.equal(body.remote.macId, true, 'enrolled writes mac_id');
  assert.equal(body.remote.macKey, false, 'this fixture writes no mac_key');
  assert.equal(body.remote.stateDir, 'custom', 'AGENT_WORKFORCE_TUNNEL_STATE is set in this suite');
  assert.ok(!c.stdin.includes(os.homedir()), 'the home directory (a user name) left the Mac');
  assert.ok(!c.args.join(' ').includes('"remote"'), 'the report went on argv');
  assert.equal(r.stderr, '', 'a success logs nothing');
});

/* kosmos#4277: a board whose switch is ON but which believes it is NOT enrolled never asks
   for a relay ticket, and this report is the only way the reason reaches us. It goes signed
   with the key alone, at most every five minutes, and never when off or keyless. */
async function waitForCalls(n, ms) {
  const until = Date.now() + (ms || 3000);
  while (fake.calls().length < n && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  return fake.calls();
}
function keyOnly(on) {
  unenroll();
  for (const f of ['mac_id', 'mac_key']) fs.writeFileSync(path.join(STATE, f), 'x');
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  // The email is set, as setupStart() leaves it while the code is awaited: the state this
  // report exists for, and the one whose status() sentence names the email.
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: on !== false, standing: '', email: 'her@example.com' }) + '\n');
}

test('#4277: ON, holding a key, NOT enrolled: one key-signed report of why, then none within five minutes', async () => {
  remote.resetForTests();
  keyOnly(true);
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  const wire = tripwire();
  try {
    const t0 = Date.now() + 10 * 60 * 1000;   // well past any earlier report
    await remote.refreshStandingIfStale({ now: t0, ttlMs: 0 });
    const calls = await waitForCalls(1);
    assert.equal(calls.length, 1, 'the not-enrolled report did not go');
    const c = calls[0];
    assert.equal(c.args[0], 'mac-request');
    assert.equal(fake.flag(c, '--path'), '/v1/mac/standing');
    const body = JSON.parse(c.stdin);
    assert.equal(body.remote.on, true);
    assert.equal(body.remote.macId, true);
    assert.equal(body.remote.macKey, true);
    assert.equal(body.remote.tunnel, 'starting', 'ON and not enrolled is status() "connecting", reported as starting');
    assert.equal(body.remote.error, 'not-enrolled; missing: address, tls.crt, tls.key', 'the report did not say which enrolment files are missing');
    assert.ok(!c.stdin.includes('her@example.com'), 'the sign-in email left the Mac in the report');
    assert.deepEqual(wire.dialled, [], 'the report went out by a direct dial instead of signed through the tunnel');
    // Within the five minutes: no second report.
    await remote.refreshStandingIfStale({ now: t0 + 60 * 1000, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().length, 1, 'a second report went out inside five minutes');
    // Past them: another.
    await remote.refreshStandingIfStale({ now: t0 + 6 * 60 * 1000, ttlMs: 0 });
    assert.equal((await waitForCalls(2)).length, 2, 'no report after five minutes');
  } finally {
    wire.restore();
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
});

test('#4277: under the test runner with NO test tunnel binary, the not-enrolled report is never attempted', async () => {
  // Observed with a spy on remote.macRequest (the report goes through the export), so nothing
  // is ever spawned, least of all a real tunnel against the production coordinator.
  const real = remote.macRequest;
  const seam = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  let called = 0;
  remote.macRequest = async () => { called++; return { ok: true, data: {} }; };
  try {
    remote.resetForTests();
    keyOnly(true);
    delete process.env.AGENT_WORKFORCE_TUNNEL_BIN;
    await remote.refreshStandingIfStale({ now: Date.now() + 30 * 60 * 1000, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(called, 0, 'the guard must stop the report before macRequest');
    // CONTROL: the same state WITH the seam set does call it, so the zero above is the guard's doing.
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = seam;
    remote.resetForTests();
    keyOnly(true);
    await remote.refreshStandingIfStale({ now: Date.now() + 60 * 60 * 1000, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(called, 1, 'control: with the seam set the report was not attempted, so the zero proves nothing');
  } finally { remote.macRequest = real; process.env.AGENT_WORKFORCE_TUNNEL_BIN = seam; }
});

test('#4277: the enrolled standing call commits the heal baseline only when the send succeeded', async () => {
  const rr = require('../engine/remote-report');
  const real = rr.commitHeal;
  const committed = [];
  rr.commitHeal = (report) => { committed.push(report); };
  try {
    enroll();
    await run('refused', () => macStanding.fetchStanding());
    assert.equal(committed.length, 0, 'a failed send committed the heal baseline (a relaunch would be swallowed)');
    await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
    assert.equal(committed.length, 1, 'a successful send did not commit the heal baseline');
    assert.equal(typeof committed[0].healBaseline, 'number', 'the committed report is not the one that was built');
  } finally { rr.commitHeal = real; }
});

test('#4277: the not-enrolled report commits its heal baseline only when it went out, and never overlaps itself', async () => {
  const rr = require('../engine/remote-report');
  const realCommit = rr.commitHeal;
  const realReq = remote.macRequest;
  const committed = [];
  rr.commitHeal = (report) => { committed.push(report); };
  let release;
  let calls = 0;
  try {
    remote.resetForTests();
    keyOnly(true);
    remote.macRequest = () => { calls++; return new Promise((res) => { release = res; }); };
    const t0 = Date.now() + 90 * 60 * 1000;
    await remote.refreshStandingIfStale({ now: t0, ttlMs: 0 });
    // While one is out, another tick past the throttle does NOT start a second (the in-flight guard).
    await remote.refreshStandingIfStale({ now: t0 + 10 * 60 * 1000, ttlMs: 0 });
    assert.equal(calls, 1, 'a second report started while one was in flight');
    release({ ok: false, because: 'refused' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(committed.length, 0, 'a failed report committed its heal baseline');
    remote.resetForTests();
    keyOnly(true);
    remote.macRequest = async () => { calls++; return { ok: true, data: {} }; };
    await remote.refreshStandingIfStale({ now: t0 + 30 * 60 * 1000, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(committed.length, 1, 'a report that went out did not commit its heal baseline');
  } finally { rr.commitHeal = realCommit; remote.macRequest = realReq; }
});

test('#4277: key-only signing still needs the key and id on disk', async () => {
  remote.resetForTests();
  keyOnly(true);
  fs.rmSync(path.join(STATE, 'mac_key'), { force: true });
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    const r = await remote.macRequest('POST', remote.KEY_ONLY_ROUTE, { remote: {} }, { keyOnly: true });
    assert.equal(r.ok, false, 'key-only signing went ahead with no mac_key');
    assert.equal(fake.calls().length, 0, 'the tunnel was asked to sign with no key');
  } finally { delete process.env.FAKE_MAC_REQUEST_MODE; }
});

test('#4277: a clock stepped backwards does not re-send inside the window; a failure is logged once per reason', async () => {
  const real = remote.macRequest;
  let calls = 0;
  remote.macRequest = async () => { calls++; return { ok: false, because: 'the coordinator said no (401)' }; };
  const realWrite = process.stderr.write;
  let stderr = '';
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    remote.resetForTests();
    keyOnly(true);
    const t0 = Date.now() + 3 * 60 * 60 * 1000;
    await remote.refreshStandingIfStale({ now: t0, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 50));
    // The clock steps back two minutes: still inside the window, so no second send.
    await remote.refreshStandingIfStale({ now: t0 - 2 * 60 * 1000, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 1, 'a backwards clock step re-sent inside the five minutes');
    // A LARGE step back (20 minutes) must not silence the report until the clock catches up:
    // it sends again. It fails with the SAME reason, so it is logged once in all.
    await remote.refreshStandingIfStale({ now: t0 - 20 * 60 * 1000, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 2);
    const lines = stderr.split('\n').filter((l) => /the remote report did not go/.test(l));
    assert.equal(lines.length, 1, 'the same failure was logged ' + lines.length + ' times');
  } finally { remote.macRequest = real; process.stderr.write = realWrite; }
});

test('#4277: key-only signing opens the report route and nothing else', async () => {
  remote.resetForTests();
  keyOnly(true);
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    for (const [method, route] of [['POST', '/v1/mac/updating'], ['POST', '/v1/mac/federation/room-ticket'], ['GET', '/v1/mac/standing']]) {
      const r = await remote.macRequest(method, route, {}, { keyOnly: true });
      assert.equal(r.ok, false, method + ' ' + route + ' was signed without enrolment');
    }
    assert.equal(fake.calls().length, 0, 'the tunnel was asked to sign a route key-only signing does not open');
    const ok = await remote.macRequest('POST', remote.KEY_ONLY_ROUTE, { remote: {} }, { keyOnly: true });
    assert.equal(ok.ok, true, 'the report route itself was refused');
  } finally { delete process.env.FAKE_MAC_REQUEST_MODE; }
});

test('#4277: no not-enrolled report when the switch is OFF, or when there is no key to sign with', async () => {
  for (const [label, setup] of [
    ['switch off', () => keyOnly(false)],
    ['no mac_key', () => { keyOnly(true); fs.rmSync(path.join(STATE, 'mac_key'), { force: true }); }],
  ]) {
    remote.resetForTests();
    setup();
    fake.reset();
    process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
    try {
      await remote.refreshStandingIfStale({ now: Date.now() + 20 * 60 * 1000, ttlMs: 0 });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(fake.calls().length, 0, label + ': a report went out');
    } finally { delete process.env.FAKE_MAC_REQUEST_MODE; }
  }
  fs.rmSync(path.join(STATE, 'mac_key'), { force: true });
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

test('the SUITE GUARD: under the test runner with NO test tunnel binary, macRequest is never called', async () => {
  // NODE_TEST_CONTEXT is set by node --test. Without a test-supplied tunnel binary the
  // real bundled tunnel would sign with the sandbox key and reach the PAID coordinator.
  // Observed at the call itself (a spy on remote.macRequest), NOT at the fake tunnel's
  // record: with the seam unset nothing would reach the fake anyway, so a record-based
  // arm stays green with the guard deleted.
  enroll();
  assert.ok(process.env.NODE_TEST_CONTEXT, 'precondition: running under node --test');
  const real = remote.macRequest;
  let called = 0;
  remote.macRequest = async () => { called++; return { ok: true, data: { standing: 'good' } }; };
  const seam = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  delete process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  try {
    assert.equal(await macStanding.fetchStanding(), null);
    assert.equal(called, 0, 'the guard must stop the call before macRequest');
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = seam;
    assert.equal(await macStanding.fetchStanding(), 'good', 'CONTROL: with the seam set, the same spy IS called');
    assert.equal(called, 1);
  } finally { remote.macRequest = real; process.env.AGENT_WORKFORCE_TUNNEL_BIN = seam; }
});

test.after(() => {
  for (const d of [SANDBOX, STATE]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  fake.cleanup();
});
