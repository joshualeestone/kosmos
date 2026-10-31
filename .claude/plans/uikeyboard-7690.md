# uikeyboard-7690: the room's keyboard checks in CI's sample-board run (kosmos#7690)

Stacked on Angel's roomhold2-7654 (#7654 part 2) at eab682eb10, agreed with Angel 14:05 CDT 10-31: on main,
testRoomNewestStaysAboveTheBox still carries XCTExpectFailure, so adding the class there would run a check that passes by
being expected to fail; part 2 deletes that block and rewrites the header this change edits. Rebased onto main once
part 2 merges.

## Change
- `ios/tools/ui-sample.sh`: `RoomKeyboardUITests:2` joins `classes=`, so the run asserts both of its checks ran
  (the per-class count refuses a filter that matched nothing). The header lists it.
- The script's scroll-trace dump on failure also fires for `RoomKeyboardUITests testRoomReadHigherUpStaysWhereItWas`,
  which records the same trace on part 2 (KOSMOS_SAMPLE_TRACE), so a failure on CI's runner shows why.
- `RoomKeyboardUITests.swift` header: "Still not in ios/tools/ui-sample.sh" replaced by where it runs.
- `ios.yml`: the ui job's comment names the long room's keyboard.

## The measurement the card asks for
"One by-hand run on CI's runner passes" is this PR's own CI run: the ios workflow runs on any pull_request touching
ios/**, on macos-latest, the same job. If it fails, the failure is read (the trace dump above) and fixed or the class
stays out; the PR does not merge red.

The run that counts is the one on the head that merges: after the rebase onto main (once part 2 merges), the rebased
head's own CI run, not this stacked branch's. A green stacked run is cited only as the stacked run.

## Budget
Measured: the ui job took 16, 16 and 15 of its 40 minutes on three main runs (10-31). The two room checks' cost is not
measured yet; the PR's run is that measurement, and its duration goes on the card.

## Shared trace file
Both read-higher-up checks append to the app's one Documents/trace.txt. The dump names which of them ran, and shows
200 lines instead of 60 when the DM check failed and the room check wrote after it. Not done: a trace file per check,
which needs an app change in ChatView.trace for a diagnostic that does not decide red or green.

## Not done
No retry or skip for a slow runner: a check that cannot hold on CI is the finding, not something to hide.
