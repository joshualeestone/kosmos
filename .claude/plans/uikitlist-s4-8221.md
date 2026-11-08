# uikitlist-s4-8221: a CI runner for the UIKit chat list (kosmos#8221, slice 4)

Stacked on uikitlist-s3-8221 (PR #8257), which adds NewMessages checks this slice's class list relies on staying out of CI.

## Finished looks like

CI runs the sample-board UI checks that switch lists on the UIKit chat list as well as the lazy one, in its own job, and
the job passes only when each class ran exactly its own number of checks. The lazy job and ui-flaky-count.sh read the same
as before.

## Why now

The slice-1 plan names two things that come before the slice that lets a phone draw the UIKit list: a runner for the UIKit
arm, and the keystroke cost. This is the runner. Until now the UIKit arm ran only by hand (TEST_RUNNER_KOSMOS_UIKITLIST=1),
so a change could break it with every check green.

## Changes

1. ios/tools/ui-sample.sh `--uikit`: TEST_RUNNER_KOSMOS_UIKITLIST=1, and its own class list: KeyboardSlideUITests:6 (its
   three rebuild checks left out with -skip-testing, since the UIKit list never rebuilds and they would only skip),
   StopAddingUITests:2, SendMovesOnceUITests:3, ComposerSendUITests:3. The first output line names the arm.
2. .github/workflows/ios.yml: job `uikit`, "uikit list (sample board)", beside `ui`, running `ui-sample.sh --uikit`, with
   its own failed-result artifact.
3. ios/tools/ui-flaky-count.sh: select the job by its exact name, "ui tests (sample board)" by default, instead of
   test("ui tests"), so a second ui job can never be the one it reads (head -1 took the first match). A second argument
   names another job, so `ui-flaky-count.sh 10 "uikit list (sample board)"` counts the UIKit job's flakes.
   Runs with no job of that name, and runs whose job list could not be read, are each counted on their own line.
4. Comments naming who runs the arm: UIKitListArm.swift (said nothing ran it), KeyboardSlideUITests.swift, ui-sample.sh.

## Decided

- Call: a flag on ui-sample.sh, not a second script. The simulator, count and flaky logic are the hard part and are shared.
- Rejected: running both arms in one job (one runner, twice the wall time, one red hides which arm); adding the
  260-message classes (ChatOpensAtNewest, NewMessages, ChatSearch, ChatDrag): CI's runner times out querying that chat
  (#7609), so they stay by hand; DotsRefreshUITests, which is run by hand on the lazy arm too (#8078).
- Rejected: keeping the rebuild checks as skips. ui-sample annotates every skip as a warning, so it would warn on every
  green run and a real new skip would not stand out.
- Coverage, stated plainly: 2 of the 14 checks open a project room, which draws the same on either list, so 12 reach the
  UIKit list. They stay in so each class's count matches its file.
- Left for a card, not this slice: ComposerSendUITests is now in CI on the UIKit list only; adding it to the lazy job
  (the shipped list) is a change to that job's scope, not to this runner.
- Weakest premise: that CI's slower runner passes the UIKit arm as this Mac does. The first CI run on this PR is the
  measurement; a red there is a finding about the arm, not a reason to drop the job.
- Would change my mind: the job flaking on SendMovesOnce timing (it skips itself when too slow, which ui-sample names).

## Status

- [x] Changes made, bash -n clean on both scripts, ios.yml parses (jobs: build ui uikit).
- [x] `ui-sample.sh --uikit` on this Mac, 11-08 12:19-12:25 CST, iPhone 17e iOS 27.0: PASS 14 of 14 (first line names the
      UIKit list).
- [x] Control that the switch reaches the tests, 12:25-12:29: a throwaway copy with the three rebuild checks kept in,
      run with --uikit: 9 of 9, 3 SKIPPED with "the UIKit list never rebuilds", which only UIKitListArm.on produces.
      Without the switch reaching the test runner they would have run (and pass on the lazy list), so this can tell.
- [ ] Lazy run unchanged: by reading, the env var is now passed as 0 and UIKitListArm.on reads == "1" (so a shell that
      exported it as 1 now gets the lazy list on a plain run, as the first line says). Measured by CI's ui job on this PR.
- [x] ui-flaky-count.sh 2: default job 2 with a verdict; "uikit list (sample board)" 0, with "2 of 2 runs had no job
      named" it (it has not run on main yet).
- [ ] CI's new job on this PR.
