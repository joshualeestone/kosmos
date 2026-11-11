'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
/* kosmos#8377: the Windows uninstall puts back the Gemini settings Kosmos filled in (#8376's record), as setup.sh does. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gs = require('./geminisettings');
const uninstaller = require('./win32uninstall');

function sandbox() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wingemundo-')));
  const env = { AGENT_WORKFORCE_DATA: path.join(dir, 'data') };
  const home = path.join(dir, 'home');
  const settings = path.join(home, '.gemini', 'settings.json');
  const rec = path.join(dir, 'data', 'Kosmos', gs.WROTE_FILE);
  return { dir, home, env, settings, rec };
}
const write = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const WROTE = { 'security.auth.selectedType': 'gemini-api-key', 'general.enableAutoUpdateNotification': false, 'general.enableAutoUpdate': false };

test('kosmos#8377: the values Kosmos filled in go back, a value the person changed stays and is said, the report says what it did', () => {
  const sb = sandbox();
  write(sb.settings, { theme: 'Dracula', security: { auth: { selectedType: 'gemini-api-key' } }, general: { enableAutoUpdateNotification: false, enableAutoUpdate: true } });
  write(sb.rec, { files: { [sb.settings]: WROTE } });
  const done = []; const notes = [];
  uninstaller._undoGeminiWrites(sb.rec, done, notes);
  const after = read(sb.settings);
  assert.equal(after.theme, 'Dracula', "the person's own setting stays");
  assert.equal(after.security && after.security.auth && after.security.auth.selectedType, undefined, 'the sign-in Kosmos set is gone');
  assert.equal(after.general.enableAutoUpdate, true, 'the value the person changed is kept');
  assert.ok(done.some((d) => d.includes('put back the Gemini settings') && d.includes(sb.settings)), JSON.stringify(done));
  assert.ok(notes.some((n) => n.startsWith('general.enableAutoUpdate in ' + sb.settings)), JSON.stringify(notes));
  assert.equal(fs.existsSync(sb.rec), false, 'the record was not used up, so the note would repeat on every later run');
});

test('kosmos#8377: no record means nothing to do and nothing said (CONTROL: the same settings stay untouched)', () => {
  const sb = sandbox();
  const before = { security: { auth: { selectedType: 'gemini-api-key' } } };
  write(sb.settings, before);
  const done = []; const notes = [];
  uninstaller._undoGeminiWrites(sb.rec, done, notes);
  assert.deepEqual(read(sb.settings), before);
  assert.deepEqual([done, notes], [[], []]);
});

test('kosmos#8377: a record that cannot be read is said, and the settings stay', () => {
  const sb = sandbox();
  const before = { security: { auth: { selectedType: 'gemini-api-key' } } };
  write(sb.settings, before);
  fs.mkdirSync(path.dirname(sb.rec), { recursive: true });
  fs.writeFileSync(sb.rec, 'not json');
  const done = []; const notes = [];
  uninstaller._undoGeminiWrites(sb.rec, done, notes);
  assert.deepEqual(read(sb.settings), before);
  assert.deepEqual(done, []);
  assert.ok(notes.some((n) => n.includes('were not put back') && n.includes(sb.rec)), JSON.stringify(notes));
});

test('kosmos#8377: a file it could not finish is a note, as on the Mac, never a leftover a rerun cannot clear', () => {
  const sb = sandbox();
  write(sb.settings, []);   // not a settings object: no rerun can fix this, so LEFT would fail every uninstall for good
  write(sb.rec, { files: { [sb.settings]: WROTE } });
  const done = []; const notes = [];
  uninstaller._undoGeminiWrites(sb.rec, done, notes);
  assert.ok(notes.some((n) => n.includes(sb.settings) && n.includes('could not be finished') && n.includes('the list of what Kosmos filled in is in ' + sb.rec)), JSON.stringify(notes));
});

test('kosmos#8377: a record that still holds something stays on disk, so the report can point at it', () => {
  const sb = sandbox();
  write(sb.settings, []);
  write(sb.rec, { files: { [sb.settings]: WROTE } });
  uninstaller._undoGeminiWrites(sb.rec, [], []);
  assert.ok(fs.existsSync(sb.rec), 'the record went, so "the list is in" would point at nothing');
});

test('kosmos#8377: the records are the data folder\'s and every named Kosmos\'s, where create.js writes them', { skip: process.platform !== 'win32' && 'a win32 data path is not absolute off Windows; the Windows CI job runs it' }, () => {
  const store = require('./store');
  const worlds = require('./worlds');
  const sb = sandbox();
  const base = store.dataRootFor('win32', sb.home, sb.env);
  assert.equal(base, path.dirname(sb.rec));
  const named = worlds.worldBaseDir(base, { id: 'k2' });
  fs.mkdirSync(named, { recursive: true });
  const namedRec = path.join(store.dataRootFor('win32', sb.home, Object.assign({}, sb.env, worlds.envOverridesFor(base, { id: 'k2' }))), gs.WROTE_FILE);
  assert.ok(namedRec.startsWith(named), namedRec);
  assert.deepEqual(uninstaller._geminiWroteRecords(sb.home, sb.env), [sb.rec, namedRec]);
  // A real install sets no AGENT_WORKFORCE_DATA: the record is under %APPDATA%\\Kosmos.
  const appdata = path.join(sb.dir, 'Roaming');
  assert.equal(uninstaller._geminiWroteRecords(sb.home, { APPDATA: appdata })[0], path.join(appdata, 'Kosmos', gs.WROTE_FILE));
});

test('kosmos#8377: two records naming the same file give one line, not one per Kosmos', () => {
  const sb = sandbox();
  write(sb.settings, []);
  const other = path.join(path.dirname(sb.rec), 'worlds', 'k2', 'Kosmos', gs.WROTE_FILE);
  write(sb.rec, { files: { [sb.settings]: WROTE } });
  write(other, { files: { [sb.settings]: WROTE } });
  const notes = [];
  uninstaller._undoGeminiWrites(sb.rec, [], notes);
  uninstaller._undoGeminiWrites(other, [], notes);
  assert.equal(notes.filter((n) => n.includes(sb.settings)).length, 2, 'CONTROL: each record names its own list: ' + JSON.stringify(notes));
  const kept = sandbox();
  write(kept.settings, { general: { enableAutoUpdate: true } });
  const k2 = path.join(path.dirname(kept.rec), 'worlds', 'k2', 'Kosmos', gs.WROTE_FILE);
  write(kept.rec, { files: { [kept.settings]: { 'general.enableAutoUpdate': false } } });
  write(k2, { files: { [kept.settings]: { 'general.enableAutoUpdate': false } } });
  const n2 = [];
  uninstaller._undoGeminiWrites(kept.rec, [], n2);
  uninstaller._undoGeminiWrites(k2, [], n2);
  assert.equal(n2.length, 1, JSON.stringify(n2));
});

test('kosmos#8377: the --delete-data deletion keeps a FILE in its keep list, with no failure, and still deletes the rest', () => {
  const sb = sandbox();
  const data = path.dirname(sb.rec);
  const nested = path.join(data, 'worlds', 'k2', 'Kosmos', gs.WROTE_FILE);
  const gone = path.join(data, 'profiles.json');
  const goneNested = path.join(data, 'worlds', 'k2', 'Kosmos', 'profiles.json');
  for (const f of [sb.rec, nested, gone, goneNested]) write(f, {});
  const failures = uninstaller._deleteAllExcept(data, [sb.rec, nested], (p) => fs.rmSync(p, { recursive: true, force: true }));
  assert.deepEqual(failures, []);
  assert.ok(fs.existsSync(sb.rec) && fs.existsSync(nested), 'a kept record went');
  assert.ok(!fs.existsSync(gone) && !fs.existsSync(goneNested), 'CONTROL: the rest was not deleted');
});

test('kosmos#8377: a record that is a link to nothing is no list, so nothing is reported (the keep filter in uninstall() uses the same existsSync; not driven here)', { skip: process.platform === 'win32' && 'a file symlink needs a privilege on Windows' }, () => {
  const sb = sandbox();
  fs.mkdirSync(path.dirname(sb.rec), { recursive: true });
  fs.symlinkSync(path.join(path.dirname(sb.rec), 'nowhere.json'), sb.rec);
  const done = []; const notes = [];
  uninstaller._undoGeminiWrites(sb.rec, done, notes);
  assert.deepEqual([done, notes], [[], []]);
});

test('kosmos#8377: a busy list is said in plain words, not the lock\'s own', () => {
  const filelock = require('./filelock');
  const sb = sandbox();
  write(sb.settings, { security: { auth: { selectedType: 'gemini-api-key' } } });
  write(sb.rec, { files: { [sb.settings]: WROTE } });
  const notes = [];
  const prev = process.env.AGENT_WORKFORCE_LOCK_MS;
  process.env.AGENT_WORKFORCE_LOCK_MS = '50';
  try {
    const held = filelock.withFileLock(sb.rec, () => { uninstaller._undoGeminiWrites(sb.rec, [], notes); return true; });
    assert.ok(held.ok, 'CONTROL: the test could not hold the lock itself');
  } finally { if (prev === undefined) delete process.env.AGENT_WORKFORCE_LOCK_MS; else process.env.AGENT_WORKFORCE_LOCK_MS = prev; }
  assert.equal(notes.length, 1, JSON.stringify(notes));
  assert.ok(notes[0].includes('another program was using the list') && !/\bwe\b|writer/.test(notes[0]), notes[0]);
});
