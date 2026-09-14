'use strict';

/**
 * kosmos: the macOS-only gate (Option A of the cross-platform analysis,
 * 2026-09-01). Kosmos's agent substrate is macOS launchd end to end -- 45
 * `launchctl` call sites, `process.getuid()`, `.plist` job definitions across
 * create.js/remove.js/machine.js/register.js/delete-leftover.js -- plus the
 * `darwin-` binary downloads and the `/bin/sh` `curl|sh` installer. On any other
 * OS those operations cannot work. This module is the single source of truth for
 * "does this platform run Kosmos", so a board on an unsupported OS refuses
 * HONESTLY (it does not arm live execution, so the Mac-only operations fail
 * closed through the existing live-execution gate) rather than attempting a
 * Mac-only action on the wrong OS and half-succeeding.
 *
 * 🔑 PURE, and it takes the platform as a parameter (default `process.platform`),
 * exactly like `store.dataRootFor(platform, ...)`. `process.platform` cannot be
 * set, so a module that hard-reads it is untestable on this Mac; a parameter is
 * testable for every platform without needing a Windows box.
 *
 * 📌 SCOPE: this is the MECHANISM only. The user-facing copy for an unsupported
 * platform ("Kosmos runs on macOS", the screen it shows on) is a product-copy
 * decision that belongs to the operator and is deliberately NOT built here -- see
 * the PR. This module reports `{ platform, supported }` (machine facts, no copy)
 * so that screen can be wired later without changing this gate.
 */

/* The platforms whose agent substrate actually works today.
 *
 * 🔑 win32 IS HERE BECAUSE THE PORT HAPPENED, not because an entry was added.
 * This comment used to say "macOS only. Adding one is a real port (a scheduler
 * abstraction for the launchctl substrate), not an entry here" -- and it was
 * right, which is why the entry waited for the substrate. `engine/win32launch.js`
 * is that abstraction: it writes the trust entry, mints the session id, ownership
 * record and sender token, and spawns an interactive, top-level, hidden-console
 * agent pinned to the recorded id. Measured on a real Windows box 2026-09-07:
 * four agents launched concurrently, all four live on the board under their
 * RECORDED names, all four credentialed, clean teardown.
 *
 * 🔑 AND IT NOW COMES BACK, which this comment used to deny. Keep-alive was the
 * separate slice it called for, and it landed as the two halves launchd bundles
 * into one plist: `engine/win32job.js` registers an at-logon Scheduled Task
 * (RunAtLoad) and `engine/win32supervisor.js` is the respawn loop with the same
 * 30s throttle (KeepAlive + ThrottleInterval). `engine/win32anchor.js` is what
 * makes that durable across a version update, which on a portable-zip platform is
 * a real hazard rather than a theoretical one.
 *
 * ⚠️ WHAT IT STILL DOES NOT MEAN: an at-logon task needs a LOGIN, exactly as
 * launchd's RunAtLoad does -- both are per-user agents, not system daemons. A box
 * that reboots to a locked login screen brings back no fleet on either platform
 * until somebody signs in. That is a property shared with the Mac, not a Windows
 * shortfall, but it is the thing people read "survives a reboot" to mean. */
const SUPPORTED = Object.freeze(['darwin', 'win32']);

/* 🛑 AND THE SECOND QUESTION, WHICH THIS MODULE USED TO CONFLATE WITH THE FIRST.
 * Two gates read `isSupported` to refuse a DOWNLOAD, not to refuse running an
 * agent: `connect.js` fetches Claude Code as `darwin-${arch}` (line ~719), and
 * `runners.js` pins codex to `vendor/aarch64-apple-darwin/bin/codex` in a
 * `-darwin-arm64` tarball. Those artifacts are macOS builds and no port changes
 * that -- publishing Windows builds is somebody's real work, not this list's.
 *
 * So adding win32 to SUPPORTED without splitting these would have armed Kosmos to
 * download MACOS BINARIES ONTO WINDOWS: exactly the "attempt a Mac-only action on
 * the wrong OS and half-succeed" the original gate was written to prevent, turned
 * on by the very change that was supposed to make Windows work.
 *
 * ⇒ One name per question. A Windows user installs Claude Code themselves (as the
 * measured box did: claude.exe already on disk, installedCheck reports it
 * present); Kosmos uses the runner that is there and says honestly that it cannot
 * fetch one. */
const RUNNER_DOWNLOADS = Object.freeze(['darwin']);

/* 🛑 AND THE THIRD QUESTION, WHICH NOTHING ASKED UNTIL #570 WENT LOOKING FOR IT.
 * `engine/update.js` is the SELF-updater. On the Mac it answers "install the new
 * Kosmos" with `spawn('/bin/sh', ['-c', 'curl -fsSL "$1" | sh; ...'])`. There is
 * no `/bin/sh` on Windows, and NEITHER of the two names above covers self-update:
 * `isSupported` is TRUE on win32 (agents run there now), and `canDownloadRunner`
 * is about RUNNER binaries, a different artifact on a different path. So this
 * third name exists to answer, on its own, "can Kosmos replace ITSELF here".
 *
 * 🔑 WIN32 IS NOW HERE BECAUSE THE WINDOWS UPDATER HAPPENED, not because an entry
 * was added -- the same discipline SUPPORTED states. This used to say win32 could
 * NOT self-install: the bundle is a portable zip (`runtime/node.exe`, no
 * `bin/kosmos` wrapper), the installer is a POSIX shell script, and a running
 * `.exe` cannot be overwritten in place. That was true until the in-app updater
 * was built to work WITHIN those facts: `engine/win32update.js` (download, verify,
 * stage) and `engine/win32apply.js` (a journaled, detached helper that stops the
 * board, swaps the bundle's own top-level entries in place, re-anchors the runtime
 * and restarts the board) are that updater. So on win32 the self-update path is
 * NOT `/bin/sh` at all -- `engine/update.js`'s beginInstall routes win32 to
 * `win32update.begin()`; this list is what turns that branch on, exactly as
 * WINDOWS-ROADMAP.md §3a said the arming slice would.
 *
 * 📌 NOT REPORTED BY `describe()`, deliberately. describe() is the wire shape two
 * suites pin to exactly three keys, because a fourth has to be LOOKED AT rather
 * than waved through, and no screen renders this fact yet. The refusal SENTENCE
 * for a platform still off this list lives with its caller (engine/update.js),
 * exactly as runners.js's and connect.js's do; this module stays machine facts. */
const SELF_INSTALL = Object.freeze(['darwin', 'win32']);

/** True only on a platform whose agent substrate runs. Defaults to this process.
 *  ⚠️ Only the DEFAULT (called with no argument, or explicit `undefined`) reads the
 *  process. Every real platform VALUE fails closed: `null`, `''`, and any unknown
 *  string return false. Callers pass either nothing or a real platform string, so
 *  the default-parameter asymmetry never surfaces a false positive in practice. */
function isSupported(platform = process.platform) {
  return SUPPORTED.includes(platform);
}

/** True only where Kosmos publishes a runner build it could fetch. Same
 *  fail-closed shape as isSupported: anything not on the list is false. */
function canDownloadRunner(platform = process.platform) {
  return RUNNER_DOWNLOADS.includes(platform);
}

/** True only where Kosmos can replace its own running copy. Same fail-closed
 *  shape as its two siblings: anything not on the list is false. Both darwin (the
 *  `/bin/sh` installer) and win32 (the in-app updater, engine/win32update.js +
 *  engine/win32apply.js) can; every other OS refuses through this gate. */
function canSelfInstall(platform = process.platform) {
  return SELF_INSTALL.includes(platform);
}

/** Machine facts for the API / a future gate screen. No user-facing copy.
 *  `runnerDownloads` is reported separately because a platform can now run
 *  agents while being unable to fetch a runner for itself, and a screen that
 *  says only "supported" cannot express that. */
function describe(platform = process.platform) {
  return {
    platform,
    supported: isSupported(platform),
    runnerDownloads: canDownloadRunner(platform),
  };
}

module.exports = { SUPPORTED, RUNNER_DOWNLOADS, SELF_INSTALL, isSupported, canDownloadRunner, canSelfInstall, describe };
