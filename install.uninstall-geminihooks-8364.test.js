'use strict';

/**
 * #8364: the Mac/Linux uninstall takes Kosmos's report hooks out of the person's Gemini settings, and nothing else.
 *
 * A Gemini agent's hooks run the report bridge in the data folder's bin/, which the uninstall deletes, so a hook left
 * in would run a missing script every time the person uses gemini. The REAL `setup.sh --uninstall` runs here against a
 * sandboxed install (its own KOSMOS_HOME with a real node, its own HOME and data folder), with the hooks written by the
 * REAL geminisettings.ensurePrepared.
 *
 * 🛑 THE CONTROLS ARE THE POINT. Removing every gemini-report-bridge hook would pass "ours is gone", so every arm also
 * asserts that the person's own hook, a hook sharing our entry, another install's hooks, a lookalike path and the
 * person's other settings survive.
 *
 *   node --test install.uninstall-geminihooks-8364.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SETUP = path.join(__dirname, 'install', 'setup.sh');
const gs = require('./engine/geminisettings');

let tmpRoot;
test.before(() => { tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gemhooks8364-'))); });
test.after(() => { if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true }); });

const theirHook = { type: 'command', command: 'echo mine' };
const PLAT = { platform: 'darwin' };

function sandbox({ noNode = false, hangNode = false } = {}) {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'sb-'));
  const kh = path.join(root, 'kosmos-home');
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  const support = path.join(data, 'Kosmos');             // what the uninstall resolves with no store.js to ask
  fs.mkdirSync(path.join(kh, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(kh, 'bin'), { recursive: true });
  // kosmos#8388: a node that does not return in time (a settings file on a stalled mount). It ends by itself after 20 s,
  // so a red run (the bound gone) leaves nothing running long after the test.
  if (hangNode) fs.writeFileSync(path.join(kh, 'runtime', 'bin', 'node'), '#!/bin/sh\nexec sleep 20\n', { mode: 0o755 });
  else if (!noNode) fs.symlinkSync(process.execPath, path.join(kh, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(kh, 'bin', 'kosmos'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(kh, 'VERSION'), '0.0.0\n');
  const bridge = path.join(support, 'bin', 'gemini-report-bridge.js');
  fs.mkdirSync(path.dirname(bridge), { recursive: true });
  fs.writeFileSync(bridge, '');

  // The default account: the person's own settings and hook, then a Gemini agent's birth, then a hook of theirs that
  // shares one of our entries. 0640: a mode the save must keep.
  const mainFile = path.join(home, '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(mainFile), { recursive: true });
  fs.writeFileSync(mainFile, JSON.stringify({ ui: { theme: 'Dracula' }, hooks: { BeforeTool: [{ matcher: 'shell', hooks: [theirHook] }] } }, null, 2) + '\n');
  assert.equal(gs.ensurePrepared(mainFile, bridge, PLAT).prepared, true, 'control: the real writer did not wire the hooks');
  const main = JSON.parse(fs.readFileSync(mainFile, 'utf8'));
  main.hooks.AfterAgent[0].hooks.push({ type: 'command', command: 'say done' });
  // A hook of the person's that names our data folder's bin/ in one argument and the bridge's name in another: theirs.
  main.hooks.BeforeAgent.push({ hooks: [{ type: 'command', command: 'bash "' + path.join(path.dirname(bridge), 'my-own.sh') + '" --tag gemini-report-bridge' }] });
  // And one whose script merely starts with the bridge's name, in the same folder: also theirs.
  main.hooks.SessionEnd.push({ hooks: [{ type: 'command', command: 'node "' + bridge.replace(/\.js$/, '-mine.js') + '"' }] });
  fs.writeFileSync(mainFile, JSON.stringify(main, null, 2) + '\n');
  fs.chmodSync(mainFile, 0o640);

  // A named account, ours too.
  const workFile = path.join(home, '.gemini-work', '.gemini', 'settings.json');
  gs.ensurePrepared(workFile, bridge, PLAT);
  // A named account wired by ANOTHER install (another data folder), and one whose folder merely contains ours.
  const otherFile = path.join(home, '.gemini-other', '.gemini', 'settings.json');
  gs.ensurePrepared(otherFile, path.join(root, 'other-data', 'Kosmos', 'bin', 'gemini-report-bridge.js'), PLAT);
  const nestedFile = path.join(home, '.gemini-nested', '.gemini', 'settings.json');
  gs.ensurePrepared(nestedFile, path.join(root, 'n') + bridge, PLAT);
  // A named account whose file is not JSON but names our bridge: named, never rewritten.
  const brokenFile = path.join(home, '.gemini-broken', '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(brokenFile), { recursive: true });
  fs.writeFileSync(brokenFile, '{ "hooks": "node \\"' + bridge + '\\"\n');
  return { root, kh, home, data, support, bridge, mainFile, workFile, otherFile, nestedFile, brokenFile };
}

function runUninstall(sb, extra = {}, timeout = 0) {
  // The runner's own Gemini home override must never reach the uninstall: it would point it at a real file.
  const base = { ...process.env };
  delete base.AGENT_WORKFORCE_GEMINI_HOME;
  try {
    // /bin/sh, as a person runs it (`sh -s -- --uninstall`): on macOS that is bash in POSIX mode, where a command
    // substitution inherits set -e, which plain bash does not, so only /bin/sh shows a check that ends the uninstall.
    return execFileSync('/bin/sh', [SETUP, '--uninstall'], {
      encoding: 'utf8',
      env: {
        ...base,
        ...extra,
        HOME: sb.home,
        AGENT_WORKFORCE_HOME: sb.home,
        KOSMOS_HOME: sb.kh,
        AGENT_WORKFORCE_DATA: sb.data,
        AGENT_WORKFORCE_LAUNCH: path.join(sb.root, 'launch'),
        KOSMOS_APP_DIR: path.join(sb.root, 'apps'),
        KOSMOS_SYS_APP_DIR: path.join(sb.root, 'sysapps'),
      },
      ...(timeout ? { timeout } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return String((e.stdout || '') + (e.stderr || ''));
  }
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const names = (obj, needle) => JSON.stringify(obj).includes(needle);
const SKIP_OFF_POSIX = process.platform === 'darwin' || process.platform === 'linux' ? false : 'setup.sh is the macOS and Linux installer';

test('#8364: uninstall takes this install\'s Gemini hooks out and keeps everything else', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  assert.ok(names(read(sb.mainFile), sb.bridge), 'control: our hooks were never written');
  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));

  const main = read(sb.mainFile);
  assert.ok(!names(main, sb.bridge), 'a Kosmos hook was left in ~/.gemini/settings.json');
  assert.deepEqual(main.hooks.BeforeTool, [{ matcher: 'shell', hooks: [theirHook] }], 'the person\'s own hook was not kept as it was');
  assert.ok(names(main.hooks.BeforeAgent, 'my-own.sh'), 'a hook of the person\'s naming our folder and the bridge\'s name apart was taken for ours');
  assert.ok(names(main.hooks.SessionEnd, 'gemini-report-bridge-mine.js'), 'a script whose name merely starts with the bridge\'s was taken for ours');
  assert.deepEqual(main.hooks.AfterAgent, [{ hooks: [{ type: 'command', command: 'say done' }] }], 'a hook sharing our entry was not kept');
  assert.equal(main.hooks.SessionStart, undefined, 'an event left with nothing was kept as an empty list');
  assert.deepEqual(main.ui, { theme: 'Dracula' }, 'the person\'s own setting was lost');
  assert.equal(main.security.auth.selectedType, 'gemini-api-key', 'this step took out a setting; settings are #8362\'s, by record');
  assert.equal(fs.statSync(sb.mainFile).mode & 0o777, 0o640, 'the settings file lost its mode');

  assert.ok(!names(read(sb.workFile), 'gemini-report-bridge'), 'a Kosmos hook was left in a named account');
  assert.ok(names(read(sb.otherFile), path.join(sb.root, 'other-data')), 'ANOTHER install\'s hooks were removed');
  assert.ok(names(read(sb.nestedFile), path.join(sb.root, 'n') + sb.bridge), 'a path that merely contains ours matched: the match is not anchored');
  assert.ok(fs.readFileSync(sb.brokenFile, 'utf8').startsWith('{ "hooks": "node'), 'a file that is not JSON was rewritten');
  assert.match(out, /these Gemini CLI settings files still hold Kosmos's hooks/, 'the unreadable Gemini file was not named');
  assert.ok(out.includes(sb.brokenFile), 'the unreadable Gemini file was not named by its path');
  assert.doesNotMatch(out, /Claude settings files/, 'a Gemini file was named under Claude\'s sentence');
});

test('#8364: with no node, every Gemini file still pointing at this install\'s bridge is named', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ noNode: true });
  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.ok(names(read(sb.mainFile), sb.bridge), 'control: with no node the hooks should still be there');
  const notice = out.slice(out.indexOf('Gemini CLI settings files'));
  for (const f of [sb.mainFile, sb.workFile, sb.brokenFile]) assert.ok(notice.includes(f), f + ' was not named');
  for (const f of [sb.otherFile, sb.nestedFile]) assert.ok(!notice.includes(f), f + ' (not this install\'s) was named');
});

test('kosmos#8388: a node step stopped at its time limit names the Gemini settings and does not read them again', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ hangNode: true });
  const before = fs.readFileSync(sb.mainFile, 'utf8');
  const t0 = Date.now();
  const out = runUninstall(sb, { KOSMOS_UNINSTALL_NODE_SECONDS: '1' }, 15000);
  const took = Date.now() - t0;
  assert.ok(took < 6000, 'the uninstall waited ' + took + ' ms on a node that never returns (a slow runner gets room)');
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.equal(fs.readFileSync(sb.mainFile, 'utf8'), before, 'a Gemini file changed though the node step never ran');
  assert.ok(out.includes('the same goes for Gemini CLI') && out.includes(path.join(sb.support, 'bin')), 'the stop did not name the Gemini settings:\n' + out);
  // The fallback reads the files that may have stalled node, so after a stop it must not run.
  assert.doesNotMatch(out, /these Gemini CLI settings files still hold Kosmos's hooks/, 'the Gemini fallback ran after a stop:\n' + out);
});

test('#8364: with no node and no Gemini files at all, the uninstall still finishes', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ noNode: true });
  for (const d of fs.readdirSync(sb.home)) if (d === '.gemini' || d.startsWith('.gemini-')) fs.rmSync(path.join(sb.home, d), { recursive: true, force: true });
  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall stopped before removing the install (a failing check under set -e): ' + out.slice(-600));
  assert.doesNotMatch(out, /Gemini CLI settings files/, 'Gemini files were named though there are none');
});

test('#8364: a KOSMOS_HOME that is not an install is left alone, and the Gemini files are still named', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  fs.rmSync(path.join(sb.kh, 'bin'), { recursive: true, force: true });   // no bin/kosmos: not provably an install
  fs.rmSync(path.join(sb.kh, 'VERSION'), { force: true });
  const out = runUninstall(sb);
  assert.match(out, /does not look like a Kosmos install/, 'control: the folder was not taken for a non-install: ' + out.slice(-600));
  assert.ok(fs.existsSync(sb.kh), 'control: a folder that is not an install was deleted');
  assert.match(out, /these Gemini CLI settings files still hold Kosmos's hooks/, 'the Gemini hooks left pointing at the removed bridge were not named');
  assert.ok(out.includes(sb.mainFile), 'the default Gemini file was not named');
});

test('#8364: a re-run after the folder is already gone names the Gemini files it left', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  fs.rmSync(sb.kh, { recursive: true, force: true });
  const out = runUninstall(sb);
  assert.match(out, /these Gemini CLI settings files still hold Kosmos's hooks/, 'a re-run said nothing about the Gemini hooks');
  assert.ok(out.includes(sb.mainFile), 'the default Gemini file was not named');
  const notice = out.slice(out.indexOf('Gemini CLI settings files'));
  for (const f of [sb.otherFile, sb.nestedFile]) assert.ok(!notice.includes(f), f + ' (not this install\'s) was named');
});

test('#8364: AGENT_WORKFORCE_GEMINI_HOME names the default Gemini home the uninstall cleans', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  const overFile = path.join(sb.root, 'gemhome', 'settings.json');
  gs.ensurePrepared(overFile, sb.bridge, PLAT);
  assert.ok(names(read(overFile), sb.bridge), 'control: our hooks were never written to the override home');
  const before = fs.readFileSync(sb.mainFile, 'utf8');
  const out = runUninstall(sb, { AGENT_WORKFORCE_GEMINI_HOME: path.dirname(overFile) });
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.ok(!names(read(overFile), 'gemini-report-bridge'), 'a Kosmos hook was left in the override home');
  assert.equal(fs.readFileSync(sb.mainFile, 'utf8'), before, '~/.gemini was changed though the override names another home');
});

test('#8364: the Gemini hooks come out before the data folder\'s bin/ (their bridge) is removed', () => {
  const s = fs.readFileSync(SETUP, 'utf8');
  const step = s.indexOf("geminiIsOurs");
  const bin = s.indexOf('rm -rf "$_support/bin"');
  assert.ok(step > 0 && bin > 0, 'a landmark is gone from setup.sh');
  assert.ok(step < bin, 'the Gemini hooks are taken out after their bridge is deleted');
});
