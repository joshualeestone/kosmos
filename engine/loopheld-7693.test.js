'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const held = require('./loopheld');
const slowspawn = require('./slowspawn');

// A watcher on a clock and a blocked-time counter the test moves by hand.
function rig() {
  const lines = [];
  const state = { t: 1000000, blocked: 0 };
  const w = held.watch({ log: (l) => lines.push(l), now: () => state.t, blockedMs: () => state.blocked, setInterval: () => ({}) });
  const after = (ms) => { state.t += ms; w.tick(); };
  w.tick();
  return { lines, state, after };
}

test('a timer that fires late says how long, and how much of it was blocking commands', () => {
  const { lines, state, after } = rig();
  state.blocked = 1500;
  after(held.TICK_MS + 6000);
  assert.deepEqual(lines, ['[loop-held] 6000 ms, 1500 ms of it in blocking commands']);
});

test('the blocking time counts only this stall, not the ones before it', () => {
  const { lines, state, after } = rig();
  state.blocked = 4000;
  after(held.TICK_MS + 5000);
  state.blocked = 4000;
  after(held.TICK_MS + 3000);
  assert.equal(lines[1], '[loop-held] 3000 ms, 0 ms of it in blocking commands');
});

test('control: a timer on time, or late by less than the limit, logs nothing', () => {
  const { lines, after } = rig();
  after(held.TICK_MS);
  after(held.TICK_MS + held.HELD_MS - 1);
  assert.deepEqual(lines, []);
  after(held.TICK_MS + held.HELD_MS);
  assert.equal(lines.length, 1, 'exactly at the limit counts, so the control above can tell');
});

test('the first tick sets the clock: the board loading is not a stall', () => {
  const lines = [];
  let t = 1000000;
  const w = held.watch({ log: (l) => lines.push(l), now: () => t, setInterval: () => ({}) });
  t += 60000;
  w.tick();
  assert.deepEqual(lines, []);
  t += held.TICK_MS + held.HELD_MS;
  w.tick();
  assert.equal(lines.length, 1, 'control: the next late tick does log');
});

test('a gap as long as a sleeping computer is not a stall', () => {
  const { lines, after } = rig();
  after(held.TICK_MS + held.ASLEEP_MS);
  assert.deepEqual(lines, []);
  after(held.TICK_MS + held.ASLEEP_MS - 1);
  assert.equal(lines.length, 1, 'control: just short of it is logged');
});

test('lines are capped per minute, and the cap resets', () => {
  const { lines, after } = rig();
  for (let i = 0; i < held.MAX_PER_MINUTE + 5; i += 1) after(held.TICK_MS + held.HELD_MS);
  assert.equal(lines.length, held.MAX_PER_MINUTE);
  after(60000);
  assert.equal(lines.length, held.MAX_PER_MINUTE + 1);
});

test('the blocking time is capped at the stall (the window also holds the half second before it)', () => {
  const { lines, state, after } = rig();
  state.blocked = 2300;
  after(held.TICK_MS + 2000);
  assert.deepEqual(lines, ['[loop-held] 2000 ms, 2000 ms of it in blocking commands']);
});

test('perMinute writes up to its cap, then again a minute on', () => {
  const lines = [];
  let t = 0;
  const say = held.perMinute((l) => lines.push(l), 2, () => t);
  say('a'); say('b'); say('c');
  assert.deepEqual(lines, ['a', 'b']);
  t += 59999; say('d');
  assert.deepEqual(lines, ['a', 'b'], 'control: still inside the minute');
  t += 1; say('e');
  assert.deepEqual(lines, ['a', 'b', 'e']);
});

test('status.js writes its slow snapshot line through the cap', () => {
  const src = fs.readFileSync(path.join(__dirname, 'status.js'), 'utf8');
  assert.ok(src.includes("if (took >= 1000) slowSnapshotLine('[slow-snapshot] ' + took + ' ms');"));
  assert.ok(src.includes("const slowSnapshotLine = require('./loopheld').perMinute("));
});

test('a failing logger or counter does not reach the board', () => {
  let t = 0;
  const w = held.watch({ log: () => { throw new Error('log'); }, now: () => t, setInterval: () => ({}) });
  w.tick();
  t += 10000;
  assert.doesNotThrow(() => w.tick());
  const v = held.watch({ blockedMs: () => { throw new Error('count'); }, log() {}, now: () => t, setInterval: () => ({}) });
  assert.doesNotThrow(() => v.tick());
});

test('the timer does not keep a stopping board alive', () => {
  let unrefed = 0;
  held.watch({ setInterval: () => ({ unref() { unrefed += 1; } }) });
  assert.equal(unrefed, 1);
});

test('a real blocked thread is seen by the real timer, and slowspawn counts its command', async () => {
  const cp = { spawnSync };
  const lines = [];
  const base = slowspawn.blockedMs();
  slowspawn.install(cp, { log() {} });
  const w = held.watch({ log: (l) => lines.push(l), blockedMs: slowspawn.blockedMs });
  const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
  try {
    await pause(held.TICK_MS + 300);   // past the first tick, which only sets the clock
    assert.deepEqual(lines, [], 'control: a free thread logs nothing');
    cp.spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 3000)']);
    await pause(held.TICK_MS + 300);
  } finally { clearInterval(w.timer); }
  assert.equal(lines.length, 1, 'the real stall was not seen');
  const m = lines[0].match(/^\[loop-held\] (\d+) ms, (\d+) ms of it in blocking commands$/);
  assert.ok(m, lines[0]);
  assert.ok(Number(m[2]) >= 2000, 'the command was not counted: ' + lines[0]);
  assert.ok(slowspawn.blockedMs() - base >= 2000);
});

test('server.js starts it only when the file is the board, beside slowspawn', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.includes("if (require.main === module) require('./engine/loopheld').watch({ blockedMs: require('./engine/slowspawn').blockedMs });"));
});
