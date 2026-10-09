'use strict';
/**
 * kosmos#5434 slice 6: trust.js's saves (the trust line in .claude.json, its undo, the bypass pre-accept in
 * settings.json, the onboarding pre-accept, and Kosmos's own trust-writes record) go through
 * securewrite.writeSecret, so the bytes are flushed to disk BEFORE the rename makes them the file (#5431). A
 * Claude Code file keeps its mode (a new one is born 0600, as before); the record keeps its mode or takes the
 * umask default, as before; a save whose every atomic attempt fails is refused and leaves the file as it was;
 * in the person's own config folder only that file's own dead temps are reaped.
 *
 *   node --test engine/trust.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trustfsync-')));
// Both before the require: the config seam and the data root (the trust-writes record lives there).
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SB, 'default-claude.json');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
const trust = require('./trust');
const store = require('./store');

let N = 0;
const fresh = (label) => { const d = path.join(SB, label + '-' + (++N)); fs.mkdirSync(d, { recursive: true }); return d; };
const RECORD = () => path.join(store.ROOT, 'trust-writes.json');

/* Each writer as `prep(cfg)`, which makes sure the next save changes the file (so it writes), and
   `save(cfg)`, the save alone, answering the file it saved and whether it said it saved. `cfg` is a
   Claude Code config folder. Keeping them apart lets the failure arm snapshot the file between them. */
let pending = null;
const WRITERS = [
  ['trustFolder', {
    creates: true,
    prep: () => { pending = fresh('work'); },
    save: (cfg) => ({ file: path.join(cfg, '.claude.json'), ok: trust.trustFolder(pending, { configDir: cfg, createIfAbsent: true }).ok }),
  }],
  ['forgetFolder (the undo)', {
    prep: (cfg) => {
      const d = fresh('work');
      const w = trust.trustFolder(d, { configDir: cfg, createIfAbsent: true });
      assert.equal(w.ok, true, 'the trust line the undo takes back was not written');
      pending = { d, w };
    },
    save: (cfg) => {
      const file = path.join(cfg, '.claude.json');
      const prevEnv = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
      process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = file;   // forgetFolder takes no config dir: point the seam at it
      try { return { file, ok: trust.forgetFolder(pending.d, pending.w.displaced, pending.w.madeEntry).ok }; }
      finally { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = prevEnv; }
    },
  }],
  ['preacceptBypass', {
    creates: true,
    prep: (cfg) => {
      const file = path.join(cfg, 'settings.json');
      try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); delete d[trust.BYPASS_KEY]; fs.writeFileSync(file, JSON.stringify(d)); } catch { /* absent: a new file */ }
    },
    save: (cfg) => ({ file: path.join(cfg, 'settings.json'), ok: trust.preacceptBypass(cfg).ok }),
  }],
  ['preacceptOnboarding', {
    creates: true,
    prep: (cfg) => {
      const file = path.join(cfg, '.claude.json');
      try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); delete d[trust.ONBOARDING_KEY]; fs.writeFileSync(file, JSON.stringify(d)); } catch { /* absent: a new file */ }
    },
    save: (cfg) => ({ file: path.join(cfg, '.claude.json'), ok: trust.preacceptOnboarding(cfg).ok }),
  }],
];
function ok(r) { assert.equal(r.ok, true, 'the save was refused'); return r.file; }

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

/* Every attempt's `wx` temp create fails, so the save's three atomic attempts all fail. */
function everyTempRefused(fn) {
  const realOpen = fs.openSync;
  let planted = 0;
  fs.openSync = (p, flags, ...rest) => {
    if (flags === 'wx' && String(p).includes('.kosmos-')) { planted += 1; const e = new Error('injected'); e.code = 'EEXIST'; throw e; }
    return realOpen.call(fs, p, flags, ...rest);
  };
  let out;
  try { out = fn(); } finally { fs.openSync = realOpen; }
  return { planted, out };
}

function flushedBeforeRename(events, file) {
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into the file: ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]),
    'the temp renamed into the file was never flushed first: ' + JSON.stringify(events));
}

test('#5434: the trust-writes record is this test process\'s throwaway', () => {
  assert.ok(store.ROOT.startsWith(SB), 'the store root is not this file\'s sandbox');
});

for (const [name, w] of WRITERS) {
  test('#5434: ' + name + ' flushes the temp it renames into the file', () => {
    const cfg = fresh('cfg');
    w.prep(cfg); ok(w.save(cfg));   // the file exists now, so the measured save is a rewrite
    w.prep(cfg);
    const { events, out: file } = recording(() => ok(w.save(cfg)));
    flushedBeforeRename(events, file);
  });

  test('#5434: ' + name + ': an existing file keeps its mode' + (w.creates ? '; a new one is born 0600' : ''), { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
    const cfg = fresh('cfg');
    w.prep(cfg);
    const file = withUmask(0o022, () => ok(w.save(cfg)));
    // the undo never creates the file (its prep's trustFolder did), so only the keep-mode half is about it
    if (w.creates) assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'a new file is not born private');
    fs.chmodSync(file, 0o640);
    w.prep(cfg);
    withUmask(0o077, () => ok(w.save(cfg)));
    assert.equal(fs.statSync(file).mode & 0o777, 0o640, 'the mode was not kept');
  });

  test('#5434: ' + name + ': when every atomic attempt fails, the save is refused and the file is left as it was', () => {
    const cfg = fresh('cfg');
    w.prep(cfg);
    const file = ok(w.save(cfg));
    w.prep(cfg);
    const before = fs.readFileSync(file);
    const { planted, out } = everyTempRefused(() => w.save(cfg));
    assert.equal(planted, 3, 'the save did not make its three atomic attempts, so this did not test the failure');
    assert.equal(out.ok, false, 'a save that never landed was reported as saved');
    assert.deepEqual(fs.readFileSync(file), before, 'a failed save changed the file');
  });
}

test('#5434: in a person\'s config folder only the file\'s own dead temps are reaped', () => {
  const cfg = fresh('cfg');
  const file = path.join(cfg, '.claude.json');
  // planted BEFORE the first write, so a once-per-folder sweep would have to show itself here
  // pid 2147483646 is chosen because it cannot be live (a dead writer); do not change it to process.pid
  const mine = file + '.kosmos-2147483646-t0-1-1.tmp';
  const other = path.join(cfg, 'settings.json.kosmos-2147483646-t0-1-1.tmp');   // another file's temp
  fs.writeFileSync(mine, 'x');
  fs.writeFileSync(other, 'x');
  assert.equal(trust.trustFolder(fresh('work'), { configDir: cfg, createIfAbsent: true }).ok, true);
  assert.equal(fs.existsSync(mine), false, 'this file\'s own dead temp was not reaped');
  assert.equal(fs.existsSync(other), true, 'another file\'s temp was swept: a folder-wide sweep of the person\'s folder');
});

test('#5434: the trust-writes record flushes before its rename, keeps its mode, and its bytes are unchanged', () => {
  const w = { key: 'k-' + (++N), displaced: undefined, madeEntry: true };
  assert.equal(trust.recordWrite('rec-a', w), true);
  const { events } = recording(() => assert.equal(trust.recordWrite('rec-b', w), true));
  flushedBeforeRename(events, RECORD());
  const raw = fs.readFileSync(RECORD(), 'utf8');
  assert.equal(raw, JSON.stringify(JSON.parse(raw), null, 2), 'the record is not stored as before (two-space JSON, no trailing newline)');
  if (process.platform !== 'win32') {
    fs.chmodSync(RECORD(), 0o640);
    withUmask(0o077, () => assert.equal(trust.recordWrite('rec-c', w), true));   // a umask the fd's mode set must undo
    assert.equal(fs.statSync(RECORD()).mode & 0o777, 0o640, 'the record\'s mode was not kept');
    fs.unlinkSync(RECORD());
    withUmask(0o022, () => assert.equal(trust.recordWrite('rec-f', w), true));
    assert.equal(fs.statSync(RECORD()).mode & 0o777, 0o644, 'a new record under umask 022 is not 0644 (not the umask default)');
    fs.unlinkSync(RECORD());
    withUmask(0o077, () => assert.equal(trust.recordWrite('rec-g', w), true));
    assert.equal(fs.statSync(RECORD()).mode & 0o777, 0o600, 'a new record under umask 077 is not 0600 (the umask was overridden)');
  }
});

test('#5434: a record save whose every atomic attempt fails leaves the record as it was', () => {
  const w = { key: 'k-' + (++N), displaced: undefined, madeEntry: true };
  assert.equal(trust.recordWrite('rec-d', w), true);
  const before = fs.readFileSync(RECORD());
  const { planted, out } = everyTempRefused(() => trust.recordWrite('rec-e', w));
  assert.equal(planted, 3, 'the save did not make its three atomic attempts');
  assert.equal(out, false, 'a failed record save was reported as written');
  assert.deepEqual(fs.readFileSync(RECORD()), before, 'a failed save changed the record');
});
