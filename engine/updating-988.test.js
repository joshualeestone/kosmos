'use strict';
/**
 * kosmos#988: while an update is applying, tell the coordinator, so a person on
 * their phone reads "your Mac is updating Kosmos, back in a moment" instead of
 * "Kosmos is not answering on this computer".
 *
 * The coordinator route is merged but deliberately NOT deployed, so these arms
 * assert the REQUEST this engine makes and, above all, that nothing here can
 * fail an install or reach a real coordinator from the suite.
 *
 * 🛑 SINCE #3626 THE REQUEST IS SIGNED BY THE TUNNEL, NOT SENT FROM NODE.
 * announce() hands the route and body to remote.macRequest(), which runs the
 * tunnel binary's `mac-request` verb. Two seams, used for two kinds of arm:
 *   - capture() replaces remote.macRequest on the module object, which is what
 *     announce() calls through, so the lifecycle and gate arms stay synchronous;
 *   - the END-TO-END arms leave macRequest real and point
 *     AGENT_WORKFORCE_TUNNEL_BIN at a fake tunnel that records argv and stdin,
 *     inside a tripwire on http.request / https.request, so a return to the old
 *     unsigned direct call (refused 401 by the coordinator, kosmos#3626) is red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-updating-988-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

/* A state dir shaped exactly as remote.enrolled() requires: mac_id, address,
   tls.crt, tls.key, because enrolled() checks for all four. */
const STATE = nodePath.join(SANDBOX, 'enrolled');
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(nodePath.join(STATE, 'mac_id'), 'test-mac\n');
fs.writeFileSync(nodePath.join(STATE, 'address'), 'test.example\n');
fs.writeFileSync(nodePath.join(STATE, 'tls.crt'), 'CERT-BYTES\n');
fs.writeFileSync(nodePath.join(STATE, 'tls.key'), 'KEY-BYTES\n');

/* The tunnel-binary seam, set BEFORE anything runs: the suite guard in
   announce() lets a call through under the test runner only when this is set, so
   it is also what keeps the real bundled tunnel (and the paid coordinator) out of
   the suite. The fake touches no network. */
const { makeFakeTunnel, waitForCalls, tripwire } = require('../test-support/fake-mac-request');
const FAKE = makeFakeTunnel();
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE.bin;

const updating = require('./updating');
const update = require('./update');

/* 🛑 NO TICK MAY REACH THE REAL RELEASE HOST. startPolling's tick runs poke() ->
   refresh() -> the global fetch, so an arm that starts a 10ms interval and awaits
   can curl installkosmos.com from every agent's suite run. engine.update-poll-1945
   injects a fetcher before every startPolling for exactly this reason; this file
   does it once, globally, so no arm can forget. */
const IDLE_FETCH = async () => ({ ok: false, status: 503, json: async () => ({}) });
update.setFetcher(IDLE_FETCH);

/* Wait until pred() holds, or a generous deadline passes. A FIXED SLEEP asserts a
   scheduling guarantee node does not give: this fleet routinely sits at load 25 on
   10 cores, and a 10ms interval can miss a 40ms window, which reds the arm for a
   scheduling reason while printing a message about the product. Polling is fast
   when the box is idle and correct when it is not. */
async function until(pred, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  return pred();
}

/* TICK EVIDENCE, so an arm asserting "nothing was announced" cannot pass because
   no tick ever ran. poke() is TTL-gated, so this counts at most one call per
   resetCache() window: it proves AT LEAST ONE tick fired and is NOT a tick counter.
   Measured with a discriminating control: a 10ms interval produces 1 call in 90ms
   and a 60s interval produces 0, so a call is tick evidence and startPolling does
   not fetch at boot. */
function countTicks() {
  const state = { n: 0, restore() { update.setFetcher(IDLE_FETCH); } };
  update.setFetcher(async (...a) => { state.n += 1; return IDLE_FETCH(...a); });
  return state;
}

/* The COMMERCIAL switch lives in remote.json under the DATA root, not in the
   state dir, so it is a separate axis from enrolment and has to be set
   separately. remote is required lazily inside the helper for the same ordering
   reason the arms below use: nothing at the top of this file may load remote.js,
   or the ordering arms stop meaning anything. */
function setPlus(on) {
  const remote = require('./remote');
  /* The data root is a sandbox that nothing has written to yet, so the directory
     remote.json lives in does not exist. mkdir first, or the helper throws at
     module load and the whole file dies with one ENOENT instead of running. */
  fs.mkdirSync(nodePath.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, JSON.stringify({ on }));
}
/* An enrolled Mac with Plus ON: the ordinary state, and what every arm below
   that calls enrol() means by "enrolled". Turning the switch on HERE rather than
   per-arm is deliberate: announce() gates on both halves, so an arm that set only
   the files would pass for the wrong reason. */
function enrol() {
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coordinator.example';
  setPlus(true);
}
function unenrol() {
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = nodePath.join(SANDBOX, 'no-such-dir');
  setPlus(true);   // isolate the enrolment axis: the switch is not what is off here
}
/* capture() replaces remote.macRequest with a recorder. Each call is kept in the
   shape the arms read: { method, path, body } with `body` the JSON text the tunnel
   would receive on stdin. `answer`, when given, is what the fake resolves to
   (default: the coordinator accepted it). release() puts the real one back. */
let realMacRequest = null;
function capture(answer) {
  const remote = require('./remote');
  if (!realMacRequest) realMacRequest = remote.macRequest;
  const calls = [];
  remote.macRequest = (method, path, body) => {
    calls.push({ method, path, body: JSON.stringify(body) });
    return typeof answer === 'function' ? answer() : Promise.resolve({ ok: true, data: {} });
  };
  return calls;
}
function release() { if (realMacRequest) require('./remote').macRequest = realMacRequest; }
/* Let the fire-and-forget .then/.catch in announce() run. */
const settle = () => new Promise((r) => setImmediate(r));
/* Collect what announce() writes to stderr while fn runs. */
async function stderrOf(fn) {
  const real = process.stderr.write;
  let out = '';
  process.stderr.write = (chunk) => { out += String(chunk); return true; };
  try { await fn(); await settle(); } finally { process.stderr.write = real; }
  return out;
}
/* The switch is a FILE, so an arm run ALONE (--test-name-pattern) would find
   remote.json missing and read off, failing for a fixture reason. afterEach alone
   made the arms order-dependent: each one relied on a PREVIOUS arm having written
   it. Setting it before as well as after removes the dependency. */
test.beforeEach(() => { setPlus(true); });

test.afterEach(() => {
  release();
  delete process.env.AGENT_WORKFORCE_TUNNEL_STATE;
  delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
  /* The switch lives in a FILE, not in the environment, so unlike the two lines
     above it survives the arm that set it. An arm that turns Plus off or corrupts
     remote.json would otherwise silence every later arm that builds its own state
     dir instead of calling enrol(), and those arms would fail as if the product
     were broken. Reset to the ordinary state; arms that need it off say so. */
  setPlus(true);
});

/* The repo's convention for a mkdtemp fixture: fixture-discipline.test.js,
   web.links-everywhere.test.js, server.usage.test.js and four others all remove
   their SANDBOX in test.after. Wrapped, because a removal that throws must not
   turn a green run red at the very end. */
test.after(() => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
  FAKE.cleanup();
});

/* ---- THE BLOCKER ARM ------------------------------------------------------ */

test('#988 BLOCKER: under the test runner with NO test tunnel binary, announce runs nothing', () => {
  /* node --test sets NODE_TEST_CONTEXT, so underTest() is true here. Without the
     guard, running the suite on an ENROLLED Mac would run the real bundled tunnel,
     which SIGNS with the operator's key, so since #3626 the coordinator ACCEPTS a
     real {"seconds":900}; one existing suite drives a child stub that never exits,
     so nothing clears it and the operator's phone reads "back in a moment" for the
     full 15-minute cap while nothing is updating.
     Observed at BOTH doors: the macRequest recorder (the signed path) and a
     tripwire on http/https (the old direct path). */
  enrol();
  assert.equal(updating.underTest(), true, 'the suite must be recognisable as a test context');
  const calls = capture();
  const wire = tripwire();
  const seam = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  delete process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  try {
    assert.doesNotThrow(() => updating.announce(900));
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = seam; wire.restore(); }
  assert.equal(calls.length, 0, 'no tunnel call may be made under test without a test tunnel binary');
  assert.deepEqual(wire.dialled, [], 'and no direct request either');
});

test('#988 CONTROL: the guard does NOT disable a test that supplies its own tunnel', () => {
  enrol();
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 1, 'with the test tunnel seam set, the same announce must run');
});

/* ---- the request itself, now visible through the seam --------------------- */

test('#988: POST to the documented route with a seconds body', () => {
  enrol();
  const calls = capture();
  updating.announce(900);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/v1/mac/updating');
  assert.deepEqual(JSON.parse(calls[0].body), { seconds: 900 });
});

test('#3626: the announce goes out SIGNED -- one `mac-request` call with the body on stdin, and no direct dial', async () => {
  /* The real macRequest, the real argv and stdin, a fake tunnel. The coordinator
     URL, including a self-hosted path prefix, is passed to the tunnel as given: the
     tunnel owns the route derivation now. */
  enrol();
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://host.example:8443/kosmos';
  FAKE.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'ok:{}';
  const wire = tripwire();
  let calls;
  try {
    updating.announce(900);
    calls = await waitForCalls(FAKE, 1);
  } finally { wire.restore(); delete process.env.FAKE_MAC_REQUEST_MODE; }
  assert.deepEqual(wire.dialled, [], 'no direct http/https request: that is the unsigned path the coordinator refuses');
  assert.equal(calls.length, 1, 'exactly one tunnel call, so a module that sends nothing is red here too');
  const c = calls[0];
  assert.equal(c.args[0], 'mac-request', 'the signing verb');
  assert.equal(FAKE.flag(c, '--method'), 'POST');
  assert.equal(FAKE.flag(c, '--path'), '/v1/mac/updating');
  assert.equal(FAKE.flag(c, '--state-dir'), STATE, 'signed with THIS Mac\'s key directory');
  assert.equal(FAKE.flag(c, '--coordinator'), 'https://host.example:8443/kosmos');
  assert.deepEqual(JSON.parse(c.stdin), { seconds: 900 }, 'the body reaches the tunnel on stdin, never argv');
  assert.ok(!c.args.some((a) => a.includes('900')), 'and the body is not on argv');
});

test('#3626: a hung tunnel does not hold announce(), which returns before the child starts', async () => {
  enrol();
  FAKE.reset();
  process.env.FAKE_MAC_REQUEST_MODE = 'hang';
  process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS = '300';
  try {
    const t0 = Date.now();
    assert.equal(updating.announce(900), undefined);
    assert.ok(Date.now() - t0 < 200, 'announce() must return at once; the install path cannot wait on the tunnel');
    await waitForCalls(FAKE, 1);
    const out = await stderrOf(() => new Promise((r) => setTimeout(r, 600)));
    assert.match(out, /kosmos#3626: \/v1\/mac\/updating failed: .*did not answer in time/,
      'the bounded tunnel call ends, and its timeout reaches the board log');
  } finally { delete process.env.FAKE_MAC_REQUEST_MODE; delete process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS; }
});

/* ---- the gates ------------------------------------------------------------ */

test('#988: an unenrolled machine says nothing, because there is nothing to say it with', () => {
  unenrol();
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 0);
});

test('#3626: remote exports macRequest as a FUNCTION', () => {
  /* A cross-module contract that would break silently: if it were missing or not
     callable, announce() would throw inside its fail-open guard and go quiet
     forever with nothing red anywhere. */
  const remote = require('./remote');
  assert.equal(typeof remote.macRequest, 'function', 'a missing macRequest dies silently in announce()');
});

/* ---- THE COMMERCIAL SWITCH, WHICH IS A SEPARATE AXIS FROM ENROLMENT --------- */

test('#988: an ENROLLED mac with Kosmos Plus switched OFF says nothing', () => {
  /* Turning Plus off does NOT unenrol. remote.setOn(false) writes {on:false} and
     calls ensure(); only forget()/retire removes the identity files. So a Mac that
     once paid and then switched off keeps enrolled() === true forever, and a guard
     that reads only the files would keep POSTing to the PAID coordinator, signed by
     that Mac, after the customer turned the feature off.
     This is the arm the guard exists for, and the two assertions below are
     deliberately BOTH present: the first proves the fixture is the dangerous one
     (still enrolled, files intact), so a future change that quietly unenrols here
     cannot make this arm pass for the ordinary reason. */
  enrol();
  setPlus(false);
  const remote = require('./remote');
  assert.equal(remote.enrolled(), true, 'the fixture must still be ENROLLED, or this arm proves nothing');
  assert.equal(remote.read().on, false, 'the switch must actually read off, or this arm proves nothing');
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 0, 'a mac whose owner switched Plus off must not reach the paid coordinator');
});

test('#988 CONTROL: the same enrolled mac WITH the switch on does send', () => {
  /* The discriminating half. Without it, an arm asserting 0 could be passing
     because the fixture is broken rather than because the guard works: the same
     shape that made six of my earlier arms vacuous on this branch. */
  enrol();
  setPlus(true);
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 1, 'with the switch on, the same enrolled mac must announce');
});

test('#988: a DAMAGED settings file fails CLOSED, it does not announce', () => {
  /* read() returns {on:false} on ENOENT, on unreadable, on unparseable and on a
     non-object, and this route is a paid one, so unreadable must mean silent
     rather than "assume the customer is paying". Asserting the direction here
     because it is the one place where an error path decides whether a signed
     request goes out. */
  enrol();
  const remote = require('./remote');
  fs.writeFileSync(remote.FILE, '{ this is not json');
  assert.equal(remote.read().on, false, 'a damaged settings file must read off, or this arm proves nothing');
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 0, 'a damaged settings file must not authorise a POST to the paid coordinator');
});

/* ---- the deadline value --------------------------------------------------- */

test('#988: 0 is the finish signal', () => {
  assert.equal(updating.seconds(0), 0);
});

test('#988: a caller typo must NOT be read as "finished"', () => {
  /* Number(null), Number(''), Number(false) and Number([]) are all 0, so
     coercing would turn a typo into the finish signal and clear a banner that
     should be showing. Only a real number is honoured. */
  for (const bad of [null, '', false, [], NaN, Infinity, {}, 'soon', undefined]) {
    assert.equal(updating.seconds(bad), updating.DEFAULT_SECONDS, `${String(bad)} must ask for the default, never 0`);
  }
});

test('#988: a NEGATIVE deadline asks for the default, it does not mean "finished"', () => {
  /* An earlier version clamped a negative to 0, which is the FINISH signal, so a
     caller typo of -1 cleared a live banner. Negatives are finite, so they slip
     past the not-a-number rule; they need their own. */
  assert.equal(updating.seconds(-5), updating.DEFAULT_SECONDS);
  assert.equal(updating.seconds(-1), updating.DEFAULT_SECONDS);
  assert.equal(updating.seconds(0), 0, 'only an explicit 0 means finished');
});

test('#988: a SUB-SECOND deadline is not "finished" either', () => {
  /* The mirror of the negative case, and the sentence above it claimed to cover
     this and did not. Math.trunc maps every 0 < v < 1 to 0, which is the FINISH
     signal, so announce(0.5) asked for half a second and cleared a live banner.
     Measured before the fix: 0.5, 0.9 and 0.0001 all returned 0. */
  assert.equal(updating.seconds(0.5), 1, 'half a second is a request, not a finish');
  assert.equal(updating.seconds(0.9), 1);
  assert.equal(updating.seconds(0.0001), 1);
  assert.equal(updating.seconds(1.7), 1, 'truncation still applies at and above one second');
  assert.equal(updating.seconds(0), 0, 'and 0 itself still means finished');
});

test('#988: the default is EXACTLY the cap, which is a limit and not headroom', () => {
  /* The arm's own name used to say the default "asks for more than any install
     needs", repeating a claim the code comment made and that is false of a value
     equal to the cap. It is 900 and the server caps at 900: an install running
     past fifteen minutes loses the banner mid-apply. Asserting equality rather
     than `>= 900` so that raising it (which would need a renewal story) cannot
     pass silently under an assertion written to be generous. */
  assert.equal(updating.DEFAULT_SECONDS, 900, 'the documented server cap, with no headroom');
});

/* ---- fail-open, which is the governing constraint ------------------------- */

test('#988 FAIL-OPEN: a macRequest that THROWS does not reach the caller', () => {
  enrol();
  capture(() => { throw new Error('tunnel on fire'); });
  assert.doesNotThrow(() => updating.announce(900));
});

test('#3626 FAIL-OPEN: a macRequest that REJECTS is caught and logged, never an unhandled rejection', async () => {
  enrol();
  capture(() => Promise.reject(new Error('tunnel crashed')));
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const out = await stderrOf(() => updating.announce(900));
    assert.match(out, /kosmos#3626: \/v1\/mac\/updating failed: tunnel crashed/);
  } finally { process.off('unhandledRejection', onUnhandled); }
  assert.equal(unhandled, null, 'a rejection on the install path must never go unhandled');
});

test('#988 FAIL-OPEN: a macRequest returning junk does not reach the caller', () => {
  enrol();
  capture(() => null);
  assert.doesNotThrow(() => updating.announce(900));
});

test('#988 FAIL-OPEN: a throw from OUTSIDE the transport still cannot reach the caller', () => {
  enrol();
  capture();
  const remote = require('./remote');
  const real = remote.enrolled;
  remote.enrolled = () => { throw new Error('state dir unreadable'); };
  try { assert.doesNotThrow(() => updating.announce(900)); }
  finally { remote.enrolled = real; }
});

test('#988 FAIL-OPEN: announce returns undefined, so no caller can await or branch on it', () => {
  enrol();
  capture();
  assert.equal(updating.announce(900), undefined);
});

/* ---- the lifecycle wiring, which is the deliverable ----------------------- */

/* beginInstall() opens with `if (installStarted) return;`, so a second call while
   the flag is set wires no child. Capture the first child's listeners here, once,
   and let the arms below drive them.
   ⚠️ An earlier version of this comment said the flag "exports no reset, so
   exactly ONE call per process ever wires a child". BOTH HALVES ARE FALSE:
   update.resetCache() is exported and clears it, and the child's own `error`
   listener clears it too, which is a listener THIS FILE FIRES below. The block is
   still sound (it captures before any arm runs, snapshots what was announced, and
   restores the factory and both runner hooks), but that was not the reason. */
const CHILD = { handlers: {}, announced: [] };
{
  enrol();
  const calls = capture();
  update.setInstalledRoot(() => SANDBOX);
  update.setInstallRunner(() => ({ on(ev, fn) { CHILD.handlers[ev] = fn; return this; } }));
  try { update.beginInstall({}); } catch { /* the fake child's shape is not under test */ }
  update.setInstallRunner(null);
  update.setInstalledRoot(null);
  CHILD.announced = calls.map((c) => JSON.parse(c.body).seconds);
  release();
}

test('#988 WIRING: beginning to apply announces a deadline', () => {
  /* Equality, not `> 0`: announce(1) survived the looser assertion, and a
     one-second deadline is a banner that clears before the download finishes. */
  assert.ok(CHILD.announced.includes(updating.DEFAULT_SECONDS),
    `applying must announce the DEFAULT deadline; got ${JSON.stringify(CHILD.announced)}`);
});

test('#988 WIRING: the installer child had its listeners wired', () => {
  assert.equal(typeof CHILD.handlers.error, 'function');
  assert.equal(typeof CHILD.handlers.exit, 'function');
});

test('#988 WIRING: a board coming back up clears, because success has no finish hook', () => {
  enrol();
  const calls = capture();
  update.setInstalledRoot(() => SANDBOX);
  const t = update.startPolling(60000);
  clearInterval(t);
  update.setInstalledRoot(null);
  assert.ok(calls.some((c) => JSON.parse(c.body).seconds === 0), 'a restarted board is by definition not mid-update');
});

test('#988 WIRING: the boot clear repeats once on the first tick, because a lost clear costs 15 minutes', async () => {
  enrol();
  /* The module-level beginInstall block above leaves installStarted TRUE for the
     rest of this file (its fake child never exits), and the tick clear is now
     correctly suppressed while an install is running. resetCache() is exported
     and clears the flag. */
  update.resetCache();
  const calls = capture();
  const clears = () => calls.filter((c) => JSON.parse(c.body).seconds === 0).length;
  update.setInstalledRoot(() => SANDBOX);
  const t = update.startPolling(10);
  try {
    await until(() => clears() >= 2);
  } finally {
    clearInterval(t);
    update.setInstalledRoot(null);
  }
  assert.ok(clears() >= 2, `a single unretried clear is the exposure; got ${clears()}`);
});

test('#988 WIRING: a boot may only ever clear, never set', () => {
  enrol();
  const calls = capture();
  update.setInstalledRoot(() => SANDBOX);
  const t = update.startPolling(60000);
  clearInterval(t);
  update.setInstalledRoot(null);
  assert.ok(calls.length > 0, 'every() is vacuously true on an empty array, so assert there IS something');
  assert.ok(calls.every((c) => JSON.parse(c.body).seconds === 0));
});

test('#3626: a failure is LOGGED ONCE, not swallowed, and a success re-arms the log', async () => {
  /* Before #3626 every announce failed 401 and a status line was the only trace;
     now the tunnel's own reason reaches the board log, once per distinct reason. */
  enrol();
  const refused = () => Promise.resolve({ ok: false, because: 'the coordinator said no (401): missing signature headers' });
  capture(refused);
  const first = await stderrOf(() => updating.announce(900));
  assert.match(first, /kosmos#3626: \/v1\/mac\/updating failed: .*401/, 'the reason reaches the board log');
  const again = await stderrOf(() => updating.announce(0));
  assert.equal(again, '', 'the same reason is not logged a second time');
  capture(() => Promise.resolve({ ok: false, because: "error: unrecognized subcommand 'mac-request'" }));
  const old = await stderrOf(() => updating.announce(0));
  assert.match(old, /too old to sign this/, 'an old tunnel is named as such, the way phonenotify does');
  capture();
  assert.equal(await stderrOf(() => updating.announce(0)), '', 'a success is silent');
  capture(refused);
  assert.match(await stderrOf(() => updating.announce(0)), /401/, 'after a success the same failure is logged again');
});

test('#988 CONTROL: an accepted announce is silent', async () => {
  enrol();
  capture();
  assert.equal(await stderrOf(() => updating.announce(900)), '');
});

/* The clears now carry an owner-identity guard, so an arm must drive a child that
   is STILL the current attempt. The module-level CHILD was captured at load and a
   later beginInstall supersedes it, which is exactly what the guard suppresses. */
function freshChild() {
  update.resetCache();
  const handlers = {};
  update.setInstalledRoot(() => SANDBOX);
  update.setInstallRunner(() => ({ on(ev, fn) { handlers[ev] = fn; return this; } }));
  try { update.beginInstall({}); } catch { /* fake child shape is not under test */ }
  update.setInstallRunner(null);
  update.setInstalledRoot(null);
  return handlers;
}

test('#988 WIRING: a child that fails to START clears the deadline', () => {
  enrol();
  const h = freshChild();
  const calls = capture();
  h.error(new Error('spawn failed'));
  assert.ok(calls.length > 0, 'a child that never started must clear');
  assert.equal(JSON.parse(calls[calls.length - 1].body).seconds, 0);
});

test('#988 WIRING: a child that EXITS ZERO still clears, because the shell masks the installer status', () => {
  /* The spawned shell ends in an `if`, so an installer that fails still exits 0.
     Measured: an installer exiting 7 records "7" in the status file while the
     child exits 0. A clear placed inside `code !== 0` never ran on ordinary
     failures, and the deadline then stood for the full cap on a healthy Mac. */
  enrol();
  const h = freshChild();
  const calls = capture();
  h.exit(0);
  assert.ok(calls.length > 0, 'an exit that reaches this listener did NOT restart the board, so it must clear');
  assert.equal(JSON.parse(calls[calls.length - 1].body).seconds, 0);
});

test('#988: the first-tick clear happens ONCE, not on every tick forever', async () => {
  /* The arm that only counted ">= 2" could not tell "once more" from "a fresh
     signed request to the coordinator every 60 seconds from every enrolled
     Mac". This one can. */
  enrol();
  update.resetCache();
  const calls = capture();
  const clears = () => calls.filter((c) => JSON.parse(c.body).seconds === 0).length;
  update.setInstalledRoot(() => SANDBOX);
  const t = update.startPolling(10);
  try {
    /* Poll for the LOW side (a missed tick is a scheduling flake), then give the
       interval a further fixed window for the HIGH side. The asymmetry is
       deliberate: load can only REDUCE the number of ticks, so a busy box cannot
       manufacture the extra clear this arm is looking for. */
    await until(() => clears() >= 2);
    await new Promise((r) => setTimeout(r, 90));
  } finally {
    clearInterval(t);
    update.setInstalledRoot(null);
  }
  const cleared = clears();
  assert.ok(cleared >= 2, `boot plus one tick expected; got ${cleared}`);
  /* Exactly 2 is what the code can produce (boot + one eligible tick); the bound
     was 3 and the slack was never reachable. */
  assert.equal(cleared, 2, `boot plus exactly one tick; got ${cleared} across ~8 ticks`);
});

test('#988: a NON-INTEGER deadline is truncated rather than put on the wire as a float', () => {
  assert.equal(updating.seconds(900.7), 900);
});

test('#988: the update path does not drag remote/ping/store into a test process', () => {
  /* 🛑 THE ORDERING INVARIANT, WHICH HAD NO ARM UNTIL A REVIEWER MUTATED IT.
     The guard must run BEFORE require('./remote'), because remote.js and ping.js
     both bind `const BASE = store.ROOT` at module scope and freeze the data root
     for the process. Moving the require above the guard restores the exact
     historical bug and left this suite green.
     It needs a CHILD process: this file already requires remote for its own
     mocks, so the parent's require.cache can never show the difference. */
  const { execFileSync } = require('node:child_process');
  const script = [
    "const os=require('node:os'),fs=require('node:fs'),p=require('node:path');",
    "process.env.AGENT_WORKFORCE_DATA=fs.mkdtempSync(p.join(os.tmpdir(),'ord-'));",
    // require update.js to model the REAL import graph, then drive announce()
    // DIRECTLY. An earlier version drove it through startPolling(), which is now
    // gated on installedRoot(); a temp dir has none, so announce never ran and
    // the arm passed with the bug reintroduced. Measured: it was vacuous.
    "require(p.join(process.argv[1],'engine/update.js'));",
    "require(p.join(process.argv[1],'engine/updating.js')).announce(900);",
    "const has=(m)=>Object.keys(require.cache).some(k=>k.endsWith(p.join('engine',m)));",
    "process.stdout.write(JSON.stringify({remote:has('remote.js'),ping:has('ping.js'),store:has('store.js')}));",
  ].join('\n');
  const repo = nodePath.join(__dirname, '..');
  /* WITHOUT the tunnel-binary seam: the guard only lets a call through when a
     test supplies a tunnel, and this arm is about the path that has none. */
  const env = { ...process.env, NODE_TEST_CONTEXT: '1' };
  delete env.AGENT_WORKFORCE_TUNNEL_BIN;
  const out = execFileSync(process.execPath, ['-e', script, repo], { env, encoding: 'utf8' });
  const loaded = JSON.parse(out);
  assert.equal(loaded.remote, false, 'requiring remote from the update path freezes the data root');
  assert.equal(loaded.ping, false, 'ping.js freezes it too');
  assert.equal(loaded.store, false, 'and store.root() reaches the legacy-store migration');
});

test('#988 END TO END: under production conditions the announce goes through the tunnel, and nothing dials the coordinator directly', async () => {
  /* 🛑 THE CARD'S DELIVERABLE. Every other arm runs under NODE_TEST_CONTEXT or
     replaces macRequest, so this is the arm that connects announce() to the real
     helper and the real spawn. A child WITHOUT NODE_TEST_CONTEXT, enrolled and
     switched on, with the coordinator pointed at a local http server: the fake
     tunnel must receive the signed request, and the server must receive NOTHING,
     because a direct hit there is the unsigned path #3626 removed. */
  const http = require('node:http');
  const direct = [];
  const server = http.createServer((req, res) => { direct.push(req.method + ' ' + req.url); res.writeHead(204).end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  FAKE.reset();
  try {
    const { spawn } = require('node:child_process');
    const script = [
      "const fs=require('node:fs'),os=require('node:os'),p=require('node:path');",
      "const box=fs.mkdtempSync(p.join(os.tmpdir(),'e2e-'));",
      "process.env.AGENT_WORKFORCE_DATA=box;",
      "const st=p.join(box,'st'); fs.mkdirSync(st,{recursive:true});",
      "for(const f of ['mac_id','address','tls.crt','tls.key']) fs.writeFileSync(p.join(st,f),'x');",
      "process.env.AGENT_WORKFORCE_TUNNEL_STATE=st;",
      "process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR='http://127.0.0.1:'+process.argv[2];",
      /* The COMMERCIAL switch, via remote's own derivation of the path. */
      "const R=require(p.join(process.argv[1],'engine/remote.js'));",
      "fs.mkdirSync(p.dirname(R.FILE),{recursive:true});",
      "fs.writeFileSync(R.FILE,JSON.stringify({on:true}));",
      "require(p.join(process.argv[1],'engine/updating.js')).announce(900);",
    ].join('\n');
    const env = { ...process.env, AGENT_WORKFORCE_TUNNEL_BIN: FAKE.bin, FAKE_MAC_REQUEST_MODE: 'ok:{}' };
    delete env.NODE_TEST_CONTEXT;          // the whole point: production conditions
    /* spawn, not execFileSync, so this process stays free to answer a direct hit
       if the child made one; bounded by a kill timer. */
    const child = spawn(process.execPath, ['-e', script, nodePath.join(__dirname, '..'), String(port)],
      { env, stdio: ['ignore', 'ignore', 'inherit'] });
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 15000);
    const code = await new Promise((r) => child.on('exit', r));
    clearTimeout(killer);
    const calls = await waitForCalls(FAKE, 1);
    assert.equal(code, 0, 'the production announce path must not crash the child');
    assert.deepEqual(direct, [], 'the coordinator must receive NO direct request: that is the unsigned path');
    assert.equal(calls.length, 1, 'the production path must actually hand the request to the tunnel');
    assert.equal(calls[0].args[0], 'mac-request');
    assert.equal(FAKE.flag(calls[0], '--path'), '/v1/mac/updating');
    assert.equal(FAKE.flag(calls[0], '--coordinator'), 'http://127.0.0.1:' + port);
    assert.deepEqual(JSON.parse(calls[0].stdin), { seconds: 900 });
  } finally { server.close(); }
});

test('#988: announce() actually CALLS seconds(), it does not just export it', () => {
  /* seconds() had six arms as a pure function and none proving announce() uses it.
     Measured: replacing `const n = seconds(v)` with `const n = v` left the suite
     green, and a real server then received {"seconds":-1} for announce(-1), which
     is the caller-typo-clears-the-banner direction seconds() exists to prevent. */
  enrol();
  const calls = capture();
  updating.announce(-1);
  assert.deepEqual(JSON.parse(calls[0].body), { seconds: updating.DEFAULT_SECONDS });
});

test('#988: the first-tick clear does NOT cancel a RUNNING install', async () => {
  /* 🛑 THE BOOT CLEAR'S ARGUMENT DOES NOT TRANSFER TO THE TICK. "The board is up,
     therefore it is not mid-update" is sound at process start and false sixty
     seconds later: both the Install button and maybeAutoInstall can start an
     install inside the first interval, and a real install runs for minutes.
     Measured without the guard: boot, then install, then tick gives the sequence
     [0,900,0], so the coordinator holds "not updating" while the Mac is mid-apply
     and about to restart with no banner. */
  enrol();
  update.resetCache();
  const calls = capture();
  update.setInstalledRoot(() => SANDBOX);
  const ticks = countTicks();
  const t = update.startPolling(20);
  update.setInstallRunner(() => ({ on() { return this; } }));
  try {
    try { update.beginInstall({}); } catch { /* fake child shape is not under test */ }
    /* 🛑 WAIT FOR A TICK, DO NOT SLEEP FOR ONE. This arm asserts that NOTHING was
       announced by the tick, which is exactly what a run where no tick ever fired
       also produces. A fixed sleep on a loaded box therefore passes it for the
       wrong reason. */
    await until(() => ticks.n >= 1);
  } finally {
    clearInterval(t);
    update.setInstallRunner(null);
    update.setInstalledRoot(null);
    ticks.restore();
  }
  const seq = calls.map((c) => JSON.parse(c.body).seconds);
  assert.ok(ticks.n >= 1, 'a tick must actually have fired, or "no tick clear" proves nothing');
  assert.ok(update.alreadyInstalling(), 'the fixture must leave an install in flight, or this proves nothing');
  assert.deepEqual(seq, [0, updating.DEFAULT_SECONDS],
    `boot clear then the begin announce, and NO tick clear while installing; got ${JSON.stringify(seq)}`);
  update.resetCache();
});

test('#988: a SUPERSEDED child\'s late exit must NOT clear a live install\'s banner', () => {
  /* 🛑 THE OWNER-IDENTITY GUARD. noteAttemptEnd carries the same one, for the
     reason it states: "a superseded attempt's late exit would overwrite the
     current one". Sequence: child A errors and clears, the person presses Install,
     child B announces its deadline, then A's LATE exit fires. Without the guard
     that clears a banner for an install that is genuinely running. */
  enrol();
  const a = freshChild();          // attempt A
  const b = freshChild();          // attempt B supersedes it
  const calls = capture();
  a.exit(0);                       // A's late exit, after B took over
  assert.equal(calls.length, 0, 'a superseded attempt may not clear the current one');
  b.exit(0);                       // and B, the current attempt, still may
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].body).seconds, 0);
  update.resetCache();
});

test('#988: a board run from a SOURCE CHECKOUT does not announce at all', () => {
  /* No installedRoot() means a dev checkout (node server.js,
     tools/restart-local-board.sh), which is routine on this fleet. Without the
     gate it makes real signed POSTs as the operator's Mac and can CLEAR
     a deadline the INSTALLED board just set. */
  enrol();
  const calls = capture();
  update.setInstalledRoot(() => null);
  const t = update.startPolling(60000);
  clearInterval(t);
  update.setInstalledRoot(null);
  assert.equal(calls.length, 0, 'a source checkout must not clear the installed board\'s banner');
});

test('#988: a SOURCE CHECKOUT is silent on the first TICK too, not just at boot', async () => {
  /* The arm above starts a 60s interval and clears it immediately, so NO TICK
     EVER FIRES: it covers the boot clear only. Measured: with the tick's gate
     removed, a source checkout announces {"seconds":0} on the first tick and the
     whole suite stayed green. Two gates, two arms. */
  enrol();
  const calls = capture();
  const ticks = countTicks();
  update.setInstalledRoot(() => null);
  const t = update.startPolling(10);
  try {
    /* Same reason as the install-in-flight arm: "announced nothing" and "never
       ticked" are the same observation, so the tick has to be witnessed. */
    await until(() => ticks.n >= 1);
  } finally {
    clearInterval(t);
    update.setInstalledRoot(null);
    ticks.restore();
  }
  assert.ok(ticks.n >= 1, 'a tick must actually have fired, or this arm proves nothing');
  assert.equal(calls.length, 0, 'the first-tick clear needs its own installedRoot gate');
});

test('#988 CONTROL: the same call WITH an installed root does announce', () => {
  enrol();
  const calls = capture();
  update.setInstalledRoot(() => SANDBOX);
  const t = update.startPolling(60000);
  clearInterval(t);
  update.setInstalledRoot(null);
  assert.ok(calls.length > 0, 'the arm above must fail for the MISSING ROOT, not because clearing broke');
});

test('#988 CONTROL: with the wiring driven and NO test tunnel, nothing is sent and nothing throws', () => {
  /* An installed root is set, so startPolling()'s boot clear really enters
     announce(); without the seam the guard must stop it there. */
  enrol();
  update.setInstalledRoot(() => SANDBOX);
  const calls = capture();
  const wire = tripwire();
  const seam = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  delete process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  try {
    assert.doesNotThrow(() => { const t = update.startPolling(60000); clearInterval(t); });
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = seam; wire.restore(); update.setInstalledRoot(null); }
  assert.equal(calls.length, 0, 'the boot path must not reach the tunnel under test without the seam');
  assert.deepEqual(wire.dialled, [], 'nor dial directly');
});
