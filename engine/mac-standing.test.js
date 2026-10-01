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
const { makeFakeTunnel, tripwire, waitForCalls: waitForFakeCalls } = require('../test-support/fake-mac-request');

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
/* An env var set to undefined becomes the string "undefined", which would disarm the suite's guard. */
function restoreSeam(v) { if (v === undefined) delete process.env.AGENT_WORKFORCE_TUNNEL_BIN; else process.env.AGENT_WORKFORCE_TUNNEL_BIN = v; }
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

test('fetchStanding: goes out SIGNED -- one `mac-request` POST /v1/mac/standing with the remote report on stdin, and no direct dial', async () => {
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
  assert.ok(!c.stdin.includes(STATE) && !c.stdin.includes(path.basename(STATE)), 'the state dir path left the Mac');
  assert.ok(!c.args.join(' ').includes('"remote"'), 'the report went on argv');
  assert.equal(r.stderr, '', 'a success logs nothing');
});

/* kosmos#4277: a board whose switch is ON but which believes it is NOT enrolled never asks
   for a relay ticket, and this report is the only way the reason reaches us. It goes signed
   with the key alone, at most every five minutes, and never when off or keyless. */
// The shared helper, with room for a loaded box (a spawned fake tunnel can take seconds there).
const waitForCalls = (n) => waitForFakeCalls(fake, n, 15000);
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
    assert.equal(body.remote.tunnel, 'stopped', 'ON and not enrolled will never start: stopped, not starting');
    assert.equal(body.remote.error, 'not-enrolled; missing: address, tls.crt, tls.key', 'the report did not say which enrolment files are missing');
    assert.ok(!c.stdin.includes('her@example.com'), 'the sign-in email left the Mac in the report');
    assert.deepEqual(wire.dialled, [], 'the report went out by a direct dial instead of signed through the tunnel');
    // Within the five minutes: no second report.
    await remote.refreshStandingIfStale({ now: t0 + 60 * 1000, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().length, 1, 'a second report went out inside five minutes');
    // Past them: another.
    await remote.refreshStandingIfStale({ now: t0 + 6 * 60 * 1000, ttlMs: 0 });
    assert.equal((await waitForCalls(2)).length, 2, 'past five minutes, the second report did not go out');
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
    restoreSeam(seam);
    remote.resetForTests();
    keyOnly(true);
    await remote.refreshStandingIfStale({ now: Date.now() + 60 * 60 * 1000, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(called, 1, 'control: with the seam set the report was not attempted, so the zero proves nothing');
  } finally { remote.macRequest = real; restoreSeam(seam); }
});

test('#4277: the enrolled standing call commits the heal baseline only when the send succeeded', async () => {
  const rr = require('../engine/remote-report');
  const real = rr.commitHeal;
  const committed = [];
  rr.commitHeal = (report) => { committed.push(report); };
  // The refused send logs a line; keep it out of the test output, as the sibling tests do.
  const realWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    enroll();
    await run('refused', () => macStanding.fetchStanding());
    assert.equal(committed.length, 0, 'a failed send committed the heal baseline (a relaunch would be swallowed)');
    await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
    assert.equal(committed.length, 1, 'a successful send did not commit the heal baseline');
    assert.equal(typeof committed[0].healBaseline, 'number', 'the committed report is not the one that was built');
  } finally { rr.commitHeal = real; process.stderr.write = realWrite; }
});

test('#4277: the not-enrolled report commits its heal baseline only when it went out, and never overlaps itself', async () => {
  const rr = require('../engine/remote-report');
  const realCommit = rr.commitHeal;
  const realReq = remote.macRequest;
  const realWrite = process.stderr.write;
  process.stderr.write = () => true;   // the refused report logs a line; keep it out of the output
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
  } finally { rr.commitHeal = realCommit; remote.macRequest = realReq; process.stderr.write = realWrite; }
});

test('#4277: the key-only route IS the standing route (one fact, two modules)', () => {
  assert.equal(remote.KEY_ONLY_ROUTE, macStanding.ROUTE, 'key-only signing opens a different route from the one the report uses');
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

/* kosmos#4743: a refresh another test left out (an ask started by a flip, which nothing awaits) must end
   before the next test resets the flags, or its re-ask lands in that test. Waits for it, at most 5 s. */
async function settleStanding() {
  for (const t0 = Date.now(); remote.standingOutForTests() && Date.now() - t0 < 5000;) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(!remote.standingOutForTests(), 'a refresh left by an earlier test never ended');
}

test('#4731, #4743: with the switch OFF an enrolled computer is still heard from: one signed standing call whose body says only that remote access is off', async () => {
  enroll(false);
  const r = await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
  assert.equal(r.value, 'good');
  assert.equal(r.calls.length, 1, 'off read as gone to the coordinator: it heard nothing');
  assert.deepEqual(r.dialled, [], 'no direct dial: still signed through the tunnel');
  assert.equal(fake.flag(r.calls[0], '--path'), '/v1/mac/standing', 'the existing standing route, nothing new');
  assert.deepEqual(JSON.parse(r.calls[0].stdin), { remote: { on: false } },
    'the body must say remote access is off, and nothing more (no report fields while off)');
  // CONTROL: the same computer with the switch ON sends its full report, so the one-bit body above is the off arm.
  enroll(true);
  const on = await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
  assert.deepEqual(Object.keys(JSON.parse(on.calls[0].stdin)), ['remote']);
  assert.notDeepEqual(JSON.parse(on.calls[0].stdin).remote, { on: false }, 'the switch ON must not send the off body');
});

test('#4743: with the switch ON and no report built, the body says exactly that remote access is on', async () => {
  await settleStanding();
  remote.resetForTests();   // the flip and in-flight flags start clear, whatever ran before
  const rr = require('../engine/remote-report');
  const realBuild = rr.build;
  rr.build = () => { throw new Error('could not build'); };
  try {
    enroll(true);
    const r = await run('ok:{"standing":"good"}', () => macStanding.fetchStanding());
    assert.equal(r.calls.length, 1);
    assert.deepEqual(JSON.parse(r.calls[0].stdin), { remote: { on: true } },
      'on with no report must still say on (it is what clears the coordinator\'s off mark), and nothing more');
  } finally { rr.build = realBuild; }
});

test('#4743: switching remote access off tells the coordinator at once, not at the next cadence (up to 12 h)', async () => {
  await settleStanding();
  remote.resetForTests();   // the flip and in-flight flags start clear, whatever ran before
  enroll(true);
  // Fresh on this cadence: without the flip hook nothing would be due for a long while.
  const cur = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
  fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(cur, { standing_at: Date.now() })) + '\n');
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    assert.equal(remote.setOn(false).ok, true);
    await waitForFakeCalls(fake, 1, 5000);
    const off = fake.calls().find((c) => fake.flag(c, '--path') === '/v1/mac/standing');
    assert.ok(off, 'switching off sent no standing question');
    assert.deepEqual(JSON.parse(off.stdin), { remote: { on: false } });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fake.calls().length, 1, 'the flip was told more than once');
  } finally {
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
});

test('#4743: switching remote access ON tells the coordinator at once too (it clears the off mark)', async () => {
  await settleStanding();
  remote.resetForTests();
  enroll(false);
  const cur = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
  fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(cur, { standing_at: Date.now() })) + '\n');
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    assert.equal(remote.setOn(true).ok, true);
    await waitForFakeCalls(fake, 1, 5000);
    const on = fake.calls().find((c) => fake.flag(c, '--path') === '/v1/mac/standing');
    assert.ok(on, 'switching on, on a fresh stamp, sent no standing question');
    assert.equal(JSON.parse(on.stdin).remote.on, true);
  } finally {
    // Switching back off is itself a flip that asks (or re-asks when the ON ask still out ends): wait until
    // no refresh is out and no flip is pending, so nothing lands in the next test.
    remote.setOn(false);
    for (const t0 = Date.now(); !remote.standingQuietForTests() && Date.now() - t0 < 5000;) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(remote.standingQuietForTests(), 'the clean-up flip never settled: it would leak into the next test');
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
});

test('#4743: a flip while a refresh is already out is told when that refresh ends', async () => {
  await settleStanding();
  remote.resetForTests();   // the flip and in-flight flags start clear, whatever ran before
  enroll(true);
  let release;
  const slow = () => new Promise((r) => { release = () => r('good'); });
  const cur = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
  fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(cur, { standing_at: 0 })) + '\n');
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    const out = remote.refreshStandingIfStale({ ttlMs: 0, fetcher: slow });   // the poll's refresh, still out
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(remote.setOn(false).ok, true);                                // the flip, while it is out
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().length, 0, 'control: nothing is sent while the first refresh is out');
    release(); await out;
    await waitForFakeCalls(fake, 1, 5000);
    const off = fake.calls().find((c) => fake.flag(c, '--path') === '/v1/mac/standing');
    assert.ok(off, 'the flip made during a refresh was never told');
    assert.deepEqual(JSON.parse(off.stdin), { remote: { on: false } });
  } finally {
    if (release) release();   // a failed assertion above must not leave the refresh out for later tests
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
});

test('#4743: signing in with the switch off makes the next standing poll tell the coordinator, whatever its stamp (turnOnAfterSignin)', async () => {
  await settleStanding();
  remote.resetForTests();   // the flip and in-flight flags start clear, whatever ran before
  enroll(false);
  const cur = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
  fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(cur, { standing_at: Date.now() })) + '\n');
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    remote.turnOnAfterSigninForTests();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().length, 0, 'the sign-in itself started a signed call (it would hold up a Forget)');
    await remote.refreshStandingIfStale({ ttlMs: 10 * 60 * 1000 });   // the next poll, on a fresh stamp
    await waitForFakeCalls(fake, 1, 5000);
    const on = fake.calls().find((c) => fake.flag(c, '--path') === '/v1/mac/standing');
    assert.ok(on, 'the sign-in switched it on and the next poll told nothing');
    assert.equal(JSON.parse(on.stdin).remote.on, true);
    // CONTROL: already on, a sign-in leaves the next poll on its cadence (fresh stamp: nothing sent).
    fake.reset();
    const now = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
    fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(now, { standing_at: Date.now() })) + '\n');
    remote.turnOnAfterSigninForTests();
    await remote.refreshStandingIfStale({ ttlMs: 10 * 60 * 1000 });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().length, 0, 'control: a sign-in with the switch already on made the poll ask early');
  } finally {
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
});

test('#4743: a sign-in cancelled after it registered leaves the switch off AND the standing stamp due (it survives a restart)', async () => {
  await settleStanding();
  remote.resetForTests();
  enroll(true);   // the register's new identity is on disk (mac_id 'x'), so the identity changed from 'old-id'
  const r = remote.cancelledAfterForTests({ ok: true }, 'old-id', 'old.example', Date.now());
  assert.ok(r, 'cancelledAfter answered nothing');
  const after = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
  assert.equal(after.on, false, 'a cancelled sign-in left the switch on');
  assert.ok(Date.now() - after.standing_at > remote.OFF_STANDING_TTL_MS,
    'the standing stamp is fresh, so after a restart the off would wait the whole off cadence: ' + after.standing_at);
  // The flag too: with the stamp made fresh (as a restart-free poll would see after another writer), the
  // next poll on its ordinary TTL still asks, and says off.
  fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(after, { standing_at: Date.now() })) + '\n');
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    await remote.refreshStandingIfStale({ ttlMs: 10 * 60 * 1000 });
    await waitForFakeCalls(fake, 1, 5000);
    const off = fake.calls().find((c) => fake.flag(c, '--path') === '/v1/mac/standing');
    assert.ok(off, 'the cancelled sign-in left no pending flip: a fresh stamp kept the off untold');
    assert.deepEqual(JSON.parse(off.stdin), { remote: { on: false } });
  } finally {
    delete process.env.FAKE_MAC_REQUEST_MODE;
    remote.resetForTests();   // nothing it set may reach the next test
  }
});

test('#4743: saving the switch at the value it already has sends nothing', async () => {
  await settleStanding();
  remote.resetForTests();   // the flip and in-flight flags start clear, whatever ran before
  enroll(false);
  const cur = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
  fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(cur, { standing_at: Date.now() })) + '\n');
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    assert.equal(remote.setOn(false).ok, true);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fake.calls().length, 0, 'a save that changed nothing sent a standing question');
  } finally {
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
});

test('#4743: a flip whose first ask was stopped is told by the next refresh, even after another writer stamped the standing fresh', async () => {
  await settleStanding();
  remote.resetForTests();   // the flip and in-flight flags start clear, whatever ran before
  // The flip is made while the board is not enrolled, so its own ask stops early (a sign-in on an enrolled
  // Mac stops it through busy() instead; the flag behaves the same either way).
  enroll(true);
  unenroll();
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    assert.equal(remote.setOn(false).ok, true);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().length, 0, 'precondition: the first ask was stopped (nothing sent)');
    // The sign-in finishes: enrolled again, and its own write stamps the standing fresh.
    for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
    const cur = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
    fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(cur, { standing_at: Date.now() })) + '\n');
    await remote.refreshStandingIfStale({ ttlMs: 0 });
    await waitForFakeCalls(fake, 1, 5000);
    const off = fake.calls().find((c) => fake.flag(c, '--path') === '/v1/mac/standing');
    assert.ok(off, 'the pending flip was never told');
    assert.deepEqual(JSON.parse(off.stdin), { remote: { on: false } });
    // CONTROL: told once, the next refresh on a fresh stamp sends nothing.
    fake.reset();
    const now = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
    fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(now, { standing_at: Date.now() })) + '\n');
    await remote.refreshStandingIfStale({ ttlMs: 0 });
    assert.equal(fake.calls().length, 0, 'control: with no flip pending, a fresh stamp was asked again');
  } finally {
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
});

test('#4743: an off flip whose ask could not go out is still told after a restart (the stamp it set back)', async () => {
  await settleStanding();
  remote.resetForTests();
  enroll(true);
  unenroll();                                   // its own ask stops early
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    assert.equal(remote.setOn(false).ok, true);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().length, 0, 'precondition: nothing could be sent');
    remote.resetForTests();                     // a restart: the in-memory flag is gone
    for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
    await remote.refreshStandingIfStale({ ttlMs: 10 * 60 * 1000 });   // an ordinary poll after it
    await waitForFakeCalls(fake, 1, 5000);
    const off = fake.calls().find((c) => fake.flag(c, '--path') === '/v1/mac/standing');
    assert.ok(off, 'after a restart the off waited for the whole off cadence (the stamp was not set back)');
    assert.deepEqual(JSON.parse(off.stdin), { remote: { on: false } });
  } finally {
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
});

test('#4743: a flip told to a board that cannot ask yet is not dropped when the refresh that was out ends', async () => {
  await settleStanding();
  remote.resetForTests();   // the flip and in-flight flags start clear, whatever ran before
  enroll(true);
  let release;
  const slow = () => new Promise((r) => { release = () => r('good'); });
  const cur = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
  fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(cur, { standing_at: 0 })) + '\n');
  fake.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{"standing":"good"}';
  try {
    const out = remote.refreshStandingIfStale({ ttlMs: 0, fetcher: slow });   // the poll's refresh, still out
    await new Promise((r) => setTimeout(r, 50));
    unenroll();                                                                // a sign-in starts: cannot ask
    assert.equal(remote.setOn(false).ok, true);
    release(); await out;                                                     // its re-ask stops early
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().length, 0, 'precondition: nothing could be sent yet');
    // The sign-in finishes, and its own write stamps the standing fresh.
    for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
    const now = JSON.parse(fs.readFileSync(remote.FILE, 'utf8'));
    fs.writeFileSync(remote.FILE, JSON.stringify(Object.assign(now, { standing_at: Date.now() })) + '\n');
    await remote.refreshStandingIfStale({ ttlMs: 0 });
    await waitForFakeCalls(fake, 1, 5000);
    const off = fake.calls().find((c) => fake.flag(c, '--path') === '/v1/mac/standing');
    assert.ok(off, 'the flip was dropped');
    assert.deepEqual(JSON.parse(off.stdin), { remote: { on: false } });
  } finally {
    if (release) release();
    delete process.env.FAKE_MAC_REQUEST_MODE;
  }
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
    restoreSeam(seam);
    assert.equal(await macStanding.fetchStanding(), 'good', 'CONTROL: with the seam set, the same spy IS called');
    assert.equal(called, 1);
  } finally { remote.macRequest = real; restoreSeam(seam); }
});

test.after(() => {
  for (const d of [SANDBOX, STATE]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  fake.cleanup();
});
