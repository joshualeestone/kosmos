'use strict';

/**
 * #8362: the Mac/Linux uninstall takes back out of the person's Gemini settings the values Kosmos recorded filling in,
 * and only a value that is still exactly the one recorded.
 *
 * The REAL `setup.sh --uninstall` runs here against a sandboxed install (its own KOSMOS_HOME with a real node and the
 * real engine files the undo loads, its own HOME and data folder), so nothing outside the temporary folder is in reach.
 * The settings and the record are written by the REAL geminisettings.ensurePrepared, as an agent's birth writes them.
 *
 * 🛑 THE CONTROLS ARE THE POINT: a value the person changed, their own keys and the hooks must all survive, and an
 * uninstall with no record must say nothing about Gemini.
 *
 *   node --test install.uninstall-gemini-8362.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SETUP = path.join(__dirname, 'install', 'setup.sh');
const gs = require('./engine/geminisettings');
/* What the undo loads from the installed engine: geminisettings.js and every engine module it requires, followed, so a
   new require in any of them reaches the sandbox too (a hand list went stale when #8361 added hookpaths.js). */
function engineClosure(start) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const src = fs.readFileSync(path.join(__dirname, 'engine', name), 'utf8');
    for (const m of src.matchAll(/require\(\s*['"]\.\/([\w.-]+?)(?:\.js)?['"]\s*\)/g)) visit(m[1] + '.js');
  };
  visit(start);
  return [...seen];
}
const ENGINE_FILES = engineClosure('geminisettings.js');

let tmpRoot;
test.before(() => { tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gemundo8362-'))); });
test.after(() => { if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true }); });

const BRIDGE = '/opt/kosmos-elsewhere/bin/gemini-report-bridge.js';

test('control: the sandbox engine holds geminisettings and what it requires', () => {
  for (const f of ['geminisettings.js', 'securewrite.js', 'filelock.js', 'hookpaths.js']) assert.ok(ENGINE_FILES.includes(f), f + ' is not copied');
});

function sandbox({ noEngine = false, record = true, crashEngine = false, hangEngine = false } = {}) {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'sb-'));
  const kh = path.join(root, 'kosmos-home');
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(kh, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(kh, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(kh, 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(kh, 'runtime', 'bin', 'node'));
  if (!noEngine) for (const f of ENGINE_FILES) fs.copyFileSync(path.join(__dirname, 'engine', f), path.join(kh, 'app', 'engine', f));
  // An engine whose undo put one file back and then failed: the step stops before its done line.
  if (crashEngine) {
    fs.writeFileSync(path.join(kh, 'app', 'engine', 'geminisettings.js'),
      "module.exports = { undoWrites: () => ({ done: true, restored: ['/put/back/settings.json'], get kept() { throw new Error('stopped'); }, left: [] }) };\n");
  }
  // kosmos#8388: an undo that does not return in time (a settings file on a stalled mount). A busy loop, so TERM stops it;
  // it ends by itself after 20 s, so a red run (the bound gone) leaves no process spinning after the test (review 5 W1).
  if (hangEngine) fs.writeFileSync(path.join(kh, 'app', 'engine', 'geminisettings.js'), 'module.exports = { undoWrites: () => { const end = Date.now() + 20000; while (Date.now() < end) {} return { done: false, because: "too slow" }; } };\n');
  fs.writeFileSync(path.join(kh, 'bin', 'kosmos'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(kh, 'VERSION'), '0.0.0\n');

  // The data folder the uninstall resolves with no store.js to ask: AGENT_WORKFORCE_DATA/Kosmos.
  const ledger = path.join(data, 'Kosmos', gs.WROTE_FILE);
  const opts = { platform: 'darwin', ...(record ? { wroteLedger: ledger } : {}) };
  // The default account: the person's own theme, then a Gemini agent's birth.
  const mainFile = path.join(home, '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(mainFile), { recursive: true });
  fs.writeFileSync(mainFile, JSON.stringify({ ui: { theme: 'Dracula' } }, null, 2) + '\n');
  assert.equal(gs.ensurePrepared(mainFile, BRIDGE, opts).prepared, true, 'control: the real writer did not prepare the file');
  // A second account whose person signed in their own way after Kosmos set the type.
  const workFile = path.join(home, '.gemini-work', '.gemini', 'settings.json');
  gs.ensurePrepared(workFile, BRIDGE, opts);
  const w = JSON.parse(fs.readFileSync(workFile, 'utf8'));
  w.security.auth.selectedType = 'oauth-personal';
  fs.writeFileSync(workFile, JSON.stringify(w, null, 2) + '\n');
  return { root, kh, home, data, ledger, mainFile, workFile };
}

function runUninstall(sb, extraEnv = {}, timeout = 0) {
  try {
    // /bin/sh, as a person runs it (`sh -s -- --uninstall`): on macOS that is bash in POSIX mode, where a command
    // substitution inherits set -e, which plain bash does not.
    return execFileSync('/bin/sh', [SETUP, '--uninstall'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: sb.home,
        AGENT_WORKFORCE_HOME: sb.home,
        KOSMOS_HOME: sb.kh,
        AGENT_WORKFORCE_DATA: sb.data,
        AGENT_WORKFORCE_LAUNCH: path.join(sb.root, 'launch'),
        KOSMOS_APP_DIR: path.join(sb.root, 'apps'),
        KOSMOS_SYS_APP_DIR: path.join(sb.root, 'sysapps'),
        ...extraEnv,
      },
      ...(timeout ? { timeout } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return String((e.stdout || '') + (e.stderr || ''));
  }
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const SKIP_OFF_POSIX = process.platform === 'darwin' || process.platform === 'linux' ? false : 'setup.sh is the macOS and Linux installer';

test('#8362: uninstall puts back what Kosmos filled in, keeps what the person changed, and says both', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  const before = read(sb.mainFile);
  assert.equal(before.security.auth.selectedType, 'gemini-api-key', 'control: the auth type was never filled in');
  assert.equal(before.general.enableAutoUpdate, false, 'control: updates were never switched off');
  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));

  const main = read(sb.mainFile);
  assert.equal(main.security, undefined, 'the auth type Kosmos filled in was left');
  assert.equal(main.general, undefined, 'the update settings Kosmos filled in were left');
  assert.deepEqual(main.ui, { theme: 'Dracula' }, 'the person\'s own setting was lost');
  assert.deepEqual(main.hooks, before.hooks, 'the hooks were changed; they are not this step\'s');

  const work = read(sb.workFile);
  assert.equal(work.security.auth.selectedType, 'oauth-personal', 'a value the person changed was taken out');
  assert.equal(work.general, undefined, 'the update settings in the second account were left');

  assert.ok(out.includes('put back the Gemini settings Kosmos had filled in, in ' + sb.mainFile), 'the uninstall did not say what it put back');
  assert.ok(out.includes('security.auth.selectedType in ' + sb.workFile + ' was changed after Kosmos set it'), 'the kept value was not named');
  assert.equal(fs.existsSync(sb.ledger), false, 'the record was kept with nothing left in it');
});

test('#8362: with no engine to undo it, the files are left and the record is named', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ noEngine: true });
  const before = fs.readFileSync(sb.mainFile, 'utf8');
  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.equal(fs.readFileSync(sb.mainFile, 'utf8'), before, 'the file changed with no engine to change it');
  assert.ok(out.includes('could not') && out.includes(sb.ledger), 'the record was not named');
  assert.ok(fs.existsSync(sb.ledger), 'the record was lost');
});

test('#8362: an undo that stops partway says what it did, and that it did not finish', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ crashEngine: true });
  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.ok(out.includes('put back the Gemini settings Kosmos had filled in, in /put/back/settings.json'), 'what it did before stopping was not said');
  assert.ok(out.includes('could not') && out.includes('finish putting them back') && out.includes(sb.ledger), 'that it did not finish was not said');
});

test('kosmos#8388: a Gemini undo that never returns is stopped after its time limit, and the record is kept', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ hangEngine: true });
  const before = fs.readFileSync(sb.mainFile, 'utf8');
  const t0 = Date.now();
  const out = runUninstall(sb, { KOSMOS_UNINSTALL_NODE_SECONDS: '1' }, 15000);
  const took = Date.now() - t0;
  // Time first, so a hang reads as a hang and not as a missing removal step (review 5 NIT 2).
  assert.ok(took < 6000, 'the uninstall waited ' + took + ' ms on a Gemini undo that never returns (a slow runner gets room)');
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.ok(out.includes('putting back the Gemini settings Kosmos filled in did not finish in 1s and was stopped'), 'the stop was not said:\n' + out);
  // The node is gone, not abandoned (review 5 NIT 3): nothing still runs from this sandbox.
  const left = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.includes(sb.root));
  assert.deepEqual(left, [], 'a process from the sandbox is still running');
  assert.equal(fs.readFileSync(sb.mainFile, 'utf8'), before, 'the settings changed though the undo never ran');
  assert.ok(fs.existsSync(sb.ledger) && out.includes(sb.ledger), 'the record was lost or not named:\n' + out);
  assert.doesNotMatch(out, /Terminated|Killed/, 'the shell\'s own job line reached the person:\n' + out);
});

test('#8362: a re-run after the folder is already gone names the record', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  fs.rmSync(sb.kh, { recursive: true, force: true });
  const before = fs.readFileSync(sb.mainFile, 'utf8');
  const out = runUninstall(sb);
  assert.ok(out.includes(sb.ledger), 'the record was not named when nothing could undo it: ' + out.slice(-600));
  assert.equal(fs.readFileSync(sb.mainFile, 'utf8'), before, 'the file changed with nothing to change it');
  assert.match(out, /Kosmos is removed/, 'the uninstall stopped after the Gemini step instead of finishing');
});

test('#8362: with no record, the uninstall says nothing about Gemini and leaves the file alone', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ record: false });
  const before = fs.readFileSync(sb.mainFile, 'utf8');
  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.equal(fs.readFileSync(sb.mainFile, 'utf8'), before, 'a file with no record was changed');
  assert.doesNotMatch(out, /Gemini/, 'an uninstall with no record talked about Gemini');
});

test('#8362: the Gemini step runs before the home is deleted (it needs the bundled node)', () => {
  const s = fs.readFileSync(SETUP, 'utf8');
  const deleting = s.indexOf('info "deleting $KOSMOS_HOME"');
  const step = s.indexOf('gemini_settings_undo_all "$_support"', deleting);   // kosmos#8402: the step that undoes every Kosmos's record
  const rm = s.indexOf('rm -rf "$KOSMOS_HOME"', deleting);
  assert.ok(deleting > 0 && step > 0 && rm > 0, 'a landmark is gone from setup.sh');
  assert.ok(step < rm, 'the Gemini step runs after the home (and its node) is deleted');
});

test('kosmos#8402: a named Kosmos\'s record (its own data folder, worlds/<id>/Kosmos) is put back too', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  const store = require('./engine/store');
  const worlds = require('./engine/worlds');
  const base = path.join(sb.data, 'Kosmos');
  // Where create.js writes it in a named Kosmos: supportDir() under that board's env (worlds.envOverridesFor).
  const worldLedger = path.join(store.dataRootFor('darwin', sb.home, worlds.envOverridesFor(base, { id: 'k2' })), gs.WROTE_FILE);
  assert.equal(worldLedger, path.join(base, 'worlds', 'k2', 'Kosmos', gs.WROTE_FILE), 'control: the named Kosmos\'s record is not where this test expects');
  const k2File = path.join(sb.home, '.gemini-k2', '.gemini', 'settings.json');
  assert.equal(gs.ensurePrepared(k2File, BRIDGE, { platform: 'darwin', wroteLedger: worldLedger }).prepared, true, 'control: the real writer did not prepare the file');
  assert.equal(read(k2File).security.auth.selectedType, 'gemini-api-key', 'control: nothing was filled in');
  // A named Kosmos with no record: nothing is said for it.
  fs.mkdirSync(path.join(base, 'worlds', 'k3', 'Kosmos'), { recursive: true });
  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.equal(read(k2File).security, undefined, 'the named Kosmos\'s filled-in value was left');
  assert.ok(out.includes('put back the Gemini settings Kosmos had filled in, in ' + k2File), 'the uninstall did not say it: ' + out.slice(-800));
  assert.equal(fs.existsSync(worldLedger), false, 'the named Kosmos\'s record was kept with nothing left in it');
  assert.equal(read(sb.mainFile).security, undefined, 'CONTROL: the main record was not put back as before');
  assert.ok(!out.includes(path.join('worlds', 'k3')), 'a named Kosmos with no record was mentioned');
});

/* kosmos#8402: a named Kosmos's record, written where create.js writes it in that Kosmos, for the file given. */
function worldRecord(sb, id, file) {
  const store = require('./engine/store');
  const worlds = require('./engine/worlds');
  const ledger = path.join(store.dataRootFor('darwin', sb.home, worlds.envOverridesFor(path.join(sb.data, 'Kosmos'), { id })), gs.WROTE_FILE);
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  if (fs.existsSync(file)) fs.writeFileSync(ledger, JSON.stringify({ files: { [file]: { 'security.auth.selectedType': 'gemini-api-key' } } }) + '\n');
  else gs.ensurePrepared(file, BRIDGE, { platform: 'darwin', wroteLedger: ledger });
  return ledger;
}

test('kosmos#8402: once one record\'s undo is stopped, the other Kosmoses\' records are not tried, and that is said once', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ hangEngine: true });
  const l2 = worldRecord(sb, 'k2', sb.mainFile);
  const l3 = worldRecord(sb, 'k3', sb.mainFile);
  const t0 = Date.now();
  const out = runUninstall(sb, { KOSMOS_UNINSTALL_NODE_SECONDS: '1' }, 20000);
  const took = Date.now() - t0;
  assert.ok(took < 6000, 'the uninstall waited ' + took + ' ms');   // a hang guard only: the counts below are what catch a loop that tries every record
  assert.equal(out.split('did not finish in 1s').length - 1, 1, 'the stop was said more or less than once:\n' + out);
  assert.equal(out.split('were not put back either').length - 1, 1, 'the skipped records were not said once:\n' + out);
  assert.ok(fs.existsSync(l2) && fs.existsSync(l3), 'a record that was never tried was lost');
});

test('kosmos#8402: a line every record would say is said once', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  const w = read(sb.mainFile);
  w.security.auth.selectedType = 'oauth-personal';   // the person changed it, so each record keeps it and names it
  fs.writeFileSync(sb.mainFile, JSON.stringify(w, null, 2) + '\n');
  worldRecord(sb, 'k2', sb.mainFile);
  const out = runUninstall(sb);
  const line = 'security.auth.selectedType in ' + sb.mainFile + ' was changed after Kosmos set it';
  assert.ok(out.includes(line), 'CONTROL: the kept value was not named at all:\n' + out);
  assert.equal(out.split(line).length - 1, 1, 'the same line was said once per record:\n' + out);
});

test('kosmos#8402: a re-run after the folder is gone names each named Kosmos\'s record too, and skips a folder no board could have made', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  const l2 = worldRecord(sb, 'k2', path.join(sb.home, '.gemini-k2', '.gemini', 'settings.json'));
  const odd = path.join(sb.data, 'Kosmos', 'worlds', 'Not Clean', 'Kosmos', gs.WROTE_FILE);
  fs.mkdirSync(path.dirname(odd), { recursive: true });
  fs.copyFileSync(l2, odd);
  const upper = path.join(sb.data, 'Kosmos', 'worlds', 'NotClean', 'Kosmos', gs.WROTE_FILE);   // capitals: macOS sh's a-z matches them in a UTF-8 locale
  fs.mkdirSync(path.dirname(upper), { recursive: true });
  fs.copyFileSync(l2, upper);
  const dflt = path.join(sb.data, 'Kosmos', 'worlds', 'default', 'Kosmos', gs.WROTE_FILE);   // the main folder's own data, never a named Kosmos
  fs.mkdirSync(path.dirname(dflt), { recursive: true });
  fs.copyFileSync(l2, dflt);
  fs.rmSync(sb.kh, { recursive: true, force: true });
  const out = runUninstall(sb, { LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' });
  assert.ok(out.includes(sb.ledger), 'CONTROL: the main record was not named:\n' + out.slice(-800));
  assert.ok(out.includes(l2), 'the named Kosmos\'s record was not named on a re-run:\n' + out.slice(-800));
  assert.ok(!out.includes(odd), 'a folder name no board could have made was read:\n' + out.slice(-800));
  assert.ok(!out.includes(upper), 'a folder name with capitals was read:\n' + out.slice(-800));
  assert.equal(out.split('could not finish putting them back here').length - 1, 1, 'the opening line was said once per record:\n' + out.slice(-800));
  assert.ok(!out.includes(dflt), 'worlds/default was read as a named Kosmos:\n' + out.slice(-800));
  assert.match(out, /Kosmos is removed/, 'the uninstall stopped after the Gemini step instead of finishing');
});

test('kosmos#8402: a named Kosmos\'s record is put back when the main folder has none', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ record: false });
  const k2File = path.join(sb.home, '.gemini-k2', '.gemini', 'settings.json');
  const l2 = worldRecord(sb, 'k2', k2File);
  assert.equal(fs.existsSync(sb.ledger), false, 'CONTROL: the main folder has a record');
  const out = runUninstall(sb);
  assert.equal(read(k2File).security, undefined, 'the named Kosmos\'s value was left:\n' + out.slice(-800));
  assert.equal(fs.existsSync(l2), false, 'its record was kept with nothing left in it');
});
