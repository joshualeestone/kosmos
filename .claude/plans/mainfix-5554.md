# mainfix-5554: main is red since #5554 merged (16:23); two #5534 tests use constants it removed

Reported by Mona Lisa and Splinter (16:3x). #5554 (#5500 Linux test port) removed LINUX_UNPORTED_WHY and
LINUX_PLIST_5432 and converted every test using them. Two tests that #5569 (#5534) added earlier still named them,
so engine/create.test.js and server.switch-model-5429.test.js fail to LOAD on main (ReferenceError), and every PR's
node suite is red.

## Finished looks like
Both files load and pass on main + this change; nothing else references the removed constants.

## Change
- engine/create.test.js:6833: `LX(WIN_LAUNCHD, LINUX_UNPORTED_WHY)` -> `WIN_LAUNCHD` (what #5554 did to the other 39).
- server.switch-model-5429.test.js:246: drop the `LINUX_PLIST_5432` argument (as #5554 did to its neighbours).

## Why it was missed
Each PR was green against the main it was tested on; #5554 merged after #5569 without its CI seeing #5569's two
tests. My merge-tree gate runs only engine.reachable.test.js, so it could not see a file that fails to load. Follow-up
(Splinter's ask): run the node suite, or at least every test file a PR touches, on main+PR before merging.

## Review log
