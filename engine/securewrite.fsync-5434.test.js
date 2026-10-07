'use strict';
/**
 * kosmos#5434: writeSecret flushes the temp file to disk BEFORE the rename makes it the file,
 * and a file system that refuses fsync does not stop the write. Every arm writes in its own
 * scratch folder.
 *
 *   node --test engine/securewrite.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const securewrite = require('./securewrite');

/* Record fsync and rename calls (in order) while `fn` runs, then put fs back. */
function recording(fn, { fsyncThrows = false } = {}) {
  const events = [];
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.fsyncSync = (fd) => { events.push(['fsync', fd]); if (fsyncThrows) throw Object.assign(new Error('fsync refused'), { code: 'EINVAL' }); return realFsync(fd); };
  fs.renameSync = (a, b) => { events.push(['rename', b]); return realRename(a, b); };
  try { fn(); } finally { fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return events;
}

test('#5434: writeSecret flushes the temp before the rename that makes it the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw5434-'));
  try {
    const file = path.join(dir, 'tokens.json');
    const events = recording(() => securewrite.writeSecret(file, '{"a":1}\n', 0o600));
    const firstFsync = events.findIndex((e) => e[0] === 'fsync');
    const rename = events.findIndex((e) => e[0] === 'rename' && e[1] === file);
    assert.ok(firstFsync > -1, 'the temp was never flushed: ' + JSON.stringify(events));
    assert.ok(rename > -1, 'the file was not renamed into place: ' + JSON.stringify(events));
    assert.ok(firstFsync < rename, 'the flush came after the rename: ' + JSON.stringify(events));
    assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5434: off Windows the folder is flushed after the rename too', { skip: process.platform === 'win32' && 'a folder cannot be flushed this way on Windows' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw5434-dir-'));
  try {
    const file = path.join(dir, 'tokens.json');
    const events = recording(() => securewrite.writeSecret(file, 'x', 0o600));
    const rename = events.findIndex((e) => e[0] === 'rename' && e[1] === file);
    assert.ok(events.slice(rename + 1).some((e) => e[0] === 'fsync'), 'no flush after the rename: ' + JSON.stringify(events));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5434: a file system that refuses fsync still gets the atomic write, not the in-place fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw5434-ref-'));
  try {
    const file = path.join(dir, 'tokens.json');
    fs.writeFileSync(file, 'old');
    const events = recording(() => securewrite.writeSecret(file, 'new', 0o600), { fsyncThrows: true });
    assert.ok(events.some((e) => e[0] === 'rename' && e[1] === file), 'the write left the atomic path: ' + JSON.stringify(events));
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.deepEqual(fs.readdirSync(dir), ['tokens.json'], 'a temp was left behind');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
