'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 22: Undo's switch and its index rewrite are flushed before they count (#5431), and the sweep keeps
 * every kept copy while the index cannot be read (its records are intact), and while it has content but no record
 * (zero-filled) until the next record is appended. On main both deleted every kept copy as unreferenced.
 *
 *   node --test engine/undoindex.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'undoindex-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, '.claude');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
for (const d of ['data', 'workers', '.claude/projects']) fs.mkdirSync(path.join(SB, d), { recursive: true });
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const store = require('./store');
const undo = require('./undo');

const DIR = path.join(store.ROOT, 'undo');
const INDEX = path.join(DIR, 'index.jsonl');
const BLOBS = path.join(DIR, 'blobs');
const SWITCH = path.join(store.ROOT, 'undo.json');
const DAY = 86400000;

function recording(fn) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return realFsync(fd); };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  try { fn(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return events;
}
function flushedBeforeRename(events, file) {
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into ' + path.basename(file) + ': ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), path.basename(file) + ': the temp was not flushed before its rename');
}
function blob(name) { fs.mkdirSync(BLOBS, { recursive: true }); fs.writeFileSync(path.join(BLOBS, name), 'kept'); }
const rec = (id, hash, atMs) => JSON.stringify({ id, path: '/x/' + id, hash, at: new Date(atMs).toISOString() });

test('#5434: the switch is flushed before its rename', () => {
  flushedBeforeRename(recording(() => undo.setOn(true)), SWITCH);
});

test('#5434: the index rewrite in the sweep is flushed before its rename, at 0600', () => {
  undo.setOn(true);
  const now = Date.now();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(INDEX, rec('old', 'a'.repeat(64), now - 40 * DAY) + '\n' + rec('new', 'b'.repeat(64), now) + '\n');
  flushedBeforeRename(recording(() => undo.sweep(now)), INDEX);
  if (process.platform !== 'win32') assert.equal(fs.statSync(INDEX).mode & 0o777, 0o600);
});

test('#5434: an index that cannot be READ keeps every kept copy (its records are intact) (review 1)', () => {
  undo.setOn(true);
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  blob('9'.repeat(64));
  fs.mkdirSync(INDEX);   // readFileSync throws EISDIR: unreadable, not absent
  try { undo.sweep(Date.now()); } finally { fs.rmSync(INDEX, { recursive: true, force: true }); }
  assert.equal(fs.existsSync(path.join(BLOBS, '9'.repeat(64))), true, 'the sweep deleted a kept copy because the index could not be read');
});

test('#5434: a dead .tmp blob is still reaped while the copies are held (review 1)', () => {
  undo.setOn(true);
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  blob('8'.repeat(64));
  blob('7'.repeat(64) + '.tmp');
  const old = new Date(Date.now() - 2 * 3600000); fs.utimesSync(path.join(BLOBS, '7'.repeat(64) + '.tmp'), old, old);
  fs.writeFileSync(INDEX, Buffer.alloc(200));
  undo.sweep(Date.now());
  assert.equal(fs.existsSync(path.join(BLOBS, '8'.repeat(64))), true, 'a held copy was deleted');
  assert.equal(fs.existsSync(path.join(BLOBS, '7'.repeat(64) + '.tmp')), false, 'a dead .tmp was not reaped');
});

test('#5434: a zero-filled index keeps its copies until the next record is appended, then the sweep collects as usual (the limit, pinned)', () => {
  undo.setOn(true);
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  blob('6'.repeat(64));
  fs.writeFileSync(INDEX, Buffer.alloc(200));
  undo.sweep(Date.now());
  assert.equal(fs.existsSync(path.join(BLOBS, '6'.repeat(64))), true, 'held while the index has no record');
  fs.appendFileSync(INDEX, '\n' + rec('next', '5'.repeat(64), Date.now()) + '\n');
  undo.sweep(Date.now());
  assert.equal(fs.existsSync(path.join(BLOBS, '6'.repeat(64))), false, 'once a record is readable, an unreferenced copy is collected as usual');
});

test('#5434: a zero-filled index keeps every kept copy', () => {
  undo.setOn(true);
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  blob('c'.repeat(64));
  fs.writeFileSync(INDEX, Buffer.alloc(200));   // what a crash after an unflushed write leaves
  undo.sweep(Date.now());
  assert.equal(fs.existsSync(path.join(BLOBS, 'c'.repeat(64))), true, 'the sweep deleted a kept copy because it could not read the index');
});

test('#5434: control: an EMPTY index, and an index whose records no longer use a blob, still let the sweep collect it', () => {
  undo.setOn(true);
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  blob('d'.repeat(64));
  fs.writeFileSync(INDEX, '');
  undo.sweep(Date.now());
  assert.equal(fs.existsSync(path.join(BLOBS, 'd'.repeat(64))), false, 'an empty index must still collect unreferenced copies');
  blob('e'.repeat(64));
  fs.writeFileSync(INDEX, rec('live', 'f'.repeat(64), Date.now()) + '\n');
  undo.sweep(Date.now());
  assert.equal(fs.existsSync(path.join(BLOBS, 'e'.repeat(64))), false, 'a readable index must still collect a copy nothing refers to');
});
