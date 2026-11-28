'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/* kosmos#9217 slice 2: engine/heavyturns.js keeps a line of turns in front of the heavy-job record. Every test uses its
   own temporary root and agent-only (no --pid) jobs or an injected startOf; nothing reaches the real data root. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const hj = require('./heavyjobs');
const ht = require('./heavyturns');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'heavyturns-9217-')); }
const T0 = 1_800_000_000_000;
const names = (list) => list.map((e) => e.agent);

test('a free computer: the first take is the turn, and records the heavy job as start does', () => {
  const r = root();
  const t = ht.take({ root: r, agent: 'renet', label: 'full suite', now: T0 });
  assert.equal(t.ok, true);
  assert.equal(t.turn, true);
  assert.deepEqual(hj.live({ root: r, now: T0 + 1 }), [{ agent: 'renet', label: 'full suite', pid: null, since: T0 }]);
  assert.deepEqual(ht.waiting({ root: r, now: T0 + 1 }), [], 'the holder holds no place in its own line');
});

test('a busy computer: a take waits, keeps its place on asking again, and says who holds the turn and who is ahead', () => {
  const r = root();
  ht.take({ root: r, agent: 'renet', label: 'suite', now: T0 });
  const a = ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 10 });
  const b = ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 20 });
  assert.deepEqual([a.turn, a.place, a.holder.agent, names(a.ahead)], [false, 1, 'renet', []]);
  assert.deepEqual([b.turn, b.place, names(b.ahead)], [false, 2, ['angel']]);
  const again = ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 30 });
  assert.equal(again.place, 1, 'asking again lost the place');
  assert.deepEqual(names(ht.waiting({ root: r, now: T0 + 31 })), ['angel', 'mona']);
});

test('the turn goes to the front of the line, not to whoever asks first once it is free', () => {
  const r = root();
  ht.take({ root: r, agent: 'renet', label: 'suite', now: T0 });
  ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 10 });
  ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 20 });
  assert.equal(ht.release({ root: r, agent: 'renet' }).ended, 1);
  const m = ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 30 });
  assert.deepEqual([m.turn, m.place, m.holder, names(m.ahead)], [false, 2, null, ['angel']], 'mona jumped the line');
  const a = ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 40 });
  assert.equal(a.turn, true);
  assert.deepEqual(names(hj.live({ root: r, now: T0 + 41 })), ['angel']);
  assert.deepEqual(names(ht.waiting({ root: r, now: T0 + 41 })), ['mona']);
});

test('a front place that leaves a free turn untaken past the grace goes to the back once, then out', () => {
  const r = root();
  ht.take({ root: r, agent: 'renet', label: 'suite', now: T0 });
  ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 10 });
  ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 20 });
  ht.release({ root: r, agent: 'renet' });
  // mona asks: the turn is free for angel from now; angel never comes.
  assert.equal(ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 100 }).place, 2);
  assert.equal(ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 100 + ht.GRACE_MS }).place, 2, 'inside the grace, angel keeps the front');
  const m = ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 101 + ht.GRACE_MS });
  assert.equal(m.turn, true, 'past the grace, the next place takes the turn');
  assert.deepEqual(names(ht.waiting({ root: r, now: T0 + 102 + ht.GRACE_MS })), ['angel'], 'a first miss goes to the back, not out');
  ht.release({ root: r, agent: 'mona' });
  ht.take({ root: r, agent: 'kitty', label: 'shots', now: T0 + 200 + ht.GRACE_MS });   // the turn is free for angel again
  const k = ht.take({ root: r, agent: 'kitty', label: 'shots', now: T0 + 201 + 2 * ht.GRACE_MS });
  assert.equal(k.turn, true);
  assert.deepEqual(ht.waiting({ root: r, now: T0 + 202 + 2 * ht.GRACE_MS }), [], 'a second miss is out');
});

test('a busy turn runs nobody\'s grace: a front place waiting behind a holder is never moved', () => {
  const r = root();
  ht.take({ root: r, agent: 'renet', label: 'suite', now: T0 });
  ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 10 });
  ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 20 });
  const m = ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 10 * ht.GRACE_MS });
  assert.deepEqual([m.turn, names(m.ahead)], [false, ['angel']]);
});

test('a place goes with its agent (no pid) or its process (--pid), as a heavy job does', () => {
  const r = root();
  ht.take({ root: r, agent: 'renet', label: 'suite', now: T0 });
  ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 10 });
  const procs = new Map([[4300, 'P']]);
  const startOf = (q) => (procs.has(q) ? procs.get(q) : null);
  assert.equal(ht.take({ root: r, agent: 'mona', label: 'cut', pid: 4300, now: T0 + 20, startOf }).place, 2);
  const alive = (name) => name !== 'angel';
  procs.delete(4300);
  const k = ht.take({ root: r, agent: 'kitty', label: 'shots', now: T0 + 30, startOf, agentAlive: alive });
  assert.deepEqual([k.place, names(k.ahead)], [1, []], 'a gone agent and a gone process kept their places');
});

test('the holder is any heavy job: one recorded with start blocks a take, and its holder asking take is told it holds it', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'by start', now: T0 });
  const a = ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 10 });
  assert.deepEqual([a.turn, a.holder.label], [false, 'by start']);
  const mine = ht.take({ root: r, agent: 'renet', label: 'by start', now: T0 + 20 });
  assert.equal(mine.turn, true);
  assert.deepEqual(names(ht.waiting({ root: r, now: T0 + 21 })), ['angel']);
});

test('release gives up a place without touching another agent\'s, and ending the turn is release too', () => {
  const r = root();
  ht.take({ root: r, agent: 'renet', label: 'suite', now: T0 });
  ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 + 10 });
  ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 20 });
  assert.deepEqual(ht.release({ root: r, agent: 'angel' }), { ok: true, left: 1, ended: 0, others: 0 });
  assert.deepEqual(names(ht.waiting({ root: r, now: T0 + 21 })), ['mona']);
  assert.deepEqual(ht.release({ root: r, agent: 'renet' }), { ok: true, left: 0, ended: 1, others: 0 });
  assert.equal(ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 30 }).turn, true);
});

test('a take is refused with the heavy-job rules (label, pid, a process that is not there) and writes nothing', () => {
  const r = root();
  for (const args of [{ label: '' }, { label: 'a\nb' }, { label: 'ok', pid: 'x' }, { label: 'ok', pid: 4400, startOf: () => null }]) {
    const t = ht.take({ root: r, agent: 'renet', now: T0, ...args });
    assert.equal(t.ok, false, JSON.stringify(args));
    assert.equal(t.refused, true);
  }
  assert.deepEqual(ht.readLine(r), []);
  assert.deepEqual(hj.readAll(r), []);
});

test('one agent holds at most MAX_PLACES_PER_AGENT places', () => {
  const r = root();
  ht.take({ root: r, agent: 'renet', label: 'suite', now: T0 });
  const startOf = () => 'S';
  for (let i = 0; i < ht.MAX_PLACES_PER_AGENT; i++) assert.equal(ht.take({ root: r, agent: 'angel', label: 'v' + i, pid: 4500 + i, now: T0 + i, startOf }).ok, true);
  const over = ht.take({ root: r, agent: 'angel', label: 'one more', pid: 4600, now: T0 + 99, startOf });
  assert.deepEqual([over.ok, over.refused], [false, true]);
  assert.equal(ht.readLine(r).length, ht.MAX_PLACES_PER_AGENT);
});

test('a front place\'s grace starts again each time the turn comes free: time spent behind a holder never counts', () => {
  const r = root();
  ht.take({ root: r, agent: 'angel', label: 'validation', now: T0 });   // the turn
  ht.take({ root: r, agent: 'mona', label: 'cut', now: T0 + 10 });
  ht.take({ root: r, agent: 'kitty', label: 'shots', now: T0 + 20 });
  ht.release({ root: r, agent: 'angel' });
  ht.take({ root: r, agent: 'kitty', label: 'shots', now: T0 + 30 });   // the turn is free for mona from here
  hj.start({ root: r, agent: 'renet', label: 'by start', now: T0 + 40 });   // and then held by someone else for an hour
  ht.take({ root: r, agent: 'kitty', label: 'shots', now: T0 + 50 });
  hj.end({ root: r, agent: 'renet' });
  const k = ht.take({ root: r, agent: 'kitty', label: 'shots', now: T0 + 60 * 60 * 1000 });
  assert.deepEqual([k.turn, names(k.ahead)], [false, ['mona']], 'mona lost the front for time the turn was not free');
});

function withProcesses(fn) {
  const rs = require('./restoresink');
  const was = { processStart: rs.processStart, pidAlive: rs.pidAlive };
  const seen = { ps: 0 };
  rs.pidAlive = () => true;
  rs.processStart = () => { seen.ps += 1; return 'A'; };
  try { return fn(seen); } finally { Object.assign(rs, was); }
}
// Twenty places past the 12 h ceiling, each tied to a process with a recorded start: every one needs a ps read to be shown.
function agedLine(r, now, base, n = 20) {
  const H = 60 * 60 * 1000;
  const line = Array.from({ length: n }, (_, i) => ({ agent: 'a' + i, label: 'job ' + i, pid: base + i, pidStart: 'A', since: now - 13 * H, at: now - 13 * H, front: null, missed: 0 }));
  fs.writeFileSync(path.join(r, ht.FILE), JSON.stringify(line));
}

test('round 1: listing the line shares heavyjobs\' ps budget, and shows only the places it could check (the rest stay in the file)', () => withProcesses((seen) => {
  const r = root();
  const now = Date.now();
  agedLine(r, now, 96100);
  const shownNow = ht.waiting({ root: r, now });
  assert.ok(seen.ps <= 8, 'ps ran ' + seen.ps + ' times for one listing');
  assert.ok(shownNow.length >= 1 && shownNow.length === seen.ps, 'shown ' + shownNow.length + ' places for ' + seen.ps + ' reads: an unread aged place was shown');
  assert.equal(ht.readLine(r).length, 20, 'a place the read could not check was dropped from the file');
}));

test('round 1: one take spends at most the same ps budget on the line and the jobs together', () => withProcesses((seen) => {
  const r = root();
  const now = Date.now();
  agedLine(r, now, 96200, 19);   // one under MAX_LINE, so the take may join
  const t = ht.take({ root: r, agent: 'renet', label: 'suite', now });
  assert.equal(t.ok, true);
  assert.ok(seen.ps <= 8, 'ps ran ' + seen.ps + ' times inside one take');
}));

test('round 1: the holder taking again with a new label re-announces it, as start does', () => {
  const r = root();
  ht.take({ root: r, agent: 'renet', label: 'first', now: T0 });
  const t = ht.take({ root: r, agent: 'renet', label: 'renamed', now: T0 + 5 });
  assert.deepEqual([t.turn, t.job.label], [true, 'renamed']);
  assert.deepEqual(hj.live({ root: r, now: T0 + 6 }).map((j) => [j.label, j.since]), [['renamed', T0]], 'the label did not change, or since moved');
});

test('round 1: release says how many of the agent\'s own jobs are left (tied to other processes)', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'tied', pid: 4700, now: T0, startOf: () => 'P' });
  assert.deepEqual(ht.release({ root: r, agent: 'renet' }), { ok: true, left: 0, ended: 0, others: 1 });
});
