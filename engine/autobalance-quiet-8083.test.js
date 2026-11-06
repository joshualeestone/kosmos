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

const { quietLine, tickLines, QUIET_SAY_MS } = require('./autobalance-sweep');

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

test('kosmos#8083: a shut gate says why at once on a change, NOT hourly (a default install has the poll off); opening it again says so at once', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'nothing' }), 'autobalance-sweep: running, nothing new to record');
  assert.equal(quietLine(said, { nowMs: T0 + MIN, offWhy: 'the usage poll is off' }), 'autobalance-sweep: not running: the usage poll is off', 'a change of state waited for the hour');
  assert.equal(quietLine(said, { nowMs: T0 + 30 * MIN, offWhy: 'the usage poll is off' }), null);
  for (const h of [1, 5, 48]) assert.equal(quietLine(said, { nowMs: T0 + h * 60 * MIN + MIN, offWhy: 'the usage poll is off' }), null, 'a setting-off state was repeated after ' + h + ' h');
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

test('kosmos#8083: an unreadable decision the board logged once is said again hourly while it lasts, with its latest reason', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'unreadable', because: 'agents walk failed', logged: true }), null);
  assert.equal(quietLine(said, { nowMs: T0 + 10 * MIN, did: 'unreadable', because: 'agents walk failed' }), null);
  assert.equal(quietLine(said, { nowMs: T0 + 60 * MIN, did: 'unreadable', because: 'agents walk failed' }),
    'autobalance-sweep: running, but it could not work out the decision (agents walk failed)', 'a lasting unreadable went silent');
  /* Keyed by kind: a new reason waits for the hour (the board's own line says a new reason at once), so an error whose
     words change every tick is not said every tick. */
  for (let m = 61; m < 120; m += 10) assert.equal(quietLine(said, { nowMs: T0 + m * MIN, did: 'unreadable', because: 'pid ' + m }), null, 'a changing error text was said at ' + m + ' min');
  assert.equal(quietLine(said, { nowMs: T0 + 121 * MIN, did: 'unreadable', because: 'list threw' }),
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

test('kosmos#8083: switched off in Settings is not repeated hourly either', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'off' }), 'autobalance-sweep: not running: auto-balance is switched off in Settings');
  assert.equal(quietLine(said, { nowMs: T0 + 3 * 60 * MIN, did: 'off' }), null);
});

test('kosmos#8083: a clock that went backwards does not silence a running state for longer than the jump', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'nothing' }) !== null, true);
  assert.equal(quietLine(said, { nowMs: T0 - 5 * 60 * MIN, did: 'nothing' }), 'autobalance-sweep: running, nothing new to record', 'a backwards clock kept a running state silent');
});

test('kosmos#8083: the start line counts as said: server.js seeds quietLine with the shut gate it printed', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /if \(offNow \|\| settingOff\) autobalanceSweep\.quietLine\(abTickMem\.quiet, \{ nowMs: Date\.now\(\), offWhy: offNow, did: settingOff \? 'off' : null, because: settingUnread \? 'setting-unreadable' : null, logged: true \}\);/);
  assert.match(src, /try \{ setting = autobalanceSetting\.read\(\); \} catch \{ setting = \{ on: false, ok: false \}; \}/, 'the start line no longer asks the Settings switch, or falls back unlike the tick');
  assert.match(src, /settingUnreadable: \(\) => \{ try \{ return autobalanceSetting\.read\(\)\.ok === false; \} catch \{ return true; \} \},/, 'the tick cannot tell an unreadable switch from an off one');
  const s2 = { at: 0, key: null };
  assert.equal(quietLine(s2, { nowMs: T0, did: 'off', logged: true }), null);
  assert.equal(quietLine(s2, { nowMs: T0 + 10 * MIN, did: 'off' }), null, 'the first tick repeated a Settings-off start line');
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, offWhy: 'the usage poll is off', logged: true }), null);
  assert.equal(quietLine(said, { nowMs: T0 + 10 * MIN, offWhy: 'the usage poll is off' }), null, 'the first tick repeated the start line');
});

test('kosmos#8083: a Settings switch that could not be read is said as such, not as switched off', () => {
  const said = { at: 0, key: null };
  assert.equal(quietLine(said, { nowMs: T0, did: 'off', because: 'setting-unreadable' }), 'autobalance-sweep: not running: its Settings switch could not be read');
  assert.equal(quietLine(said, { nowMs: T0 + MIN, did: 'off' }), 'autobalance-sweep: not running: auto-balance is switched off in Settings', 'the two off states are one state');
});

/* tickLines: what one finished tick prints, in order, from the board's own memory. These run the real function the
   board calls (server.js prints exactly what it returns), so the "logged" accounting is behaviour, not source text. */
const MEM = () => ({ unreadableSaid: null, writeSaid: false, quiet: { at: 0, key: null } });
test('kosmos#8083 tickLines: a recorded and a cleared decision each print one line, and the quiet line is not added beside them', () => {
  const mem = MEM();
  assert.deepEqual(tickLines(mem, { did: 'recorded' }, { nowMs: T0 }), ['autobalance-sweep: recorded a changed decision']);
  assert.deepEqual(tickLines(mem, { did: 'nothing' }, { nowMs: T0 + 10 * MIN }), [], 'a quiet tick right after a recorded one printed');
  assert.deepEqual(tickLines(mem, { did: 'cleared' }, { nowMs: T0 + 20 * MIN }), ['autobalance-sweep: recorded a changed decision (a risk ended)']);
  assert.deepEqual(tickLines(mem, { did: 'nothing' }, { nowMs: T0 + 81 * MIN }), ['autobalance-sweep: running, nothing new to record'], 'silent an hour after');
});

test('kosmos#8083 tickLines: an unreadable reason prints once, then hourly in quietLine words; a new reason prints at once', () => {
  const mem = MEM();
  assert.deepEqual(tickLines(mem, { did: 'unreadable', because: 'walk failed' }, { nowMs: T0 }), ['autobalance-sweep: could not record the decision (unreadable: walk failed)']);
  assert.deepEqual(tickLines(mem, { did: 'unreadable', because: 'walk failed' }, { nowMs: T0 + 10 * MIN }), []);
  assert.deepEqual(tickLines(mem, { did: 'unreadable', because: 'walk failed' }, { nowMs: T0 + 60 * MIN }), ['autobalance-sweep: running, but it could not work out the decision (walk failed)']);
  assert.deepEqual(tickLines(mem, { did: 'unreadable', because: 'list threw' }, { nowMs: T0 + 61 * MIN }), ['autobalance-sweep: could not record the decision (unreadable: list threw)']);
});

test('kosmos#8083 tickLines: a write failure prints once per run of failures, then hourly; its end is said', () => {
  const mem = MEM();
  const f = { did: 'nothing', because: 'write-failed' };
  assert.deepEqual(tickLines(mem, f, { nowMs: T0 }), ['autobalance-sweep: its record could not be written; Settings says it is not recording']);
  assert.deepEqual(tickLines(mem, f, { nowMs: T0 + 10 * MIN }), []);
  assert.deepEqual(tickLines(mem, f, { nowMs: T0 + 60 * MIN }), ['autobalance-sweep: running, but its record could not be written']);
  assert.deepEqual(tickLines(mem, { did: 'nothing' }, { nowMs: T0 + 70 * MIN }), ['autobalance-sweep: running, nothing new to record']);
  assert.deepEqual(tickLines(mem, f, { nowMs: T0 + 80 * MIN }), ['autobalance-sweep: its record could not be written; Settings says it is not recording'], 'a new run of failures was not said');
});

test('kosmos#8083 tickLines: a result that is not an object is never said as a healthy quiet tick', () => {
  for (const r of [undefined, null, 'x', 3]) {
    assert.deepEqual(tickLines(MEM(), r, { nowMs: T0 }), ['autobalance-sweep: running, but it could not work out the decision (the sweep gave no answer)'], String(r));
  }
  assert.deepEqual(tickLines(null, { did: 'recorded' }, { nowMs: T0 }), [], 'no memory threw or printed');
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
  assert.match(src, /autobalance-sweep: timer set, every \$\{Math\.round\(abSweepMs \/ 60000\)\} min, \$\{startState\}; the mover is \$\{automoveRun \? 'on' : 'off'\}/);
  assert.match(src, /settingOff \? 'not running now: ' \+ \(settingUnread \? 'its Settings switch could not be read' : 'auto-balance is switched off in Settings'\) : 'running';/);
  assert.match(src, /\.catch\(\(err\) => \{ abSayQuiet\(\{ did: 'unreadable', because: 'the tick failed: ' \+ /, 'a tick that throws leaves no trace');
  assert.match(src, /if \(!abSweep \|\| !autobalanceSweepRuns\(\{ forTick: true \}\)\) \{ abSayQuiet\(\{ offWhy: autobalanceSweepOffWhy\(\) \|\| 'unknown' \}\); return; \}/,
    'the early return no longer says why the sweep is not running');
  assert.match(src, /try \{ unmeasured = \(abSweep\.state\.unmeasuredNow \|\| \[\]\)\.length; \} catch \{[^}]*\}\n\s+for \(const line of autobalanceSweep\.tickLines\(abTickMem, r, \{ nowMs: Date\.now\(\), unmeasured \}\)\) process\.stdout\.write\(line \+ '\\n'\);/, 'the end of a tick no longer prints tickLines, or reads the count unguarded');
  assert.match(src, /autobalanceSweep\.quietLine\(abTickMem\.quiet, \{ nowMs: Date\.now\(\), \.\.\.opts \}\)/);
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
  assert.ok(why.indexOf('!usagePoll.enabled()') < why.indexOf('!usagePoll.liveAllowed()'), 'a poll that is off would be named as a dry run');
  assert.match(why, /if \(!usagePoll\.liveAllowed\(\)\) return 'the usage poll is not reading live \(a dry run or a test\)';/);
});
