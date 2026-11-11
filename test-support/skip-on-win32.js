'use strict';
/**
 * kosmos#8378: the one way a test says it does not run on Windows, and why.
 *
 * `{ skip: skipOnWin32('it spawns install/kosmos, the Mac and Linux CLI, through bash') }` reads as the reason on a
 * Windows host (node:test prints it beside the skipped test) and as `false` everywhere else, so the test still runs on
 * the Mac and Linux. A reason is required: an empty or missing one throws, so no Windows skip is ever silent about why.
 *
 * Only for a test about something that does not exist on Windows (bash, tmux, POSIX file modes and signals). A test
 * that is wrong, or about a Windows path that is broken, is a fix, not a skip.
 *
 * Name the mechanism in the reason, not "Windows has no bash": a bare `bash` reaches Git Bash on Windows (on the box
 * and on GitHub's Windows runners); what Windows cannot run is an absolute POSIX path (/bin/bash, /bin/sh, /usr/bin/...)
 * or a script run directly by its shebang line.
 *
 * The Windows coupling audit (engine/windows-tests-1777.test.js) looks for `process.platform === 'win32'` branches and
 * does not see this call. That is deliberate: its Windows arm only skips, and the reason is printed on every run.
 *
 * `platform` is a seam for this helper's own tests; callers leave it out.
 */

function skipOnWin32(reason, platform = process.platform) {
  if (typeof reason !== 'string' || !reason.trim()) throw new TypeError('skipOnWin32 needs a reason: say why the test cannot run on Windows');
  return platform === 'win32' ? reason.trim() : false;
}

module.exports = { skipOnWin32 };
