'use strict';
/**
 * kosmos#7409: a removed agent stays off after a machine move. launchd keeps `disable` in its own per-machine database,
 * which Migration Assistant does not copy, so on the new Mac a removed agent's plist loads at login, enabled, and the
 * agent runs again in its tmux session. At board start, reapplyRemovedDisables gives each removed agent whose recorded
 * job launchd does not hold disabled removal's own steps again: disable, bootout, and its session ended when the board
 * can tie it to the agent. Driven through remove.setRunner (every launchctl and tmux call recorded) against a sandboxed
 * removed.json, with the board's roster from test-support/fleet.
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
const create = require('./create');
const launchidentity = require('./launchidentity');
const fleet = require('../test-support/fleet');
const REMOVED = nodePath.join(store.ROOT, 'removed.json');
const labelOf = (name) => create.serviceLabel(name, launchidentity.currentWorldId());

function removedList(rows) {
  fs.mkdirSync(nodePath.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, JSON.stringify(rows));
}
const removedRow = (name) => ({ name, label: labelOf(name), plist: '/x/' + labelOf(name) + '.plist', stopped: true });

/* A launchctl and tmux that answer from `held` (print-disabled) and record every call. A killed session is gone. */
function machine(held, { refuse = {} } = {}) {
  const calls = [];
  remove.setRunner((file, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'print-disabled') return { ok: true, stdout: 'disabled services = {\n' + held.map(([l, v]) => '\t"' + l + '" => ' + v + '\n').join('') + '}\n' };
    for (const [verb, code] of Object.entries(refuse)) if (args[0] === verb) return { ok: false, code, stdout: '', stderr: 'no' };
    if (args[0] === 'has-session') return { ok: false, code: 1, stdout: '', stderr: '' };   // gone after the kill
    return { ok: true, stdout: '' };
  });
  return calls;
}
let board = null;
function roster(agents) { if (board) board.restore(); board = fleet.install(agents); }
test.afterEach(() => {
  remove.setRunner(null);
  if (board) { board.restore(); board = null; }
  try { fs.rmSync(REMOVED, { force: true }); } catch { /* none */ }
});

test('#7409: a removed agent launchd holds enabled (after a move) is disabled, booted out, and its running session ended', () => {
  removedList([removedRow('casey')]);
  roster([fleet.agent('casey', { state: 'working' })]);
  const calls = machine([['com.apple.foo', 'disabled']]);
  const out = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.deepEqual(out, { ok: true, reapplied: ['casey'], failed: [], unsure: [] });
  assert.equal(calls[0], 'print-disabled gui/501');
  assert.ok(calls.includes('disable gui/501/' + labelOf('casey')) && calls.includes('bootout gui/501/' + labelOf('casey')), calls.join(' | '));
  assert.ok(calls.some((c) => /^kill-session -t =casey/.test(c)), 'the agent\'s own session was not ended (bootout alone leaves it running): ' + calls.join(' | '));
});

test('#7409: a removed agent that is not running is disabled and booted out, with no session to end', () => {
  removedList([removedRow('casey')]);
  roster([]);
  const calls = machine([]);
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }).reapplied, ['casey']);
  assert.ok(!calls.some((c) => c.startsWith('kill-session')), calls.join(' | '));
});

test('#7409: a session the board cannot tie to the agent is left alone and reported (control: its own is ended)', () => {
  removedList([removedRow('casey')]);
  roster([fleet.agent('casey', { state: 'working', ours: false })]);
  const calls = machine([]);
  const out = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.deepEqual(out, { ok: false, reapplied: [], failed: [], unsure: ['casey'] });
  assert.ok(!calls.some((c) => c.startsWith('kill-session')), 'a session not tied to the agent was killed');
});

test('#7409: a label launchd already holds disabled (either spelling) is left alone (control: an enabled one is not)', () => {
  removedList([removedRow('a'), removedRow('b'), removedRow('c')]);
  roster([]);
  const calls = machine([[labelOf('a'), 'disabled'], [labelOf('b'), 'true'], [labelOf('c'), 'enabled']]);
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }).reapplied, ['c'], 'CONTROL: an enabled one must be disabled again');
  assert.ok(!calls.some((c) => c.endsWith('/' + labelOf('a')) || c.endsWith('/' + labelOf('b'))), calls.join(' | '));
});

test('#7409: a label that is not the one removal records for that name is never touched (a hand-edited removed.json)', () => {
  removedList([{ name: 'casey', label: 'com.apple.Dock' }, { name: 'dana', label: labelOf('casey') }, { name: 'w', label: null }]);
  roster([]);
  const calls = machine([]);
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }), { ok: true, reapplied: [], failed: [], unsure: [] });
  assert.deepEqual(calls, [], 'a foreign or mismatched label reached launchctl');
});

test('#7409: a refused disable or bootout is a failure, and its session is not touched; the others still go', () => {
  removedList([removedRow('a'), removedRow('b')]);
  roster([fleet.agent('a', { state: 'working' })]);
  let calls = machine([], { refuse: { disable: 5 } });
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }), { ok: false, reapplied: [], failed: ['a', 'b'], unsure: [] });
  assert.ok(!calls.some((c) => c.startsWith('kill-session')));
  calls = machine([], { refuse: { bootout: 5 } });
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }).failed, ['a', 'b']);
  assert.ok(!calls.some((c) => c.startsWith('kill-session')), 'a session was ended after launchd refused the bootout');
  calls = machine([], { refuse: { bootout: 3 } });   // CONTROL: 3 is "not loaded", the wanted end state
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }).reapplied, ['a', 'b']);
});

test('#7409: nothing runs off a Mac, in a dry run, or with nothing removed', () => {
  removedList([removedRow('a')]);
  roster([]);
  let calls = machine([]);
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'win32', uid: 501 }).reapplied, []);
  assert.deepEqual(calls, []);
  remove.setRunner(null);   // no runner: a dry run, where nothing would really happen
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }), { ok: true, reapplied: [], failed: [], unsure: [] });
  fs.rmSync(REMOVED, { force: true });
  calls = machine([]);
  assert.deepEqual(remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 }).reapplied, []);
  assert.deepEqual(calls, []);
});

test('#7409: an unreadable removed list, or a print-disabled launchd will not answer, does nothing and says why', () => {
  fs.mkdirSync(nodePath.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, '{ not json');
  roster([]);
  let calls = machine([]);
  const bad = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.equal(bad.ok, false);
  assert.match(bad.because, /could not be read/);
  assert.deepEqual(calls, []);
  removedList([removedRow('a')]);
  calls = [];
  remove.setRunner((file, args) => { calls.push(args.join(' ')); return { ok: false, code: 1 }; });
  const quiet = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.equal(quiet.ok, false);
  assert.match(quiet.because, /did not say which jobs it holds disabled/);
  assert.deepEqual(calls, ['print-disabled gui/501'], 'it disabled without knowing what launchd held');
});

test('#7409: a sandboxed board never schedules it; a real board does, logs the names, and tries once more only when not clean', () => {
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; };
  const said = [];
  const sinks = { out: (t) => said.push(t), err: (t) => said.push(t) };
  assert.equal(remove.reapplyAtBoardStart({ enforcing: false, setTimer, ...sinks }), false);
  assert.equal(timers.length, 0, 'a sandboxed fixture board scheduled it');
  removedList([removedRow('casey')]);
  roster([]);
  machine([]);
  assert.equal(remove.reapplyAtBoardStart({ enforcing: true, setTimer, ...sinks }), true);
  assert.equal(timers.length, 1, 'CONTROL: a real board did not schedule it');
  timers[0].fn();
  assert.match(said.join(''), /removed agents kept from running again .*: casey/, 'the board log did not name the agent: ' + said.join(''));
  assert.equal(timers.length, 1, 'a clean run scheduled another');
  machine([], { refuse: { disable: 5 } });
  remove.reapplyAtBoardStart({ enforcing: true, setTimer, ...sinks });
  timers[1].fn();
  assert.equal(timers.length, 3, 'a run that was not clean did not try once more');
  assert.equal(timers[2].ms, 30000);
  timers[2].fn();
  assert.equal(timers.length, 3, 'the second try scheduled a third');
});

test('#7409 review 2: an agent launchd already holds disabled still has its own running session ended (an untied one left)', () => {
  removedList([removedRow('casey'), removedRow('dana')]);
  roster([fleet.agent('casey', { state: 'working' }), fleet.agent('dana', { state: 'working', ours: false })]);
  const calls = machine([[labelOf('casey'), 'disabled'], [labelOf('dana'), 'disabled']]);
  const out = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.deepEqual(out, { ok: true, reapplied: ['casey'], failed: [], unsure: [] });
  assert.ok(calls.some((c) => /^kill-session -t =casey/.test(c)), 'the session missed earlier was not ended: ' + calls.join(' | '));
  assert.ok(!calls.some((c) => /^kill-session -t =dana/.test(c)), 'an untied session was killed');
  assert.ok(!calls.some((c) => c.startsWith('disable') || c.startsWith('bootout')), 'a job launchd already held disabled was touched again');
});

test('#7409 review 2: the default Kosmos legacy com.<name>.discord label is swept for its own name only', () => {
  removedList([{ name: 'casey', label: 'com.casey.discord' }, { name: 'dana', label: 'com.casey.discord' }]);
  roster([]);
  const calls = machine([]);
  const out = remove.reapplyRemovedDisables({ platform: 'darwin', uid: 501 });
  assert.equal(launchidentity.isDefaultWorld(launchidentity.currentWorldId()), true, 'CONTROL: this test runs in the default Kosmos');
  assert.deepEqual(out.reapplied, ['casey']);
  assert.ok(calls.includes('disable gui/501/com.casey.discord'), calls.join(' | '));
});
