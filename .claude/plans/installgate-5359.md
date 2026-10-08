# installgate-5359: bless board-alive.json in the install gate (0.7.28 cut blocker)

The 0.7.28 cut failed at step 4b: the sandboxed install added ./Kosmos/board-alive.json, which tools/test-install.sh's EXPECTED_ADDS does not name. #5497 (#5359 part 1) makes the board write it at start (engine/restartnote.js atStart -> beat), and the gate runs only in the cut, so #5497 merged green.

Change: add ./Kosmos/board-alive.json to EXPECTED_ADDS in sort order (after bin/, before community.json; the same in C and UTF-8 collation), with the comment entry the list keeps for every blessed file. Nothing else.

Verified: bash -n; the cut's own step 4b re-runs this gate on the re-cut, which is the real measurement. The gap (a PR adding a board-start file merges green and fails only at release) is carded separately.
