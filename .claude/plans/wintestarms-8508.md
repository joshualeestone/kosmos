# wintestarms-8508: follow-ups from the #8456 review cap

Card: kosmos#8508 (Windows lane, handed to Angel by Splinter 2026-11-18 08:32 CST). Test-only.

## Finished means
Each item the card lists is fixed on a branch, the touched Mac tests pass, the new check is shown able to fail, and
Homer has a Windows run of server.test.js and server.disconnect-stop-2570.test.js on the branch.

## Changes
1. WARNING (round-trip arm, server.test.js): the dry removal ends partial on Windows, so its step list is a weaker
   control there. Chosen fix: after the REAL DELETE (which asserts outcome 'removed' on every platform), require its
   steps to include "closed its window" and "took it off the board", and assert the question and reassurance recite
   none of the real labels.
   Rejected: (a) making the dry kill take and restarting the agent afterwards: restarting writes a new ownership row
   and session id, so the DELETE below would act on a different identity than the one created, and it needs a
   Windows run to get right; (b) asserting the dry run's acted.outcome per platform: the Windows value ('partial') is a
   reviewer's reading, not a measurement, and pinning it adds a test of the dry run, not of the question.
   Measured on this Mac: perturbing the reassurance to contain "took it off the board" fails the new check, and the
   OLD dry-run loop did not catch it even on a Mac (its dry run has no such step), so this adds coverage on both.
2. NIT server.test.js: the startup-task comment moves above assertWin32TaskStopped; startsJob and enablesJob are
   together again.
3. NIT server.disconnect-stop-2570.test.js: the stop-acts comment moves above stopActs().
4. NIT plan win-skiparms-8456.md: clearSurvivors() removed from the helper list.
5. NIT jobfixture: a watcher's answer keeps its `code`, so win32Step no longer reads every watcher refusal as exit 1.
   No watcher passes a code today, so behaviour is unchanged.

## Weakest premise
That the real Windows removal's steps include both labels. Reasoned from engine/remove.js (closed its window,
took it off the board are pushed on the non-dry path for every platform), not run on Windows. Homer's run decides it.
