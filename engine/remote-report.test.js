'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits

/**
 * kosmos#4277: engine/remote-report.js builds this Mac's remote-access report. A fake
 * remote (status, switch, state dir, restart count) stands in for engine/remote.js, so
 * every field is checked against a known state; nothing here spawns or dials.
 *
 *   node --test engine/remote-report.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const report = require('./remote-report');


function fakeRemote({ on = true, ok = true, state = 'up', because = null, dir, restarts = 0, sup, lastFailure = null, dialingMs = null, custom = false }) {
  const supervisor = sup || (state === 'restarting' ? 'waiting' : (state === 'up' || state === 'connecting' ? 'alive' : 'none'));
  return {
    supervisorState: () => supervisor,
    lastTunnelFailure: () => lastFailure,
    dialingForMs: () => dialingMs,
    stateDirIsCustom: () => custom,
    holdsKey: () => ['mac_id', 'mac_key'].every((f) => fs.existsSync(path.join(dir, f))),
    read: () => ({ ok, on }),
    status: () => ({ state, because }),
    stateDir: () => dir,
    restartCount: () => restarts,
  };
}
function stateDir(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remote-report-'));
  for (const f of files) fs.writeFileSync(path.join(d, f), 'x');
  return d;
}

test('an up tunnel: running, no error, the identity files seen, the app version', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id', 'mac_key']);
  const r = report.build({ remote: fakeRemote({ dir }), env: {}, appVersion: '0.7.05' });
  assert.deepEqual(r, { on: true, tunnel: 'running', error: null, stateDir: 'default', macId: true, macKey: true, app: '0.7.05', heal: 'none' });
});

test('every status maps to the coordinator vocabulary, and off follows the switch', () => {
  const dir = stateDir(report.ENROL_FILES);
  const cases = [
    [{ state: 'up' }, 'running'],
    [{ state: 'connecting', because: 'x' }, 'starting'],
    [{ state: 'restarting', because: 'x' }, 'crashed'],
    // The tunnel reconnecting inside a live process (a graceful close, a renewal) is not a crash.
    [{ state: 'restarting', because: 'the connection closed', sup: 'alive' }, 'starting'],
    [{ state: 'off', because: 'the board has not started the tunnel' }, 'stopped'],
    [{ state: 'off', because: 'the switch is off', on: false }, 'off'],
  ];
  for (const [st, want] of cases) {
    report.resetForTests();
    const r = report.build({ remote: fakeRemote({ dir, ...st }), env: {} });
    assert.equal(r.tunnel, want, JSON.stringify(st));
  }
});

test('the error is a CODE classified from status()\'s sentence; the sentence never leaves the Mac', () => {
  report.resetForTests();
  const dir = stateDir([]);
  const because = 'reading mac_key from /Users/somebody/Library/x: Permission denied';
  const r = report.build({ remote: fakeRemote({ dir, state: 'restarting', because }), env: {} });
  assert.equal(r.error, 'state-file-unreadable');
  assert.ok(!JSON.stringify(r).includes('somebody'), 'text from the sentence left the Mac');
});

test('classify: each known failure kind gets its code, anything else is other, never the text', () => {
  const cases = [
    // session.rs, verbatim shape: the tunnel reconnects to renew its certificate.
    ['certificate renewal is due (20 days left); reconnecting to renew', 'cert-renewal'],
    ['the tunnel program could not be started: spawn /x ENOENT', 'binary-unstartable'],
    ['the tunnel program could not be started: spawn /x EACCES', 'binary-unstartable'],
    // Unreachable in a report (the tunnel refuses a dir only without mac_id, which
    // enrolled() requires), so it has no code of its own and must not leak.
    ['/Volumes/Josh Stone/x does not look like a Mac state dir (no mac_id)', 'other'],
    ['reading mac_key from /Users/j/remote: No such file', 'state-file-unreadable'],
    ['relay refused the tunnel: bad ticket', 'relay-refused'],
    ['relay said go away: replaced', 'relay-dropped'],
    ['Kosmos+ refused this Mac: standing lapsed (HTTP 401 on /v1/mac/relay-ticket)', 'coordinator-refused'],
    ['Kosmos+ unreachable for /v1/mac/relay-ticket: dns error', 'coordinator-unreachable'],
    ['restarting after a crash (exit 3)', 'crashed'],
    ['the connection closed', 'reconnecting'],
    // The board's own healthy dialling sentences, verbatim from remote.js status().
    ['connecting to the relay', 'starting'],
    ['starting the connection', 'starting'],
    ['connecting to relay.plus.installkosmos.com:443: Connection refused (os error 61)', 'relay-unreachable'],
    ['connecting to relay.plus.installkosmos.com:443: failed to lookup address information', 'relay-unreachable'],
    ['relay TLS handshake: invalid peer certificate: Expired', 'relay-certificate'],
    ['relay TLS handshake: invalid peer certificate: UnknownIssuer', 'relay-certificate'],
    ['relay TLS handshake: received fatal alert: HandshakeFailure', 'relay-unreachable'],
    // session.rs AUTH read timeout: the relay never answered, which is not a refusal.
    ['relay did not answer AUTH: deadline has elapsed', 'relay-unreachable'],
    ['relay answered AUTH with ERROR', 'relay-refused'],
    // A gateway page with relay words in a coordinator 5xx is still the coordinator.
    ['Kosmos+ answered 502 for /v1/mac/relay-ticket: <html>connection lost keepalive</html>', 'coordinator-unreachable'],
    ['Kosmos+ answered 403 for /v1/mac/relay-ticket: <html>connection lost</html>', 'coordinator-refused'],
    ['unexpected Ping frame from the relay', 'relay-dropped'],
    ['Kosmos+ answered 503 for /v1/mac/relay-ticket: busy', 'coordinator-unreachable'],
    ['Kosmos+ answered 409 for /v1/mac/relay-ticket: taken', 'coordinator-refused'],
    // Rate-limited or timed out is "not now", not a refusal.
    ['Kosmos+ answered 429 for /v1/mac/relay-ticket: slow down', 'coordinator-unreachable'],
    ['Kosmos+ refused this Mac: slow down (HTTP 429 on /v1/mac/relay-ticket)', 'coordinator-unreachable'],
    ['Kosmos+ answered 408 for /v1/mac/relay-ticket: timeout', 'coordinator-unreachable'],
    // A wrong Mac clock, not a bad key.
    ['the Kosmos+ ticket does not verify against the pinned key: ticket expired at unix 1790000000', 'ticket-expired'],
    // The RELAY refusing an expired ticket the Mac had just accepted points at the relay, not this Mac.
    ['relay refused the tunnel: ticket refused: ticket expired at unix 1790000000', 'relay-refused'],
    // kosmos#4315's tunnel wording, verbatim.
    ['relay TLS handshake did not finish within 10s', 'relay-unreachable'],
    ['relay did not take AUTH within 10s', 'relay-unreachable'],
    ['writing AUTH to the relay: Broken pipe (os error 32)', 'relay-dropped'],
    // session.rs, verbatim: the relay connection ending mid-session.
    ['tunnel reader stopped', 'relay-dropped'],
    ['relay connection lost: Connection reset by peer (os error 54)', 'relay-dropped'],
    ['relay stopped answering keepalives', 'relay-dropped'],
    ['writer gone', 'relay-dropped'],
    // proto frame.rs, bare: the relay closed the connection during AUTH (tunnels already shipped).
    ['reading frame header: early eof', 'relay-dropped'],
    ['writing frame header: Broken pipe (os error 32)', 'relay-dropped'],
    ['reading frame payload: early eof', 'relay-dropped'],
    ['writing frame payload: Broken pipe (os error 32)', 'relay-dropped'],
    // coordinator.rs, verbatim: an answer that is not the coordinator's.
    ['the Kosmos+ answer is not JSON: expected value at line 1 column 1', 'coordinator-bad-answer'],
    ['the Kosmos+ answer has no ticket field', 'coordinator-bad-answer'],
    ['reading the Kosmos+ answer: unexpected end of file', 'coordinator-bad-answer'],
    // A 5xx whose body parses as a refusal is still an outage.
    ['Kosmos+ refused this Mac: busy (HTTP 503 on /v1/mac/relay-ticket)', 'coordinator-unreachable'],
    ['status unreadable: ENOENT: no such file', 'status-unreadable'],
    ['mac_key is not 32 bytes', 'state-file-unreadable'],
    ['the Kosmos+ ticket does not verify against the pinned key', 'ticket-mismatch'],
    ['ticket names "a" but this Mac\'s address is "b"', 'ticket-mismatch'],
    // Unreachable in a report: only a not-enrolled board says it, and that board sends
    // `not-enrolled; missing: ...` instead. It must never leak.
    ['waiting for the code sent to agent@example.com', 'other'],
    // session.rs local TLS setup, verbatim: this Mac's own certificate or key.
    ['opening certificate: No such file or directory (os error 2)', 'local-cert-unreadable'],
    ['parsing certificate: invalid PEM', 'local-cert-unreadable'],
    ['no private key found', 'local-cert-unreadable'],
    // A gateway page inside a coordinator answer never reads as a local fault.
    ['Kosmos+ answered 502 for /v1/mac/relay-ticket: <html>error reading body from upstream</html>', 'coordinator-unreachable'],
    ['Kosmos+ answered 503 for /v1/mac/relay-ticket: certificate renewal in progress', 'coordinator-unreachable'],
    ['Kosmos+ unreachable for /v1/mac/relay-ticket: the tunnel program could not be started', 'coordinator-unreachable'],
    ['Kosmos+ refused this Mac: the ticket names are wrong (HTTP 400 on /v1/mac/relay-ticket)', 'coordinator-refused'],
    ['the board has not started the tunnel', 'not-started'],
    ["Josh's MacBook Pro at 192.168.1.23 said something new", 'other'],
  ];
  for (const [text, want] of cases) assert.equal(report.classify(text), want, text);
  for (const code of report.CODES.map(([c]) => c)) assert.match(code, /^[a-z-]+$/, 'a code is not a fixed token: ' + code);
});

const ALLOW_SAID = 'this computer is not allowed yet; allow it from your other computer first. If that computer is gone, retire it from your account page, then retire this computer and set it up again';
test('kosmos#4640: waiting for the other computer\'s Allow is waiting-allow, not coordinator-refused; other refusals are unchanged', () => {
  const cases = [
    // retirehold-4681's ticket tunnel (with the code), the relay main tunnel (without), and status()'s own sentence.
    ['Kosmos+ refused this Mac: ' + ALLOW_SAID + ' (HTTP 403 on /v1/mac/relay-ticket, code own_lineage)', 'waiting-allow'],
    ['Kosmos+ refused this Mac: ' + ALLOW_SAID + ' (HTTP 403 on /v1/mac/relay-ticket)', 'waiting-allow'],
    [ALLOW_SAID, 'waiting-allow'],
    // CONTROLS: the same words with another code, the same words on another path, and an ordinary refusal stay as before.
    ['Kosmos+ refused this Mac: ' + ALLOW_SAID + ' (HTTP 403 on /v1/mac/relay-ticket, code standing_lapsed)', 'coordinator-refused'],
    // #4640 review: own_lineage's FINAL sentences (denied; no computer left to allow) are refusals, not a wait.
    ['Kosmos+ refused this Mac: this computer was not allowed on your account; retire this computer and set it up again (HTTP 403 on /v1/mac/relay-ticket, code own_lineage)', 'coordinator-refused'],
    ['Kosmos+ refused this Mac: this computer is still waiting to be allowed, and no other computer on your account is left to allow it; retire this computer and set it up again (HTTP 403 on /v1/mac/relay-ticket, code own_lineage)', 'coordinator-refused'],
    ['Kosmos+ refused this Mac: ' + ALLOW_SAID + ' (HTTP 403 on /v1/mac/standing)', 'coordinator-refused'],
    ['Kosmos+ refused this Mac: standing lapsed (HTTP 403 on /v1/mac/relay-ticket)', 'coordinator-refused'],
  ];
  for (const [text, want] of cases) assert.equal(report.classify(text), want, text);
  report.resetForTests();
  const dir = stateDir(report.ENROL_FILES);
  const r = report.build({ remote: fakeRemote({ dir, state: 'waiting-allow', because: ALLOW_SAID }), env: {} });
  assert.equal(r.tunnel, 'starting', 'a waiting computer\'s live tunnel read as stopped or crashed');
  assert.equal(r.error, 'waiting-allow');
});

test('classify: each healthy dialling sentence matches `starting` and no failure pattern', () => {
  // The order of CODES must not be what keeps a healthy board from reading as failed.
  for (const s of ['connecting to the relay', 'starting the connection']) {
    const hits = report.CODES.filter(([, re]) => re.test(s)).map(([c]) => c);
    assert.deepEqual(hits, ['starting'], s);
  }
});

test('a tunnel dialling again after a failure is named by that failure, not by "connecting"', () => {
  report.resetForTests();
  const dir = stateDir(report.ENROL_FILES);
  const stuck = report.build({ remote: fakeRemote({ dir, state: 'connecting', because: 'connecting to the relay', lastFailure: 'relay refused the tunnel: bad ticket' }), env: {} });
  assert.equal(stuck.tunnel, 'starting');
  assert.equal(stuck.error, 'relay-refused', 'a stuck tunnel read as one coming up');
  assert.ok(!JSON.stringify(stuck).includes('bad ticket'), 'the failure sentence left the Mac');
  const fresh = report.build({ remote: fakeRemote({ dir, state: 'connecting', because: 'connecting to the relay' }), env: {} });
  assert.equal(fresh.error, 'starting', 'a tunnel with no failure yet is simply starting');
  // A real reason in the status wins over the remembered one.
  const now = report.build({ remote: fakeRemote({ dir, state: 'restarting', because: 'relay said go away: replaced', sup: 'alive', lastFailure: 'relay refused the tunnel: x' }), env: {} });
  assert.equal(now.error, 'relay-dropped');
});

test('a first dial running past STUCK_DIALLING_MS with no failure reads stuck-dialling; a known failure still wins', () => {
  report.resetForTests();
  const dir = stateDir(report.ENROL_FILES);
  const at = (dialingMs, lastFailure = null) => report.build({ remote: fakeRemote({ dir, state: 'connecting', because: 'connecting to the relay', dialingMs, lastFailure }), env: {} }).error;
  assert.equal(at(10 * 1000), 'starting', 'a tunnel ten seconds in read as stuck');
  assert.equal(at(report.STUCK_DIALLING_MS + 1), 'stuck-dialling', 'a tunnel stuck on its first dial read as starting');
  assert.equal(at(report.STUCK_DIALLING_MS + 1, 'relay refused the tunnel: x'), 'relay-refused', 'the age hid a known failure');
  assert.equal(at(null), 'starting');
});

test('classify is bounded: a 100k-character hostile line classifies fast', () => {
  const t0 = Date.now();
  assert.equal(report.classify('a1'.repeat(50000)), 'other');
  assert.ok(Date.now() - t0 < 200, 'classify took ' + (Date.now() - t0) + ' ms on a long line');
});

test('switch on, key held, not enrolled: the error names the missing enrolment files, not the sign-in sentence', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id', 'mac_key']);
  const r = report.build({ remote: fakeRemote({ dir, state: 'connecting', because: 'waiting for the code sent to agent@example.com' }), env: {} });
  // kosmos-relay coordinator/src/macremote.rs says_not_enrolled() matches this `not-enrolled` prefix
  // so the Mac is not shown as seen: change both together.
  assert.equal(r.error, 'not-enrolled; missing: address, tls.crt, tls.key',
    'the not-enrolled wording changed: kosmos-relay macremote.rs says_not_enrolled() matches its prefix');
  assert.equal(r.tunnel, 'stopped', 'a board that is not enrolled will never start; it is not `starting`');
  assert.ok(!JSON.stringify(r).includes('@'), 'the email left the Mac');
});

test('stateDir: custom when AGENT_WORKFORCE_TUNNEL_STATE is set, missing when the directory is not there', () => {
  report.resetForTests();
  const dir = stateDir([]);
  assert.equal(report.build({ remote: fakeRemote({ dir, custom: true }), env: {} }).stateDir, 'custom');
  assert.equal(report.build({ remote: fakeRemote({ dir }), env: {} }).stateDir, 'default');
  const gone = path.join(dir, 'not-here');
  assert.equal(report.build({ remote: fakeRemote({ dir: gone }), env: {} }).stateDir, 'missing');
});

test('heal: counted only once a report is SENT; a tunnel still starting is not yet a result', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id', 'mac_key']);
  let last = null;
  const at = (restarts, state, sup) => { last = report.build({ remote: fakeRemote({ dir, restarts, state, sup, because: state === 'up' ? null : 'x' }), env: {} }); return last.heal; };
  const commit = () => report.commitHeal(last);
  // The baseline is 0 (restarts counts from process start), so relaunches before the first
  // successful send are not lost.
  assert.equal(at(3, 'up'), 'relaunched', 'relaunches before the first send were lost');
  commit();
  assert.equal(at(4, 'up'), 'relaunched');
  // Not sent (no commitHeal): the relaunch is still news for the next report.
  assert.equal(at(4, 'up'), 'relaunched', 'a relaunch was swallowed by a report that never went out');
  commit();
  assert.equal(at(4, 'up'), 'none', 'the same count again is not a new relaunch');
  commit();
  // A relaunched process still dialling is a relaunch that held, not a failure.
  assert.equal(at(5, 'connecting'), 'relaunched', 'a relaunched tunnel still dialling was not reported');
  commit();
  assert.equal(at(6, 'restarting'), 'relaunch-failed', 'a relaunch that died again was not reported');
  commit();
  // The tunnel reconnecting INSIDE a live process reads `restarting` too; the relaunch held.
  assert.equal(at(7, 'restarting', 'alive'), 'relaunched', 'an in-process reconnect after a relaunch read as relaunch-failed');
  commit();
  // A deliberate stop after a relaunch: nothing is running and nothing is scheduled, so no result.
  assert.equal(at(8, 'off', 'none'), 'none', 'a deliberate stop read as a relaunch result');
});

test('a remote that throws gives no report, never an exception', () => {
  report.resetForTests();
  const broken = { read: () => { throw new Error('boom'); }, status: () => ({}), stateDir: () => '/x' };
  assert.equal(report.build({ remote: broken, env: {} }), null);
});

test('the report carries only the known fields, each a fixed value', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id']);
  const r = report.build({ remote: fakeRemote({ dir }), env: {}, appVersion: '0.7.05' });
  assert.deepEqual(Object.keys(r).sort(), ['app', 'error', 'heal', 'macId', 'macKey', 'on', 'stateDir', 'tunnel']);
  assert.ok(!JSON.stringify(r).includes(dir), 'the state dir path was sent');
});

test('commitHeal only moves forward: a slow send committing an older baseline does not roll it back', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id', 'mac_key']);
  const mk = (restarts) => report.build({ remote: fakeRemote({ dir, restarts, state: 'up' }), env: {} });
  const older = mk(2);
  const newer = mk(5);
  report.commitHeal(newer);
  report.commitHeal(older);   // the slow one lands last
  assert.equal(mk(5).heal, 'none', 'a late, older commit rolled the baseline back and re-reported a relaunch');
});
