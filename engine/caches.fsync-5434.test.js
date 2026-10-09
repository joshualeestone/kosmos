'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 23: the caches, markers, seen-cursors and nudge records Kosmos keeps (group 4 of the
 * inventory) save through store.saveFlushed or securewrite.writeSecret, so the bytes are flushed to disk BEFORE
 * the rename makes them the file (#5431: a crash could leave the file at full length but zero-filled). A record
 * that was written 0600 is still 0600; a file in a folder that is not Kosmos's own (the person's workspace, the
 * guide's folder) reaps only its own dead temps; each caller keeps the error behaviour it had.
 *
 *   node --test engine/caches.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cachesfsync-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');   // before any require: store.ROOT is read at load
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
const store = require('./store');
const stuck = require('./stuckterminal');
const turn = require('./communityturn');
const reread = require('./instructionreread');
const replynudge = require('./replynudge');
const prompternudge = require('./prompternudge');
const musefront = require('./musefront');

let N = 0;
const fresh = (label) => { const d = path.join(SB, label + '-' + (++N)); fs.mkdirSync(d, { recursive: true }); return d; };

/* Record each fsync (with the path of the fd, paired through the openSync wrapper) and each rename, in order. */
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

function flushedBeforeRename(events, file) {
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into the file: ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]),
    'the temp renamed into the file was never flushed first: ' + JSON.stringify(events));
}

/* Every temp the save opens for `file` fails (EISDIR), so the save fails where it now happens. Counts the refusals,
   so a test can prove the write really failed rather than passing because nothing was attempted. */
function tempsRefused(file, fn) {
  const realOpen = fs.openSync;
  let refused = 0;
  fs.openSync = (p, ...rest) => {
    if (typeof p === 'string' && p.startsWith(file + '.kosmos-')) { refused += 1; const e = new Error('injected: the temp is a folder'); e.code = 'EISDIR'; throw e; }
    return realOpen.call(fs, p, ...rest);
  };
  let out;
  try { out = fn(); } finally { fs.openSync = realOpen; }
  return { refused, out };
}

test('#5434 slice 23: the data root is this test process\'s throwaway', () => {
  assert.ok(store.ROOT.startsWith(SB), 'the store root is not this file\'s sandbox');
});

/* Each writer: `save()` performs the save once (each call writes different content), `file()` names what it saved,
   and `failed(out)` reads the caller's failure answer the way the caller always gave it. */
const WRITERS = [
  ['stuckterminal.writeAnchor', {
    file: () => stuck.fileFor('mara'),
    save: () => stuck.writeAnchor('mara', { state: 'auth_failed', sinceAt: Date.now() + (++N) }),
    failed: () => true,   // it never throws and answers nothing: the file staying as it was is the check
  }],
  ['communityturn.writeBook', {
    file: () => turn.bookFile(),
    save: () => turn.writeBook(new Map([['mara', [Date.now() - (++N)]]])),
    failed: (out) => out === false,
  }],
  ['instructionreread.writeOwed', {
    file: () => reread.file(),
    save: () => reread.writeOwed({ mara: { at: Date.now() + (++N), sections: ['x'] } }),
    failed: (out) => out === false,
  }],
  ['instructionreread.recordSent', {
    file: () => reread.sentFile(),
    save: () => reread.recordSent('mara', Date.now() + (++N)),
    failed: (out) => out === false,
  }],
  ['replynudge.writePersons', {
    file: () => replynudge.personsFile(store.ROOT, 'mara'),
    save: () => replynudge.writePersons(store.ROOT, 'mara', { ['c' + (++N)]: { at: 1 } }),
    failed: (out) => out === false,
  }],
  ['replynudge.writeNudged', {
    file: () => replynudge.nudgedFile(store.ROOT, 'mara'),
    save: () => replynudge.writeNudged(store.ROOT, 'mara', new Set(['id-' + (++N)])),
    failed: (out) => out === false,
  }],
  ['prompternudge.write', {
    file: () => prompternudge.FILE,
    save: () => prompternudge.write([{ session: 's-' + (++N), from: 'a', to: 'b' }]),
    failed: (out) => out && out.ok === false,
    mode: 0o600,
  }],
];

for (const [name, w] of WRITERS) {
  test('#5434 slice 23: ' + name + ' flushes the temp it renames into the file', () => {
    w.save();   // the file exists now, so the measured save is a rewrite
    const { events } = recording(() => w.save());
    flushedBeforeRename(events, w.file());
  });

  test('#5434 slice 23: ' + name + ': a save that fails is answered as before and leaves the file as it was', () => {
    w.save();
    const before = fs.readFileSync(w.file());
    const { refused, out } = tempsRefused(w.file(), () => w.save());
    assert.ok(refused >= 1, 'the write did not fail, so this proves nothing');
    assert.ok(w.failed(out), 'the caller did not answer the failure as it always has: ' + JSON.stringify(out));
    assert.deepEqual(fs.readFileSync(w.file()), before, 'a failed save changed the file');
    assert.deepEqual(fs.readdirSync(path.dirname(w.file())).filter((n) => n.endsWith('.tmp')), [], 'a temp file was left behind');
  });

  if (w.mode) {
    test('#5434 slice 23: ' + name + ' is still saved at mode ' + w.mode.toString(8), { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
      fs.rmSync(w.file(), { force: true });   // review 2: measure a fresh create, not a file an earlier arm left at 0600
      const prev = process.umask(0o022);
      try { w.save(); } finally { process.umask(prev); }
      assert.equal(fs.statSync(w.file()).mode & 0o777, w.mode);
    });
  }
}

test('#5434 slice 23: musefront.keepModel flushes before its rename, stays 0600, and reaps only its own dead temps in the workspace', () => {
  const ws = fresh('ws');
  assert.equal(musefront.keepModel(ws, 'model-a'), true);
  const file = musefront.modelFile(ws);
  // pid 2147483646 is chosen because it cannot be live (a dead writer); do not change it to process.pid
  const mine = file + '.kosmos-2147483646-t0-1-1.tmp';
  const other = path.join(path.dirname(file), 'notes.json.kosmos-2147483646-t0-1-1.tmp');   // a file Kosmos does not own
  fs.writeFileSync(mine, 'x');
  fs.writeFileSync(other, 'x');
  const { events, out } = recording(() => musefront.keepModel(ws, 'model-b'));
  assert.equal(out, true);
  flushedBeforeRename(events, file);
  assert.equal(fs.readFileSync(file, 'utf8'), 'model-b\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(mine), false, 'the model file\'s own dead temp was not reaped');
  assert.equal(fs.existsSync(other), true, 'another file\'s temp was swept: a folder-wide sweep of the person\'s workspace');
});

test('#5434 slice 23: musefront.keepModel still answers false when the save fails', () => {
  const ws = fresh('ws');
  assert.equal(musefront.keepModel(ws, 'model-a'), true);
  const file = musefront.modelFile(ws);
  const { refused, out } = tempsRefused(file, () => musefront.keepModel(ws, 'model-c'));
  assert.ok(refused >= 1, 'the write did not fail, so this proves nothing');
  assert.equal(out, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'model-a\n', 'a failed save changed the file');
});

/* The source scan: every converted site now goes through a flushed save, and the only renameSync left in these files
   is a MOVE deliberately kept (filepreview: the PNG the renderer drew, moved into the cache). Comments are stripped
   first, so a comment naming renameSync or the helper cannot satisfy or break the count. */
const ROOT = path.join(__dirname, '..');
const EXPECTED = {
  'engine/accountnotify.js': { moves: 0, flushed: /saveFlushed\(/ },
  'engine/assigner.js': { moves: 0, flushed: /writeSecret\([^;]*0o600/ },
  'engine/catalogue.js': { moves: 0, flushed: /saveFlushed\(/ },
  'engine/messages.js': { moves: 0, flushed: /saveFlushed\(SEEN/ },
  'engine/communityfollow.js': { moves: 0, flushed: /saveFlushed\(/ },
  'engine/communitynudge.js': { moves: 0, flushed: /writeSecret\([^;]*0o600/ },
  'engine/communityread.js': { moves: 0, flushed: /saveFlushed\(/ },
  'engine/communityturn.js': { moves: 0, flushed: /saveFlushed\(/ },
  'engine/discover.js': { moves: 0, flushed: /saveFlushed\(reqPath/ },
  'engine/filepreview.js': { moves: 1, flushed: /writeSecret\([^;]*0o600/ },
  'engine/instructionreread.js': { moves: 0, flushed: /saveFlushed\(/ },
  'engine/musestatus.js': { moves: 0, flushed: /writeSecret\([^;]*0o600/ },
  'engine/musefront.js': { moves: 0, flushed: /ownTempsOnly: true/ },
  'engine/pagecontext.js': { moves: 0, flushed: /writeSecret\([^;]*0o600[^;]*ownTempsOnly: true/ },
  'engine/prompternudge.js': { moves: 0, flushed: /writeSecret\([^;]*0o600/ },
  'engine/replynudge.js': { moves: 0, flushed: /saveFlushed\(/ },
  'engine/stuckterminal.js': { moves: 0, flushed: /saveFlushed\(/ },
};
// review 2: a file with two owner-only saves must keep BOTH on writeSecret (one regex match would pass with one left).
const OWNER_ONLY_SITES = { 'engine/communitynudge.js': 2 };
for (const [rel, n] of Object.entries(OWNER_ONLY_SITES)) {
  test('#5434 slice 23: ' + rel + ' keeps all ' + n + ' owner-only saves on writeSecret', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.equal((src.match(/writeSecret\([^;]*0o600/g) || []).length, n);
    assert.doesNotMatch(src, /saveFlushed\(/);
  });
}

for (const [rel, want] of Object.entries(EXPECTED)) {
  test('#5434 slice 23: ' + rel + ' saves through a flushed write and keeps exactly ' + want.moves + ' move(s)', () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.match(src, want.flushed, 'the flushed save is not there');
    assert.equal((src.match(/renameSync\(/g) || []).length, want.moves, 'an unflushed rename is back, or a deliberate move went');
  });
}
test('#5434 slice 23: discover.js saves its declines and its dismiss snapshot flushed, and catalogue.js its portraits', () => {
  const strip = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const d = strip('engine/discover.js');
  assert.equal((d.match(/saveFlushed\(DECLINED_FILE/g) || []).length, 2, 'decline and undecline are not both flushed');
  assert.match(d, /saveFlushed\(DISMISS_FILE/);
  assert.match(strip('engine/catalogue.js'), /saveFlushed\(file, bytes\)/, 'the portrait is not saved flushed');
});
test('#5434 slice 23: server.js saves seen-version.json flushed, with no temp of its own', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.match(src, /store\.saveFlushed\(path\.join\(store\.ROOT, 'seen-version\.json'\)/);
  assert.doesNotMatch(src, /seen-version\.json\.tmp/, 'the old fixed temp is still there');
});

test('#5434 communitynudge: the follows record is exactly 0600 even under umask 0 (review 1: a measured mode, not a scan)', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  const nudge = require('./communitynudge');
  const prev = process.umask(0);
  let ok;
  try { ok = nudge.noteFollowed('agent-mode', 'someone'); } finally { process.umask(prev); }
  assert.notEqual(ok, false, 'the follow was not recorded');
  assert.equal(fs.statSync(nudge.followsFile()).mode & 0o777, 0o600);
});
