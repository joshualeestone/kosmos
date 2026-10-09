'use strict';
/**
 * kosmos#5434 slice 12: instructions.write (an agent's CLAUDE.md / AGENTS.md, the brief it starts from) flushes the
 * new text to disk BEFORE the rename makes it the brief, flushes the kept previous version before it is claimed, and
 * flushes the folder after the rename (#5431). A flush that fails refuses the save and leaves the old brief; a
 * backup whose flush fails is not claimed.
 *
 *   node --test engine/instructions.fsync-5434.test.js
 */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Before the require, as instructions.test.js does: the workers root and HOME are read at load.
const ROOT = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'brief-fsync-workers-')));
process.env.AGENT_WORKFORCE_WORKERS = ROOT;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-fsync-home-'));
process.env.HOME = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const instructions = require('./instructions');

test.after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
});

const OLD = 'You are a test agent. These are the instructions before the save.';
const NEW = 'You are a test agent. These are the instructions after the save, longer.';
let N = 0;
function agent() {
  const name = 'brief' + (++N);
  fs.mkdirSync(path.join(ROOT, name), { recursive: true });
  const file = path.join(ROOT, name, 'CLAUDE.md');
  fs.writeFileSync(file, OLD);
  return { name, file };
}

/* (fdPath maps an fd to its path while `fn` runs; a reused fd number is overwritten by its next open.) */
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
  let err = null;
  try { out = fn(); } catch (e) { err = e; } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return { events, out, err };
}

test('#5434: the new brief is flushed before the rename makes it the brief', () => {
  const { name, file } = agent();
  const { events, out, err } = recording(() => instructions.write(name, NEW));
  assert.equal(err, null, String(err));
  assert.equal(fs.readFileSync(file, 'utf8'), NEW);
  assert.ok(out.keptPrevious, 'no previous version was kept, so the backup arm below would measure nothing');
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into the brief: ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), 'the temp was never flushed before its rename: ' + JSON.stringify(events));
});

test('#5434: the kept previous version is flushed', () => {
  const { name, file } = agent();
  const { events, out } = recording(() => instructions.write(name, NEW));
  assert.equal(out.keptPrevious, true);
  assert.equal(fs.readFileSync(file + '.previous', 'utf8'), OLD);
  assert.ok(events.some((e) => e[0] === 'fsync' && e[1] === file + '.previous'), 'the previous version was never flushed: ' + JSON.stringify(events));
});

test('#5434: the folder is flushed after the rename', { skip: process.platform === 'win32' && 'no folder flush on Windows' }, () => {
  const { name, file } = agent();
  const { events } = recording(() => instructions.write(name, NEW));
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into the brief');
  assert.ok(events.slice(r + 1).some((e) => e[0] === 'fsync' && e[1] === path.dirname(file)), 'the folder was not flushed after the rename: ' + JSON.stringify(events));
});

test('#5434: a flush of the new brief that fails refuses the save, keeps the old brief and leaves no temp', () => {
  const { name, file } = agent();
  const isTemp = (p) => p.startsWith(file + '.') && p.endsWith('.tmp');
  const { events, err } = recording(() => instructions.write(name, NEW), isTemp);
  assert.ok(events.some((e) => e[0] === 'fsync' && isTemp(e[1])), 'the temp was never flushed, so this tests nothing');
  assert.ok(err, 'a save whose flush failed was reported as done');
  assert.match(String(err.message), /could not be saved/);
  assert.equal(fs.readFileSync(file, 'utf8'), OLD, 'a save whose flush failed changed the brief');
  const left = fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(left, [], 'a temp was left behind');
});

test('#5434: a backup whose flush fails is not claimed, and the save still lands', () => {
  const { name, file } = agent();
  const { events, out, err } = recording(() => instructions.write(name, NEW), (p) => p === file + '.previous');
  assert.ok(events.some((e) => e[0] === 'fsync' && e[1] === file + '.previous'), 'the backup was never flushed, so this tests nothing');
  assert.equal(err, null, 'a backup failure blocked the save: ' + String(err));
  assert.equal(out.keptPrevious, false, 'a backup that may not be on disk was claimed');
  assert.equal(fs.readFileSync(file, 'utf8'), NEW);
});

test('#5434: the brief keeps its mode', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  const { name, file } = agent();
  fs.chmodSync(file, 0o600);
  const prev = process.umask(0o022);
  try { instructions.write(name, NEW); } finally { process.umask(prev); }
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
