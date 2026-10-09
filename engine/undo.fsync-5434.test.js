'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 13: Undo flushes what it writes before anything relies on it (#5431):
 *   - the restore's temp before the rename makes it the person's file, and the folder after;
 *   - the current version saved aside before that file is replaced;
 *   - the kept copy (blob) before its rename, and a kept copy that no longer hashes to its name is rewritten;
 *   - moveAside's cross-device copy before the original is deleted.
 * A read-only file is still restored. A flush that fails leaves the person's file as it was.
 *
 *   node --test engine/undo.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// As engine/undo-5153.test.js: every root undo.js resolves, in this file's own sandbox, before the require.
const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'undofsync-')));
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
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const blobOf = (content) => path.join(store.ROOT, 'undo', 'blobs', sha(Buffer.from(content)));
let pn = 0;
function activity(project, rows) {
  const file = taskchat.taskChatFile(project, 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify({ ...r, at: T(r.at) })).join('\n') + '\n');
}
function worker(name) {
  const d = path.join(SB, 'workers', name);
  fs.mkdirSync(d, { recursive: true });
  store.writeProfile(name, { displayName: name });
  undo.resetForTests();
  return d;
}
function edit(file, content, at, cwd) {
  const r = undo.keep(file, { cwd, session: 's', now: ms(at) });
  fs.writeFileSync(file, content);
  const t = new Date(ms(at) + 1000); fs.utimesSync(file, t, t);
  return r;
}
function original(file, content) { fs.writeFileSync(file, content); const t = new Date(ms('09:00')); fs.utimesSync(file, t, t); }
const task = () => ({ number: 1, closedAt: T('11:00') });

/* A task whose undo restores `name`'s notes.md to ORIGINAL (unique per call, so its kept copy is its own). */
function scenario(name, mode) {
  const project = 'p' + (++pn);
  const dir = worker(name);
  const f = path.join(dir, 'notes.md');
  const orig = 'ORIGINAL ' + name + ' ' + pn;
  original(f, orig);
  if (mode != null) fs.chmodSync(f, mode);
  activity(project, [{ at: '10:00', kind: 'created', who: name }, { at: '11:00', kind: 'closed' }]);
  if (mode == null) edit(f, 'EDITED ' + name, '10:10', dir);
  else {
    // The copy is kept while the file is still at `mode` (that is the mode Undo puts back); then the edit lands.
    undo.keep(f, { cwd: dir, session: 's', now: ms('10:10') });
    fs.chmodSync(f, 0o644);
    fs.writeFileSync(f, 'EDITED ' + name);
    const t = new Date(ms('10:10') + 1000); fs.utimesSync(f, t, t);
  }
  return { project, f, orig };
}

function recording(fn, failFsyncOf) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => {
    const p = fdPath.get(fd);
    events.push(['fsync', p]);
    if (failFsyncOf && p && failFsyncOf(p)) { const e = new Error('injected'); e.code = 'EIO'; throw e; }
    return realFsync(fd);
  };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  let out;
  try { out = fn(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return { events, out };
}

undo.setOn(true, ms('08:00'));

test('#5434: the restore flushes its temp before the rename into the person\'s file, and the folder after', () => {
  const { project, f, orig } = scenario('ann');
  const { events, out } = recording(() => undo.apply(project, task(), [f], { now: ms('12:00') }));
  assert.deepEqual(out.done, [f], JSON.stringify(out));
  assert.equal(fs.readFileSync(f, 'utf8'), orig);
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === f);
  assert.ok(r >= 0, 'no rename into the file: ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), 'the temp was never flushed before its rename: ' + JSON.stringify(events));
  if (process.platform !== 'win32') {
    assert.ok(events.slice(r + 1).some((e) => e[0] === 'fsync' && e[1] === path.dirname(f)), 'the folder was not flushed after the rename');
  }
});

test('#5434: the current version saved aside is flushed before the file is replaced', () => {
  const { project, f } = scenario('bo');
  const { events, out } = recording(() => undo.apply(project, task(), [f], { now: ms('12:00') }));
  const saved = fs.readdirSync(out.savedIn).find((n) => n.endsWith('-notes.md'));
  assert.ok(saved, 'nothing was saved aside');
  const keepAs = path.join(out.savedIn, saved);
  const flushed = events.findIndex((e) => e[0] === 'fsync' && e[1] === keepAs);
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === f);
  assert.ok(flushed >= 0 && flushed < r, 'the saved-aside version was not flushed before the file was replaced: ' + JSON.stringify(events));
  if (process.platform !== 'win32') {
    const dirs = [out.savedIn, path.dirname(out.savedIn)];
    for (const d of dirs) {
      const i = events.findIndex((e) => e[0] === 'fsync' && e[1] === d);
      assert.ok(i >= 0 && i < r, 'the folder ' + d + ' was not flushed before the file was replaced (review 1)');
    }
  }
});

test('#5434: a read-only file is still restored, at its mode', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  const { project, f, orig } = scenario('cy', 0o444);
  fs.chmodSync(f, 0o444);   // read-only at undo time too, so the saved-aside copy is 0444 (flushPath's read-only open)
  const realOpen = fs.openSync;
  let readOnlyOpen = false;
  fs.openSync = (q, flags, ...rest) => { if (flags === 'r' && String(q).endsWith('-notes.md')) readOnlyOpen = true; return realOpen.call(fs, q, flags, ...rest); };
  let out;
  try { out = undo.apply(project, task(), [f], { now: ms('12:00') }); } finally { fs.openSync = realOpen; }
  assert.ok(readOnlyOpen, 'the saved-aside copy was never opened read-only, so the 0444 path was not exercised');
  assert.deepEqual(out.done, [f], 'a read-only file could not be restored: ' + JSON.stringify(out));
  assert.equal(fs.readFileSync(f, 'utf8'), orig);
  assert.equal(fs.statSync(f).mode & 0o777, 0o444);
});

test('#5434: a restore whose flush fails leaves the person\'s file as it was and no temp', () => {
  const { project, f } = scenario('di');
  const before = fs.readFileSync(f, 'utf8');
  const isTemp = (p) => path.basename(p).startsWith('.kosmos-undo-');
  const { events, out } = recording(() => undo.apply(project, task(), [f], { now: ms('12:00') }), isTemp);
  assert.ok(events.some((e) => e[0] === 'fsync' && isTemp(e[1])), 'the temp was never flushed, so this tests nothing');
  assert.deepEqual(out.done, []);
  assert.deepEqual(out.skipped, [{ path: f, why: 'failed' }]);
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'the person\'s file changed');
  assert.deepEqual(fs.readdirSync(path.dirname(f)).filter((n) => n.startsWith('.kosmos-undo-')), [], 'a temp was left beside the file');
});

test('#5434: the kept copy is flushed before its rename', () => {
  const dir = worker('ed');
  const f = path.join(dir, 'kept.md');
  const content = 'KEEP ME ' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(f, content);
  const blob = blobOf(content);
  const { events, out } = recording(() => undo.keep(f, { cwd: dir, session: 's', now: ms('10:00') }));
  assert.deepEqual(out, { kept: true });
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === blob);
  assert.ok(r >= 0, 'no rename into the kept copy: ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), 'the kept copy was not flushed before its rename');
});

test('#5434: a kept copy that no longer hashes to its name is rewritten, and the undo then restores it', () => {
  const { project, f, orig } = (() => {
    const project = 'p' + (++pn);
    const dir = worker('fay');
    const f = path.join(dir, 'notes.md');
    const orig = 'ORIGINAL fay ' + pn;
    original(f, orig);
    activity(project, [{ at: '10:00', kind: 'created', who: 'fay' }, { at: '11:00', kind: 'closed' }]);
    // A crash left this content's kept copy at full length but zero-filled, before this task began.
    fs.mkdirSync(path.dirname(blobOf(orig)), { recursive: true });
    fs.writeFileSync(blobOf(orig), Buffer.alloc(Buffer.byteLength(orig)));
    edit(f, 'EDITED fay', '10:10', dir);
    return { project, f, orig };
  })();
  assert.equal(sha(fs.readFileSync(blobOf(orig))), sha(Buffer.from(orig)), 'the zero-filled kept copy was trusted, not rewritten');
  const out = undo.apply(project, task(), [f], { now: ms('12:00') });
  assert.deepEqual(out.done, [f], JSON.stringify(out));
  assert.equal(fs.readFileSync(f, 'utf8'), orig);
});

test('#5434: moveAside across devices flushes the copy before deleting the original', () => {
  const dir = fs.mkdtempSync(path.join(SB, 'move-'));
  const from = path.join(dir, 'a.md');
  const to = path.join(dir, 'b.md');
  fs.writeFileSync(from, 'MOVE ME');
  const realRename = fs.renameSync;
  const realUnlink = fs.unlinkSync;
  const realFsync = fs.fsyncSync;
  const realOpen = fs.openSync;
  const events = [];   // ONE ordered list, so the test can say "before" (review 1)
  const fdPath = new Map();
  fs.renameSync = (a, b) => { if (String(a) === from) { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; } return realRename(a, b); };
  fs.unlinkSync = (p) => { events.push(['unlink', String(p)]); return realUnlink(p); };
  fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return realFsync(fd); };
  try { undo.moveAside(from, to); } finally { fs.renameSync = realRename; fs.unlinkSync = realUnlink; fs.fsyncSync = realFsync; fs.openSync = realOpen; }
  assert.equal(fs.existsSync(from), false);
  assert.equal(fs.readFileSync(to, 'utf8'), 'MOVE ME');
  const flushed = events.findIndex((e) => e[0] === 'fsync' && e[1] === to);
  const deleted = events.findIndex((e) => e[0] === 'unlink' && e[1] === from);
  assert.ok(flushed >= 0 && deleted >= 0 && flushed < deleted, 'the copy was not flushed before the original was deleted: ' + JSON.stringify(events));
});
