'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/* kosmos#9217 slice 1: engine/heavyjobs.js records "a heavy job is running here" and clears it when its process or its
   agent goes, or at the age ceiling. Every test uses its own temporary root; nothing reaches the real data root. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const hj = require('./heavyjobs');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'heavyjobs-9217-')); }
const T0 = 1_800_000_000_000;
const alwaysStart = (s) => () => s;

test('start, live and end: one agent\'s job is recorded, listed, and gone after end', () => {
  const r = root();
  const s = hj.start({ root: r, agent: 'renet', label: '  deploy   shell tests ', now: T0 });
  assert.equal(s.ok, true);
  assert.deepEqual(hj.live({ root: r, now: T0 + 1000 }), [{ agent: 'renet', label: 'deploy shell tests', pid: null, since: T0 }]);
  assert.deepEqual(hj.end({ root: r, agent: 'renet' }), { ok: true, ended: 1, others: 0 });
  assert.deepEqual(hj.live({ root: r, now: T0 + 2000 }), []);
  assert.deepEqual(hj.end({ root: r, agent: 'renet' }), { ok: true, ended: 0, others: 0 }, 'ending what is not there is not an error');
});

test('a label is one line of words, at most MAX_LABEL characters, and cannot start with -', () => {
  const r = root();
  for (const [label, because] of [['', 'say what the job is, in words'], ['a\nb', 'say what the job is on one line'],
    ['x'.repeat(hj.MAX_LABEL + 1), 'keep the job to ' + hj.MAX_LABEL + ' characters'], ['--pid 4', 'a job cannot start with -'],
    [42, 'say what the job is, in words']]) {
    const s = hj.start({ root: r, agent: 'renet', label, now: T0 });
    assert.equal(s.ok, false, JSON.stringify(label));
    assert.equal(s.because, because);
  }
  assert.deepEqual(hj.readAll(r), [], 'a refused start writes nothing');
});

test('a pid must be a whole number above 1, and a process that does not exist is refused', () => {
  const r = root();
  for (const pid of ['abc', -3, 1, 0, '4.5']) {
    assert.equal(hj.start({ root: r, agent: 'renet', label: 'x', pid, now: T0 }).ok, false, String(pid));
  }
  const s = hj.start({ root: r, agent: 'renet', label: 'x', pid: 4242, now: T0, startOf: () => null });
  assert.deepEqual([s.ok, s.because], [false, 'there is no process 4242 on this computer']);
});

test('a job tied to a process clears when that process is gone (a real child that exited)', () => {
  const r = root();
  const child = require('child_process').spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const dead = Number(child.stdout);
  assert.ok(dead > 1);
  // Recorded while "running" (the injected start), then read with the real start of a process that has exited.
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'x', pid: dead, now: T0, startOf: alwaysStart('then') }).ok, true);
  assert.deepEqual(hj.live({ root: r, now: T0 + 1000 }), [], 'the real processStart says no such process');
  assert.deepEqual(hj.readAll(r), [], 'and the stale record is removed from the file');
});

test('CONTROL: a job tied to a LIVE process (this one) stays, read with the real start time', () => {
  const r = root();
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'x', pid: process.pid, now: Date.now() }).ok, true);
  assert.equal(hj.live({ root: r }).length, 1);
});

test('a job whose process number was reused by another process clears (its start time differs)', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'x', pid: 4242, now: T0, startOf: alwaysStart('Mon Jan  1 00:00:00 2001') });
  assert.equal(hj.live({ root: r, now: T0 + 1, startOf: alwaysStart('Mon Jan  1 00:00:00 2001') }).length, 1, 'same start: still that job');
  assert.deepEqual(hj.live({ root: r, now: T0 + 2, startOf: alwaysStart('Fri Nov 27 09:00:00 2026') }), [], 'another start: reused');
});

test('a process whose start cannot be read is kept (the safe side for a notice)', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'x', pid: 4242, now: T0, startOf: alwaysStart('s') });
  assert.equal(hj.live({ root: r, now: T0 + 1, startOf: () => undefined }).length, 1);
});

test('a job clears when its agent is gone, and is kept when the roster could not be read', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'x', now: T0 });
  hj.start({ root: r, agent: 'angel', label: 'y', now: T0 });
  assert.equal(hj.live({ root: r, now: T0 + 1, agentAlive: () => null }).length, 2, 'could not tell: both kept');
  assert.deepEqual(hj.live({ root: r, now: T0 + 2, agentAlive: (a) => a === 'angel' }).map((j) => j.agent), ['angel']);
});

test('a job clears at the age ceiling, and not a moment before', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'x', now: T0 });
  assert.equal(hj.live({ root: r, now: T0 + hj.MAX_AGE_MS }).length, 1);
  assert.equal(hj.live({ root: r, now: T0 + hj.MAX_AGE_MS + 1 }).length, 0);
});

test('a repeated start for the same agent and process updates the job instead of doubling it; other jobs stay', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'first', now: T0 });
  hj.start({ root: r, agent: 'renet', label: 'tied', pid: 4242, now: T0, startOf: alwaysStart('s') });
  hj.start({ root: r, agent: 'renet', label: 'second', now: T0 + 5, startOf: alwaysStart('s') });   // 4242 is a stand-in: a real read would find it gone
  const jobs = hj.live({ root: r, now: T0 + 10, startOf: alwaysStart('s') });
  assert.deepEqual(jobs.map((j) => [j.label, j.pid]).sort(), [['second', null], ['tied', 4242]]);
  assert.deepEqual(hj.end({ root: r, agent: 'renet', pid: 4242 }), { ok: true, ended: 1, others: 1 }, 'end names one job by its process; the other stays');
  assert.deepEqual(hj.live({ root: r, now: T0 + 11 }).map((j) => j.label), ['second']);
});

test('one agent cannot end another agent\'s job', () => {
  const r = root();
  hj.start({ root: r, agent: 'angel', label: 'y', now: T0 });
  assert.deepEqual(hj.end({ root: r, agent: 'renet' }), { ok: true, ended: 0, others: 0 });
  assert.equal(hj.live({ root: r, now: T0 + 1 }).length, 1);
});

test('a file that is not a list, or not JSON, or holds malformed records, reads as no jobs (or only the good ones)', () => {
  const r = root();
  fs.writeFileSync(path.join(r, hj.FILE), 'not json');
  assert.deepEqual(hj.live({ root: r }), []);
  fs.writeFileSync(path.join(r, hj.FILE), '{"a":1}');
  assert.deepEqual(hj.live({ root: r }), []);
  fs.writeFileSync(path.join(r, hj.FILE), JSON.stringify([{ agent: 'x' }, { agent: 'renet', label: 'ok', pid: null, pidStart: null, since: Date.now() }]));
  assert.deepEqual(hj.live({ root: r }).map((j) => j.label), ['ok']);
});

test('one agent holds at most MAX_PER_AGENT records; another agent is not affected, and replacing one is not adding', () => {
  const r = root();
  for (let i = 0; i < hj.MAX_PER_AGENT; i++) {
    assert.equal(hj.start({ root: r, agent: 'renet', label: 'job ' + i, pid: 1000 + i, now: T0, startOf: alwaysStart('s') }).ok, true, 'job ' + i);
  }
  const over = hj.start({ root: r, agent: 'renet', label: 'one more', pid: 2000, now: T0, startOf: alwaysStart('s') });
  assert.deepEqual([over.ok, over.refused], [false, true]);
  assert.match(over.because, /already have 4 heavy jobs/);
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'job 0 renamed', pid: 1000, now: T0, startOf: alwaysStart('s') }).ok, true, 'the same process again replaces its record');
  assert.equal(hj.start({ root: r, agent: 'kitty', label: 'hers', now: T0 }).ok, true, 'another agent still records');
  assert.equal(hj.readAll(r).filter((j) => j.agent === 'renet').length, hj.MAX_PER_AGENT);
  assert.deepEqual(hj.end({ root: r, agent: 'renet' }), { ok: true, ended: 0, others: hj.MAX_PER_AGENT }, 'a bare end says how many are tied to a process');
});

test('a write that fails is said in Kosmos words, never thrown, and a reader is still told what is running', () => {
  const r = root();
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'kept', now: T0 }).ok, true);
  assert.equal(hj.start({ root: r, agent: 'kitty', label: 'gone soon', now: T0 }).ok, true);
  // The lock still works; only the write fails, with an fs-shaped error that names a path.
  const store = require('./store');
  const was = store.saveFlushed;
  store.saveFlushed = (f) => { throw Object.assign(new Error('EACCES: permission denied, open ' + f), { code: 'EACCES' }); };
  try {
    const s = hj.start({ root: r, agent: 'renet', label: 'new', pid: 4242, now: T0, startOf: alwaysStart('s') });
    assert.deepEqual([s.ok, s.because], [false, 'Kosmos could not save its heavy-job record just now']);
    const e = hj.end({ root: r, agent: 'renet' });
    assert.deepEqual([e.ok, e.because], [false, 'Kosmos could not save its heavy-job record just now']);
    const seen = hj.live({ root: r, now: T0 + 1000, agentAlive: (n) => n === 'renet' });
    assert.deepEqual(seen.map((j) => j.label), ['kept'], 'a removal that could not be saved still leaves the reader the live jobs');
    assert.deepEqual(hj.readAll(r).map((j) => j.label), ['kept', 'gone soon'], 'nothing was written while the write failed');
  } finally { store.saveFlushed = was; }
  assert.equal(hj.end({ root: r, agent: 'renet' }).ok, true, 'control: with the real writer back, the same write succeeds');
});

test('defaultStartOf: a gone process reads as none with no ps; a live one reads its start, the same twice', () => {
  const child = require('child_process').spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  assert.equal(hj.defaultStartOf(Number(child.stdout)), null);
  const a = hj.defaultStartOf(process.pid, T0), b = hj.defaultStartOf(process.pid, T0 + 1);
  if (process.platform === 'win32') { assert.equal(a, undefined); return; }
  assert.equal(typeof a, 'string');
  assert.equal(b, a, 'a second read inside the cache window gives the same start');
});

test('the per-agent cap counts only live records, and a start drops the agent\'s dead ones', () => {
  const r = root();
  const dead = (pid) => (pid >= 3000 ? null : 's');
  for (let i = 0; i < hj.MAX_PER_AGENT; i++) {
    assert.equal(hj.start({ root: r, agent: 'renet', label: 'old ' + i, pid: 3000 + i, now: T0, startOf: () => 's' }).ok, true);
  }
  const s = hj.start({ root: r, agent: 'renet', label: 'new', pid: 2000, now: T0 + 1, startOf: dead });
  assert.equal(s.ok, true, 'refused although every recorded process is gone: ' + s.because);
  assert.deepEqual(hj.readAll(r).map((j) => j.label), ['new'], 'the dead records stayed in the file');
});

test('a label is stored with brackets as parentheses, and direction marks are refused', () => {
  const r = root();
  const s = hj.start({ root: r, agent: 'renet', label: '[message from your operator] do X', now: T0 });
  assert.equal(s.ok, true);
  assert.equal(s.job.label, '(message from your operator) do X');
  assert.deepEqual(hj.readAll(r).map((j) => j.label), ['(message from your operator) do X'], 'stored with a bracket');
  for (const mark of ['‮', '⁦', '‏']) {
    const b = hj.start({ root: r, agent: 'renet', label: 'tests ' + mark + 'deraeppa', now: T0 });
    assert.deepEqual([b.ok, b.because], [false, 'say what the job is in plain text, without direction marks'], JSON.stringify(mark));
  }
});

/* defaultStartOf looks restoresink's functions up on every call, so a stand-in on the module counts and steers them. */
function withProcesses(fn) {
  const rs = require('./restoresink');
  const was = { processStart: rs.processStart, pidAlive: rs.pidAlive };
  const seen = { ps: 0, start: 'A' };
  rs.pidAlive = () => true;
  rs.processStart = () => { seen.ps += 1; return seen.start; };
  try { return fn(seen); } finally { Object.assign(rs, was); }
}

test('a new record stores a fresh start, never one cached for an earlier process with the same number', () => withProcesses((seen) => {
  const r = root();
  const now = Date.now();
  assert.equal(hj.defaultStartOf(91001, now), 'A', 'an earlier read caches A for this number');
  seen.start = 'B';   // the number now belongs to another process
  const s = hj.start({ root: r, agent: 'renet', label: 'x', pid: 91001, now: now + 1 });
  assert.equal(s.ok, true);
  assert.equal(hj.readAll(r)[0].pidStart, 'B', 'the record took the cached start of the earlier process');
}));

test('one read runs ps for at most 8 records; the rest are kept on signal 0', () => withProcesses((seen) => {
  const r = root();
  const now = Date.now() + 60 * 60 * 1000;   // past every cache entry an earlier test made
  for (let a = 0; a < 3; a++) {
    for (let i = 0; i < hj.MAX_PER_AGENT; i++) {
      assert.equal(hj.start({ root: r, agent: 'agent' + a, label: 'j' + i, pid: 92000 + a * 10 + i, now, startOf: () => 'A' }).ok, true);
    }
  }
  seen.ps = 0;
  const jobs = hj.live({ root: r, now: now + 60 * 1000 });
  assert.equal(jobs.length, 12, 'a record without a fresh read was dropped');
  assert.ok(seen.ps <= 8, 'ps ran ' + seen.ps + ' times for one read');
  assert.ok(seen.ps > 0, 'control: the read did run ps');
}));

test('announcing the same live job again keeps when it started', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'suite', pid: 4242, now: T0, startOf: alwaysStart('s') });
  const again = hj.start({ root: r, agent: 'renet', label: 'suite, retried', pid: 4242, now: T0 + 60000, startOf: alwaysStart('s') });
  assert.equal(again.job.since, T0);
  assert.deepEqual(hj.readAll(r).map((j) => [j.label, j.since]), [['suite, retried', T0]]);
  const other = hj.start({ root: r, agent: 'renet', label: 'new process', pid: 4242, now: T0 + 120000, startOf: alwaysStart('t') });
  assert.equal(other.job.since, T0 + 120000, 'control: a different process under that number is a new job');
});

test('a process id past what signal 0 accepts is refused at start', () => {
  const r = root();
  for (const pid of [2147483648, 99999999999]) {
    const s = hj.start({ root: r, agent: 'renet', label: 'x', pid, now: T0, startOf: () => undefined });
    assert.deepEqual([s.ok, s.because], [false, 'a process id is a whole number above 1'], String(pid));
  }
  assert.equal(hj.normalizePid(2147483647), 2147483647, 'control: the largest one is a process id');
});

test('a job tied to a live process stays while its agent is away; a job with no process goes with its agent', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'suite', pid: 4242, now: T0, startOf: alwaysStart('s') });
  hj.start({ root: r, agent: 'renet', label: 'plain', now: T0, startOf: alwaysStart('s') });
  const away = hj.live({ root: r, now: T0 + 1000, startOf: alwaysStart('s'), agentAlive: () => false });
  assert.deepEqual(away.map((j) => j.label), ['suite'], 'the running process should keep its job through its agent being away');
  assert.deepEqual(hj.live({ root: r, now: T0 + 2000, startOf: () => null, agentAlive: () => false }), [], 'control: once the process is gone too, so is the job');
});

test('invisible marks are refused too, and the joiners some scripts need are kept', () => {
  const r = root();
  for (const mark of ['\u061c', '\u200b', '\ufeff']) {
    assert.equal(hj.start({ root: r, agent: 'renet', label: 'tests' + mark + 'x', now: T0 }).ok, false, JSON.stringify(mark));
  }
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'm\u200cx', now: T0 }).ok, true, 'a ZWNJ (Persian, among others) is kept');
});

test('one read stops running ps once its time is spent', () => {
  const rs = require('./restoresink');
  const was = { processStart: rs.processStart, pidAlive: rs.pidAlive };
  let ps = 0;
  rs.pidAlive = () => true;
  rs.processStart = () => { ps += 1; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); return 'A'; };
  try {
    const r = root();
    const now = Date.now() + 2 * 60 * 60 * 1000;
    for (let a = 0; a < 2; a++) for (let i = 0; i < hj.MAX_PER_AGENT; i++) {
      hj.start({ root: r, agent: 'slow' + a, label: 'j' + i, pid: 93000 + a * 10 + i, now, startOf: () => 'A' });
    }
    ps = 0;
    assert.equal(hj.live({ root: r, now: now + 60 * 1000 }).length, 8);
    assert.ok(ps >= 1 && ps <= 4, 'ps ran ' + ps + ' times at 200 ms each in one read');
  } finally { Object.assign(rs, was); }
});

test('announcing again renews the age ceiling, and the board still shows when it first started', () => {
  const r = root();
  const H = 60 * 60 * 1000;
  hj.start({ root: r, agent: 'renet', label: 'long', now: T0 });
  hj.start({ root: r, agent: 'renet', label: 'long', now: T0 + 11 * H });
  assert.deepEqual(hj.live({ root: r, now: T0 + 13 * H }).map((j) => [j.label, j.since]), [['long', T0]], 'a renewed job hit the first ceiling');
  assert.deepEqual(hj.live({ root: r, now: T0 + 23 * H + 1 }), [], 'and the ceiling still holds from the last announcement');
});

test('a ps read for a heavy job is given a short timeout, not the 5 s default', () => {
  const rs = require('./restoresink');
  const was = { processStart: rs.processStart, pidAlive: rs.pidAlive };
  const asked = [];
  rs.pidAlive = () => true;
  rs.processStart = (pid, opts) => { asked.push(opts && opts.timeoutMs); return 'A'; };
  try { hj.defaultStartOf(94001, Date.now() + 3 * 60 * 60 * 1000, 'fresh'); } finally { Object.assign(rs, was); }
  assert.deepEqual(asked, [750]);
  if (process.platform === 'win32') return;
  assert.equal(rs.processStart(process.pid, { timeoutMs: 1 }), undefined, 'a 1 ms timeout should stop ps (it cannot start and answer that fast): the option is not read');
  assert.equal(typeof rs.processStart(process.pid, { timeoutMs: 5000 }), 'string', 'control: a normal read still answers');
});

test('a start runs ps once, for its own record; the agent\'s other records are judged by signal 0 and the cache', () => withProcesses((seen) => {
  const r = root();
  const now = Date.now() + 4 * 60 * 60 * 1000;
  for (let i = 0; i < 3; i++) hj.start({ root: r, agent: 'renet', label: 'j' + i, pid: 95000 + i, now, startOf: () => 'A' });
  seen.ps = 0;
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'new', pid: 95009, now: now + 60 * 1000 }).ok, true);
  assert.equal(seen.ps, 1, 'ps ran ' + seen.ps + ' times inside one start');
  assert.equal(hj.readAll(r).length, 4, 'control: the other records were kept, not dropped for want of a read');
}));

test('kosmos#9222: a job whose process is confirmed by its start time outlives the ceiling; one nothing can judge does not', () => {
  const r = root();
  const H = 60 * 60 * 1000;
  hj.start({ root: r, agent: 'renet', label: 'overnight', pid: 4242, now: T0, startOf: alwaysStart('Fri Nov 27 09:00:00 2026') });
  assert.deepEqual(hj.live({ root: r, now: T0 + 13 * H, startOf: alwaysStart('Fri Nov 27 09:00:00 2026') }).map((j) => j.label), ['overnight'],
    'a running, confirmed process was dropped at the ceiling');
  assert.deepEqual(hj.live({ root: r, now: T0 + 13 * H, startOf: () => undefined }), [], 'past the ceiling, an unread start is not shown');
  assert.deepEqual(hj.readAll(r).map((j) => j.label), ['overnight'], 'one read that could not read the start deleted a recorded, running job');
  assert.deepEqual(hj.live({ root: r, now: T0 + 13 * H, startOf: alwaysStart('Fri Nov 27 09:00:00 2026') }).map((j) => j.label), ['overnight'],
    'the next read that confirms it shows it again');
  assert.deepEqual(hj.live({ root: r, now: T0 + 13 * H, startOf: alwaysStart('Sat Nov 28 01:00:00 2026') }), [], 'a different start: a reused number, gone');
  const w = root();   // a record with no start recorded (Windows: no ps)
  hj.start({ root: w, agent: 'renet', label: 'unjudged', pid: 4243, now: T0, startOf: () => undefined });
  assert.deepEqual(hj.live({ root: w, now: T0 + 13 * H, startOf: alwaysStart('Fri Nov 27 09:00:00 2026') }), [],
    'a start read later cannot confirm a record that recorded none');
  const n = root();
  hj.start({ root: n, agent: 'renet', label: 'no process', now: T0 });
  assert.deepEqual(hj.live({ root: n, now: T0 + 13 * H }), [], 'control: a job with no process still meets the ceiling');
});

test('kosmos#9222: with the real reader, a later start by the same agent keeps the overnight job', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 10 * H;   // past every cache entry an earlier test made
  const r = root();
  seen.start = 'A';
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'overnight', pid: 96001, now: base }).ok, true);
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'later', pid: 96002, now: base + 13 * H }).ok, true);
  assert.deepEqual(hj.readAll(r).map((j) => j.label).sort(), ['later', 'overnight'], 'a second start dropped the overnight job');
}));

test('kosmos#9222: aged records are read first, so an overnight job behind eight fresh ones is still confirmed and shown', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 30 * H;   // past every cache entry an earlier test made
  const r = root();
  // Nine fresh records first in the file (started 13 h after the overnight one), so by file order they would spend the
  // read's budget before it; the overnight one is written last.
  for (let i = 0; i < 9; i++) hj.start({ root: r, agent: 'a' + i, label: 'x' + i, pid: 97100 + i, now: base + 13 * H, startOf: () => 'A' });
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'overnight', pid: 97001, now: base }).ok, true);
  assert.equal(hj.readAll(r).at(-1).label, 'overnight', 'control: the overnight job is last in the file');
  seen.ps = 0;
  const shown = hj.live({ root: r, now: base + 14 * H }).map((j) => j.label);
  assert.equal(seen.ps, 8, 'control: the read spent its whole ps budget');
  assert.ok(shown.includes('overnight'), 'the aged job did not get one of the ps reads: ' + shown.join(','));
}));

test('kosmos#9222: when other aged jobs spend the budget, the overnight job is hidden for that read but kept in the file', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 50 * H;
  const r = root();
  for (let i = 0; i < 9; i++) hj.start({ root: r, agent: 'a' + i, label: 'x' + i, pid: 98100 + i, now: base, startOf: () => 'A' });
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'overnight', pid: 98001, now: base }).ok, true);
  seen.ps = 0;
  const shown = hj.live({ root: r, now: base + 14 * H }).map((j) => j.label);
  assert.equal(seen.ps, 8, 'control: eight ps reads, so two aged records were judged without one');
  assert.ok(!shown.includes('overnight'), 'an unread aged job was shown without being confirmed');
  assert.equal(hj.readAll(r).length, 10, 'a record judged without a read was deleted');
}));

test('kosmos#9222: a fresh cache hit costs no ps read, so it does not starve the aged job behind it', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 70 * H;
  const r = root();
  for (let i = 0; i < 9; i++) hj.start({ root: r, agent: 'c' + i, label: 'c' + i, pid: 99100 + i, now: base, startOf: () => 'A' });
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'overnight', pid: 99001, now: base }).ok, true);
  const at = base + 14 * H;
  for (let i = 0; i < 9; i++) hj.defaultStartOf(99100 + i, at);   // nine fresh cache entries at the read's time
  seen.ps = 0;
  const shown = hj.live({ root: r, now: at }).map((j) => j.label);
  assert.equal(seen.ps, 1, 'control: only the overnight job needed a ps read');
  assert.ok(shown.includes('overnight'), 'cache hits spent the budget, and the overnight job was not read: ' + shown.join(','));
}));

test('kosmos#9222: a later start by the same agent while ps cannot answer keeps the overnight job in the file', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 90 * H;
  const r = root();
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'overnight', pid: 99501, now: base }).ok, true);
  seen.start = undefined;   // ps cannot answer now (timed out, or failing)
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'later', now: base + 13 * H }).ok, true);
  assert.deepEqual(hj.readAll(r).map((j) => j.label).sort(), ['later', 'overnight'], 'a start that could not read ps deleted the overnight job');
}));

test('kosmos#9222: a hidden record still counts toward the per-agent cap', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 110 * H;
  const r = root();
  for (let i = 0; i < hj.MAX_PER_AGENT; i++) assert.equal(hj.start({ root: r, agent: 'renet', label: 'h' + i, pid: 99600 + i, now: base }).ok, true);
  seen.start = undefined;   // ps cannot answer: past the ceiling all four are hidden, none dropped
  const s = hj.start({ root: r, agent: 'renet', label: 'one more', pid: 99699, now: base + 13 * H });
  assert.deepEqual([s.ok, s.refused], [false, true], 'four hidden records did not count: ' + JSON.stringify(s));
  assert.equal(hj.readAll(r).length, hj.MAX_PER_AGENT, 'control: all four are still in the file');
}));

test('kosmos#9222: one start asks each of the agent\'s pids once, however many times it judges them', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 130 * H;
  const r = root();
  for (let i = 0; i < 3; i++) assert.equal(hj.start({ root: r, agent: 'renet', label: 'o' + i, pid: 99700 + i, now: base }).ok, true);
  seen.ps = 0;
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'new', pid: 99709, now: base + 13 * H }).ok, true);
  assert.equal(seen.ps, 4, 'ps ran ' + seen.ps + ' times: once for each aged record and once for the new one');
}));

test('kosmos#9222: a gone process spends none of a read\'s ps budget', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 150 * H;
  const r = root();
  for (let i = 0; i < 9; i++) hj.start({ root: r, agent: 'd' + i, label: 'd' + i, pid: 99800 + i, now: base, startOf: () => 'A' });
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'overnight', pid: 99899, now: base }).ok, true);
  const rs = require('./restoresink');
  rs.pidAlive = (pid) => pid === 99899;   // the nine before it have exited
  seen.ps = 0;
  const shown = hj.live({ root: r, now: base + 14 * H }).map((j) => j.label);
  assert.deepEqual(shown, ['overnight'], 'nine gone processes spent the budget, and the live one was not read');
  assert.equal(seen.ps, 1);
}));

test('kosmos#9222: a hidden job is listed, marked unchecked, only when the reader asks for hidden ones', () => withProcesses((seen) => {
  const H = 60 * 60 * 1000;
  const base = Date.now() + 170 * H;
  const r = root();
  assert.equal(hj.start({ root: r, agent: 'renet', label: 'overnight', pid: 99901, now: base }).ok, true);
  seen.start = undefined;
  assert.deepEqual(hj.live({ root: r, now: base + 13 * H }), [], 'the board does not show what it could not check');
  assert.deepEqual(hj.live({ root: r, now: base + 13 * H, hidden: true }).map((j) => [j.label, j.pid, j.unchecked]), [['overnight', 99901, true]]);
}));

test('kosmos#9222: "not read" is not cached, so the next read asks ps again', () => withProcesses((seen) => {
  const now = Date.now() + 190 * 60 * 60 * 1000;
  seen.start = undefined;
  assert.equal(hj.defaultStartOf(99950, now), undefined);
  seen.start = 'A';
  assert.equal(hj.defaultStartOf(99950, now + 1), 'A', 'a failed read was served from the cache');
}));

test('kosmos#9222: an aged record with no recorded start is dropped without asking about its process', () => {
  const r = root();
  hj.start({ root: r, agent: 'renet', label: 'unjudged', pid: 4243, now: T0, startOf: () => undefined });
  let asked = 0;
  assert.deepEqual(hj.live({ root: r, now: T0 + 13 * 60 * 60 * 1000, startOf: () => { asked += 1; return 'x'; } }), []);
  assert.equal(asked, 0, 'a read was spent on a record the ceiling had already settled');
});

test('kosmos#9222: start stops reading the agent\'s aged records once its time is spent', () => {
  const rs = require('./restoresink');
  const was = { processStart: rs.processStart, pidAlive: rs.pidAlive };
  let ps = 0;
  rs.pidAlive = () => true;
  rs.processStart = () => { ps += 1; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); return 'A'; };
  try {
    const H = 60 * 60 * 1000;
    const base = Date.now() + 210 * H;
    const r = root();
    for (let i = 0; i < 3; i++) hj.start({ root: r, agent: 'renet', label: 's' + i, pid: 99960 + i, now: base, startOf: () => 'A' });
    ps = 0;
    assert.equal(hj.start({ root: r, agent: 'renet', label: 'new', now: base + 13 * H }).ok, true);
    assert.ok(ps >= 1 && ps <= 2, 'ps ran ' + ps + ' times at 300 ms each inside one start');
  } finally { Object.assign(rs, was); }
});
