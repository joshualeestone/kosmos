'use strict';

/* #8362: geminisettings records the values it fills into a Gemini settings file (where the person had none), and
   undoWrites takes back out only a value that is still exactly the one recorded.

   🛑 THE CONTROLS ARE THE POINT. Deleting the three keys whenever they exist would pass "ours is gone", so every
   undo arm also asserts what must stay: a value the person changed, the person's own keys, the hooks, and a file
   that cannot be read. */

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { skipOnWin32 } = require('../test-support/skip-on-win32');
const NO_POSIX_MODES = skipOnWin32('it checks POSIX file modes, which Windows does not keep');   // kosmos#8378
/* kosmos#9269: the unreachable-folder arm takes a folder away with chmod 0o000, which Windows does not enforce (it only
   marks it read-only). There the same EACCES is forced through the fs calls instead, for paths inside that folder only
   (and listing or opening the folder itself), everything else untouched: fs.realpathSync is the one the undo reaches.
   KOSMOS_TEST_CHMOD_STUB=1 runs the stub arm on a Mac or Linux. */
const CHMOD_VIA_STUB = process.platform === 'win32' || process.env.KOSMOS_TEST_CHMOD_STUB === '1';
function denyFolder(dir) {
  const d = path.resolve(dir);
  const SELF = new Set(['openSync', 'readFileSync', 'readdirSync']);   // the folder's own lstat and stat still work
  const names = [['realpathSync', 'lstat'], ['lstatSync', 'lstat'], ['statSync', 'stat'], ['existsSync', 'access'],
    ['openSync', 'open'], ['readFileSync', 'open'], ['readdirSync', 'scandir']];
  const real = {};
  for (const [name, syscall] of names) {
    real[name] = fs[name];
    const wrapped = function (p, ...rest) {
      const r = typeof p === 'string' ? path.resolve(p) : null;
      if (r && (r.startsWith(d + path.sep) || (r === d && SELF.has(name)))) {
        if (name === 'existsSync') return false;
        throw Object.assign(new Error(`EACCES: permission denied, ${syscall} '${p}'`), { code: 'EACCES', syscall, path: p });
      }
      return real[name].call(this, p, ...rest);
    };
    if (real[name].native) wrapped.native = real[name].native;
    fs[name] = wrapped;
  }
  return () => { for (const name of Object.keys(real)) fs[name] = real[name]; };
}

const gs = require('./geminisettings');

const BRIDGE = '/opt/kosmos/app/bin/gemini-report-bridge.js';
const POSIX = { platform: 'darwin' };

function sandbox() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gemwrote-')));
  const file = path.join(dir, 'home', '.gemini', 'settings.json');
  const ledger = path.join(dir, 'data', gs.WROTE_FILE);
  return { dir, file, ledger, opts: { ...POSIX, wroteLedger: ledger } };
}
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n'); };

test('a fresh file: the three values written are recorded, under the file, with the values written', () => {
  const sb = sandbox();
  const r = gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  assert.equal(r.prepared, true);
  assert.equal(r.recorded, true);
  assert.deepEqual(readJSON(sb.ledger), { files: { [sb.file]: {
    'security.auth.selectedType': 'gemini-api-key', 'general.enableAutoUpdateNotification': false, 'general.enableAutoUpdate': false,
  } } });
  if (!NO_POSIX_MODES) assert.equal(fs.statSync(sb.ledger).mode & 0o777, 0o600);
});

test('only what this call wrote is recorded: a value the person chose is not', () => {
  const sb = sandbox();
  write(sb.file, { security: { auth: { selectedType: 'oauth-personal' } }, general: { enableAutoUpdateNotification: true } });
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  // Their check stays theirs, the install is switched off (geminisettings' rule), and only that is recorded.
  assert.deepEqual(readJSON(sb.ledger).files[sb.file], { 'general.enableAutoUpdate': false });
});

test('nothing written, nothing recorded; a second run leaves the record as it was', () => {
  const sb = sandbox();
  write(sb.file, { security: { auth: { selectedType: 'oauth-personal' } }, general: { enableAutoUpdate: true } });
  const r = gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  assert.equal(r.changed, true, 'control: the hooks were added, so the file was saved');
  assert.equal(fs.existsSync(sb.ledger), false, 'a save that filled in none of the three values made a record');

  const sb2 = sandbox();
  gs.ensurePrepared(sb2.file, BRIDGE, sb2.opts);
  const first = fs.readFileSync(sb2.ledger, 'utf8');
  gs.ensurePrepared(sb2.file, BRIDGE, sb2.opts);
  assert.equal(fs.readFileSync(sb2.ledger, 'utf8'), first);
});

test('without a record path nothing is recorded (the call as it was before)', () => {
  const sb = sandbox();
  const r = gs.ensurePrepared(sb.file, BRIDGE, POSIX);
  assert.equal(r.recorded, undefined);
  assert.equal(fs.existsSync(path.dirname(sb.ledger)), false);
});

test('two files share one record', () => {
  const sb = sandbox();
  const other = path.join(sb.dir, 'home', '.gemini-work', '.gemini', 'settings.json');
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  gs.ensurePrepared(other, BRIDGE, sb.opts);
  assert.deepEqual(Object.keys(readJSON(sb.ledger).files).sort(), [other, sb.file].sort());
});

test('undo: the recorded values come out, everything else stays, and the record is removed', () => {
  const sb = sandbox();
  write(sb.file, { theme: 'Dracula', general: { vimMode: true } });
  fs.chmodSync(sb.file, 0o640);
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  const hooksBefore = readJSON(sb.file).hooks;
  const r = gs.undoWrites(sb.ledger);
  assert.deepEqual(r, { done: true, restored: [sb.file], kept: [], left: [] });
  const s = readJSON(sb.file);
  assert.equal(s.theme, 'Dracula');
  assert.deepEqual(s.general, { vimMode: true }, 'the person\'s own general setting went, or ours stayed');
  assert.equal(s.security, undefined, 'the security object Kosmos created (and emptied) was left');
  assert.deepEqual(s.hooks, hooksBefore, 'the hooks are not this undo\'s to touch');
  if (!NO_POSIX_MODES) assert.equal(fs.statSync(sb.file).mode & 0o777, 0o640, 'the file\'s mode changed');
  assert.equal(fs.existsSync(sb.ledger), false, 'a record with nothing left in it was kept');
});

test('undo: a value the person changed since stays, and is named; the rest still comes out', () => {
  const sb = sandbox();
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  const s0 = readJSON(sb.file);
  s0.security.auth.selectedType = 'oauth-personal';          // they signed in their own way afterwards
  write(sb.file, s0);
  const r = gs.undoWrites(sb.ledger);
  assert.deepEqual(r.kept, [{ file: sb.file, key: 'security.auth.selectedType' }]);
  assert.deepEqual(r.restored, [sb.file]);
  const s = readJSON(sb.file);
  assert.equal(s.security.auth.selectedType, 'oauth-personal');
  assert.equal(s.general, undefined);
});

test('undo: a value loose equality would match (0 == false) is not ours', () => {
  const sb = sandbox();
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  const s0 = readJSON(sb.file);
  s0.general.enableAutoUpdate = 0;
  write(sb.file, s0);
  gs.undoWrites(sb.ledger);
  assert.equal(readJSON(sb.file).general.enableAutoUpdate, 0);
});

test('undo: a file that cannot be read is left, named, and kept in the record for a later run', () => {
  const sb = sandbox();
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  const good = fs.readFileSync(sb.file, 'utf8');
  fs.writeFileSync(sb.file, good + 'not json');
  const r = gs.undoWrites(sb.ledger);
  assert.deepEqual(r, { done: true, restored: [], kept: [], left: [sb.file] });
  assert.equal(fs.readFileSync(sb.file, 'utf8'), good + 'not json', 'a file that could not be read was rewritten');
  assert.ok(readJSON(sb.ledger).files[sb.file], 'the record forgot a file it did not finish');
  fs.writeFileSync(sb.file, good);
  assert.deepEqual(gs.undoWrites(sb.ledger).restored, [sb.file], 'a later run did not finish it');
});

test('undo: a file the person emptied has nothing to undo, and is not named', () => {
  const sb = sandbox();
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  fs.writeFileSync(sb.file, '');
  assert.deepEqual(gs.undoWrites(sb.ledger), { done: true, restored: [], kept: [], left: [] });
  assert.equal(fs.readFileSync(sb.file, 'utf8'), '', 'an emptied file was written to');
  assert.equal(fs.existsSync(sb.ledger), false, 'the record kept a file with nothing of ours in it');
});

test('undo: a file that is gone has nothing to undo; no record at all is nothing to do', () => {
  const sb = sandbox();
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  fs.unlinkSync(sb.file);
  assert.deepEqual(gs.undoWrites(sb.ledger), { done: true, restored: [], kept: [], left: [] });
  assert.equal(fs.existsSync(sb.ledger), false);
  assert.deepEqual(gs.undoWrites(sb.ledger), { done: true, restored: [], kept: [], left: [] });
});

test('undo: a file that cannot be reached (not gone) is left, named, and kept in the record', { skip: !CHMOD_VIA_STUB && process.getuid && process.getuid() === 0 ? 'root reads every folder' : false }, () => {
  const sb = sandbox();
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  const folder = path.dirname(path.dirname(sb.file));
  const unblock = CHMOD_VIA_STUB ? denyFolder(folder) : (fs.chmodSync(folder, 0o000), null);   // kosmos#9269: realpathSync's EACCES on Windows
  let r;
  try { r = gs.undoWrites(sb.ledger); } finally { if (unblock) unblock(); else fs.chmodSync(folder, 0o755); }
  assert.deepEqual(r.left, [sb.file], 'a file that could not be reached was dropped as if it were gone');
  assert.ok(readJSON(sb.ledger).files[sb.file], 'the record forgot a file it could not reach');
  assert.equal(readJSON(sb.file).security.auth.selectedType, 'gemini-api-key');
});

test('undo: a save made by a running gemini between the read and the write is not overwritten', (t) => {
  const sb = sandbox();
  gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  const theirs = { ...readJSON(sb.file), ui: { theme: 'saved by gemini' } };
  // The undo reads the settings file twice; between the two, gemini saves it.
  const real = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, 'readFileSync', function (f, ...rest) {
    if (f === sb.file && ++reads === 2) fs.writeFileSync(sb.file, JSON.stringify(theirs, null, 2) + '\n');
    return real.call(this, f, ...rest);
  });
  const r = gs.undoWrites(sb.ledger);
  t.mock.restoreAll();
  assert.equal(reads, 2, 'control: the undo did not read the file twice, so the save was never placed between them');
  assert.deepEqual(r.left, [sb.file], 'a file changed under the undo was not named');
  assert.deepEqual(readJSON(sb.file), theirs, 'the save made between the read and the write was overwritten');
  assert.ok(readJSON(sb.ledger).files[sb.file], 'the record forgot a file it did not finish');
});

test('a record that is not a record is never replaced, by the writer or the undo', () => {
  const sb = sandbox();
  write(sb.ledger, ['not', 'a', 'record']);
  const r = gs.ensurePrepared(sb.file, BRIDGE, sb.opts);
  assert.equal(r.prepared, true, 'a bad record failed the preparation');
  assert.equal(r.recorded, false);
  const u = gs.undoWrites(sb.ledger);
  assert.equal(u.done, false);
  assert.match(u.because, /could not be read/);
  assert.deepEqual(readJSON(sb.ledger), ['not', 'a', 'record']);
  assert.equal(readJSON(sb.file).security.auth.selectedType, 'gemini-api-key', 'the undo touched a file with no record');
});
