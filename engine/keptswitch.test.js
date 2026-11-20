'use strict';
require('../test-support/tmpscope');
/**
 * kosmos#8841: the usage poll and the mover, switched on in one start's environment, stay on at a later start that
 * does not repeat the variable. Before, a restart turned both off and said so only in the log.
 *
 *   node --test engine/keptswitch.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const keptswitch = require('./keptswitch');
const usagePoll = require('./usagepoll');
const automove = require('./automove');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-keptswitch-'));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));
let n = 0;
const fresh = () => path.join(DIR, `kept-${++n}.json`);
const POLL = 'AGENT_WORKFORCE_USAGE_POLL';
const MOVE = 'AGENT_WORKFORCE_AUTOMOVE';
const start = (env, file, nowMs = 1000) => keptswitch.applyAtStart(env, { live: true, file, nowMs });

test('CONTROL: a board nobody switched on stays off, writes nothing and says nothing', () => {
  const file = fresh();
  const env = {};
  const r = start(env, file);
  assert.deepEqual([r.kept, r.recorded, r.cleared, r.wrote, r.lines], [[], [], [], null, []]);
  assert.deepEqual(env, {}, 'the environment was changed');
  assert.equal(fs.existsSync(file), false, 'a record was written for a board that switched nothing on');
  assert.equal(usagePoll.enabled(env), false);
  assert.equal(automove.movesOn(env), false);
});

test('switched on at one start, both are on at the next start that leaves the variables unset', () => {
  const file = fresh();
  const first = { [POLL]: '1', [MOVE]: '1' };
  const a = start(first, file, Date.UTC(2026, 10, 6, 9, 17));
  assert.deepEqual([a.recorded, a.kept, a.wrote], [['usagePoll', 'automove'], [], true]);
  assert.match(a.lines.join('\n'), /the usage poll and the mover are on at this start, and will stay on at later starts/);

  const second = {};   // the restart of 2026-11-11: launchd's environment no longer carried them
  assert.equal(usagePoll.enabled(second), false, 'CONTROL: without the record this start is off');
  const b = start(second, file, Date.UTC(2026, 10, 11, 19, 40));
  assert.deepEqual([b.kept, b.recorded, b.wrote], [['usagePoll', 'automove'], [], null]);
  assert.deepEqual(second, { [POLL]: '1', [MOVE]: '1' });
  assert.equal(usagePoll.enabled(second), true, 'the usage poll did not come back');
  assert.equal(automove.movesOn(second), true, 'the mover did not come back');
  assert.equal(b.lines.length, 1);
  assert.equal(b.lines[0], 'kept-switches: the usage poll and the mover are on, kept from the start of 2026-11-06T09:17:00.000Z; start once with AGENT_WORKFORCE_USAGE_POLL=0 and AGENT_WORKFORCE_AUTOMOVE=0 to switch them off');
  // The date kept is the first start's, however many starts repeat it.
  start({ [POLL]: '1' }, file, Date.UTC(2026, 10, 12));
  assert.equal(keptswitch.read(file).on.usagePoll.at, Date.UTC(2026, 10, 6, 9, 17));
});

test('NAME=0 switches it off for good; the other switch is untouched', () => {
  const file = fresh();
  start({ [POLL]: '1', [MOVE]: '1' }, file);
  const off = { [MOVE]: '0' };
  const r = start(off, file);
  assert.deepEqual([r.cleared, r.kept, r.wrote], [['automove'], ['usagePoll'], true]);
  assert.equal(automove.movesOn(off), false);
  assert.equal(usagePoll.enabled(off), true);
  const later = {};
  start(later, file);
  assert.deepEqual(later, { [POLL]: '1' }, 'a switch that was switched off came back at a later start');
});

test('the brake still wins while it is set, and the record survives it', () => {
  const file = fresh();
  start({ [POLL]: '1', [MOVE]: '1' }, file);
  const braked = { [POLL + '_OFF']: '1', [MOVE + '_OFF']: '1' };
  start(braked, file);
  assert.equal(usagePoll.enabled(braked), false, 'the brake did not hold the usage poll off');
  assert.equal(automove.movesOn(braked), false, 'the brake did not hold the mover off');
  const after = {};
  start(after, file);
  assert.equal(usagePoll.enabled(after), true, 'taking the brake off did not bring the kept switch back');
});

test('under a test or a dry run nothing is read, written or changed', () => {
  const file = fresh();
  start({ [POLL]: '1' }, file);
  const before = fs.readFileSync(file, 'utf8');
  for (const live of [false, undefined]) {
    const env = {};
    const r = keptswitch.applyAtStart(env, { live, file });
    assert.deepEqual([env, r.kept, r.lines], [{}, [], []]);
    const on = { [MOVE]: '1' };
    assert.deepEqual(keptswitch.applyAtStart(on, { live, file }).recorded, []);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a record that cannot be read keeps nothing, says so, and is not replaced by an empty one', () => {
  const file = fresh();
  fs.writeFileSync(file, '{ not json');
  const env = {};
  const r = start(env, file);
  assert.deepEqual([env, r.kept, r.readOk, r.wrote], [{}, [], false, null]);
  assert.match(r.lines.join('\n'), /could not be read, so nothing was kept from an earlier start/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'an unreadable record was overwritten with nothing to record');
  // A start that says it again writes a good record over it.
  assert.equal(start({ [POLL]: '1' }, file).wrote, true);
  assert.deepEqual(Object.keys(keptswitch.read(file).on), ['usagePoll']);
});

test('a record that cannot be written is said, and this start is still on', () => {
  const file = path.join(fresh(), 'under-a-file', 'kept.json');
  fs.writeFileSync(path.dirname(path.dirname(file)), 'a file where the folder would go');
  const env = { [POLL]: '1' };
  const r = start(env, file);
  assert.equal(r.wrote, false);
  assert.equal(usagePoll.enabled(env), true);
  assert.match(r.lines.join('\n'), /could not be written down, so a later start must say it again/);
});

test('the board calls it at start, before the usage poll and the mover are wired, and never live under a test', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const call = src.indexOf("require('./engine/keptswitch').applyAtStart(process.env");
  assert.ok(call > 0, 'server.js does not apply the kept switches');
  assert.ok(call < src.indexOf('const usagePollTick = '), 'applied after the usage poll is wired');
  assert.ok(call < src.indexOf('if (abSweep && automove.movesOn())'), 'applied after the mover is decided at start');
  assert.match(src.slice(call, call + 400), /live: liveExecution\.liveExecutionAllowed\(\) && !process\.env\.NODE_TEST_CONTEXT && process\.env\.AGENT_WORKFORCE_DRY_RUN !== '1'/);
});
