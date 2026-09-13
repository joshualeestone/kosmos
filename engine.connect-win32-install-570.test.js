'use strict';

/**
 * #570 BLOCKER 3: a clean Windows box had no in-product way to get `claude`.
 *
 * 🛑 WHAT WAS ACTUALLY WRONG, because the honest part is easy to mistake for the
 * whole thing. `connect.download()` refuses on win32 BEFORE any bytes move --
 * correctly, the artifact it fetches is a `darwin-${arch}` build -- and the
 * refusal sentence reaches the "We could not finish connecting Claude" card
 * verbatim. So the product failed HONESTLY and was still a dead end: the two
 * actions were "Try again" (repeat the same doomed download) and "Continue
 * anyway" (a board that cannot make a working agent). Nowhere in the engine, the
 * web assets, the README or the docs was a Windows user told HOW to install
 * Claude Code, while `engine/platform.js`'s own design note assumes exactly that
 * they will.
 *
 * ⇒ This file is the SERVING half: the two machine facts a screen needs before
 * it can say so. The sentence itself lives with the screen (web/index.html) and
 * is pinned by server.connect.test.js, the same split `platform.js` keeps
 * between a gate and the copy its callers write.
 *
 *   node --test engine.connect-win32-install-570.test.js
 *
 * ⚠️ EVERY ARM INJECTS ITS PLATFORM. `process.platform` cannot be set, so a
 * module that hard-read it would be untestable on the Mac this suite mostly runs
 * on -- the same seam `platform.describe`, `runners.pathextCandidates` and
 * `connect.download` already carry.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const connect = require('./engine/connect');
const platformGate = require('./engine/platform');

test('#570: publicView tells a screen that the install is the person\'s job here', () => {
  const win = connect.publicView({ phase: 'stuck', because: 'x' }, 'win32');
  assert.equal(win.canInstallClaude, false,
    'win32 is served as a platform Kosmos can install Claude Code on, which is the thing the download refuses to do');
  assert.equal(win.platform, 'win32',
    'the platform is absent from the contract, so a screen cannot tell WHICH install instruction is true');

  /* CONTROL. Without it this file passes for a contract that hard-codes false. */
  const mac = connect.publicView({ phase: 'stuck', because: 'x' }, 'darwin');
  assert.equal(mac.canInstallClaude, true,
    'a Mac is being told to install Claude Code by hand, which is the job Connect does for it');
  assert.equal(mac.platform, 'darwin');
});

test('#570: the two new fields are the gate\'s answer, not a second copy of it', () => {
  /**
   * ⭐ ONE DERIVATION. `platform.js` is the single source of truth for "does
   * Kosmos publish a runner build here", and a screen keyed on a re-derived
   * `platform === 'win32'` would drift the day that list changes -- which is a
   * live prospect: `RUNNER_DOWNLOADS` was SPLIT OUT of `SUPPORTED` precisely so
   * one could move without the other.
   */
  for (const p of ['darwin', 'win32', 'linux', 'freebsd']) {
    assert.equal(connect.publicView({ phase: 'idle' }, p).canInstallClaude,
      platformGate.canDownloadRunner(p),
      `publicView disagrees with the gate about ${p}`);
  }
});

test('#570: the fields are derived, so they are right on every phase and cannot go stale', () => {
  /* Unlike `canRunClaude` -- a disk fact one writer records at one moment --
     these are true of the machine for as long as the process lives. A record
     that never mentioned them still serves them, so a person who reaches the
     card through any path gets the same answer. */
  for (const phase of ['idle', 'downloading', 'stuck', 'interrupted', 'connected']) {
    const v = connect.publicView({ phase }, 'win32');
    assert.equal(v.canInstallClaude, false, `${phase} lost the field`);
    assert.equal(v.platform, 'win32', `${phase} lost the field`);
  }
  /* And a record that CLAIMS otherwise does not get to. The state file is
     written by this process and read back after a restart; a stale platform in
     it must never outrank the machine we are actually on. */
  const lying = connect.publicView({ phase: 'stuck', platform: 'darwin', canInstallClaude: true }, 'win32');
  assert.equal(lying.platform, 'win32', 'a stale record overrode the live machine');
  assert.equal(lying.canInstallClaude, false, 'a stale record overrode the live gate');
});

test('#570: nothing already on the wire was dropped', () => {
  /* The #1595 shape: a field added to this contract is only useful if the ones
     the rest of the page depends on survive the edit. */
  const v = connect.publicView({ phase: 'stuck', because: 'x', tail: 't', canRunClaude: true }, 'win32');
  for (const k of ['configDir', 'phase', 'before', 'progress', 'url', 'plan', 'because', 'tail', 'canRunClaude', 'claudeSigninCommand']) {
    assert.ok(k in v, 'publicView dropped the pre-existing field ' + k);
  }
  assert.equal(v.canRunClaude, true, 'the hatch flag stopped travelling');
});

test('win32-signin-web-copy: publicView serves the sign-in line the stuck record carries, and null when it carries none', () => {
  /* Recorded by becomeStuck beside canRunClaude (engine/connect.win32signin.test.js drives
     that); publicView passes it through and never builds one. */
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
  assert.equal(here.canInstallClaude, platformGate.canDownloadRunner(process.platform));
});

test('#570: THE REFUSAL IS NOT WEAKENED -- win32 still downloads no macOS binary', async () => {
  /**
   * 🛑 THE HALF THAT MUST NOT MOVE. Telling a Windows user how to install Claude
   * Code themselves is the fix; making Kosmos fetch a Mac binary onto Windows to
   * spare them the trouble is the "attempt a Mac-only action on the wrong OS and
   * half-succeed" the gate exists to prevent. This had no test of its own: only
   * `platform.canDownloadRunner` was pinned, and the CALL SITE that reads it was
   * not, so the gate could have been left intact while the caller stopped
   * consulting it.
   *
   * ⚠️ AND IT REFUSES BEFORE ANY BYTES MOVE, which is why no network seam is
   * needed here: the throw happens on the first line, ahead of `downloadBase()`.
   * A version of this that reached the network would hang or fail for a second
   * reason and this assertion could not tell the two apart.
   */
  await assert.rejects(
    () => connect.download(undefined, undefined, 'win32'),
    /not supported; the Claude Code binary is a macOS build and was not downloaded/,
    'win32 no longer refuses the runner download');
  /* Every non-publishing platform, not just the one this card is about. */
  await assert.rejects(() => connect.download(undefined, undefined, 'linux'), /not supported/);
});
