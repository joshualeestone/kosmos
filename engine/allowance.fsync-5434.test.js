'use strict';
/**
 * kosmos#5434 slice 5: the two files Kosmos keeps in a provider's account folder (the weekly reading the statusline
 * records, and the weekly calibration) are saved through securewrite.writeSecret, so the bytes are flushed to disk
 * BEFORE the rename makes them the file (#5431); an existing file keeps its mode, a new one takes the umask default; a
 * save whose every atomic attempt fails leaves the old file; in the provider's folder only that file's own dead temps
 * are reaped; and the statusline, copied alone, still records a reading. Every arm writes in its own scratch folder.
 *
 *   node --test engine/allowance.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const allowance = require('./allowance');
const statusline = require('./kosmos-statusline');

const FUTURE = Math.floor(Date.now() / 1000) + 3 * 24 * 3600;

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowfsync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/* Each writer as one call that saves its file in `dir`, answering the file. Every call moves the figure forward,
   so it really writes. */
let N = 0;
const WRITERS = [
  ['statusline.record', (dir) => { N += 1; assert.equal(statusline.record(dir, { usedPct: N, resetsAt: FUTURE }, 1000 + N), true, 'the reading was not written'); return path.join(dir, statusline.FILE); }],
  ['allowance.calibrate', (dir) => {
    N += 1;
    const now = Date.now();
    const dayStart = now - 6 * 3600 * 1000;
    fs.writeFileSync(path.join(dir, statusline.FILE), JSON.stringify({ usedPct: 44, resetsAt: FUTURE, at: now - 60e3, history: [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 44, FUTURE]] }));
    allowance.calibrate(dir, 4e6 + N * 1000, { now, dayStart });
    return path.join(dir, allowance.CALIBRATION_FILE);
  }],
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

for (const [name, write] of WRITERS) {
  test('#5434: ' + name + ' flushes the temp it renames into the file', (t) => {
    const dir = scratch(t);
    const { events, out: file } = recording(() => write(dir));
    const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
    assert.ok(r >= 0, 'no rename into the file: ' + JSON.stringify(events));
    assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]),
      'the temp renamed into the file was never flushed first: ' + JSON.stringify(events));
  });

  test('#5434: ' + name + ': an existing file keeps its mode; a new one takes the umask default', { skip: process.platform === 'win32' && 'POSIX modes' }, (t) => {
    const dir = scratch(t);
    const file = write(dir);
    fs.chmodSync(file, 0o640);
    withUmask(0o022, () => write(dir));
    assert.equal(fs.statSync(file).mode & 0o777, 0o640, 'the mode was not kept');
    fs.unlinkSync(file);
    withUmask(0o022, () => write(dir));
    assert.equal(fs.statSync(file).mode & 0o777, 0o644, 'a new file under umask 022 is not 0644');
    fs.unlinkSync(file);
    withUmask(0o077, () => write(dir));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'a new file under umask 077 is not 0600 (the umask was overridden)');
  });

  test('#5434: ' + name + ': when every atomic attempt fails, the file is left as it was', (t) => {
    const dir = scratch(t);
    const file = write(dir);
    const before = fs.readFileSync(file, 'utf8');
    const realOpen = fs.openSync;
    let planted = 0;
    fs.openSync = (target, flags, ...rest) => {
      // 'wx' is the flag writeSecret opens its temp with; if that ever changes `planted` says so
      if (flags === 'wx' && String(target).startsWith(file)) { planted += 1; throw Object.assign(new Error('planted'), { code: 'EEXIST' }); }
      return realOpen.call(fs, target, flags, ...rest);
    };
    // the writer helper's own `record(...) === true` assertion fails here by design (the save failed); swallowed, and
    // the planted count and the unchanged bytes below are what this arm checks
    try { write(dir); } catch { /* expected, see above */ }
    finally { fs.openSync = realOpen; }
    assert.equal(planted, 3, 'the planted failure did not fire on all three atomic attempts');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'the file was rewritten in place');
  });

  test('#5434: ' + name + ': in the provider\'s folder only this file\'s own dead temps are reaped', (t) => {
    // A FRESH folder and both temps planted BEFORE the first write: securewrite sweeps a folder once per process, so
    // a write before planting would spend that sweep and a folder-wide reap could no longer show here.
    const dir = scratch(t);
    const file = path.join(dir, name === 'statusline.record' ? statusline.FILE : allowance.CALIBRATION_FILE);
    const own = file + '.kosmos-2147483646-t0-1-1.tmp';
    const other = path.join(dir, 'settings.json.kosmos-2147483646-t0-1-1.tmp');   // the provider's own file's temp
    fs.writeFileSync(own, 'x');
    fs.writeFileSync(other, 'x');
    assert.equal(write(dir), file);
    assert.equal(fs.existsSync(own), false, 'this file\'s dead temp was left');
    assert.equal(fs.existsSync(other), true, 'another file\'s temp in the provider\'s folder was swept');
  });

}

test('#5434: the statusline copied ALONE (no securewrite beside it) still records a reading, never an error', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slalone-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, 'kosmos-statusline.js'), path.join(home, 'kosmos-statusline.js'));
  const acct = path.join(home, 'acct');
  fs.mkdirSync(acct);
  const out = require('node:child_process').execFileSync(process.execPath,
    ['-e', 'process.stdout.write(String(require(process.argv[1]).record(process.argv[2], { usedPct: 7, resetsAt: Number(process.argv[3]) }, 1)))',
      path.join(home, 'kosmos-statusline.js'), acct, String(FUTURE)], { encoding: 'utf8' });
  assert.equal(out, 'true', 'the reading was not recorded');
  assert.equal(JSON.parse(fs.readFileSync(path.join(acct, statusline.FILE), 'utf8')).usedPct, 7);
});

test('#5434: the calibration and the reading are still the same JSON (no change to what is stored)', (t) => {
  const dir = scratch(t);
  const now = Date.now();
  const dayStart = now - 6 * 3600 * 1000;
  fs.writeFileSync(path.join(dir, statusline.FILE), JSON.stringify({ usedPct: 44, resetsAt: FUTURE, at: now - 60e3, history: [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 44, FUTURE]] }));
  const got = allowance.calibrate(dir, 4e6, { now, dayStart });
  const raw = fs.readFileSync(path.join(dir, allowance.CALIBRATION_FILE), 'utf8');
  assert.equal(raw, JSON.stringify(got) + '\n', 'the calibration file is not the estimate as before');
  statusline.record(dir, { usedPct: 45, resetsAt: FUTURE }, 5);
  const w = fs.readFileSync(path.join(dir, statusline.FILE), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(w)), ['usedPct', 'resetsAt', 'at', 'history']);
  assert.ok(w.endsWith('}\n'), 'the reading\'s trailing newline changed');
});
