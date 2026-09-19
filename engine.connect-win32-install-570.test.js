'use strict';

/**
 * #570 BLOCKER 3, and its #3159 resolution: a clean Windows box now has an in-product
 * way to get `claude` -- Kosmos downloads and installs it, exactly as on the Mac.
 *
 * 🛑 WHAT USED TO BE WRONG. `connect.download()` refused on win32 before any bytes
 * moved, because the only Claude Code artifact was a `darwin-${arch}` build. The
 * refusal reached the "We could not download Claude" card verbatim, and the product
 * failed HONESTLY into a dead end -- a real investor hit exactly this (#3159). The
 * #570 stopgap was to tell the Windows user to install Claude Code THEMSELVES.
 *
 * ⇒ #3159 removes the dead end: downloads.claude.ai now publishes `win32-x64` and
 * `win32-arm64` builds with manifest checksums, so `connect.download()` fetches the
 * WINDOWS build and checksum-verifies it before executing -- the identical trust
 * posture as the Mac. `canInstallClaude` (this file's subject) is now TRUE on win32.
 * The half that must NOT move: codex is still a darwin-only tarball, and a platform
 * with no published Claude build still refuses. Sign-in is a separate slice
 * (WINDOWS_SIGNIN_HOST_ENABLED, on since #3288), so a win32 user auto-installs, then signs in.
 *
 *   node --test engine.connect-win32-install-570.test.js
 *
 * ⚠️ EVERY ARM INJECTS ITS PLATFORM. `process.platform` cannot be set, so a module
 * that hard-read it would be untestable on the Mac this suite mostly runs on -- the
 * same seam `platform.describe`, `runners.pathextCandidates` and `connect.download`
 * already carry.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const connect = require('./engine/connect');
const platformGate = require('./engine/platform');
const runners = require('./engine/runners');

test('#3159: publicView tells a screen Kosmos CAN install Claude Code here -- win32 too', () => {
  const win = connect.publicView({ phase: 'stuck', because: 'x' }, 'win32');
  assert.equal(win.canInstallClaude, true,
    'win32 now publishes a checksum-verifiable Claude Code build, so Kosmos installs it -- the download no longer refuses');
  assert.equal(win.platform, 'win32',
    'the platform still travels, so a screen can tell which OS it is speaking to');

  const mac = connect.publicView({ phase: 'stuck', because: 'x' }, 'darwin');
  assert.equal(mac.canInstallClaude, true, 'the Mac could always have Connect install it');
  assert.equal(mac.platform, 'darwin');

  /* CONTROL. Without it this file passes for a contract that hard-codes true. A
     platform with no published Claude build is still served false. */
  const linux = connect.publicView({ phase: 'stuck', because: 'x' }, 'linux');
  assert.equal(linux.canInstallClaude, false, 'linux has no published Claude build, so Connect cannot install one');
});

test('#3159: canInstallClaude is the gate\'s answer (canDownloadClaude), not a second copy of it', () => {
  /**
   * ⭐ ONE DERIVATION. `platform.js` is the single source of truth for "does Claude
   * publish a build here", and a screen keyed on a re-derived `platform === 'win32'`
   * would drift the day that list changes. The predicate is `canDownloadClaude`
   * specifically -- NOT `canDownloadRunner`, which is codex-only and would wrongly
   * report false for Claude on Windows.
   */
  for (const p of ['darwin', 'win32', 'linux', 'freebsd']) {
    assert.equal(connect.publicView({ phase: 'idle' }, p).canInstallClaude,
      platformGate.canDownloadClaude(p),
      `publicView disagrees with the gate about ${p}`);
  }
});

test('#3159: the field is derived, so it is right on every phase and cannot go stale', () => {
  /* Unlike `canRunClaude` -- a disk fact one writer records at one moment -- this is
     true of the machine for as long as the process lives. A record that never mentioned
     it still serves it, so a person who reaches the card through any path gets the same
     answer. */
  for (const phase of ['idle', 'downloading', 'stuck', 'interrupted', 'connected']) {
    const v = connect.publicView({ phase }, 'win32');
    assert.equal(v.canInstallClaude, true, `${phase} lost the field`);
    assert.equal(v.platform, 'win32', `${phase} lost the field`);
  }
  /* And a stale record cannot outrank the live machine. The state file is written by
     this process and read back after a restart; a stale platform/flag in it must never
     override the machine we are actually on. Here the record CLAIMS win32 cannot install
     (the old world); the live win32 gate must override it to true. */
  const lying = connect.publicView({ phase: 'stuck', platform: 'darwin', canInstallClaude: false }, 'win32');
  assert.equal(lying.platform, 'win32', 'a stale record overrode the live machine');
  assert.equal(lying.canInstallClaude, true, 'a stale record overrode the live gate');
});

test('#570: nothing already on the wire was dropped', () => {
  /* The #1595 shape: a field on this contract is only useful if the ones the rest of
     the page depends on survive the edit. */
  const v = connect.publicView({ phase: 'stuck', because: 'x', tail: 't', canRunClaude: true }, 'win32');
  for (const k of ['configDir', 'phase', 'before', 'progress', 'url', 'plan', 'because', 'tail', 'canRunClaude', 'claudeSigninCommand']) {
    assert.ok(k in v, 'publicView dropped the pre-existing field ' + k);
  }
  assert.equal(v.canRunClaude, true, 'the hatch flag stopped travelling');
});

test('win32-signin-web-copy: publicView serves the sign-in line the stuck record carries, and null when it carries none', () => {
  /* Recorded by becomeStuck beside canRunClaude (engine/connect.win32signin.test.js drives
     that); publicView passes it through and never builds one. Sign-in stays a separate
     slice from install -- this file's install flip does not touch it. */
  const line = "& 'C:\\Users\\Mary O''Brien\\.local\\bin\\claude.exe' auth login --claudeai";
  assert.equal(connect.publicView({ phase: 'stuck', because: 'x', canRunClaude: true, claudeSigninCommand: line }, 'win32').claudeSigninCommand, line,
    'the recorded line did not reach the page');
  assert.equal(connect.publicView({ phase: 'stuck', because: 'x', canRunClaude: true }, 'win32').claudeSigninCommand, null,
    'a record with no line served something other than null');
  assert.equal(connect.publicView({ phase: 'downloading' }, 'darwin').claudeSigninCommand, null);
});

test('#570: the default is the real process, so production is not served a guess', () => {
  const here = connect.publicView({ phase: 'idle' });
  assert.equal(here.platform, process.platform,
    'the default parameter stopped reading the process, so every board serves whatever the last test injected');
  assert.equal(here.canInstallClaude, platformGate.canDownloadClaude(process.platform));
});

test('#3159: installEnvFor sets USERPROFILE on win32 (the vendor launcher\'s home var), HOME on both', () => {
  /* The one production line that differs between the platforms for `claude install`.
     Extracted to a pure, platform-parameterized helper precisely so the win32 arm is
     testable here on the Mac CI runs, per this module's "every arm injects its platform"
     convention. Placement follows USERPROFILE on Windows, HOME on the Mac; both are set
     to installHome so resolveBin finds the launcher and a sandbox stays sandboxed. */
  assert.deepEqual(connect.installEnvFor('/sandbox/home', 'win32'),
    { TERM: 'dumb', HOME: '/sandbox/home', USERPROFILE: '/sandbox/home' },
    'win32 must set USERPROFILE (Windows home) so the launcher lands where resolveBin looks');
  assert.deepEqual(connect.installEnvFor('/sandbox/home', 'darwin'),
    { TERM: 'dumb', HOME: '/sandbox/home' },
    'the Mac needs only HOME -- no USERPROFILE on darwin');
});

test('#3159: the guardrail holds -- win32 fetches the WINDOWS build, never a Mac codex tarball, and unpublished platforms refuse', async () => {
  /**
   * 🛑 THE HALF THAT MUST NOT MOVE. Claude auto-installing on win32 is the fix -- and it
   * fetches the win32 build (checksum-verified), proven end to end in
   * platform-gate-download.test.js and connect.test.js. What must NOT ride along:
   *  - CODEX is still a `-darwin-arm64` tarball, so runners.install must keep refusing
   *    win32 (canDownloadRunner, unchanged) -- fetching a Mac codex tarball onto Windows
   *    is the exact half-succeed the gate exists to prevent.
   *  - a platform with NO published Claude build still refuses BEFORE any bytes move (no
   *    network seam needed -- the throw is on the first line, ahead of downloadBase()).
   */
  await assert.rejects(
    () => connect.download(undefined, undefined, 'linux'),
    /no published Claude Code build/,
    'linux must still refuse -- there is no Claude build for it, and we fetch nothing speculative');

  /* 📌 CODEX ON WIN32 NOW FETCHES ITS OWN WINDOWS BUILD, never the Mac tarball: the
     guardrail this arm defends ("no Mac binary onto Windows") holds by the manifest
     picking the win32 artifact, which is asserted here, rather than by refusing.
     A provider name the manifest does not know still refuses on win32. */
  const winBuild = runners.manifestFor('openai', 'win32', 'x64');
  assert.match(winBuild.url, /-win32-x64\.tgz$/, 'win32 fetches the Windows Codex build');
  assert.doesNotMatch(winBuild.url, /darwin/, 'never the Mac tarball');
  const codexWin = runners.install('codex', { platform: 'win32' });
  assert.equal(codexWin.phase, 'failed', 'an unknown provider name must not start a download on win32');
  assert.match(codexWin.because, /not supported/,
    'Claude\'s win32 permission must not leak to an arm with no published Windows build');
});
