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

/* Record opens (with the fd each returned), fsyncs and renames, in order, while `fn` runs; put fs
   back afterwards. `wxFails` makes every 'wx' create fail with EEXIST, which sends writeSecret to
   its in-place fallback after three attempts. */
function recording(fn, { fsyncThrows = false, wxFails = false } = {}) {   // fsyncThrows: false, or an error code
  const events = [];
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (target, flags, ...rest) => {
    if (wxFails && flags === 'wx') throw Object.assign(new Error('planted'), { code: 'EEXIST' });
    const fd = realOpen.call(fs, target, flags, ...rest);
    events.push(['open', target, flags, fd]);
    return fd;
  };
  fs.fsyncSync = (fd) => { events.push(['fsync', fd]); if (fsyncThrows) throw Object.assign(new Error('fsync failed'), { code: fsyncThrows === true ? 'EINVAL' : fsyncThrows }); return realFsync(fd); };
  fs.renameSync = (a, b) => { events.push(['rename', b]); return realRename(a, b); };
  try { fn(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return events;
}

test('#5434: writeSecret flushes the temp before the rename that makes it the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw5434-'));
  try {
    const file = path.join(dir, 'tokens.json');
    const events = recording(() => securewrite.writeSecret(file, '{"a":1}\n', 0o600));
    const tempOpen = events.find((e) => e[0] === 'open' && e[2] === 'wx');
    assert.ok(tempOpen, 'no temp was created: ' + JSON.stringify(events));
    const tempFlush = events.findIndex((e) => e[0] === 'fsync' && e[1] === tempOpen[3]);
    const rename = events.findIndex((e) => e[0] === 'rename' && e[1] === file);
    assert.ok(tempFlush > -1, 'the temp\'s own fd was never flushed: ' + JSON.stringify(events));
    assert.ok(rename > -1, 'the file was not renamed into place: ' + JSON.stringify(events));
    assert.ok(tempFlush < rename, 'the temp was flushed after the rename: ' + JSON.stringify(events));
    assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5434: off Windows the folder is flushed after the rename too', { skip: process.platform === 'win32' && 'a folder cannot be flushed this way on Windows' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw5434-dir-'));
  try {
    const file = path.join(dir, 'tokens.json');
    const events = recording(() => securewrite.writeSecret(file, 'x', 0o600));
    const rename = events.findIndex((e) => e[0] === 'rename' && e[1] === file);
    const after = events.slice(rename + 1);
    const dirOpen = after.find((e) => e[0] === 'open' && e[1] === dir && e[2] === 'r');
    assert.ok(dirOpen, 'the folder was not opened after the rename: ' + JSON.stringify(events));
    assert.ok(after.some((e) => e[0] === 'fsync' && e[1] === dirOpen[3]), 'the folder itself was not flushed: ' + JSON.stringify(events));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5434: a file system that cannot flush (each skipped code) still gets the atomic write, not the in-place fallback', () => {
  for (const code of ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw5434-ref-'));
    try {
      const file = path.join(dir, 'tokens.json');
      fs.writeFileSync(file, 'old');
      const events = recording(() => securewrite.writeSecret(file, 'new', 0o600), { fsyncThrows: code });
      assert.ok(events.some((e) => e[0] === 'rename' && e[1] === file), code + ': the write left the atomic path: ' + JSON.stringify(events));
      assert.equal(fs.readFileSync(file, 'utf8'), 'new', code);
      assert.deepEqual(fs.readdirSync(dir), ['tokens.json'], code + ': a temp was left behind');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('#5434: the in-place fallback flushes what it wrote too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw5434-fb-'));
  try {
    const file = path.join(dir, 'tokens.json');
    fs.writeFileSync(file, 'old');
    const events = recording(() => securewrite.writeSecret(file, 'new', 0o600), { wxFails: true });
    // The fallback's own open: numeric O_* flags (the read that captures the old contents opens with 'r').
    const fbOpen = events.find((e) => e[0] === 'open' && e[1] === file && typeof e[2] === 'number');
    assert.ok(fbOpen, 'the fallback did not open the file in place: ' + JSON.stringify(events));
    assert.ok(events.some((e) => e[0] === 'fsync' && e[1] === fbOpen[3]), 'the fallback did not flush: ' + JSON.stringify(events));
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5434: a real flush error (EIO) fails the write and keeps the old file, as a failed close did before', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw5434-eio-'));
  try {
    const file = path.join(dir, 'tokens.json');
    fs.writeFileSync(file, 'old');
    let threw = null;
    const events = recording(() => { try { securewrite.writeSecret(file, 'new', 0o600); } catch (e) { threw = e; } }, { fsyncThrows: 'EIO' });
    assert.ok(threw, 'a write whose bytes may never have reached the disk was reported as a success');
    assert.equal(events.filter((e) => e[0] === 'open' && e[2] === 'wx').length, 1, 'it retried after the disk refused: ' + JSON.stringify(events));
    assert.ok(!events.some((e) => e[0] === 'open' && e[1] === file && typeof e[2] === 'number'), 'it went on to the in-place fallback, which truncates the live file: ' + JSON.stringify(events));
    assert.equal(fs.readFileSync(file, 'utf8'), 'old', 'the old file was replaced by bytes the disk refused');
    assert.deepEqual(fs.readdirSync(dir), ['tokens.json'], 'a temp was left behind');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
