# uikeyboard-7690: the room's keyboard checks in CI's sample-board run (kosmos#7690)

Built stacked on Angel's #7654 part 2 and held until it merged (#7715), because main carried the check's XCTExpectFailure
until then. Now on main directly, squashed: the three review rounds' fixes are in one commit (backup tag
backup/uikeyboard-7690-d12bae0c2d holds them separately).

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

The runs that count are on the head that merges: after the rebase onto main (once part 2 merges), THREE green runs of
the ui job on the rebased head before merge (a push, then re-runs of the same job), not one: this 220-post room has
stopped short on CI once already, and one pass cannot rule that out. A green stacked run is cited only as the stacked
run. Any red is read before anything else: it is the finding, and the class stays out until it is understood.

## Budget
Measured: the ui job took 16, 16 and 15 of its 40 minutes on three main runs (10-31). The two room checks' cost is not
measured yet; the PR's run is that measurement, and its duration goes on the card.

## Shared trace file
Both read-higher-up checks append to the app's one Documents/trace.txt. The dump names which of them ran and the
file's length, and prints the whole file (not a tail) when the DM check failed and the room check ran after it, since
the DM check's events then open the file. Tested on four fake logs against the script's own block, under set -u. Not done: a trace file per check,
which needs an app change in ChatView.trace for a diagnostic that does not decide red or green.

## Not done
No retry or skip for a slow runner: a check that cannot hold on CI is the finding, not something to hide.
