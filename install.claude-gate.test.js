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
const HARNESS = 'die() { printf "%s\\n" "$*" >&2; exit 1; }\ninfo() { printf "%s\\n" "$*"; }\n';

function run({ homeHasClaude, pathClaude }) {
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
  const script = HARNESS + gate();
  try {
    const out = execFileSync('/bin/sh', ['-c', script], {
      encoding: 'utf8',
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') };
  }
}

test('present at the path Kosmos uses: proceeds, and says where it looked', () => {
  const r = run({ homeHasClaude: true, pathClaude: false });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Claude Code found at .*\.local\/bin\/claude/);
});

test('genuinely absent: refuses with the install step, never a bare failure', () => {
  const r = run({ homeHasClaude: false, pathClaude: false });
  assert.notEqual(r.code, 0, 'a Mac with no Claude Code completed the gate');
  assert.match(r.err, /needs Claude Code and this Mac does not have it/);
  assert.match(r.err, /claude\.com\/claude-code/, 'the refusal does not say what to do');
});

test('installed elsewhere: names where it is and the one-line link, a DIFFERENT sentence than absent', () => {
  const r = run({ homeHasClaude: false, pathClaude: true });
  assert.notEqual(r.code, 0, 'an agent started from a path with nothing at it would never run');
  assert.match(r.err, /is installed at .*\/bin\/claude, but Kosmos starts agents from/);
  assert.match(r.err, /ln -s/, 'the fix is not named');
  assert.doesNotMatch(r.err, /does not have it/,
    'the two states that look identical from a Terminal got the same sentence');
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
  let out;
  try {
    execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } });
    assert.fail('a path with an unrunnable claude completed the gate');
  } catch (e) {
    out = String(e.stderr || '');
  }
  assert.match(out, /cannot run \(a broken link, or a file without execute permission\)/);
  assert.match(out, /rm /, 'the remedy is not named');
  assert.doesNotMatch(out, /nothing there/, 'the false claim survived');
  assert.doesNotMatch(out, /ln -s/, 'the looping remedy survived');
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
