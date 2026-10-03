# qhplace-5064: the repo's queued-heavy.sh keeps a lost take's place (#5064), as the installed copy already does

Card: joshualeestone/kosmos#5064. Live in ~/.cache/claude-handoffs/queued-heavy.sh since 2026-10-02 15:53 CDT.
Base: Angel's queuewrap-4977 (#4977 brings tools/queued-heavy.sh into the repo without this fix). This branch is a
FOLLOW-UP: its PR opens after #4977 merges, rebased onto main. Angel asked (19:13) that nothing be pushed to their
branch.

## Change
- tools/queued-heavy.sh: the live #5064 change, applied as the same patch (pete-carry/qh-5064.patch, 16 lines):
  QH_JOINED is taken before the wait; after a lost MAIN-lane take, kosmos_mark_suite_waiting "$QH_JOINED" writes the
  marker back with the original join time; a QH_TEST_LOSE_TAKES test seam (main lane only), unset for the command.
- tools/test-queued-heavy-4977.sh: three arms. The seam fired; a waiter that lost its take ran before a later joiner;
  CONTROL: the same scenario on a copy without the re-mark lets the later joiner go first. Expected count 79 -> 82.

## Verification
- tools/test-queued-heavy-4977.sh: 82 OK, 0 BAD (2026-10-02 20:43 CDT), the control arm included.

## Weakest premise
The instant race between two takes is not closed; only the loser's place is kept (as on the card).
