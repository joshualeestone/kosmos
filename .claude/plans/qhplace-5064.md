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

## Review 1 (blind Opus, on Angel's 90d07ad85): 0 blockers, 1 warning, 4 nits
- Verified: parity with the installed copy line for line; mutants (re-mark writes now, seam off) turn the arms red;
  the fixed arm passed 15 of 15 in a loop.
- WARNING fixed: the test released the box after a fixed 2.5 s, so on a loaded Mac a slow B could miss its place and
  turn the CONTROL red for the wrong reason. It now waits until both waiters have a marker.
- NITs fixed: the message says "re-marked its place" (an unwritable marker dir or a pre-#4911 lib keeps none); a
  stale comment ("a main-lane loser has already left the queue"); a 170-character comment line.
- NIT left: QH_JOINED is taken a few seconds before the library's own join time (the library's check runs in a
  subshell); the only effect is a few-second tie between a light and a heavy waiter, no starvation. Same as installed.

## Review 2 (blind Sonnet): converged, 0 blockers, 0 warnings, 2 nits, both taken
- A timed-out wait for the waiters is now written into the order file, so the ORDER= arms go red instead of passing a
  run that never raced; both waits count exactly the lib's suitewait.<pid> markers (cut-guard.sh:549).
