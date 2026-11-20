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
test.after(() => { keptswitch.applyAtStart({}, { live: false }); fs.rmSync(DIR, { recursive: true, force: true }); });
let n = 0;
const fresh = () => path.join(DIR, `kept-${++n}.json`);
const POLL = 'AGENT_WORKFORCE_USAGE_POLL';
const MOVE = 'AGENT_WORKFORCE_AUTOMOVE';
const start = (env, file, nowMs = 1000) => keptswitch.applyAtStart(env, { live: true, file, nowMs });
const T1 = Date.UTC(2026, 10, 6, 9, 17);

test('CONTROL: a board nobody switched on stays off, writes nothing and says nothing', () => {
  const file = fresh();
  const env = {};
  const r = start(env, file);
  assert.deepEqual([r.kept, r.recorded, r.cleared, r.wrote, r.lines], [[], [], [], null, []]);
  assert.equal(fs.existsSync(file), false, 'a record was written for a board that switched nothing on');
  assert.deepEqual([usagePoll.enabled(env), automove.movesOn(env), keptswitch.keptNow()], [false, false, {}]);
});

test('switched on at one start, both are on at the next start that leaves the variables unset', () => {
  const file = fresh();
  const a = start({ [POLL]: '1', [MOVE]: '1' }, file, T1);
  assert.deepEqual([a.recorded, a.kept, a.wrote], [['usagePoll', 'automove'], [], true]);
  assert.deepEqual(a.lines, ['kept-switches: the usage poll and the mover are switched on at this start, and will stay switched on at later starts']);
  assert.deepEqual(keptswitch.keptNow(), {}, 'a switch this start was told itself is not "kept"');

  const second = {};   // the restart of 2026-11-11: launchd's environment no longer carried them
  const b = start(second, file, Date.UTC(2026, 10, 11, 19, 40));
  assert.deepEqual([b.kept, b.recorded, b.wrote], [['usagePoll', 'automove'], [], null]);
  assert.equal(usagePoll.enabled(second), true, 'the usage poll did not come back');
  assert.equal(automove.movesOn(second), true, 'the mover did not come back');
  assert.deepEqual(keptswitch.keptNow(), { usagePoll: T1, automove: T1 });
  assert.deepEqual(b.lines, ['kept-switches: the usage poll and the mover are switched on, kept from the start of 2026-11-06T09:17:00.000Z; start once with AGENT_WORKFORCE_USAGE_POLL=0 and AGENT_WORKFORCE_AUTOMOVE=0 to switch them off']);
  // The date kept is the first start's, however many starts repeat it.
  start({ [POLL]: '1' }, file, Date.UTC(2026, 10, 12));
  assert.equal(keptswitch.read(file).on.usagePoll.at, T1);
});

test('the kept switch is the board\'s alone: the environment is not changed, and no other environment reads as on', () => {
  const file = fresh();
  start({ [POLL]: '1', [MOVE]: '1' }, file);
  const board = {};
  start(board, file);
  assert.deepEqual(board, {}, 'the switch was written into the environment, which everything the board starts inherits');
  assert.equal(usagePoll.enabled(board), true, 'CONTROL: it is on for the board');
  // What a child of the board would see: a copy of that environment, or the test runner's own.
  assert.equal(usagePoll.enabled({ ...board }), false, 'a copy of the board\'s environment read as switched on');
  assert.equal(automove.movesOn({}), false);
  assert.equal(usagePoll.enabled(), false, 'this test process\'s own environment read as switched on');
  assert.equal(automove.movesOn(), false);
});

test('NAME=0 switches it off for good; the other switch is untouched', () => {
  const file = fresh();
  start({ [POLL]: '1', [MOVE]: '1' }, file);
  const off = { [MOVE]: '0' };
  const r = start(off, file);
  assert.deepEqual([r.cleared, r.kept, r.wrote], [['automove'], ['usagePoll'], true]);
  assert.match(r.lines.join('\n'), /the mover is switched off, and will stay off at later starts/);
  assert.deepEqual([automove.movesOn(off), usagePoll.enabled(off)], [false, true]);
  const later = {};
  start(later, file);
  assert.deepEqual([automove.movesOn(later), usagePoll.enabled(later)], [false, true], 'a switch that was switched off came back at a later start');
});

test('a value that is neither 1, 0 nor unset is off at this start and leaves the record alone', () => {
  const file = fresh();
  start({ [POLL]: '1' }, file);
  const odd = { [POLL]: 'true' };
  const r = start(odd, file);
  assert.deepEqual([r.kept, r.cleared, r.wrote, usagePoll.enabled(odd)], [[], [], null, false]);
  const empty = { [POLL]: '' };
  start(empty, file);
  assert.equal(usagePoll.enabled(empty), true, 'an empty value did not read as unset');
});

test('the brake still wins while it is set, the log says so, and the record survives it', () => {
  const file = fresh();
  const first = { [POLL]: '1', [POLL + '_OFF']: '1' };
  const a = start(first, file, T1);
  assert.equal(usagePoll.enabled(first), false);
  assert.deepEqual(a.lines, ['kept-switches: the usage poll is switched on at this start; held off for now by AGENT_WORKFORCE_USAGE_POLL_OFF=1, and will stay switched on at later starts']);
  const braked = { [POLL + '_OFF']: '1' };
  const b = start(braked, file);
  assert.equal(usagePoll.enabled(braked), false, 'the brake did not hold the kept usage poll off');
  assert.deepEqual(b.lines, ['kept-switches: the usage poll is switched on, kept from the start of 2026-11-06T09:17:00.000Z; held off for now by AGENT_WORKFORCE_USAGE_POLL_OFF=1; start once with AGENT_WORKFORCE_USAGE_POLL=0 to switch it off']);
  assert.deepEqual(keptswitch.keptNow(), {}, 'a switch the brake holds off was reported as kept on, which the page would say');
  const after = {};
  start(after, file);
  assert.equal(usagePoll.enabled(after), true, 'taking the brake off did not bring the kept switch back');
  assert.deepEqual(keptswitch.keptNow(), { usagePoll: T1 });
});

test('under a test or a dry run nothing is read, written or kept', () => {
  const file = fresh();
  start({ [POLL]: '1' }, file);
  const before = fs.readFileSync(file, 'utf8');
  const board = (extra) => keptswitch.atBoardStart({ ...extra }, { liveExecutionAllowed: true, file });
  assert.deepEqual(board({}).kept, ['usagePoll'], 'CONTROL: a live board start keeps it');
  for (const r of [board({ NODE_TEST_CONTEXT: 'child' }), board({ AGENT_WORKFORCE_DRY_RUN: '1' }),
    keptswitch.atBoardStart({}, { liveExecutionAllowed: false, file }), keptswitch.atBoardStart({ [MOVE]: '1' }, { file })]) {
    assert.deepEqual([r.kept, r.recorded, r.lines, r.wrote], [[], [], [], null]);
    assert.deepEqual(keptswitch.keptNow(), {});
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a record that cannot be read keeps nothing, says so, and is never written over', () => {
  const file = fresh();
  fs.writeFileSync(file, '{ not json');
  const env = {};
  const r = start(env, file);
  assert.deepEqual([r.kept, r.readOk, r.wrote, usagePoll.enabled(env)], [[], false, null, false]);
  assert.deepEqual(r.lines, ['kept-switches: the record of what was switched on could not be read, so nothing was kept from an earlier start']);
  // A start that is told a switch is still on for itself, and does not replace a record it could not read (which may
  // hold the other switch).
  const told = { [POLL]: '1' };
  const s = start(told, file);
  assert.deepEqual([s.wrote, usagePoll.enabled(told)], [null, true]);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'an unreadable record was written over');
  assert.match(s.lines.join('\n'), /but that could not be written down, so a later start must say it again/);
  assert.match(s.lines.join('\n'), /what this start was told \(AGENT_WORKFORCE_USAGE_POLL=1\) was not written down/);
});

test('a record that cannot be written is said, and this start is still on', () => {
  const locked = path.join(DIR, 'locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o555);   // the record's folder cannot be made inside it; reading there is "no record yet"
  const env = { [POLL]: '1' };
  let r;
  try { r = start(env, path.join(locked, 'data', 'kept.json')); } finally { fs.chmodSync(locked, 0o755); }
  assert.deepEqual([r.readOk, r.wrote, usagePoll.enabled(env)], [true, false, true]);
  assert.match(r.lines.join('\n'), /but that could not be written down, so a later start must say it again/);
});

test('the board makes the one call at start, with nothing of its own decided there', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.equal(src.split("require('./engine/keptswitch').atBoardStart(process.env, { liveExecutionAllowed: liveExecution.liveExecutionAllowed() })").length, 2,
    'server.js does not make exactly one atBoardStart call for its own environment');
});

test('a recorded time no date can say reads as no day, not as an invalid one', () => {
  const file = fresh();
  fs.writeFileSync(file, JSON.stringify({ usagePoll: { on: true, at: 9e15 }, automove: { on: true, at: -5 } }));
  assert.deepEqual(keptswitch.read(file).on, { usagePoll: { at: 0 }, automove: { at: 0 } });
  const r = start({}, file);
  assert.match(r.lines[0], /kept from the start of an earlier day;/);
});
