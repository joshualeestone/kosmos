'use strict';

/**
 * #5998: the uninstall takes Kosmos's report hooks and status line back out of Claude Code's settings, and nothing else.
 *
 * Left in, every hook points at a script the uninstall deletes, so Claude Code reports a hook error on every tool call
 * from then on. The REAL `setup.sh --uninstall` runs here against a sandboxed install (its own KOSMOS_HOME with a real
 * node at runtime/bin/node, its own HOME), so nothing outside the temporary folder is in reach.
 *
 * 🛑 THE CONTROLS ARE THE POINT. Removing everything would pass "ours is gone", so every arm also asserts the person's
 * own hook, a hook that shared our entry, another Kosmos install's hooks, and unrelated settings survive.
 *
 *   node --test install.uninstall-unwire-5998.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SETUP = path.join(__dirname, 'install', 'setup.sh');
const reporthook = require('./engine/reporthook');
const allowance = require('./engine/allowance');

let tmpRoot;
// Resolved, as a real install's paths are (the engine writes its hook paths from its own realpath; on macOS /var is /private/var).
test.before(() => { tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'unwire5998-'))); });
test.after(() => { if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true }); });

const ourHook = (kh) => ({ type: 'command', command: 'bash "' + path.join(kh, 'app', 'bin', 'kosmos-report-hook.sh') + '"', timeout: 15 });
const theirHook = { type: 'command', command: 'echo mine', timeout: 5 };

/* A sandboxed install. linkHome: KOSMOS_HOME is a symlink to a differently named folder, and the hooks name the REAL
   path, as a real install writes them (hookScriptPath and stableNode resolve from the engine's own realpath).
   noNode: a partial install with no runtime, so nothing can edit the JSON and the leftover must be named. */
function sandbox({ linkHome = false, noNode = false, crashNode = false } = {}) {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'sb-'));
  const real = path.join(root, linkHome ? 'real-kosmos' : 'kosmos-home');
  const kh = path.join(root, 'kosmos-home');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(real, 'app', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(real, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(real, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(real, 'bin'), { recursive: true });
  if (linkHome) fs.symlinkSync(real, kh);
  if (crashNode) fs.writeFileSync(path.join(real, 'runtime', 'bin', 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  else if (!noNode) fs.symlinkSync(process.execPath, path.join(real, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(real, 'bin', 'kosmos'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(real, 'VERSION'), '0.0.0\n');
  const script = path.join(real, 'app', 'bin', 'kosmos-report-hook.sh');
  fs.writeFileSync(script, '#!/bin/sh\n');
  fs.writeFileSync(path.join(real, 'app', 'engine', 'kosmos-statusline.js'), '');

  // The default account, wired by the REAL writers, then the person's own hook beside ours and one sharing our entry.
  const mainFile = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(mainFile), { recursive: true });
  // 0664: a mode the umask would change, so keeping it proves the save restores the file's mode.
  fs.writeFileSync(mainFile, JSON.stringify({ skipDangerousModePermissionPrompt: true, model: 'opus' }) + '\n');
  fs.chmodSync(mainFile, 0o664);
  const wired = reporthook.ensureWired(mainFile, script, { platform: 'darwin' });
  assert.equal(wired.wired, true, 'control: the real writer did not wire the hooks: ' + JSON.stringify(wired));
  const sl = allowance.ensureStatusLine(mainFile, { platform: 'darwin', script: path.join(real, 'app', 'engine', 'kosmos-statusline.js'),
    node: path.join(real, 'runtime', 'bin', 'node') });
  assert.equal(sl.wired, true, 'control: the real writer did not add the status line: ' + JSON.stringify(sl));
  const main = JSON.parse(fs.readFileSync(mainFile, 'utf8'));
  main.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [theirHook] });
  main.hooks.Stop[0].hooks.push({ type: 'command', command: 'say done' });
  main.hooks.Unrelated = [];
  fs.writeFileSync(mainFile, JSON.stringify(main, null, 2) + '\n');
  fs.chmodSync(mainFile, 0o664);

  // A second account, through a symlink: ANOTHER Kosmos install's hooks (must stay) and this install's status line.
  const other = path.join(root, 'other-kosmos');
  const dot = path.join(root, 'dotfiles', 'acct-settings.json');
  fs.mkdirSync(path.dirname(dot), { recursive: true });
  // nested: an install whose folder path merely CONTAINS this one's (it must not match, the anchoring rule).
  const nested = path.join(root, 'n') + kh;
  fs.writeFileSync(dot, JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [ourHook(other)] }],
    SessionEnd: [{ matcher: '', hooks: [ourHook(nested)] }] }, statusLine: main.statusLine }, null, 2) + '\n');
  // A fourth account carrying only ANOTHER install's status line: it must stay.
  const otherStatus = { type: 'command', command: '"' + path.join(other, 'runtime', 'bin', 'node') + '" "' + path.join(other, 'app', 'engine', 'kosmos-statusline.js') + '"' };
  fs.mkdirSync(path.join(home, '.claude-other'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-other', 'settings.json'), JSON.stringify({ statusLine: otherStatus }, null, 2) + '\n');
  fs.mkdirSync(path.join(home, '.claude-work'), { recursive: true });
  fs.symlinkSync(dot, path.join(home, '.claude-work', 'settings.json'));

  // A fifth account that started with an empty hooks object and this install's status line: the {} is the person's.
  fs.mkdirSync(path.join(home, '.claude-empty'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-empty', 'settings.json'), JSON.stringify({ hooks: {}, statusLine: main.statusLine }, null, 2) + '\n');

  // A sixth account whose file is JSON but not an object, naming this install's hook: named, never rewritten.
  fs.mkdirSync(path.join(home, '.claude-arr'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-arr', 'settings.json'), JSON.stringify(['bash "' + script + '"']) + '\n');

  // A third account whose file is not JSON but names this install's hook: named, never rewritten.
  fs.mkdirSync(path.join(home, '.claude-broken'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-broken', 'settings.json'), '{ "hooks": "bash \\"' + script + '\\"\n');
  return { root, kh, real, home, other, nested, dot, mainFile, otherStatus };
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
        AGENT_WORKFORCE_DATA: path.join(sb.root, 'data'),
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
const mentions = (obj, needle) => JSON.stringify(obj).includes(needle);

const SKIP_OFF_POSIX = process.platform === 'darwin' || process.platform === 'linux' ? false : 'setup.sh is the macOS and Linux installer';

function checkCleaned(sb, out) {
  let gone = false;
  try { fs.lstatSync(sb.kh); } catch { gone = true; }   // the home as given (a symlink's rm removes the link)
  assert.ok(gone, 'the uninstall did not reach its removal step, so nothing below means anything: ' + out.slice(-600));
  const main = read(sb.mainFile);
  assert.ok(!mentions(main, 'kosmos-report-hook'), 'a Kosmos hook was left in ~/.claude/settings.json');
  assert.equal(main.statusLine, undefined, 'the Kosmos status line was left in ~/.claude/settings.json');
  assert.deepEqual(main.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [theirHook] }], 'the person\'s own hook was not kept as it was');
  assert.deepEqual(main.hooks.Stop, [{ matcher: '', hooks: [{ type: 'command', command: 'say done' }] }],
    'a hook that shared our entry was not kept');
  assert.equal(main.hooks.SessionStart, undefined, 'an event left with no entries was kept as an empty list');
  assert.deepEqual(main.hooks.Unrelated, [], 'an empty event that was never ours was removed');
  assert.equal(main.skipDangerousModePermissionPrompt, true, 'an unrelated setting was lost');
  assert.equal(main.model, 'opus', 'an unrelated setting was lost');
  assert.equal(fs.statSync(sb.mainFile).mode & 0o777, 0o664, 'the settings file lost its mode');
  assert.deepEqual(fs.readdirSync(path.dirname(sb.mainFile)).filter((f) => f.includes('kosmos-unwire')), [], 'a temp file was left beside the settings');

  const acct = path.join(sb.home, '.claude-work', 'settings.json');
  assert.ok(fs.lstatSync(acct).isSymbolicLink(), 'the symlinked settings file was replaced instead of written through');
  const acctData = read(sb.dot);
  assert.equal(acctData.statusLine, undefined, 'this install\'s status line was left in the second account');
  assert.ok(mentions(acctData, path.join(sb.other, 'app', 'bin', 'kosmos-report-hook.sh')),
    'ANOTHER Kosmos install\'s hook was removed: only this install\'s may go');
  assert.ok(mentions(acctData, path.join(sb.nested, 'app', 'bin', 'kosmos-report-hook.sh')),
    'an install whose folder path merely contains this one\'s was removed: the match is not anchored');
  assert.deepEqual(read(path.join(sb.home, '.claude-other', 'settings.json')).statusLine, sb.otherStatus,
    'ANOTHER install\'s status line was removed');
  const empty = read(path.join(sb.home, '.claude-empty', 'settings.json'));
  assert.equal(empty.statusLine, undefined, 'this install\'s status line was left beside an empty hooks object');
  assert.deepEqual(empty.hooks, {}, 'an empty hooks object that was never ours was removed');

  assert.ok(fs.readFileSync(path.join(sb.home, '.claude-broken', 'settings.json'), 'utf8').startsWith('{ "hooks": "bash'),
    'a settings file that is not JSON was rewritten');
  assert.match(out, /could not be taken out of these Claude settings files/, 'the unreadable file was not named');
  assert.match(out, /\.claude-broken\/settings\.json/, 'the unreadable file was not named by its path');
  assert.match(out, /\.claude-arr\/settings\.json/, 'a settings file that is JSON but not an object was not named');
}

test('#5998: uninstall removes this install\'s hooks and status line and keeps everything else', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  assert.ok(mentions(read(sb.mainFile), path.join(sb.real, 'app', 'bin')), 'control: our hooks were never seeded');
  checkCleaned(sb, runUninstall(sb));
});

test('#5998: an install reached through a symlink, whose hooks name the real folder, is cleaned too', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ linkHome: true });
  assert.ok(!mentions(read(sb.mainFile), sb.kh + '/'), 'control: the hooks name the link, so the realpath arm is not exercised');
  checkCleaned(sb, runUninstall(sb));
});

function checkNamed(sb, out, what) {
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step: ' + out.slice(-600));
  assert.ok(mentions(read(sb.mainFile), 'kosmos-report-hook'), 'control: ' + what + ', so the hooks should still be there');
  assert.match(out, /could not be taken out of these Claude settings files/, 'the leftover hooks were not named (' + what + ')');
  assert.ok(out.includes(sb.mainFile), 'the default settings file was not named (' + what + ')');
  // Only the hooks notice: the later status-line notice rightly names .claude-work (it holds this install's status line).
  const notice = out.slice(out.indexOf('could not be taken out'), out.indexOf('status line is still') === -1 ? undefined : out.indexOf('status line is still'));
  assert.ok(!notice.includes(path.join(sb.home, '.claude-work', 'settings.json')),
    'a file holding only another install\'s hooks was named for this install');
}

test('#5998: with no node to edit the settings, every file still pointing at this install is named', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ noNode: true });
  checkNamed(sb, runUninstall(sb), 'no node');
});

test('#5998: a node that fails partway is not taken as done: the files are named', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ crashNode: true });
  checkNamed(sb, runUninstall(sb), 'a failing node');
});

test('#5998: with no node, an install reached through a symlink is matched by its real folder', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ linkHome: true, noNode: true });
  checkNamed(sb, runUninstall(sb), 'no node, symlinked home');
});

test('#5998: with no node, a symlinked install\'s notice names the real folder the hooks were written with', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox({ linkHome: true, noNode: true });
  const out = runUninstall(sb);
  assert.ok(out.includes('also written as ' + sb.real), 'the notice names only the link, which the hooks in the file never mention');
});

test('#5998: an uninstall run again after an older one removed the folder names the hooks it left', { skip: SKIP_OFF_POSIX }, () => {
  const sb = sandbox();
  fs.rmSync(sb.real, { recursive: true, force: true });   // what an uninstall from before #5998 left: no folder, hooks still wired
  assert.ok(mentions(read(sb.mainFile), path.join(sb.real, 'app', 'bin', 'kosmos-report-hook.sh')), 'control: the hooks are still there');
  const out = runUninstall(sb);
  assert.match(out, /could not be taken out of these Claude settings files/, 'a re-run said nothing about the hooks the old uninstall left');
  assert.ok(out.includes(sb.mainFile), 'the default settings file was not named');
  const notice = out.slice(out.indexOf('could not be taken out'), out.indexOf('status line is still') === -1 ? undefined : out.indexOf('status line is still'));
  assert.ok(!notice.includes(path.join(sb.home, '.claude-work', 'settings.json')), 'a file holding only another install\'s hooks was named');
});

test('#5998: the unwire step runs inside the proven-install branch, before the home is deleted', () => {
  const s = fs.readFileSync(SETUP, 'utf8');
  const step = s.indexOf("<<'UNWIREEOF'");
  const deleting = s.indexOf('info "deleting $KOSMOS_HOME"');
  const rm = s.indexOf('rm -rf "$KOSMOS_HOME"', deleting);
  assert.ok(step > 0 && deleting > 0 && rm > 0, 'a landmark is gone from setup.sh');
  assert.ok(deleting < step && step < rm, 'the unwire step is not between the install check and the removal of the home');
});
