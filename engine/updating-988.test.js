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
 * 🛑 THE SEAM REPLACES THE TRANSPORT ONLY. Enrolment, the certificate read and
 * the URL derivation all still run under test, so a wrong path, a missing cert
 * or a broken coordinator derivation is visible here. An earlier version of this
 * file replaced the whole send, which made every one of those invisible.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-updating-988-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

/* A state dir shaped exactly as remote.enrolled() requires: mac_id, address,
   tls.crt, tls.key. Real files, so the certificate read is exercised. */
const STATE = nodePath.join(SANDBOX, 'enrolled');
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(nodePath.join(STATE, 'mac_id'), 'test-mac\n');
fs.writeFileSync(nodePath.join(STATE, 'address'), 'test.example\n');
fs.writeFileSync(nodePath.join(STATE, 'tls.crt'), 'CERT-BYTES\n');
fs.writeFileSync(nodePath.join(STATE, 'tls.key'), 'KEY-BYTES\n');

const updating = require('./updating');
const update = require('./update');

function enrol() {
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coordinator.example';
}
function unenrol() {
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = nodePath.join(SANDBOX, 'no-such-dir');
}
/* A fake request object with the surface announce() uses, and nothing else. */
function fakeReq() {
  const handlers = {};
  return {
    handlers,
    destroyed: false,
    on(ev, fn) { handlers[ev] = fn; return this; },
    end() {},
    destroy() { this.destroyed = true; },
    fire(ev, arg) { if (handlers[ev]) handlers[ev](arg); },
  };
}
function capture() {
  const calls = [];
  updating.setRequestFactory((opts, body) => { calls.push({ opts, body }); return fakeReq(); });
  return calls;
}
test.afterEach(() => {
  updating.setRequestFactory(null);
  delete process.env.AGENT_WORKFORCE_TUNNEL_STATE;
  delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
});

/* ---- THE BLOCKER ARM ------------------------------------------------------ */

test('#988 BLOCKER: an in-process announce with no factory injected reaches no transport', () => {
  enrol();
  updating.setRequestFactory(null);
  /* node --test sets NODE_TEST_CONTEXT, so underTest() is true here. Without the
     guard, running the suite on an ENROLLED Mac posts a real {"seconds":900}
     with the operator's client certificate, and one existing suite drives a
     child stub that never exits, so nothing clears it: the operator's phone then
     reads "back in a moment" for the full 15-minute cap while nothing is
     updating. This card's own message, inverted, by its own test suite. */
  assert.equal(updating.underTest(), true, 'the suite must be recognisable as a test context');
  /* Observe the REAL transport. An earlier version of this arm installed a
     counting factory and then nulled it, so the counter could never increment
     and the arm asserted 0 against nothing: it stayed green with the guard
     removed. Stub node:https/node:http instead, which is what announce() reaches
     when no factory is injected. */
  const https = require('node:https');
  const http = require('node:http');
  const realHttps = https.request;
  const realHttp = http.request;
  let reached = 0;
  https.request = (...a) => { reached++; return fakeReq(); };
  http.request = (...a) => { reached++; return fakeReq(); };
  try {
    assert.doesNotThrow(() => updating.announce(900));
  } finally { https.request = realHttps; http.request = realHttp; }
  assert.equal(reached, 0, 'the suite must not reach the real transport with no factory injected');
});

test('#988 CONTROL: the guard does NOT disable an injected transport', () => {
  enrol();
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 1, 'a test that supplies its own transport touches no network and must still run');
});

/* ---- the request itself, now visible through the seam --------------------- */

test('#988: POST to the documented route with a seconds body', () => {
  enrol();
  const calls = capture();
  updating.announce(900);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.path, '/v1/mac/updating');
  assert.deepEqual(JSON.parse(calls[0].body), { seconds: 900 });
});

test('#988: the client certificate and key are attached, read from the state dir', () => {
  enrol();
  const calls = capture();
  updating.announce(900);
  assert.equal(String(calls[0].opts.cert), 'CERT-BYTES\n', 'the cert must be the enrolled one');
  assert.equal(String(calls[0].opts.key), 'KEY-BYTES\n', 'the key must be the enrolled one');
});

test('#988: the timeout is wired into the request, not merely declared', () => {
  enrol();
  const calls = capture();
  updating.announce(900);
  assert.equal(calls[0].opts.timeout, updating.TIMEOUT_MS);
});

test('#988: TLS verification is never disabled', () => {
  enrol();
  const calls = capture();
  updating.announce(900);
  assert.notEqual(calls[0].opts.rejectUnauthorized, false);
});

test('#988: a self-hosted coordinator keeps its path prefix', () => {
  enrol();
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://host.example/kosmos';
  const calls = capture();
  updating.announce(0);
  assert.equal(calls[0].opts.path, '/kosmos/v1/mac/updating');
});

test('#988: an http coordinator is reachable, not silently dead', () => {
  enrol();
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'http://localhost:9099';
  const calls = capture();
  updating.announce(0);
  assert.equal(calls[0].opts.protocol, 'http:', 'a dev coordinator over http must not be dropped');
});

/* ---- the gates ------------------------------------------------------------ */

test('#988: an unenrolled machine says nothing, because there is nothing to say it with', () => {
  unenrol();
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 0);
});

test('#988: the ENROLMENT gate is load-bearing, not shadowed by the certificate read', () => {
  /* 🛑 THE ARM ABOVE CANNOT PROVE THIS, and I only noticed because a reviewer
     mutated the code. unenrol() points at a directory with NONE of the four
     files, so deleting `if (!remote.enrolled()) return;` still produces
     calls.length === 0, just via the cert-read catch instead: the same observable
     outcome down a different path, which is the definition of an arm that cannot
     fail for its stated reason.
     enrolled() requires FOUR files; the cert read looks at two. This fixture has
     the two certs and neither identity file, which is a plausible mid-forget() or
     partially written state dir, and it is the only shape that separates the
     gates. Measured: with the guard removed it sends a real POST carrying a
     possibly orphaned client certificate. */
  const orphan = nodePath.join(SANDBOX, 'orphan');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(nodePath.join(orphan, 'tls.crt'), 'CERT-BYTES\n');
  fs.writeFileSync(nodePath.join(orphan, 'tls.key'), 'KEY-BYTES\n');
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = orphan;
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coordinator.example';
  const remote = require('./remote');
  assert.equal(remote.enrolled(), false, 'the fixture must be UNenrolled, or this arm proves nothing');
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 0, 'an unenrolled mac must not present a certificate it still happens to hold');
});

test('#988 CONTROL: the same fixture WITH the identity files present does send', () => {
  const whole = nodePath.join(SANDBOX, 'orphan-complete');
  fs.mkdirSync(whole, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(whole, f), 'x\n');
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = whole;
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coordinator.example';
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 1, 'the arm above must fail for the MISSING IDENTITY, not for the fixture');
});

test('#988: a certificate that vanishes AFTER the enrolment check says nothing rather than throwing', () => {
  /* 🛑 THE RACE THIS ARM IS FOR, and an earlier version of it never reached the
     code it named. It deleted tls.key and then called announce(), but
     remote.enrolled() re-checks existsSync on every call, so the function
     returned at the enrolment gate and the readFileSync catch below it was never
     entered. That made the arm redundant with the unenrolled arm above and left
     a real branch uncovered. Forcing enrolled() true with the key absent is the
     only way in: it is exactly the window the code's own comment describes.
     ⚠️ SCOPE, so this arm does not overclaim a second time: it asserts the
     OUTCOME (nothing sent, nothing thrown) and cannot say WHICH guard produced
     it. Removing the inner catch leaves this green, because the outer guard
     swallows the same throw and builds no request either way. That is measured,
     and the library says so at the site. */
  const partial = nodePath.join(SANDBOX, 'partial');
  fs.mkdirSync(partial, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(partial, f), 'x\n');
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = partial;
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coordinator.example';
  fs.rmSync(nodePath.join(partial, 'tls.key'));
  const calls = capture();
  const remote = require('./remote');
  const real = remote.enrolled;
  remote.enrolled = () => true;   // the gate has already passed; the file goes now
  try {
    assert.doesNotThrow(() => updating.announce(900));
    assert.equal(calls.length, 0, 'no request may be built without a key');
  } finally { remote.enrolled = real; }
});

test('#988 CONTROL: the same fixture WITH the key present does send, so the arm above is not vacuous', () => {
  const whole = nodePath.join(SANDBOX, 'whole');
  fs.mkdirSync(whole, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(whole, f), 'x\n');
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = whole;
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coordinator.example';
  const calls = capture();
  updating.announce(900);
  assert.equal(calls.length, 1, 'the cert-vanished arm must fail for the MISSING KEY, not for the fixture');
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

test('#988: the default asks for more than any install needs, because the server caps it', () => {
  assert.ok(updating.DEFAULT_SECONDS >= 900);
});

/* ---- fail-open, which is the governing constraint ------------------------- */

test('#988 FAIL-OPEN: a throwing transport does not reach the caller', () => {
  enrol();
  updating.setRequestFactory(() => { throw new Error('coordinator on fire'); });
  assert.doesNotThrow(() => updating.announce(900));
});

test('#988 FAIL-OPEN: a factory returning junk does not reach the caller', () => {
  enrol();
  updating.setRequestFactory(() => null);
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

/* beginInstall() opens with `if (installStarted) return;` and exports no reset,
   so exactly ONE call per process ever wires a child. Capture that child's
   listeners here, once, and let the arms below drive them. */
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
  updating.setRequestFactory(null);
}

test('#988 WIRING: beginning to apply announces a deadline', () => {
  assert.ok(CHILD.announced.some((n) => n > 0), `applying must announce a deadline; got ${JSON.stringify(CHILD.announced)}`);
});

test('#988 WIRING: the installer child had its listeners wired', () => {
  assert.equal(typeof CHILD.handlers.error, 'function');
  assert.equal(typeof CHILD.handlers.exit, 'function');
});

test('#988 WIRING: a board coming back up clears, because success has no finish hook', () => {
  enrol();
  const calls = capture();
  const t = update.startPolling(60000);
  clearInterval(t);
  assert.ok(calls.some((c) => JSON.parse(c.body).seconds === 0), 'a restarted board is by definition not mid-update');
});

test('#988 WIRING: the boot clear repeats once on the first tick, because a lost clear costs 15 minutes', async () => {
  enrol();
  const calls = capture();
  const t = update.startPolling(10);
  await new Promise((r) => setTimeout(r, 40));
  clearInterval(t);
  const cleared = calls.filter((c) => JSON.parse(c.body).seconds === 0);
  assert.ok(cleared.length >= 2, `a single unretried clear is the exposure; got ${cleared.length}`);
});

test('#988 WIRING: a boot may only ever clear, never set', () => {
  enrol();
  const calls = capture();
  const t = update.startPolling(60000);
  clearInterval(t);
  assert.ok(calls.every((c) => JSON.parse(c.body).seconds === 0));
});

test('#988: the timeout handler destroys the request rather than leaving it hanging', () => {
  enrol();
  let made = null;
  updating.setRequestFactory(() => { made = fakeReq(); return made; });
  updating.announce(900);
  assert.ok(made, 'a request must have been built');
  assert.equal(made.destroyed, false);
  made.fire('timeout');
  assert.equal(made.destroyed, true, 'a timed-out request must be destroyed, not left to hang');
});

test('#988: a handler that throws still cannot reach the caller', () => {
  enrol();
  let made = null;
  updating.setRequestFactory(() => { made = fakeReq(); return made; });
  updating.announce(900);
  made.destroy = () => { throw new Error('already gone'); };
  assert.doesNotThrow(() => made.fire('timeout'));
  assert.doesNotThrow(() => made.fire('error', new Error('socket')));
});

test('#988: a non-2xx answer is reported on stderr, once per response, and changes nothing', () => {
  enrol();
  let made = null;
  updating.setRequestFactory(() => { made = fakeReq(); return made; });
  updating.announce(900);
  const real = process.stderr.write;
  const lines = [];
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { made.fire('response', { statusCode: 401, resume() {} }); }
  finally { process.stderr.write = real; }
  assert.equal(lines.length, 1, 'a route that is merged but undeployed has no other client-side check');
  assert.match(lines[0], /401/);
});

test('#988 CONTROL: a 2xx answer is silent', () => {
  enrol();
  let made = null;
  updating.setRequestFactory(() => { made = fakeReq(); return made; });
  updating.announce(900);
  const real = process.stderr.write;
  const lines = [];
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { made.fire('response', { statusCode: 204, resume() {} }); }
  finally { process.stderr.write = real; }
  assert.equal(lines.length, 0);
});

test('#988: the error handler is REGISTERED, which is the line the fail-open guarantee rests on', () => {
  /* Deleting req.on('error') left this suite green, so the one handler the
     governing constraint depends on was unarmed. (Measured separately: on this
     Node version its removal did NOT crash a refused or DNS-failed announce,
     because the throw surfaces inside the outer guard. Armed anyway: an unguarded
     line on the install route should not depend on that staying true.) */
  enrol();
  let made = null;
  updating.setRequestFactory(() => { made = fakeReq(); return made; });
  updating.announce(900);
  assert.equal(typeof made.handlers.error, 'function', 'an error listener must be registered');
  assert.equal(typeof made.handlers.timeout, 'function', 'a timeout listener must be registered');
  assert.equal(typeof made.handlers.response, 'function', 'a response listener must be registered');
});

test('#988 WIRING: a child that fails to START clears the deadline', () => {
  enrol();
  const calls = capture();
  CHILD.handlers.error(new Error('spawn failed'));
  assert.ok(calls.length > 0, 'a child that never started must clear');
  assert.equal(JSON.parse(calls[calls.length - 1].body).seconds, 0);
});

test('#988 WIRING: a child that EXITS ZERO still clears, because the shell masks the installer status', () => {
  /* The spawned shell ends in an `if`, so an installer that fails still exits 0.
     Measured: an installer exiting 7 records "7" in the status file while the
     child exits 0. A clear placed inside `code !== 0` never ran on ordinary
     failures, and the deadline then stood for the full cap on a healthy Mac. */
  enrol();
  const calls = capture();
  CHILD.handlers.exit(0);
  assert.ok(calls.length > 0, 'an exit that reaches this listener did NOT restart the board, so it must clear');
  assert.equal(JSON.parse(calls[calls.length - 1].body).seconds, 0);
});

test('#988: the first-tick clear happens ONCE, not on every tick forever', async () => {
  /* The arm that only counted ">= 2" could not tell "once more" from "a fresh
     mTLS connection to the coordinator every 60 seconds from every enrolled
     Mac". This one can. */
  enrol();
  const calls = capture();
  const t = update.startPolling(10);
  await new Promise((r) => setTimeout(r, 90));
  clearInterval(t);
  const cleared = calls.filter((c) => JSON.parse(c.body).seconds === 0).length;
  assert.ok(cleared >= 2, `boot plus one tick expected; got ${cleared}`);
  assert.ok(cleared <= 3, `the clear must not repeat every tick; got ${cleared} across ~8 ticks`);
});

test('#988 CONTROL: with the wiring driven and NO factory, nothing is sent and nothing throws', () => {
  enrol();
  updating.setRequestFactory(null);
  const https = require('node:https');
  const realHttps = https.request;
  let reached = 0;
  https.request = () => { reached++; return fakeReq(); };
  try {
    assert.doesNotThrow(() => { const t = update.startPolling(60000); clearInterval(t); });
  } finally { https.request = realHttps; }
  assert.equal(reached, 0, 'the boot path must not reach the real transport under test either');
});
