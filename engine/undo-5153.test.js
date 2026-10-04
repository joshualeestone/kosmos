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
const store = require('./store');

const T = (hhmm) => `2026-10-01T${hhmm}:00.000Z`;
const ms = (hhmm) => Date.parse(T(hhmm));
let pn = 0;
function activity(project, number, rows) {
  const file = taskchat.taskChatFile(project, number);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify({ ...r, at: T(r.at) })).join('\n') + '\n');
}
/* A Kosmos agent: a folder and a profile (register.known lists profiles), so its sessions get copies. */
function worker(name) {
  const d = path.join(SB, 'workers', name);
  fs.mkdirSync(d, { recursive: true });
  store.writeProfile(name, { displayName: name });
  undo.resetForTests();
  return d;
}
/* An "edit" at a time: keep() as the hook would call it, then the change. */
function edit(file, content, at, cwd) {
  const r = undo.keep(file, { cwd, session: 's', now: ms(at) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const t = new Date(ms(at) + 1000); fs.utimesSync(file, t, t);
  return r;
}
const task = (closedAt = T('11:00')) => ({ number: 1, closedAt });
/* A file as it was before any hold: written, then dated 09:00, so its first copy is plainly from before the agent began. */
function original(file, content) { fs.writeFileSync(file, content); const t = new Date(ms('09:00')); fs.utimesSync(file, t, t); }

test('the switch is OFF until it is turned on: nothing is kept, and an undo does nothing', () => {
  assert.deepEqual(undo.read(), { on: false, ok: true, since: null });
  const f = path.join(worker('off'), 'a.md');
  fs.writeFileSync(f, 'x');
  assert.deepEqual(undo.keep(f, { cwd: path.dirname(f) }), { kept: false, because: 'off' });
  assert.equal(undo.apply('px', task(), [f]).because, 'off');
  assert.equal(fs.existsSync(path.join(store.ROOT, 'undo', 'index.jsonl')), false, 'a copy was kept with the switch off');
});

test('undo puts an edited file back to the copy before the FIRST edit in the task, saving its current version first', () => {
  undo.setOn(true, ms('08:00'));   // on before every hold below, so their histories are whole
  const project = 'p' + (++pn);
  const ann = worker('ann');
  const f = path.join(ann, 'notes.md');
  original(f, 'ORIGINAL');
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
  original(f, 'ORIGINAL');
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
  original(f, 'ORIGINAL');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'di' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'BEFORE THE TASK', '09:00', di);   // a copy from before the hold: not this task's
  edit(f, 'DI', '10:10', di);
  edit(f, 'ED', '10:30', ed);                // another agent, not on this task, edits the same file meanwhile
  const p = undo.plan(project, task()).files[0];
  assert.deepEqual([p.ok, p.why], [false, 'shared']);
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
  assert.equal(undo.keep(path.join(fa, 'bad\nname'), { cwd: fa }).because, 'not-absolute', 'a control character is refused, not rewritten');
  let linked = true;
  try { fs.symlinkSync(big, path.join(fa, 'ln')); } catch { linked = false; }
  if (linked) assert.equal(undo.keep(path.join(fa, 'ln'), { cwd: fa }).because, 'link');
});

test('a person\'s own Claude session (not a Kosmos agent\'s folder or session) gets no copy', () => {
  const mine = fs.mkdtempSync(path.join(SB, 'person-'));
  fs.writeFileSync(path.join(mine, '.env'), 'SECRET=1');
  assert.equal(undo.keep(path.join(mine, '.env'), { cwd: mine, session: 'not-an-agent-session' }).because, 'not-an-agent');
});

test('a file swapped for a link after its copy is never written through: listed, not choosable, the link\'s target untouched', (t) => {
  const project = 'p' + (++pn);
  const gi = worker('gi');
  const f = path.join(gi, 'conf.yml');
  original(f, 'ORIGINAL');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'gi' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'AGENT', '10:10', gi);
  const target = path.join(SB, 'precious.txt');
  fs.writeFileSync(target, 'PRECIOUS');
  fs.rmSync(f);
  try { fs.symlinkSync(target, f); } catch { t.skip('links cannot be made here'); return; }
  const old = new Date(ms('10:30')); fs.lutimesSync(f, old, old);
  assert.deepEqual(undo.plan(project, task()).files.map((x) => [x.ok, x.why]), [[false, 'not-a-file']]);
  const r = undo.apply(project, task(), [f], { now: ms('12:00') });
  assert.deepEqual(r.done, []);
  assert.equal(fs.readFileSync(target, 'utf8'), 'PRECIOUS', 'the undo wrote through the link');
});

test('a file deleted after the task closed is not brought back', () => {
  const project = 'p' + (++pn);
  const hu = worker('hu');
  const f = path.join(hu, 'gone.md');
  original(f, 'ORIGINAL');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'hu' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'AGENT', '10:10', hu);
  fs.rmSync(f);
  assert.deepEqual(undo.plan(project, task()).files.map((x) => [x.ok, x.why]), [[false, 'gone']]);
  assert.deepEqual(undo.apply(project, task(), [f], { now: ms('12:00') }).done, []);
  assert.equal(fs.existsSync(f), false);
});

test('the same agent on two overlapping tasks: an edit inside the other task is flagged, not offered as this task\'s', () => {
  const projects = require('./projects');
  const project = 'po' + (++pn);
  const io = worker('io');
  projects.writeAll([...projects.readAll(), { id: project, name: 'Overlap', agents: ['io'], tasks: [
    { number: 1, sentence: 'one', closedAt: T('11:00') }, { number: 2, sentence: 'two', closedAt: T('11:00') }] }]);
  const f = path.join(io, 'both.md');
  original(f, 'ORIGINAL');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'io' }, { at: '11:00', kind: 'closed' }]);
  activity(project, 2, [{ at: '10:00', kind: 'created', who: 'io' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'IO', '10:10', io);
  assert.deepEqual(undo.plan(project, { number: 1, closedAt: T('11:00') }).files.map((x) => [x.ok, x.why]), [[false, 'other-task']]);
});

test('turned on after the agent began: its history is incomplete, so a file is flagged, not "before this task"', () => {
  const project = 'p' + (++pn);
  const ju = worker('ju');
  const f = path.join(ju, 'late.md');
  original(f, 'ORIGINAL');
  activity(project, 1, [{ at: '07:00', kind: 'created', who: 'ju' }, { at: '11:00', kind: 'closed' }]);   // began before 08:00
  edit(f, 'AGENT', '10:10', ju);
  assert.deepEqual(undo.plan(project, task()).files.map((x) => [x.ok, x.why]), [[false, 'incomplete']]);
});

test('copies are private (0600 files, 0700 folders); the sweep drops old ones; turning off deletes them all', () => {
  const ku = worker('ku');
  const f = path.join(ku, 'k.md');
  fs.writeFileSync(f, 'K');
  assert.equal(undo.keep(f, { cwd: ku, now: ms('10:00') }).kept, true);
  const root = path.join(store.ROOT, 'undo');
  assert.equal(fs.statSync(path.join(root, 'index.jsonl')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(root, 'blobs')).mode & 0o777, 0o700);
  const before = fs.readFileSync(path.join(root, 'index.jsonl'), 'utf8').split('\n').filter(Boolean).length;
  undo.sweep(ms('10:00') + (undo.KEEP_DAYS + 1) * 86400000);
  assert.equal(fs.readFileSync(path.join(root, 'index.jsonl'), 'utf8').split('\n').filter(Boolean).length, 0, 'old copies kept past ' + undo.KEEP_DAYS + ' days (' + before + ' before)');
  assert.deepEqual(fs.readdirSync(path.join(root, 'blobs')), [], 'unreferenced blobs kept');
  undo.setOn(false);
  assert.equal(fs.existsSync(root), false, 'turning off left copies behind');
  undo.setOn(true, ms('08:00'));
});

test('an open task has nothing to undo', () => {
  assert.deepEqual(undo.plan('px', { number: 1, closedAt: null }), { ready: false, because: 'open', files: [] });
});

test('turning the switch off deletes the copies, never what an undo saved or moved aside', () => {
  const project = 'p' + (++pn);
  const lo = worker('lo');
  const f = path.join(lo, 'made.md');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'lo' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'MADE', '10:10', lo);
  const r = undo.apply(project, task(), [f], { now: ms('12:00') });
  assert.deepEqual(r.done, [f]);
  undo.setOn(false);
  assert.ok(fs.readdirSync(r.savedIn).some((n) => n.endsWith('-made.md')), 'the moved-aside file was deleted with the copies');
  undo.setOn(true, ms('08:00'));
});

test('a file created in a new folder: if that folder is later a link to elsewhere, nothing is moved through it', (t) => {
  const project = 'p' + (++pn);
  const mo = worker('mo');
  const sub = path.join(mo, 'fresh');
  const f = path.join(sub, 'x.md');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'mo' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'MADE', '10:10', mo);   // the folder did not exist when the copy was kept
  const elsewhere = fs.mkdtempSync(path.join(SB, 'elsewhere-'));
  fs.writeFileSync(path.join(elsewhere, 'x.md'), 'NOT YOURS');
  const old = new Date(ms('10:30')); fs.utimesSync(path.join(elsewhere, 'x.md'), old, old);
  fs.rmSync(sub, { recursive: true });
  try { fs.symlinkSync(elsewhere, sub); } catch { t.skip('links cannot be made here'); return; }
  assert.deepEqual(undo.plan(project, task()).files.map((x) => [x.ok, x.why]), [[false, 'moved']]);
  assert.deepEqual(undo.apply(project, task(), [f], { now: ms('12:00') }).done, []);
  assert.equal(fs.readFileSync(path.join(elsewhere, 'x.md'), 'utf8'), 'NOT YOURS');
});

test('a first copy made after the file had already changed inside the hold is marked incomplete, not "before this task"', () => {
  const project = 'p' + (++pn);
  const nu = worker('nu');
  const f = path.join(nu, 'late.md');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'nu' }, { at: '11:00', kind: 'closed' }]);
  fs.writeFileSync(f, 'CHANGED BY A COMMAND');
  const t5 = new Date(ms('10:05')); fs.utimesSync(f, t5, t5);   // inside the hold, before any copy
  edit(f, 'AGENT', '10:10', nu);
  assert.deepEqual(undo.plan(project, task()).files.map((x) => [x.ok, x.why]), [[false, 'incomplete']]);
});

test('moving aside across disks copies, checks and then removes; a failed restore leaves no temp file behind', (t) => {
  const d = fs.mkdtempSync(path.join(SB, 'xdev-'));
  const from = path.join(d, 'a.md');
  fs.writeFileSync(from, 'CONTENT');
  const realRename = fs.renameSync;
  const m = t.mock.method(fs, 'renameSync', (a, b) => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; });
  undo.moveAside(from, path.join(d, 'b.md'));
  m.mock.restore();
  assert.equal(fs.existsSync(from), false);
  assert.equal(fs.readFileSync(path.join(d, 'b.md'), 'utf8'), 'CONTENT');

  const project = 'p' + (++pn);
  const ov = worker('ov');
  const f = path.join(ov, 'r.md');
  original(f, 'ORIGINAL');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'ov' }, { at: '11:00', kind: 'closed' }]);
  edit(f, 'AGENT', '10:10', ov);
  t.mock.method(fs, 'renameSync', (a, b) => { if (path.basename(a).startsWith('.kosmos-undo-')) { const e = new Error('read-only'); e.code = 'EROFS'; throw e; } return realRename(a, b); });
  const r = undo.apply(project, task(), [f], { now: ms('12:00') });
  assert.deepEqual(r.skipped.map((x) => x.why), ['failed']);
  assert.deepEqual(fs.readdirSync(ov).filter((n) => n.startsWith('.kosmos-undo-')), [], 'the old content was left beside the file');
  assert.equal(fs.readFileSync(f, 'utf8'), 'AGENT', 'nothing changed');
});
