'use strict';

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


function fakeRemote({ on = true, ok = true, state = 'up', because = null, dir, restarts = 0 }) {
  return {
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
  const dir = stateDir([]);
  const cases = [
    [{ state: 'up' }, 'running'],
    [{ state: 'connecting', because: 'x' }, 'starting'],
    [{ state: 'restarting', because: 'x' }, 'crashed'],
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
  const because = '/Users/somebody/Library/x does not look like a Mac state dir (no mac_id); run setup first';
  const r = report.build({ remote: fakeRemote({ dir, state: 'restarting', because }), env: {} });
  assert.equal(r.error, 'state-dir-invalid');
  assert.ok(!JSON.stringify(r).includes('somebody'), 'text from the sentence left the Mac');
});

test('classify: each known failure kind gets its code, anything else is other, never the text', () => {
  const cases = [
    ['the switch is off', 'switch-off'],
    ['the tunnel program could not be started: spawn /x ENOENT', 'binary-missing'],
    ['/Volumes/Josh Stone/x does not look like a Mac state dir (no mac_id)', 'state-dir-invalid'],
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
    ['relay TLS handshake: invalid peer certificate: Expired', 'relay-unreachable'],
    ['unexpected Ping frame from the relay', 'relay-dropped'],
    ['Kosmos+ answered 503 for /v1/mac/relay-ticket: busy', 'coordinator-unreachable'],
    ['Kosmos+ answered 409 for /v1/mac/relay-ticket: taken', 'coordinator-refused'],
    // A 5xx whose body parses as a refusal is still an outage (review 9).
    ['Kosmos+ refused this Mac: busy (HTTP 503 on /v1/mac/relay-ticket)', 'coordinator-unreachable'],
    ['status unreadable: ENOENT: no such file', 'status-unreadable'],
    ['mac_key is not 32 bytes', 'state-file-unreadable'],
    ['the Kosmos+ ticket does not verify against the pinned key', 'ticket-mismatch'],
    ['ticket names "a" but this Mac\'s address is "b"', 'ticket-mismatch'],
    ['waiting for the code sent to josh@stuff.io', 'awaiting-sign-in'],
    ['the board has not started the tunnel', 'not-started'],
    ["Josh's MacBook Pro at 192.168.1.23 said something new", 'other'],
  ];
  for (const [text, want] of cases) assert.equal(report.classify(text), want, text);
  for (const code of report.CODES.map(([c]) => c)) assert.match(code, /^[a-z-]+$/, 'a code is not a fixed token: ' + code);
});

test('classify: each healthy dialling sentence matches `starting` and no failure pattern', () => {
  // The order of CODES must not be what keeps a healthy board from reading as failed (review 9).
  for (const s of ['connecting to the relay', 'starting the connection']) {
    const hits = report.CODES.filter(([, re]) => re.test(s)).map(([c]) => c);
    assert.deepEqual(hits, ['starting'], s);
  }
});

test('classify is bounded: a 100k-character hostile line classifies fast', () => {
  const t0 = Date.now();
  assert.equal(report.classify('a1'.repeat(50000)), 'other');
  assert.ok(Date.now() - t0 < 200, 'classify took ' + (Date.now() - t0) + ' ms on a long line');
});

test('switch on, key held, not enrolled: the error names the missing enrolment files, not the sign-in sentence', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id', 'mac_key']);
  const r = report.build({ remote: fakeRemote({ dir, state: 'connecting', because: 'waiting for the code sent to josh@stuff.io' }), env: {} });
  assert.equal(r.error, 'not-enrolled; missing: address, tls.crt, tls.key');
  assert.ok(!JSON.stringify(r).includes('@'), 'the email left the Mac');
});

test('stateDir: custom when AGENT_WORKFORCE_TUNNEL_STATE is set, missing when the directory is not there', () => {
  report.resetForTests();
  const dir = stateDir([]);
  assert.equal(report.build({ remote: fakeRemote({ dir }), env: { AGENT_WORKFORCE_TUNNEL_STATE: dir } }).stateDir, 'custom');
  const gone = path.join(dir, 'not-here');
  assert.equal(report.build({ remote: fakeRemote({ dir: gone }), env: {} }).stateDir, 'missing');
});

test('heal: counted only once a report is SENT; a tunnel still starting is not yet a result', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id', 'mac_key']);
  let last = null;
  const at = (restarts, state) => { last = report.build({ remote: fakeRemote({ dir, restarts, state, because: state === 'up' ? null : 'x' }), env: {} }); return last.heal; };
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
  assert.equal(at(5, 'connecting'), 'none', 'a tunnel still starting was called a failure');
  commit();
  assert.equal(at(5, 'up'), 'relaunched', 'the pending relaunch was lost while the tunnel was starting');
  commit();
  assert.equal(at(6, 'restarting'), 'relaunch-failed');
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
