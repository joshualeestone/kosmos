'use strict';
/**
 * kosmos#8083: on a board where nothing has been at risk since it started, the auto-balance sweep wrote nothing to its
 * record and nothing to the board log, so "armed and quiet" and "not running" looked the same (Mortals, 11-05: armed at
 * 15:26, no record and no line by 20:12). quietLine says which, when that changes and once an hour while it holds.
 *
 *   node --test engine/autobalance-quiet-8083.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { quietLine, QUIET_SAY_MS } = require('./autobalance-sweep');

const T0 = Date.UTC(2026, 10, 5, 21, 26, 0);
const MIN = 60 * 1000;

test('kosmos#8083: a quiet tick says the sweep is running once, then not again within the hour', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'nothing' }), 'autobalance-sweep: running, nothing new to record');
  for (const m of [10, 20, 59]) assert.equal(quietLine(said, { nowMs: T0 + m * MIN, did: 'nothing' }), null, 'said again at ' + m + ' min');
  assert.equal(QUIET_SAY_MS, 60 * MIN);
  assert.equal(quietLine(said, { nowMs: T0 + 60 * MIN, did: 'nothing' }), 'autobalance-sweep: running, nothing new to record', 'silent at the hour, when it should be said again');
  assert.equal(quietLine(said, { nowMs: T0 + 70 * MIN, did: 'nothing' }), null);
});

test('kosmos#8083: unmeasured accounts are counted in the line, one and many', () => {
  assert.equal(quietLine({ at: 0, key: null }, { nowMs: T0, did: 'nothing', unmeasured: 1 }),
    'autobalance-sweep: running, nothing new to record (1 account not measured now)');
  assert.equal(quietLine({ at: 0, key: null }, { nowMs: T0, did: 'nothing', unmeasured: 3 }),
    'autobalance-sweep: running, nothing new to record (3 accounts not measured now)');
  for (const bad of [0, -1, 1.5, NaN, '2', null]) {
    assert.equal(quietLine({ at: 0, key: null }, { nowMs: T0, did: 'nothing', unmeasured: bad }), 'autobalance-sweep: running, nothing new to record', String(bad));
  }
});

test('kosmos#8083: a shut gate says why, at once on a change and hourly while it holds; opening it again says so at once', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'nothing' }), 'autobalance-sweep: running, nothing new to record');
  assert.equal(quietLine(said, { nowMs: T0 + MIN, offWhy: 'the usage poll is off' }), 'autobalance-sweep: not running: the usage poll is off', 'a change of state waited for the hour');
  assert.equal(quietLine(said, { nowMs: T0 + 30 * MIN, offWhy: 'the usage poll is off' }), null);
  assert.equal(quietLine(said, { nowMs: T0 + 61 * MIN, offWhy: 'the usage poll is off' }), 'autobalance-sweep: not running: the usage poll is off');
  assert.equal(quietLine(said, { nowMs: T0 + 62 * MIN, offWhy: 'live execution is not allowed' }), 'autobalance-sweep: not running: live execution is not allowed', 'a different reason is a change');
  assert.equal(quietLine(said, { nowMs: T0 + 63 * MIN, did: 'nothing' }), 'autobalance-sweep: running, nothing new to record');
});

test('kosmos#8083: switched off in Settings (did off) is said as such, and differs from running', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'off' }), 'autobalance-sweep: not running: auto-balance is switched off in Settings');
  assert.equal(quietLine(said, { nowMs: T0 + MIN, did: 'off' }), null);
  assert.equal(quietLine(said, { nowMs: T0 + 2 * MIN, did: 'nothing' }), 'autobalance-sweep: running, nothing new to record');
});

test('kosmos#8083 CONTROL: a tick the board printed a line for adds none and counts as said', () => {
  for (const did of ['recorded', 'cleared', 'gap', 'unreadable', 'nothing']) {
    const said = { at: 0, key: null };
    assert.equal(quietLine(said, { nowMs: T0, did, logged: true }), null, did + ' was said twice');
    assert.equal(quietLine(said, { nowMs: T0 + 61 * MIN, did, logged: false }) !== null, true, 'silent an hour after a logged ' + did);
  }
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'recorded', logged: true }), null);
  assert.equal(quietLine(said, { nowMs: T0 + MIN, did: 'nothing' }), null, 'a quiet tick right after a recorded one was said');
});

test('kosmos#8083: an unreadable decision the board logged once is said again hourly while it lasts, and a new reason is a change', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'unreadable', because: 'agents walk failed', logged: true }), null);
  assert.equal(quietLine(said, { nowMs: T0 + 10 * MIN, did: 'unreadable', because: 'agents walk failed' }), null);
  assert.equal(quietLine(said, { nowMs: T0 + 60 * MIN, did: 'unreadable', because: 'agents walk failed' }),
    'autobalance-sweep: running, but it could not work out the decision (agents walk failed)', 'a lasting unreadable went silent');
  assert.equal(quietLine(said, { nowMs: T0 + 61 * MIN, did: 'unreadable', because: 'list threw' }),
    'autobalance-sweep: running, but it could not work out the decision (list threw)');
  assert.equal(quietLine({ at: 0, key: null }, { nowMs: T0, did: 'unreadable' }), 'autobalance-sweep: running, but it could not work out the decision (unknown)');
});

test('kosmos#8083: a failed record write is never said as nothing new to record', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'nothing', because: 'write-failed', logged: true }), null);
  assert.equal(quietLine(said, { nowMs: T0 + 60 * MIN, did: 'nothing', because: 'write-failed' }), 'autobalance-sweep: running, but its record could not be written');
  assert.equal(quietLine(said, { nowMs: T0 + 70 * MIN, did: 'nothing' }), 'autobalance-sweep: running, nothing new to record', 'the write coming back was not said');
});

test('kosmos#8083: a gap, even one repeated without its own log line, is never said as nothing new', () => {
  const said = { at: 0, key: 'on' };
  assert.equal(quietLine(said, { nowMs: T0, did: 'gap', because: 'an account the last decision named could not be measured' }),
    'autobalance-sweep: running, but it could not measure what it needs (an account the last decision named could not be measured)');
  assert.equal(quietLine(said, { nowMs: T0 + MIN, did: 'gap', because: 'an account the last decision named could not be measured' }), null);
});

test('kosmos#8083: fewer than two accounts is said, not read as armed and healthy', () => {
  assert.equal(quietLine({ at: 0, key: null }, { nowMs: T0, did: 'nothing', because: 'fewer-than-two' }),
    'autobalance-sweep: running, but there are fewer than two Claude subscription accounts to balance');
  // The sweep returning that reason on a real one-account tick is pinned in autobalance-sweep-7152.test.js.
});

test('kosmos#8083: no memory or no clock says nothing and never throws', () => {
  assert.equal(quietLine(null, { nowMs: T0, did: 'nothing' }), null);
  assert.equal(quietLine({ at: 0, key: null }, { nowMs: NaN, did: 'nothing' }), null);
  assert.equal(quietLine({ at: 0, key: null }), null);
});

/* The board's wiring, from its own source: the tick cannot run under a test (the gate refuses there, review 16 of
   #7152), so this pins that both ends of a tick reach quietLine and that the start line is written. */
test('kosmos#8083: server.js says the start line and calls quietLine where the tick returns early and where it ends', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /autobalance-sweep: timer set, every \$\{Math\.round\(abSweepMs \/ 60000\)\} min, \$\{offNow \? 'not running now: ' \+ offNow : 'running'\}; the mover is \$\{automoveRun \? 'on' : 'off'\}/);
  assert.match(src, /r\.did === 'recorded' \|\| r\.did === 'cleared'\)\) \{ process\.stdout\.write\('autobalance-sweep: recorded a changed decision\\n'\); logged = true; \}/, 'a cleared risk is not logged');
  assert.match(src, /\.catch\(\(err\) => \{ abSayQuiet\(\{ did: 'unreadable', because: 'the tick failed: ' \+ /, 'a tick that throws leaves no trace');
  assert.match(src, /if \(!abSweep \|\| !autobalanceSweepRuns\(\{ forTick: true \}\)\) \{ abSayQuiet\(\{ offWhy: autobalanceSweepOffWhy\(\) \|\| 'unknown' \}\); return; \}/,
    'the early return no longer says why the sweep is not running');
  assert.match(src, /abSayQuiet\(\{ did: r && r\.did, because: r && r\.because, unmeasured: \(abSweep\.state\.unmeasuredNow \|\| \[\]\)\.length, logged \}\);/, 'the end of a tick no longer reaches quietLine');
  assert.match(src, /autobalanceSweep\.quietLine\(abQuietSaid, \{ nowMs: Date\.now\(\), \.\.\.opts \}\)/);
  /* autobalanceSweepOffWhy names a gate for each of autobalanceSweepRuns' tick gates. */
  const runs = src.match(/function autobalanceSweepRuns\([^]*?\n\}/)[0];
  const why = src.match(/function autobalanceSweepOffWhy\(\) \{[^]*?\n\}/)[0];
  assert.match(runs, /return !!autobalanceSweepRun && /, 'CONTROL: autobalanceSweepRuns no longer starts from the sweep existing');
  assert.match(why, /if \(!autobalanceSweepRun\) return /);
  for (const gate of ['liveExecution.liveExecutionAllowed()', 'usagePoll.liveAllowed()', 'usagePoll.enabled()', 'autobalanceSweep.sweepOn()']) {
    assert.ok(runs.includes(gate), 'CONTROL: autobalanceSweepRuns no longer has ' + gate);
    assert.ok(why.includes('!' + gate), 'autobalanceSweepOffWhy does not name ' + gate);
  }
  /* A dry run has the poll enabled but not live: asked in this order, it is never named "the usage poll is off". */
  assert.ok(why.indexOf('!usagePoll.enabled()') < why.indexOf('!usagePoll.liveAllowed()'), 'a dry run would be named as the poll being off');
  assert.match(why, /if \(!usagePoll\.liveAllowed\(\)\) return 'the usage poll is not reading live \(a dry run or a test\)';/);
});
