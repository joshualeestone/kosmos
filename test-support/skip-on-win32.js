'use strict';
/**
 * kosmos#8378: the one way a test says it does not run on Windows, and why.
 *
 * `{ skip: skipOnWin32('it runs install/kosmos directly by its shebang line, which Windows cannot do') }` reads as the reason on a
 * Windows host (node:test prints it beside the skipped test) and as `false` everywhere else, so the test still runs on
 * the Mac and Linux. A reason is required: an empty or missing one throws, so no Windows skip is ever silent about why.
 *
 * Only for a test about something that does not exist on Windows (an absolute POSIX path, a script run by its shebang
 * line, tmux, POSIX file modes and signals). A test
 * that is wrong, or about a Windows path that is broken, is a fix, not a skip.
 *
 * One exception, and it must say so (kosmos#8378): a test whose subject DOES exist on Windows, but whose setup is
 * Mac-only (a tmux stop, say) and needs a Windows arm written, may skip while that arm is owed, if its reason says
 * "what it checks exists on Windows" and names the open card that owes the arm (kosmos#8456 is the first). Then the gap
 * is counted on a card someone owns, not hidden in a reason that reads as "not applicable".
 *
 * Name the mechanism in the reason, not "Windows has no bash": a bare `bash` reaches Git Bash on Windows (on the box
 * and on GitHub's Windows runners); what Windows cannot run is an absolute POSIX path (/bin/bash, /bin/sh, /usr/bin/...)
 * or a script run directly by its shebang line.
 *
 * The Windows coupling audit (engine/windows-tests-1777.test.js) sees this call as a Windows branch, as it sees
 * `process.platform === 'win32'`. So a test file that uses it must be in HOST_BRANCH_EXCLUDED in tools/windows-tests.js,
 * with its reason (or be run on Windows), or that audit fails.
 *
 * `platform` is a seam for this helper's own tests; callers leave it out.
 */

function skipOnWin32(reason, platform = process.platform) {
  if (typeof reason !== 'string' || !reason.trim()) throw new TypeError('skipOnWin32 needs a reason: say why the test cannot run on Windows');
  return platform === 'win32' ? reason.trim() : false;
}

module.exports = { skipOnWin32 };
