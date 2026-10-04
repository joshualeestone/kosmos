'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5153 slice 4: undo a closed task's file changes from copies Kosmos kept just before each edit.
 *   node --test engine/undo-5153.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ud5153-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, '.claude');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
for (const d of ['data', 'workers', '.claude/projects']) fs.mkdirSync(path.join(SB, d), { recursive: true });

const undo = require('./undo');
const taskchat = require('./taskchat');

const T = (hhmm) => `2026-10-01T${hhmm}:00.000Z`;
const ms = (hhmm) => Date.parse(T(hhmm));
let pn = 0;
function activity(project, number, rows) {
  const file = taskchat.taskChatFile(project, number);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify({ ...r, at: T(r.at) })).join('\n') + '\n');
}
function worker(name) { const d = path.join(SB, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
/* An "edit" at a time: keep() as the hook would call it, then the change. */
function edit(file, content, at, cwd) {
  const r = undo.keep(file, { cwd, session: 's', now: ms(at) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const t = new Date(ms(at) + 1000); fs.utimesSync(file, t, t);
  return r;
}
const task = (closedAt = T('11:00')) => ({ number: 1, closedAt });

test('the switch is OFF until it is turned on: nothing is kept, and an undo does nothing', () => {
  assert.deepEqual(undo.read(), { on: false, ok: true });
  const f = path.join(worker('off'), 'a.md');
  fs.writeFileSync(f, 'x');
  assert.deepEqual(undo.keep(f, { cwd: path.dirname(f) }), { kept: false, because: 'off' });
  assert.equal(undo.apply('px', task(), [f]).because, 'off');
  assert.equal(fs.existsSync(path.join(SB, 'data', 'undo', 'copies')), false, 'a copy was kept with the switch off');
});

test('undo puts an edited file back to the copy before the FIRST edit in the task, saving its current version first', () => {
  undo.setOn(true);
  const project = 'p' + (++pn);
  const ann = worker('ann');
  const f = path.join(ann, 'notes.md');
  fs.writeFileSync(f, 'ORIGINAL');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'ann' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'FIRST EDIT', '10:10', ann);
  edit(f, 'SECOND EDIT', '10:20', ann);
  const plan = undo.plan(project, task());
  assert.deepEqual(plan.files.map((x) => [path.basename(x.path), x.action, x.ok]), [['notes.md', 'restore', true]]);
  const r = undo.apply(project, task(), [f], { now: ms('12:00') });
  assert.deepEqual(r.done, [f]);
  assert.equal(fs.readFileSync(f, 'utf8'), 'ORIGINAL', 'back to before the task, not before the last edit');
  const saved = fs.readdirSync(r.savedIn).filter((n) => n.endsWith('-notes.md'));
  assert.equal(saved.length, 1);
  assert.equal(fs.readFileSync(path.join(r.savedIn, saved[0]), 'utf8'), 'SECOND EDIT', 'the current version was saved first');
  assert.ok(taskchat.read(project, 1).some((e) => e.kind === 'undone' && e.files === 1), 'the task\'s activity says so');
});

test('a file the agent created is moved aside, never deleted', () => {
  const project = 'p' + (++pn);
  const bo = worker('bo');
  const f = path.join(bo, 'new.md');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'bo' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'MADE BY THE AGENT', '10:10', bo);
  assert.equal(undo.plan(project, task()).files[0].action, 'move-aside');
  const r = undo.apply(project, task(), [f], { now: ms('12:00') });
  assert.equal(fs.existsSync(f), false);
  const moved = fs.readdirSync(r.savedIn).filter((n) => n.endsWith('-new.md'));
  assert.equal(moved.length, 1);
  assert.equal(fs.readFileSync(path.join(r.savedIn, moved[0]), 'utf8'), 'MADE BY THE AGENT', 'kept, in Kosmos\'s own folder');
});

test('a file changed after the task closed is listed and never overwritten', () => {
  const project = 'p' + (++pn);
  const cy = worker('cy');
  const f = path.join(cy, 'a.md');
  fs.writeFileSync(f, 'ORIGINAL');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'cy' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'AGENT', '10:10', cy);
  fs.writeFileSync(f, 'THE PERSON, LATER');
  const later = new Date(ms('11:30')); fs.utimesSync(f, later, later);
  assert.deepEqual(undo.plan(project, task()).files.map((x) => [x.ok, x.why]), [[false, 'changed-since']]);
  const r = undo.apply(project, task(), [f], { now: ms('12:00') });
  assert.deepEqual([r.done, r.skipped], [[], [{ path: f, why: 'changed-since' }]]);
  assert.equal(fs.readFileSync(f, 'utf8'), 'THE PERSON, LATER');
});

test('only the agent\'s own folder and holds count; another agent\'s edit of the same file is flagged and skipped unless chosen', () => {
  const project = 'p' + (++pn);
  const di = worker('di');
  const ed = worker('ed');
  const f = path.join(di, 'shared.md');
  fs.writeFileSync(f, 'ORIGINAL');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'di' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'BEFORE THE TASK', '09:00', di);   // a copy from before the hold: not this task's
  edit(f, 'DI', '10:10', di);
  edit(f, 'ED', '10:30', ed);                // another agent, not on this task, edits the same file meanwhile
  const p = undo.plan(project, task()).files[0];
  assert.deepEqual([p.ok, p.why, p.shared], [false, 'shared', true]);
  assert.equal(undo.apply(project, task(), [], { now: ms('12:00') }).done.length, 0, 'nothing chosen, nothing done');
  const r = undo.apply(project, task(), [f], { now: ms('12:00') });
  assert.deepEqual(r.done, [f], 'the person chose it');
  assert.equal(fs.readFileSync(f, 'utf8'), 'BEFORE THE TASK', 'the copy kept before di\'s first edit IN the task');
});

test('a link, a folder and a file over the size limit get no copy', () => {
  const fa = worker('fa');
  const big = path.join(fa, 'big.bin');
  fs.writeFileSync(big, Buffer.alloc(undo.MAX_BYTES + 1));
  assert.equal(undo.keep(big, { cwd: fa }).because, 'too-large');
  assert.equal(undo.keep(fa, { cwd: fa }).because, 'not-a-file');
  assert.equal(undo.keep('relative/x', { cwd: fa }).because, 'not-absolute');
  try { fs.symlinkSync(big, path.join(fa, 'ln')); assert.equal(undo.keep(path.join(fa, 'ln'), { cwd: fa }).because, 'link'); } catch { /* no links here */ }
});

test('an open task has nothing to undo', () => {
  assert.deepEqual(undo.plan('px', { number: 1, closedAt: null }), { ready: false, because: 'open', files: [] });
});
