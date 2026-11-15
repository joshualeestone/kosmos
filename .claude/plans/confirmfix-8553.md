# confirmfix-8553: the #8261 review-cap leftovers

Card: joshualeestone/kosmos#8553 (leftovers of #8261, merged as kosmos#8554). Comments and tests only: no code in
engine/records.js changes.

## Calls
1. Keep main's date rule: a row's `confirmed` is the newer of the written date and its newest kept confirmer.
   Pinned: a backdated source-only write leaves a row on its fresh confirmer's date; CONTROL with no confirmer kept,
   the backdated date stands.
2. Keep, and say so: any write is evidence for the row's date (#6994), a source fix too, while confirmers lists only
   who named the status. So a source fix dated today shows today beside an older confirmer. Pinned by a test.
   Rejected (built in two review rounds, then reverted after round 3): making a status-less write or a nameless
   writer leave the date alone. It silently broke the documented refresh (the agent instructions say a write with
   no date is today; `--confirmed` alone did nothing) and threw away the person's own status check from a terminal
   outside tmux (the board cannot name that writer). Weakest premise of keeping it: the line "confirmed today by
   ana" can pair today's date with ana's older check; what would change my mind is a way to show each confirmer's
   own age without crowding the line.
3. Document: a write the board could not name (no token and no pane it could match, and not the screen; the
   person's terminal outside tmux is one) blanks by and adds nobody; a new status from it empties the confirmers. A
   named writer over CONFIRMER_NAME_MAX is in by and is not a confirmer. Pinned (by/byPerson asserts on the existing
   nameless-write test).
4. Nits: the byte-budget comment is called a typical case with its real caveats (by uncapped, NFKC key expansion,
   JSON escaping, bytes vs characters), re-measured at 1,248 without confirmers; the "stale before the cap" comment
   says the cap alone decides when none is fresh. Left: "you" on the page and "the person" in the CLI.

## Tests
- engine/records-confirmers-8261.test.js: two #8553 tests and a by/byPerson assert; records, server and CLI tests 65 pass.
