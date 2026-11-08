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
3. ios/tools/ui-flaky-count.sh: select the job by its exact name, "ui tests (sample board)", instead of test("ui tests"),
   so a second ui job can never be the one it reads (head -1 took the first match).

## Decided

- Call: a flag on ui-sample.sh, not a second script. The simulator, count and flaky logic are the hard part and are shared.
- Rejected: running both arms in one job (one runner, twice the wall time, one red hides which arm); adding the
  260-message classes (ChatOpensAtNewest, NewMessages, ChatSearch, ChatDrag): CI's runner times out querying that chat
  (#7609), so they stay by hand; DotsRefreshUITests, which is run by hand on the lazy arm too (#8078).
- Rejected: keeping the rebuild checks as skips. ui-sample annotates every skip as a warning, so it would warn on every
  green run and a real new skip would not stand out.
- Weakest premise: that CI's slower runner passes the UIKit arm as this Mac does. The first CI run on this PR is the
  measurement; a red there is a finding about the arm, not a reason to drop the job.
- Would change my mind: the job flaking on SendMovesOnce timing (it skips itself when too slow, which ui-sample names).

## Status

- [x] Changes made, bash -n clean on both scripts, ios.yml parses (jobs: build ui uikit).
- [ ] `ui-sample.sh --uikit` run on this Mac.
- [ ] Lazy run unchanged (the env var is now passed as 0; UIKitListArm.on reads == "1").
- [ ] CI's new job on this PR.
