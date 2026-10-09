'use strict';
/**
 * kosmos#5434 slice 4: store.js's saves (writeProfile, writeSettings, saveAvatar, keepAvatarOriginal) go through
 * securewrite.writeSecret, so the bytes are flushed to disk BEFORE the rename makes them the file (#5431), an existing
 * file keeps its mode, a new one takes the umask default, and a save whose every atomic attempt fails throws and
 * leaves the file as it was. This test process's store is a throwaway (#5418 ask 1).
 *
 *   node --test engine/store.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'storefsync-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
const store = require('./store');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000000500010d0a2db40000000049454e44ae426082', 'hex');

/* Each writer as one call that saves a file, answering the file it saved. */
let N = 0;
const WRITERS = [
  ['writeProfile', () => { store.writeProfile('ava', { role: 'r' + (++N) }); return path.join(store.PROFILES, store.profileFileName('ava')); }],
  ['writeSettings', () => { store.writeSettings({ n: ++N }); return store.settingsPath(); }],
  ['saveAvatar', () => store.saveAvatar('ava', 'image/png', Buffer.concat([PNG, Buffer.from([++N % 250])]))],
];

/* Record each fsync (with the path of the fd) and each rename, in order, while `fn` runs. */
function recording(fn) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (target, ...rest) => { const fd = realOpen.call(fs, target, ...rest); fdPath.set(fd, String(target)); return fd; };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd)]); return realFsync(fd); };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  let out;
  try { out = fn(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return { events, out };
}

function withUmask(mask, fn) {
  const prev = process.umask(mask);
  try { return fn(); } finally { process.umask(prev); }
}

test('#5434: the store is this test process\'s throwaway', () => {
  assert.ok(store.ROOT.startsWith(SB), 'the store root is not this file\'s sandbox');
});

for (const [name, write] of WRITERS) {
  test('#5434: ' + name + ' flushes the temp it renames into the file', () => {
    const { events, out: file } = recording(write);
    const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
    assert.ok(r >= 0, 'no rename into the file: ' + JSON.stringify(events));
    assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]),
      'the temp renamed into the file was never flushed first: ' + JSON.stringify(events));
  });

  test('#5434: ' + name + ': an existing file keeps its mode; a new one takes the umask default', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
    const file = write();
    fs.chmodSync(file, 0o640);
    withUmask(0o022, write);
    assert.equal(fs.statSync(file).mode & 0o777, 0o640, 'the mode was not kept');
    fs.unlinkSync(file);
    withUmask(0o022, write);
    assert.equal(fs.statSync(file).mode & 0o777, 0o644, 'a new file under umask 022 is not 0644 (a fixed mode, not the umask default)');
    fs.unlinkSync(file);
    withUmask(0o077, write);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'a new file under umask 077 is not 0600 (the umask was overridden)');
  });

  test('#5434: ' + name + ': when every atomic attempt fails, the save throws and the file is left as it was', () => {
    const file = write();
    const before = fs.readFileSync(file);
    const realOpen = fs.openSync;
    let planted = 0;
    fs.openSync = (target, flags, ...rest) => {
      // 'wx' is the flag writeSecret opens its temp with; if that ever changes this stub stops matching and `planted` says so
      if (flags === 'wx') { planted += 1; throw Object.assign(new Error('planted'), { code: 'EEXIST' }); }
      return realOpen.call(fs, target, flags, ...rest);
    };
    try { assert.throws(() => write(), /planted/); } finally { fs.openSync = realOpen; }
    assert.equal(planted, 3, 'the planted failure did not fire on all three atomic attempts');
    assert.deepEqual(fs.readFileSync(file), before, 'the file was rewritten in place');
  });
}

test('#5434: the bytes written are unchanged (the same JSON, no trailing newline added)', () => {
  const p = store.writeProfile('bea', { role: 'x' });
  assert.equal(fs.readFileSync(path.join(store.PROFILES, store.profileFileName('bea')), 'utf8'), JSON.stringify(p, null, 2));
  const s = store.writeSettings({ tz: 'America/Chicago' });
  assert.equal(fs.readFileSync(store.settingsPath(), 'utf8'), JSON.stringify(s, null, 2));
});

test('#5434: keepAvatarOriginal flushes the original it keeps', () => {
  store.saveAvatar('cy', 'image/png', PNG);
  const { events, out: dest } = recording(() => store.keepAvatarOriginal('cy'));
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === dest);
  assert.ok(r >= 0 && events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), 'the original was not flushed before its rename');
  assert.deepEqual(fs.readFileSync(dest), PNG, 'the kept original is not the picture');
});

test('#5434: a writer temp beside a picture is never taken for the picture', () => {
  const dest = store.saveAvatar('dee', 'image/png', PNG);
  fs.writeFileSync(dest + '.kosmos-2147483646-t0-1-1.tmp', 'not a picture');   // the shape writeSecret names its temps
  assert.equal(store.avatarPath('dee'), dest);
  assert.equal(store.avatarLookup('dee').file, dest);
});

test('#5434: removing a picture never takes another process\'s keep in flight in avatar-originals', () => {
  store.saveAvatar('eve', 'image/png', PNG);
  const kept = store.keepAvatarOriginal('eve');
  const dir = path.dirname(kept);
  const inflight = path.join(dir, path.basename(kept) + '.kosmos-' + process.ppid + '-t0-1-1.tmp');   // a live writer's temp (this run's parent: alive)
  fs.writeFileSync(inflight, 'in flight');
  const dead = path.join(dir, path.basename(kept) + '.kosmos-2147483646-t0-1-1.tmp');   // a dead writer's leftover copy
  fs.writeFileSync(dead, 'left behind');
  store.removeAvatar('eve');
  assert.equal(fs.existsSync(dead), false, 'a dead writer\'s copy of the removed picture was left');
  assert.equal(fs.existsSync(kept), false, 'CONTROL: the kept original was not removed with the picture');
  assert.equal(fs.existsSync(inflight), true, 'a keep in flight was unlinked');
  fs.unlinkSync(inflight);
});

test('#5434: a writer temp in the profiles folder is never listed as a profile', () => {
  store.writeProfile('fay', { role: 'r' });
  const file = path.join(store.PROFILES, store.profileFileName('fay'));
  fs.writeFileSync(file + '.kosmos-2147483646-t0-1-1.tmp', '{}');
  const listed = require('./register').known().names;
  assert.ok(listed.includes('fay'), 'CONTROL: the profile itself was not listed');
  assert.equal(listed.some((n) => n.includes('kosmos-')), false, 'a temp was listed as a profile');
});
