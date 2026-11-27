'use strict';

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
  assert.deepEqual(hj.end({ root: r, agent: 'renet' }), { ok: true, ended: 1 });
  assert.deepEqual(hj.live({ root: r, now: T0 + 2000 }), []);
  assert.deepEqual(hj.end({ root: r, agent: 'renet' }), { ok: true, ended: 0 }, 'ending what is not there is not an error');
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
  hj.start({ root: r, agent: 'renet', label: 'second', now: T0 + 5 });
  const jobs = hj.live({ root: r, now: T0 + 10, startOf: alwaysStart('s') });
  assert.deepEqual(jobs.map((j) => [j.label, j.pid]).sort(), [['second', null], ['tied', 4242]]);
  assert.deepEqual(hj.end({ root: r, agent: 'renet', pid: 4242 }), { ok: true, ended: 1 }, 'end names one job by its process');
  assert.deepEqual(hj.live({ root: r, now: T0 + 11 }).map((j) => j.label), ['second']);
});

test('one agent cannot end another agent\'s job', () => {
  const r = root();
  hj.start({ root: r, agent: 'angel', label: 'y', now: T0 });
  assert.deepEqual(hj.end({ root: r, agent: 'renet' }), { ok: true, ended: 0 });
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
