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

const HOME = '/Users/somebody';

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
  const r = report.build({ remote: fakeRemote({ dir }), env: {}, home: HOME, appVersion: '0.7.05' });
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
    const r = report.build({ remote: fakeRemote({ dir, ...st }), env: {}, home: HOME });
    assert.equal(r.tunnel, want, JSON.stringify(st));
  }
});

test('the error is status()\'s sentence, with the home directory written as ~ and no user name left', () => {
  report.resetForTests();
  const dir = stateDir([]);
  const because = `${HOME}/Library/Application Support/AgentWorkforce/remote does not look like a Mac state dir (no mac_id); run setup first`;
  const r = report.build({ remote: fakeRemote({ dir, state: 'restarting', because }), env: {}, home: HOME });
  assert.equal(r.error, '~/Library/Application Support/AgentWorkforce/remote does not look like a Mac state dir (no mac_id); run setup first');
  assert.ok(!r.error.includes('somebody'), 'the user name left the Mac');
});

test('an email in the sentence is never sent: status() names the sign-in email while it waits for the code', () => {
  report.resetForTests();
  const dir = stateDir([]);
  const r = report.build({ remote: fakeRemote({ dir, state: 'connecting', because: 'waiting for the code sent to josh@stuff.io' }), env: {}, home: HOME });
  assert.equal(r.error, 'waiting for the code sent to <email>');
  assert.ok(!JSON.stringify(r).includes('@'), 'an email left the Mac');
  assert.equal(report.scrub('a.b+c@d-e.co.uk said no', HOME), '<email> said no');
});

test('the home directory is matched in any letter case (macOS paths are case-insensitive)', () => {
  const home = '/Users/Somebody';
  assert.equal(report.scrub('/users/somebody/Library/x and /USERS/SOMEBODY/y', home), '~/Library/x and ~/y');
  assert.ok(!report.scrub('/users/somebody/x', home).toLowerCase().includes('somebody'), 'the user name left the Mac');
});

test('the error is cut to its bound, never mid-character, and loses control characters', () => {
  report.resetForTests();
  const dir = stateDir([]);
  const because = 'line one\nline\u0007two ' + 'é'.repeat(report.ERROR_MAX_CHARS + 40);
  const r = report.build({ remote: fakeRemote({ dir, state: 'restarting', because }), env: {}, home: HOME });
  assert.equal(Array.from(r.error).length, report.ERROR_MAX_CHARS);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(r.error), 'a control character was sent');
});

test('stateDir: custom when AGENT_WORKFORCE_TUNNEL_STATE is set, missing when the directory is not there', () => {
  report.resetForTests();
  const dir = stateDir([]);
  assert.equal(report.build({ remote: fakeRemote({ dir }), env: { AGENT_WORKFORCE_TUNNEL_STATE: dir }, home: HOME }).stateDir, 'custom');
  const gone = path.join(dir, 'not-here');
  assert.equal(report.build({ remote: fakeRemote({ dir: gone }), env: {}, home: HOME }).stateDir, 'missing');
});

test('heal: none on the first report, relaunched when the supervisor restarted it and it is up, relaunch-failed when it is not', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id', 'mac_key']);
  const at = (restarts, state) => report.build({ remote: fakeRemote({ dir, restarts, state, because: state === 'up' ? null : 'x' }), env: {}, home: HOME }).heal;
  assert.equal(at(3, 'up'), 'none', 'the first report cannot know what happened before it');
  assert.equal(at(3, 'up'), 'none', 'no restart since the last report');
  assert.equal(at(4, 'up'), 'relaunched');
  assert.equal(at(5, 'restarting'), 'relaunch-failed');
  assert.equal(at(5, 'restarting'), 'none', 'the same count again is not a new relaunch');
});

test('a remote that throws gives no report, never an exception', () => {
  report.resetForTests();
  const broken = { read: () => { throw new Error('boom'); }, status: () => ({}), stateDir: () => '/x' };
  assert.equal(report.build({ remote: broken, env: {}, home: HOME }), null);
});

test('the report carries no path, address or email: only the known fields', () => {
  report.resetForTests();
  const dir = stateDir(['mac_id']);
  const r = report.build({ remote: fakeRemote({ dir }), env: {}, home: HOME, appVersion: '0.7.05' });
  assert.deepEqual(Object.keys(r).sort(), ['app', 'error', 'heal', 'macId', 'macKey', 'on', 'stateDir', 'tunnel']);
  assert.ok(!JSON.stringify(r).includes(dir), 'the state dir path was sent');
});
