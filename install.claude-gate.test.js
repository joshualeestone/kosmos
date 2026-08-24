'use strict';

/**
 * The installer refuses a Mac with no Claude Code, in a named sentence
 * (#133), instead of finishing and leaving an agent that never starts.
 *
 * Runs the SHIPPED gate, lifted from setup.sh the way install.tmux-pick
 * lifts the picker: a restatement here would pass while the installer
 * drifted. The three states each get a case, and the two that look
 * identical from a Terminal (absent vs installed-elsewhere) are proven to
 * produce DIFFERENT sentences, which is the card's whole point.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const SETUP = fs.readFileSync(nodePath.join(__dirname, 'install', 'setup.sh'), 'utf8');

function gate() {
  const at = SETUP.indexOf('check_claude_code() {');
  assert.notEqual(at, -1, 'the gate moved or was renamed; re-point this test');
  const end = SETUP.indexOf('\ncheck_claude_code\n', at);
  assert.notEqual(end, -1, 'the gate is defined and never called');
  return SETUP.slice(at, end + '\ncheck_claude_code\n'.length);
}

/* die/info from setup.sh are not lifted (they carry the whole logging
   apparatus); stubs with the same contract, refusal text on stderr and a
   non-zero exit, which is what a person and this test each observe. */
/* The shipped gate runs under set -euo pipefail (setup.sh:102); the
   harness matches, so an edit that only breaks under -u or -e dies here
   too rather than only in the real installer. */
const HARNESS = 'set -euo pipefail\ndie() { printf "%s\\n" "$*" >&2; exit 1; }\ninfo() { printf "%s\\n" "$*"; }\n';

function run({ homeHasClaude, pathClaude, installer }) {
  const sb = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'clgate-')));
  const home = nodePath.join(sb, 'home');
  fs.mkdirSync(nodePath.join(home, '.local', 'bin'), { recursive: true });
  if (homeHasClaude) {
    const c = nodePath.join(home, '.local', 'bin', 'claude');
    fs.writeFileSync(c, '#!/bin/sh\nexit 0\n'); fs.chmodSync(c, 0o755);
  }
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  if (pathClaude) {
    const c = nodePath.join(bin, 'claude');
    fs.writeFileSync(c, '#!/bin/sh\nexit 0\n'); fs.chmodSync(c, 0o755);
  }
  /**
   * ⚠️ THE CARRY ARM MUST NEVER REACH THE REAL NETWORK FROM A TEST. The
   * gate's install URL is overridable (an operator-mirror seam), and every
   * case here sets it to a LOCAL stub via file://, which curl speaks:
   * 'lands'  a stub installer that writes a runnable claude where
   *          Anthropic's own does,
   * 'fails'  a stub that exits 1,
   * absent   a file:// URL with nothing behind it (curl -f fails).
   */
  let installUrl = `file://${sb}/no-such-installer.sh`;
  if (installer === 'lands') {
    // The stub claude ANSWERS --version, because the gate probes rather
    // than trusts (a truncated binary passes -f/-x); a stub that only
    // exits would fail the carry the way a truncated real one should.
    const inst = nodePath.join(sb, 'installer.sh');
    fs.writeFileSync(inst,
      '#!/bin/sh\nmkdir -p "$HOME/.local/bin"\nprintf \'#!/bin/sh\\necho 9.9.9-stub\\n\' > "$HOME/.local/bin/claude"\nchmod 755 "$HOME/.local/bin/claude"\n');
    installUrl = `file://${inst}`;
  } else if (installer === 'fails') {
    const inst = nodePath.join(sb, 'installer.sh');
    fs.writeFileSync(inst, '#!/bin/sh\nexit 1\n');
    installUrl = `file://${inst}`;
  }
  const script = HARNESS + gate();
  try {
    const out = execFileSync('/bin/sh', ['-c', script], {
      encoding: 'utf8',
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, AGENT_WORKFORCE_CLAUDE_INSTALL_URL: installUrl },
    });
    return { code: 0, out, err: '', home };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || ''), home };
  }
}

test('present at the path Kosmos uses: proceeds, and says where it looked', () => {
  const r = run({ homeHasClaude: true, pathClaude: false });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Claude Code found at .*\.local\/bin\/claude/);
});

/* RESTATED for carry (#548, Josh's ruling 2026-08-24 11:06), not deleted:
   the absent case now INSTALLS instead of refusing, and the assertions
   moved with the product the way clean-machine's phase did. */
test('genuinely absent: carries — says what it is doing, installs, and continues', () => {
  const r = run({ homeHasClaude: false, pathClaude: false, installer: 'lands' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /does not have it/, 'the state is named before anything happens');
  assert.match(r.out, /Installing it now with Anthropic's own installer/, 'the carry is silent, which the card forbids');
  assert.match(r.out, /Claude Code installed at /);
  const landed = nodePath.join(r.home, '.local', 'bin', 'claude');
  assert.ok(fs.existsSync(landed) && (fs.statSync(landed).mode & 0o100),
    'the carry sentence appeared but nothing runnable landed');
});

test('a failed carry dies the way the old gate did: named, with the self-remedy, never a bare failure', () => {
  const r = run({ homeHasClaude: false, pathClaude: false, installer: 'fails' });
  assert.notEqual(r.code, 0, 'a failed carry completed the gate, building the agents-that-never-start machine');
  assert.match(r.err, /We tried to install Claude Code and it did not work/);
  assert.match(r.err, /claude\.com\/claude-code/, 'the refusal does not say what to do');
});

test('installed elsewhere: linked into place with a sentence, a DIFFERENT sentence than absent', () => {
  const r = run({ homeHasClaude: false, pathClaude: true });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /is installed at .*\/bin\/claude, but Kosmos starts agents from/);
  assert.match(r.out, /Linking it there now/);
  assert.match(r.out, /Claude Code linked at /);
  const link = nodePath.join(r.home, '.local', 'bin', 'claude');
  assert.ok(fs.existsSync(link) && (fs.statSync(link).mode & 0o100),
    'the link sentence appeared but nothing runnable is at the path');
  /* The link the gate just CREATED must be accepted on the next run, or
     every carry-linked machine gets re-linked (or worse) forever. Kept
     from the old remedy-loop control, one step tighter: the state under
     test is now the gate's own output, not a pasted remedy's. */
  const linked = execFileSync('/bin/sh', ['-c', HARNESS + gate()], {
    encoding: 'utf8',
    env: { HOME: r.home, PATH: '/usr/bin:/bin', AGENT_WORKFORCE_CLAUDE_INSTALL_URL: 'file:///never-reached' },
  });
  assert.match(linked, /Claude Code found at /,
    'the gate refuses the very link it created, so every linked machine loops');
  assert.doesNotMatch(r.out, /Installing it now/,
    'the two states that look identical from a Terminal took the same arm');
});

test('something present that cannot run gets its own sentence, never the false "nothing there"', () => {
  /* A broken symlink (npm prefix moved) or a chmod-000 file at the path:
     the elsewhere-remedy's pasted ln would fail on File exists, so this
     state needs a different sentence and a remedy that works. */
  const sb = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'clgate-')));
  const home = nodePath.join(sb, 'home');
  fs.mkdirSync(nodePath.join(home, '.local', 'bin'), { recursive: true });
  fs.symlinkSync(nodePath.join(sb, 'moved-away'), nodePath.join(home, '.local', 'bin', 'claude'));
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const c = nodePath.join(bin, 'claude');
  fs.writeFileSync(c, '#!/bin/sh\nexit 0\n'); fs.chmodSync(c, 0o755);
  const script = HARNESS + gate();
  let code = 0; let out = '';
  try {
    execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } });
  } catch (e) {
    code = e.status; out = String(e.stderr || '');
  }
  assert.notEqual(code, 0, 'a path with an unrunnable claude completed the gate');
  assert.match(out, /cannot run \(a broken link, a folder, or a file without execute permission\)/);
  assert.match(out, /rm -rf /, 'the remedy is not named, cannot handle every shape, or prompts on a mode-000 file');
  assert.doesNotMatch(out, /nothing there/, 'the false claim survived');
  /* A working claude IS on PATH in this fixture, so the one-shot replace
     remedy is the right sentence: rm then ln in one line. */
  assert.match(out, /&& ln -s/, 'the one-shot replacement is not offered although a working claude is on PATH');
});

test('a DIRECTORY at the path is refused as unrunnable, never accepted', () => {
  /* mode-755 directories pass a bare -x, and the first draft of this gate
     accepted one: the install completed and every agent spawned from the
     path failed to start, the exact #133 failure. No claude on PATH here,
     so the plain remove remedy is the sentence, and rm -r is the form
     that works on a folder. */
  const sb = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'clgate-')));
  const home = nodePath.join(sb, 'home');
  fs.mkdirSync(nodePath.join(home, '.local', 'bin', 'claude'), { recursive: true });
  const script = HARNESS + gate();
  let code = 0; let out = '';
  try {
    execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' } });
  } catch (e) {
    code = e.status; out = String(e.stderr || '');
  }
  assert.notEqual(code, 0, 'a directory at the path completed the gate');
  assert.match(out, /a folder, or a file without execute permission/);
  assert.match(out, /rm -rf /, 'the remedy would fail verbatim on a folder, or prompt on a mode-000 file');
  assert.doesNotMatch(out, /&& ln -s/, 'the replace remedy was offered with nothing to link');

  /* And a symlink TO a directory is refused the same way, with rm -rf
     removing only the link (the -f follows the link for the accept test,
     so this is the second half of that comment, pinned). */
  const sb2 = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'clgate-')));
  const home3 = nodePath.join(sb2, 'home');
  fs.mkdirSync(nodePath.join(home3, '.local', 'bin'), { recursive: true });
  const dirTarget = nodePath.join(sb2, 'a-directory');
  fs.mkdirSync(dirTarget);
  fs.symlinkSync(dirTarget, nodePath.join(home3, '.local', 'bin', 'claude'));
  let code3 = 0;
  try {
    execFileSync('/bin/sh', ['-c', HARNESS + gate()], { encoding: 'utf8', env: { HOME: home3, PATH: '/usr/bin:/bin' } });
  } catch (e) { code3 = e.status; }
  assert.notEqual(code3, 0, 'a symlink to a directory was accepted as runnable');
});

test('the env override is honored, so sandboxed installs can point at a fixture', () => {
  const sb = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'clgate-')));
  const fake = nodePath.join(sb, 'claude');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n'); fs.chmodSync(fake, 0o755);
  const script = HARNESS + gate();
  const out = execFileSync('/bin/sh', ['-c', script], {
    encoding: 'utf8',
    env: { HOME: nodePath.join(sb, 'nohome'), PATH: '/usr/bin:/bin', AGENT_WORKFORCE_CLAUDE_BIN: fake },
  });
  assert.match(out, /Claude Code found at /);
});
