'use strict';
/**
 * kosmos#5434 slice 3: the provider settings writers (reporthook.writeSettings, shared with allowance.js;
 * groksettings and geminisettings ensurePrepared) save through securewrite.writeSecret, so the bytes are
 * flushed to disk BEFORE the rename makes them the file (#5431), an existing file keeps its exact mode, a
 * new one takes the umask default, and a save whose every atomic attempt fails leaves the file as it was.
 * Every arm writes in its own scratch folder.
 *
 *   node --test engine/settingswrite.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const reporthook = require('./reporthook');
const groksettings = require('./groksettings');
const geminisettings = require('./geminisettings');

const POSIX = { platform: 'darwin' };
/* Each writer as one call that saves `file`, answering whether it WROTE. reporthook's is the shared
   writer itself; the provider ones go through ensurePrepared, which writes only when it changes
   something and refuses a file that is not its own, so every call passes a different bridge path `n`
   (a real rewrite every time) and a file is seeded by the writer itself. */
let N = 0;
const WRITERS = [
  ['reporthook.writeSettings', (file) => reporthook.writeSettings(file, { theme: 'dark', n: ++N }, statMode(file)) === true],
  ['groksettings.ensurePrepared', (file) => { const r = groksettings.ensurePrepared(file, '/opt/kosmos/app' + (++N) + '/bin/grok-report-bridge.js', POSIX); return r.prepared === true && r.changed === true; }],
  ['geminisettings.ensurePrepared', (file) => { const r = geminisettings.ensurePrepared(file, '/opt/kosmos/app' + (++N) + '/bin/gemini-report-bridge.js', POSIX); return r.prepared === true && r.changed === true; }],
];

function statMode(file) { try { return fs.statSync(file).mode & 0o7777; } catch { return null; } }

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setw5434-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

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
  try { fn(); } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return events;
}

function withUmask(mask, fn) {
  const prev = process.umask(mask);
  try { return fn(); } finally { process.umask(prev); }
}

for (const [name, write] of WRITERS) {
  test('#5434: ' + name + ' flushes the temp it renames into the file', (t) => {
    const file = path.join(scratch(t), 'settings.json');
    let wrote = false;
    const events = recording(() => { wrote = write(file); });
    assert.equal(wrote, true, 'the writer did not write');
    const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
    assert.ok(r >= 0, 'no rename into the file: ' + JSON.stringify(events));
    assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]),
      'the temp renamed into the file was never flushed first: ' + JSON.stringify(events));
    assert.ok(fs.readFileSync(file, 'utf8').length > 0);
  });

  test('#5434: ' + name + ': an existing file keeps its exact mode; a new one takes the umask default', { skip: process.platform === 'win32' && 'POSIX modes' }, (t) => {
    const dir = scratch(t);
    for (const mode of [0o600, 0o640, 0o664]) {
      const file = path.join(dir, 'm' + mode.toString(8) + '.json');
      assert.equal(write(file), true, 'seed');
      fs.chmodSync(file, mode);
      const before = fs.readFileSync(file, 'utf8');
      assert.equal(withUmask(0o022, () => write(file)), true, 'the rewrite did not happen');
      assert.notEqual(fs.readFileSync(file, 'utf8'), before, 'the file did not change, so its mode proves nothing');
      assert.equal(fs.statSync(file).mode & 0o777, mode, 'mode ' + mode.toString(8) + ' was not kept');
    }
    const a = path.join(dir, 'new022.json');
    assert.equal(withUmask(0o022, () => write(a)), true);
    assert.equal(fs.statSync(a).mode & 0o777, 0o644, 'a new file under umask 022 is not 0644');
    const b = path.join(dir, 'new077.json');
    assert.equal(withUmask(0o077, () => write(b)), true);
    assert.equal(fs.statSync(b).mode & 0o777, 0o600, 'a new file under umask 077 is not 0600 (the umask was overridden)');
  });

  test('#5434: ' + name + ': when every atomic attempt fails, the file is left exactly as it was', (t) => {
    const file = path.join(scratch(t), 'settings.json');
    assert.equal(write(file), true, 'seed');
    assert.equal(write(file), true, 'CONTROL: this file saves normally, so a failure below is the planted one');
    const before = fs.readFileSync(file, 'utf8');
    const realOpen = fs.openSync;
    fs.openSync = (target, flags, ...rest) => {
      if (flags === 'wx') throw Object.assign(new Error('planted'), { code: 'EEXIST' });   // every atomic attempt fails
      return realOpen.call(fs, target, flags, ...rest);
    };
    let wrote;
    try { wrote = write(file); } finally { fs.openSync = realOpen; }
    assert.equal(wrote, false, 'the save reported success though every atomic attempt failed');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'the file was rewritten in place');
  });
}

test('#5434: CONTROL, securewrite.writeSecret with an explicit mode still sets it exactly over the umask', { skip: process.platform === 'win32' && 'POSIX modes' }, (t) => {
  const file = path.join(scratch(t), 'secret');
  withUmask(0o022, () => require('./securewrite').writeSecret(file, 'x', 0o600));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  withUmask(0o077, () => require('./securewrite').writeSecret(file, 'y', 0o640));
  assert.equal(fs.statSync(file).mode & 0o777, 0o640, 'an explicit mode was cut by the umask');
});

test('#5434: reporthook writes THROUGH a symlinked settings file (to its target), as before', { skip: process.platform === 'win32' && 'symlinks need privilege on Windows' }, (t) => {
  const dir = scratch(t);
  const real = path.join(dir, 'dotfiles-settings.json');
  fs.writeFileSync(real, '{}\n');
  const link = path.join(dir, 'settings.json');
  fs.symlinkSync(real, link);
  const read = reporthook.readSettings(link);
  assert.equal(reporthook.writeSettings(read.target, { a: 1 }, read.prevMode), true);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the link was replaced');
  assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { a: 1 });
});
