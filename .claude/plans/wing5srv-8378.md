# kosmos#8378 group 5, the server.* part (59 files)

Hand-out: Splinter, 00:38 11-28. List: #8378 comment 7235424591; how-to: 7235170746; first errors: Homer's comments from
7235404367. Measured throughout on GitHub's Windows runner through the never-merged branch wing5srv-8378-never-merge.

Result on the runner: 58 of 59 files failed, 126 tests (run 46119265069). Now all 59 pass, 0 failing (run 46121613128,
46122481509 after review round 1, and 46124242300 on round 6's head with server.faketmux-win-8378 too: 60 files,
465 pass, 25 skip, 0 fail). Tests passing went from 344 to 465; skips from 13 to 25, each new one named below.

🛑 What that green means (review round 3): the stand-in serves fake tmux's tmux-shaped rows, so on a Windows host every
card is a Mac card (no claude.exe rows, reachedByChannel false, delivery through tmux). The green says each route is
reachable and answers on a Windows host; it does NOT say the Windows board behaves this way. That is #9262's fix
(win32roster.rowLine rows, delivery through the supervisor), which this does not close. Also not checked on Windows,
beyond the skips: the remaining descriptor counts in the attachment tests (#9276; those tests' other checks run), the add route's
switch gate in compat-hidden, and the Windows arm of update-pause.

## The shared cause, fixed rather than skipped
- Every file stages its board through test-support/fake-tmux.sh, a `#!/bin/sh` script Windows cannot run. Without a
  fleet, /api/status answered 500 "we could not run tmux at all" (diagnostic run 46119452790); with fleet.install's
  seams it answered 200.
- test-support/faketmux-win.js serveOnWindows() serves fake tmux's reads in process, on Windows only, from the same files
  and with the same defaults: the pane list (AGENT_WORKFORCE_FAKE_PANES), the screen (AGENT_WORKFORCE_FAKE_SCREEN), and
  messages.js's "whose session is this pane in" (fixture-discord). fleet.restore() returns to it instead of to "none".
  51 files call it just before they first require the server. On macOS and Linux it does nothing.
- Eight files start the board as a child process. faketmux-win.childArgs() adds `--require faketmux-win-preload.js` on
  Windows only (the argv is unchanged elsewhere). In the child, the preload also has win32roster.make and
  win32capture.make hand back fake tmux's reads, since a board starting on Windows wires its own roster over the seams.
- It does not stand in for fake tmux's WRITES, its list-sessions and folder reads, or (in a board child) the board's
  other Windows roster calls; the helper's header lists them. No file in this group needed them.

## Per file, fixed
- A runner stub (test-support/runnerstub.js) for Claude or Codex where /bin/echo was set and Windows cannot run it:
  team-agent-token-1279, team-creator-runs-on-3734, team-newrole-4474, teamping-5590, orgchart-read-4559 and the two
  board children asbrow-4405 and guide-on-connect-3660.
- Separators: ios-routes-6838 (SITES names files with /), groklimits-6176 (accounts by folder name), move-handoff-9010
  (either separator).
- attachment-stream-6734: the reply-copy arm resolves its path with realpathSync.native, as replyfile.realOf does; the
  plain realpathSync kept the temp folder's 8.3 short name on Windows.
- allowance-3946: its Windows arm expected 409, but Windows wires the weekly reading since #6213; it now expects 200.
- away-9049: a Mac-only control ran only on a Mac board; on a Windows host it now runs only off Windows, and the arm
  about Windows still runs.
- update-pause-6620: pins the Mac update arm (as server.version-5084 does). The pause is ASKED first and its refusal
  answered after the platform and source refusals; the Windows arm's pause refusal is not checked here (reasoned to be
  the same code path, not shown).
- builtfiles-9105: the Mac CLI reads in the review-5 arm run only off Windows; the route checks run everywhere.
- tasks-tab-3559, team-agent-token-1279: a forced unreadable roster restores to the Windows source, not to "none".
- worlds-import-2563: test-support/jobfixture.useJobStore() (the stand-in Task Scheduler) answers the import's job check.
- dm-delete-7614: the board's keep-alive is longer for this file, since a thousand synchronous writes on a Windows disk
  outlasted the 5 s default and fetch reused a closed socket (ECONNRESET). Weakest premise: the reset cause is reasoned
  from the timing; the run after the change is green, which is consistent, not proof.
- asbrow-4405, guide-on-connect-3660: removing the sandbox retries (Windows frees a stopped board's files a moment later).

## Skipped on Windows, each with its reason and a HOST_BRANCH_EXCLUDED entry
- compat-hidden-7206 (1): the switch-ON control; DeepSeek agents run on a Mac for now. The OFF arm runs on Windows, with
  the add route's own refusal (review round 1).
- link-8719 (3): linking a hand-started window is not available on Windows yet; a Windows-only arm pins the 409 refusal
  (review round 1).
- undo-5153 (1): a file name holding a double quote, which Windows does not allow, and the Mac CLI.
- post-inreplyto-3224 (1), post-restartcite-8178 (1): the folder-in-place-of-the-log setup reads as an empty log on
  Windows, a real product bug that fails open (#9279, filed by another cluster; noted there that these two skips depend
  on it). Their reasons say the subject exists on Windows and fails open there.
- register-routes-6714 (3): the macOS login-job survey this file stands in; on Windows the survey reads Task Scheduler
  (#9284, filed here).
- attachment-range-6805 (1, review round 3): the abandoned ranged download, whose whole subject is the descriptor (#9276).
- attachment-stream-6734 (1, review round 5): the stall arm, whose every check is the descriptor count (#9276).
- Not skips, but not checked on Windows: the other descriptor counts in attachment-stream-6734 and headers-twice-7686 run
  only where /dev/fd exists; the rest of each of those tests runs (#9276, filed here).

## Guarded
- server.faketmux-win-8378.test.js (new, every host): the helper does nothing off Windows; asked to act as Windows it
  answers what fake-tmux.sh answers; server.js still wires the two factories the board-child preload replaces.

## Weakest premises
- The GitHub runner is a Windows Server image run as admin, not Homer's box; his next inventory confirms it.
- These files are not added to the Windows CI selection (tools/windows-tests.js ALSO_ROOT), so nothing keeps them green on
  Windows after this; Homer's full inventory is what would see a regression. Card #9286 (filed in
  review round 1) asks for that decision.
