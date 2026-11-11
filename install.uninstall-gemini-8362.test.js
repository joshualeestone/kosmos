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
const { execFileSync } = require('node:child_process');

const SETUP = path.join(__dirname, 'install', 'setup.sh');
const gs = require('./engine/geminisettings');
const ENGINE_FILES = ['geminisettings.js', 'securewrite.js', 'filelock.js'];   // what the undo loads from the installed engine

let tmpRoot;
test.before(() => { tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gemundo8362-'))); });
test.after(() => { if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true }); });

const BRIDGE = '/opt/kosmos-elsewhere/bin/gemini-report-bridge.js';

function sandbox({ noEngine = false, record = true } = {}) {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'sb-'));
  const kh = path.join(root, 'kosmos-home');
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(kh, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(kh, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(kh, 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(kh, 'runtime', 'bin', 'node'));
  if (!noEngine) for (const f of ENGINE_FILES) fs.copyFileSync(path.join(__dirname, 'engine', f), path.join(kh, 'app', 'engine', f));
  fs.writeFileSync(path.join(kh, 'bin', 'kosmos'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(kh, 'VERSION'), '0.0.0\n');

  // The data folder the uninstall resolves with no store.js to ask: AGENT_WORKFORCE_DATA/Kosmos.
  const ledger = path.join(data, 'Kosmos', gs.WROTE_FILE);
  const opts = { platform: process.platform === 'win32' ? 'darwin' : process.platform, ...(record ? { wroteLedger: ledger } : {}) };
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

function runUninstall(sb) {
  try {
    return execFileSync('bash', [SETUP, '--uninstall'], {
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
      },
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

test('#8362: a re-run after the folder is already gone names the record', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  fs.rmSync(sb.kh, { recursive: true, force: true });
  const out = runUninstall(sb);
  assert.ok(out.includes(sb.ledger), 'the record was not named when nothing could undo it: ' + out.slice(-600));
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
  const step = s.indexOf('gemini_settings_undo "$_support"', deleting);
  const rm = s.indexOf('rm -rf "$KOSMOS_HOME"', deleting);
  assert.ok(deleting > 0 && step > 0 && rm > 0, 'a landmark is gone from setup.sh');
  assert.ok(step < rm, 'the Gemini step runs after the home (and its node) is deleted');
});
