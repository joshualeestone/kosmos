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
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'SessionStart'];

let tmpRoot;
test.before(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unwire5998-')); });
test.after(() => { if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true }); });

const ourHook = (kh) => ({ type: 'command', command: 'bash "' + path.join(kh, 'app', 'bin', 'kosmos-report-hook.sh') + '"', timeout: 15 });
const theirHook = { type: 'command', command: 'echo mine', timeout: 5 };

function sandbox() {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'sb-'));
  const kh = path.join(root, 'kosmos-home');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(kh, 'app', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(kh, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(kh, 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(kh, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(kh, 'bin', 'kosmos'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(kh, 'VERSION'), '0.0.0\n');
  fs.writeFileSync(path.join(kh, 'app', 'bin', 'kosmos-report-hook.sh'), '#!/bin/sh\n');
  const ourStatus = { type: 'command', command: '"' + path.join(kh, 'runtime', 'bin', 'node') + '" "' + path.join(kh, 'app', 'engine', 'kosmos-statusline.js') + '" "' + path.join(home, '.claude') + '"' };

  // The default account: all seven of ours, the person's own hook beside one, a hook that shares our entry, our status line.
  const hooks = {};
  for (const e of EVENTS) hooks[e] = [{ matcher: '', hooks: [ourHook(kh)] }];
  hooks.PreToolUse.push({ matcher: 'Bash', hooks: [theirHook] });
  hooks.Stop = [{ matcher: '', hooks: [ourHook(kh), { type: 'command', command: 'say done' }] }];
  const main = { skipDangerousModePermissionPrompt: true, model: 'opus', hooks, statusLine: ourStatus };
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(main, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(path.join(home, '.claude', 'settings.json'), 0o600);

  // A second account, through a symlink: ANOTHER Kosmos install's hooks (must stay) and this install's status line.
  const other = path.join(root, 'other-kosmos');
  const real = path.join(root, 'dotfiles', 'acct-settings.json');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [ourHook(other)] }] }, statusLine: ourStatus }, null, 2) + '\n');
  fs.mkdirSync(path.join(home, '.claude-work'), { recursive: true });
  fs.symlinkSync(real, path.join(home, '.claude-work', 'settings.json'));

  // A third account whose file is not JSON but carries our marker: named, never rewritten.
  fs.mkdirSync(path.join(home, '.claude-broken'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-broken', 'settings.json'), '{ "hooks": kosmos-report-hook\n');
  return { root, kh, home, other, real };
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

test('#5998: uninstall removes this install\'s hooks and status line and keeps everything else', { skip: process.platform === 'darwin' || process.platform === 'linux' ? false : 'setup.sh is the macOS and Linux installer' }, () => {
  const sb = sandbox();
  const mainFile = path.join(sb.home, '.claude', 'settings.json');
  assert.ok(mentions(read(mainFile), path.join(sb.kh, 'app', 'bin')), 'control: our hooks were never seeded');

  const out = runUninstall(sb);
  assert.ok(!fs.existsSync(sb.kh), 'the uninstall did not reach its removal step, so nothing below means anything: ' + out.slice(-600));

  const main = read(mainFile);
  assert.ok(!mentions(main, 'kosmos-report-hook'), 'a Kosmos hook was left in ~/.claude/settings.json');
  assert.equal(main.statusLine, undefined, 'the Kosmos status line was left in ~/.claude/settings.json');
  assert.deepEqual(main.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [theirHook] }], 'the person\'s own hook was not kept as it was');
  assert.deepEqual(main.hooks.Stop, [{ matcher: '', hooks: [{ type: 'command', command: 'say done' }] }],
    'a hook that shared our entry was not kept');
  assert.equal(main.hooks.SessionStart, undefined, 'an event left with no entries was kept as an empty list');
  assert.equal(main.skipDangerousModePermissionPrompt, true, 'an unrelated setting was lost');
  assert.equal(main.model, 'opus', 'an unrelated setting was lost');
  assert.equal(fs.statSync(mainFile).mode & 0o777, 0o600, 'the settings file lost its mode');

  const acct = path.join(sb.home, '.claude-work', 'settings.json');
  assert.ok(fs.lstatSync(acct).isSymbolicLink(), 'the symlinked settings file was replaced instead of written through');
  const acctData = read(sb.real);
  assert.equal(acctData.statusLine, undefined, 'this install\'s status line was left in the second account');
  assert.ok(mentions(acctData, path.join(sb.other, 'app', 'bin', 'kosmos-report-hook.sh')),
    'ANOTHER Kosmos install\'s hook was removed: only this install\'s may go');

  assert.equal(fs.readFileSync(path.join(sb.home, '.claude-broken', 'settings.json'), 'utf8'), '{ "hooks": kosmos-report-hook\n',
    'a settings file that is not JSON was rewritten');
  assert.match(out, /could not be taken out of these Claude settings files/, 'the unreadable file was not named');
  assert.match(out, /\.claude-broken\/settings\.json/, 'the unreadable file was not named by its path');
});

test('#5998: the unwire step runs inside the proven-install branch, before the home is deleted', () => {
  const s = fs.readFileSync(SETUP, 'utf8');
  const step = s.indexOf("<<'UNWIREEOF'");
  const deleting = s.indexOf('info "deleting $KOSMOS_HOME"');
  const rm = s.indexOf('rm -rf "$KOSMOS_HOME"', deleting);
  assert.ok(step > 0 && deleting > 0 && rm > 0, 'a landmark is gone from setup.sh');
  assert.ok(deleting < step && step < rm, 'the unwire step is not between the install check and the removal of the home');
});
