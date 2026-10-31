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

## Budget
The ui job takes about 16 of its 40 minutes on main (three runs 10-31). Two checks in a 220-post room add a few minutes.

## Not done
No retry or skip for a slow runner: a check that cannot hold on CI is the finding, not something to hide.
