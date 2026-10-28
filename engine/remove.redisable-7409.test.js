'use strict';
/**
 * kosmos#7409: a removed agent stays off after a machine move. launchd keeps `disable` in its own per-machine database,
 * which Migration Assistant does not copy, so on the new Mac a removed agent's plist loads at login, enabled. At board
 * start, reapplyRemovedDisables disables again (and stops) every removed agent's recorded Mac label that launchd does
 * not hold disabled. Driven through remove.setRunner, against a sandboxed removed.json; every call is recorded.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// Sandbox every root before requiring remove.js (it freezes store roots at require).
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'remove-redisable-7409-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const remove = require('./remove');
const store = require('./store');
const REMOVED = nodePath.join(store.ROOT, 'removed.json');

function removedList(rows) {
  fs.mkdirSync(nodePath.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, JSON.stringify(rows));
}
/* A launchctl that answers print-disabled with `held` and records every call. */
function launchd(held, { disableFails = [] } = {}) {
  const calls = [];
  remove.setRunner((file, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'print-disabled') return { ok: true, stdout: 'disabled services = {\n' + held.map(([l, v]) => '\t"' + l + '" => ' + v + '\n').join('') + '}\n' };
    if (args[0] === 'disable' && disableFails.some((l) => args[1].endsWith('/' + l))) return { ok: false, code: 5, stdout: '', stderr: 'no' };
    return { ok: true, stdout: '' };
  });
  return calls;
}
test.afterEach(() => { remove.setRunner(null); try { fs.rmSync(REMOVED, { force: true }); } catch { /* none */ } });

test('#7409: a removed agent launchd holds enabled (after a move) is disabled again and stopped', () => {
  removedList([{ name: 'casey', label: 'com.kosmos.agent.casey', plist: '/x/com.kosmos.agent.casey.plist' }]);
  const calls = launchd([['com.apple.foo', 'disabled']]);   // the new Mac's database: nothing of ours
  const out = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.deepEqual(out, { ok: true, reapplied: ['com.kosmos.agent.casey'], failed: [] });
  assert.deepEqual(calls, ['print-disabled gui/501', 'disable gui/501/com.kosmos.agent.casey', 'bootout gui/501/com.kosmos.agent.casey']);
});

test('#7409: a label launchd already holds disabled (either spelling) is left alone (control: an enabled one is not)', () => {
  removedList([{ name: 'a', label: 'com.kosmos.agent.a' }, { name: 'b', label: 'com.kosmos.agent.b' }, { name: 'c', label: 'com.kosmos.agent.c' }]);
  const calls = launchd([['com.kosmos.agent.a', 'disabled'], ['com.kosmos.agent.b', 'true'], ['com.kosmos.agent.c', 'enabled']]);
  const out = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.deepEqual(out.reapplied, ['com.kosmos.agent.c'], 'CONTROL: an enabled one must be disabled again');
  assert.ok(!calls.some((c) => /agent\.(a|b)$/.test(c)), 'a job launchd already holds disabled was touched: ' + calls.join(' | '));
});

test('#7409: a disable launchd refuses is reported, and the others still go', () => {
  removedList([{ name: 'a', label: 'com.kosmos.agent.a' }, { name: 'b', label: 'com.kosmos.agent.b' }]);
  launchd([], { disableFails: ['com.kosmos.agent.a'] });
  const out = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.deepEqual(out, { ok: false, reapplied: ['com.kosmos.agent.b'], failed: ['com.kosmos.agent.a'] });
});

test('#7409: nothing runs off a Mac, with no removed agents, or for a label that is not launchd-shaped', () => {
  removedList([{ name: 'a', label: 'com.kosmos.agent.a' }]);
  let calls = launchd([]);
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'win32', uid: 501 }).reapplied, []);
  assert.deepEqual(calls, [], 'launchctl was asked off a Mac');
  removedList([{ name: 'w', label: null }, { name: 'x', label: 'evil/../label' }, { name: 'y', label: 'a b' }]);
  calls = launchd([]);
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }).reapplied, []);
  assert.deepEqual(calls, [], 'an unusable label reached launchctl');
  fs.rmSync(REMOVED, { force: true });
  calls = launchd([]);
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }), { ok: true, reapplied: [], failed: [] });
  assert.deepEqual(calls, [], 'with nothing removed, launchctl was asked anyway');
});

test('#7409: an unreadable removed list, or a print-disabled launchd will not answer, does nothing and says why', () => {
  fs.mkdirSync(nodePath.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, '{ not json');
  let calls = launchd([]);
  const bad = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.equal(bad.ok, false);
  assert.match(bad.because, /could not be read/);
  assert.deepEqual(calls, []);
  removedList([{ name: 'a', label: 'com.kosmos.agent.a' }]);
  calls = [];
  remove.setRunner((file, args) => { calls.push(args.join(' ')); return { ok: false, code: 1 }; });
  const quiet = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.equal(quiet.ok, false);
  assert.match(quiet.because, /did not say which jobs it holds disabled/);
  assert.deepEqual(calls, ['print-disabled gui/501'], 'it disabled without knowing what launchd held');
});
