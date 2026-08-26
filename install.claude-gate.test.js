'use strict';

/**
 * The installer OBSERVES Claude Code and installs nothing (#979, Josh's
 * ruling 2026-08-26 10:32: "we're not forcing people to have Claude Code as
 * part of the installer").
 *
 * 🛑 THIS FILE USED TO ASSERT THE OPPOSITE, and deliberately so: under #548
 * ("let's carry and just install now", 2026-08-24) the installer downloaded
 * Claude Code and REFUSED the whole install if that failed, and these tests
 * pinned it. Both rulings are Josh's; the newer one wins, and the assertions
 * move with the product the way they moved into it two days ago.
 *
 * ⭐ THE HEADLINE CASE IS NOW THE ONE THAT USED TO FAIL: a Mac with no Claude
 * Code must COMPLETE the install. As shipped before this branch, an
 * OpenAI-only person could not get through it at all.
 *
 * Runs the SHIPPED function, lifted from setup.sh the way install.tmux-pick
 * lifts the picker: a restatement here would pass while the installer drifted.
 *
 * ⚠️ AND THE STRONGEST ASSERTION IN THE FILE IS A NEGATIVE ONE. Every case
 * points the retired install URL at a stub that WOULD land a runnable claude
 * if anything still called it, then asserts nothing landed. A test that only
 * checked the sentences would pass against a function that still downloaded.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const SETUP = fs.readFileSync(nodePath.join(__dirname, 'install', 'setup.sh'), 'utf8');

function gate() {
  const at = SETUP.indexOf('note_claude_code() {');
  assert.notEqual(at, -1, 'the function moved or was renamed; re-point this test');
  const end = SETUP.indexOf('\nnote_claude_code\n', at);
  assert.notEqual(end, -1, 'it is defined and never called');
  return SETUP.slice(at, end + '\nnote_claude_code\n'.length);
}

/* The retired mechanism must not come back by accident: a re-added gate is a
   silent return to force-installing Claude Code on every Mac.

   ⚠️ CODE LINES ONLY. The first version of this asserted the strings were
   absent from the whole file and failed on the COMMENT that explains the
   removal -- an explanation that names what it removed is not the thing
   coming back. Comments are stripped before asking. */
const CODE_LINES = SETUP.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('the force-install mechanism is gone from setup.sh, in code', () => {
  assert.equal(CODE_LINES.includes('check_claude_code'), false,
    'the old gate is back; the installer force-installs Claude Code again');
  assert.equal(CODE_LINES.includes('claude.ai/install.sh'), false,
    'the installer fetches the vendor installer again');
  assert.equal(CODE_LINES.includes('AGENT_WORKFORCE_CLAUDE_INSTALL_URL'), false,
    'the retired mirror override is being read again, which means something downloads');
  // And the positive control, so the three assertions above are not vacuous:
  // this file IS the installer and it DOES still look for Claude Code.
  assert.ok(CODE_LINES.includes('note_claude_code'),
    'setup.sh no longer mentions Claude Code at all, so the checks above prove nothing');
});

/* die/info from setup.sh are not lifted (they carry the whole logging
   apparatus); stubs with the same contract, refusal text on stderr and a
   non-zero exit, which is what a person and this test each observe. */
/* The shipped gate runs under set -euo pipefail (setup.sh:102); the
   harness matches, so an edit that only breaks under -u or -e dies here
   too rather than only in the real installer. */
/* Every sandbox this file makes is REMOVED when the process ends, on every
   path: pass, fail, and a signal. Five call sites used mkdtempSync bare and
   nothing removed them; this file runs under yarn test, which the release
   gate runs on every cut, so the build Mac accumulated 4,638 clgate-* dirs,
   three of them a populated fake home at ~310M (#906). Same shape as
   docs/browser-checks/live-connect.js since #877. KOSMOS_KEEP_SANDBOX=1
   keeps them for a look at a red run. */
const SANDBOXES = [];
function sandbox() {
  const sb = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'clgate-')));
  SANDBOXES.push(sb);
  return sb;
}
process.on('exit', () => {
  if (process.env.KOSMOS_KEEP_SANDBOX === '1') { console.error('sandboxes kept (KOSMOS_KEEP_SANDBOX=1):', SANDBOXES.join(' ')); return; }
  for (const sb of SANDBOXES) { try { fs.rmSync(sb, { recursive: true, force: true }); } catch { /* nothing to do about it at exit */ } }
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1));

const HARNESS = 'set -euo pipefail\ndie() { printf "%s\\n" "$*" >&2; exit 1; }\ninfo() { printf "%s\\n" "$*"; }\n';

function run({ homeHasClaude, pathClaude, installer }) {
  const sb = sandbox();
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
  // The shipped function appends to $LOG; give it one so the transcript
  // assertion has something real to read rather than a stub of our own.
  const log = nodePath.join(sb, 'install.log');
  fs.writeFileSync(log, '');
  const script = HARNESS + gate();
  try {
    const out = execFileSync('/bin/sh', ['-c', script], {
      encoding: 'utf8',
      env: {
        HOME: home, PATH: `${bin}:/usr/bin:/bin`, LOG: log,
        AGENT_WORKFORCE_CLAUDE_INSTALL_URL: installUrl,
      },
    });
    return { code: 0, out, err: '', home, log };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || ''), home, log };
  }
}

test('the env override is honored, so sandboxed installs can point at a fixture', () => {
  /* ⚠️ RESTORED. An earlier version of this branch deleted this case along
     with the download it used to guard, but AGENT_WORKFORCE_CLAUDE_BIN is
     still read by the shipped function, and tools/test-install.sh pins all
     eleven of its sandbox homes at one shared binary through it. Deleting the
     download did not delete the seam, and the seam had no other coverage. */
  const sb = sandbox();
  const home = nodePath.join(sb, 'home');
  fs.mkdirSync(home, { recursive: true });
  const fixture = nodePath.join(sb, 'fixture-claude');
  fs.writeFileSync(fixture, '#!/bin/sh\nexit 0\n'); fs.chmodSync(fixture, 0o755);
  const out = execFileSync('/bin/sh', ['-c', HARNESS + gate()], {
    encoding: 'utf8',
    env: { HOME: home, PATH: '/usr/bin:/bin', AGENT_WORKFORCE_CLAUDE_BIN: fixture },
  });
  assert.match(out, new RegExp('Claude Code found at ' + fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the override was ignored, so every sandboxed install would look at the real home');
});

test('present at the path Kosmos uses: says where it looked, changes nothing', () => {
  const r = run({ homeHasClaude: true, pathClaude: false, installer: 'lands' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Claude Code found at .*\.local\/bin\/claude/);
});

test('⭐ genuinely absent: the install COMPLETES, and nothing is downloaded', () => {
  /* The case that used to install, and before that refused. It is the whole
     point of the ruling: an OpenAI-only person gets through setup. */
  const r = run({ homeHasClaude: false, pathClaude: false, installer: 'lands' });
  assert.equal(r.code, 0, r.err || 'a Mac with no Claude Code could not finish the install');
  /* 🛑 AND IT SAYS NOTHING ABOUT CLAUDE CODE. Josh, 2026-08-26 14:59, on
     being told about it before choosing a model: "Why the hell would I
     install Claude Code? That doesn't make any sense." At this point in the
     install nobody has picked a provider, so one provider's absence is not
     news the installer gets to deliver. Kosmos raises it on the Connect step
     for the provider actually chosen. */
  assert.doesNotMatch(r.out, /Claude/,
    'the installer mentions Claude Code to somebody who has not chosen a provider');
  /* 📌 Silent to the PERSON, not to the log. The transcript is what a stranger
     is asked to send us, and this is the commonest machine state: without a
     line there, "we looked and found nothing" is indistinguishable from "we
     never looked". A log is not a screen, so the ruling is untouched. */
  assert.match(fs.readFileSync(r.log, 'utf8'), /no Claude Code at .*and none on PATH; nothing installed/,
    'the install transcript cannot say whether Kosmos even looked');
  // 🛑 THE LOAD-BEARING ASSERTION. The stub installer would have landed a
  // runnable claude if anything still called it.
  assert.equal(fs.existsSync(nodePath.join(r.home, '.local', 'bin', 'claude')), false,
    'something still installs Claude Code');
  assert.doesNotMatch(r.out, /Installing it now/, 'the retired sentence is back');
});

test('installed elsewhere: LINKED into place, which moves no bytes and installs nothing', () => {
  /* 🛑 THE LINK STAYS, and an earlier version of this branch removed it on
     the belief that the engine would do it on Connect. Checked and wrong
     twice: that code is on an unmerged branch, and even merged it is
     reachable only through a route no screen calls -- engine/connect.js looks
     ONLY at the canonical path, never at `command -v claude`. So removing it
     would have told a person with Claude Code at /opt/homebrew/bin that a
     link was coming and instead given them a fresh 231MB download of what
     they already have.

     ⚠️ It does not breach the ruling either: the rule is that nothing
     INSTALLS and nothing DOWNLOADS before a provider is chosen. A symlink is
     neither. */
  const r = run({ homeHasClaude: false, pathClaude: true, installer: 'lands' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Claude Code is installed at .*\/bin\/claude, but Kosmos starts agents from/);
  assert.match(r.out, /Claude Code linked at /);
  const link = nodePath.join(r.home, '.local', 'bin', 'claude');
  assert.ok(fs.existsSync(link) && (fs.statSync(link).mode & 0o100),
    'the link sentence appeared but nothing runnable is at the path');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true,
    'it copied or downloaded rather than linking');
  // And the download stub was armed the whole time: linking is not installing.
  assert.doesNotMatch(r.out, /Installing it now/, 'the retired install sentence is back');
});

test('something present that cannot run: named, and the install still COMPLETES', () => {
  /* A broken symlink (npm prefix moved) or a chmod-000 file at the path.
     This used to die, taking the whole Kosmos install with it because one
     provider's path was untidy. */
  const sb = sandbox();
  const home = nodePath.join(sb, 'home');
  fs.mkdirSync(nodePath.join(home, '.local', 'bin'), { recursive: true });
  fs.symlinkSync(nodePath.join(sb, 'moved-away'), nodePath.join(home, '.local', 'bin', 'claude'));
  const script = HARNESS + gate();
  let code = 0; let out = ''; let err = '';
  try {
    out = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' } });
  } catch (e) {
    code = e.status; out = String(e.stdout || ''); err = String(e.stderr || '');
  }
  assert.equal(code, 0, err || 'an untidy Claude path still ends the whole install');
  assert.match(out, /cannot run \(a broken link, a folder, or a file without execute permission\)/);
  assert.match(out, /rm -rf /, 'the remedy is not named');
  assert.doesNotMatch(out, /nothing there/, 'the false claim survived');
});

test('a DIRECTORY at the path is named as unrunnable, and still does not end the install', () => {
  /* mode-755 directories pass a bare -x, the #133 trap. The -f half still
     catches it; what changed is that it no longer stops everything. */
  const sb = sandbox();
  const home = nodePath.join(sb, 'home');
  fs.mkdirSync(nodePath.join(home, '.local', 'bin', 'claude'), { recursive: true });
  const script = HARNESS + gate();
  let code = 0; let out = ''; let err = '';
  try {
    out = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' } });
  } catch (e) {
    code = e.status; out = String(e.stdout || ''); err = String(e.stderr || '');
  }
  assert.equal(code, 0, err || 'a folder at the runner path still ends the whole install');
  assert.match(out, /cannot run/);
});
