# promote-waitboard-8960: the promote waits for the gate's board to run V (kosmos#8960)

## Why
0.8.19 was promoted with --force because phase A ran before the Mortals board (staging channel) had updated
itself to 0.8.19: the experience gate refused (nothing on :16180 while it installed) or could not tell (old
release). 0.8.20 passed every gate unforced because a stopgap in ~/promote-0820-a.sh on Mortals waited for
the board first. That stopgap lives on one disk. This moves it into tools/promote-channel.sh.

## What
- tools/staging-experience-check.sh: the #5084 version reader becomes one function, read_board_version, and
  a --print-version mode prints only the version (exit 0 / 1 nothing answered / 2 cannot tell). No nonce.
- tools/promote-channel.sh: wait_for_board_on_v before the experience gate, bounded by
  KOSMOS_PROMOTE_BOARD_WAIT (default 1800 s, 0 off) and, while nothing answers, KOSMOS_PROMOTE_BOARD_SILENT_WAIT
  (default 600 s), step KOSMOS_PROMOTE_BOARD_WAIT_STEP (30 s). Waits only
  while nothing answers or the board runs an older release. No wait when the gate command is overridden
  and no reader is named (tests, and any board not known).
- No gate is loosened: exit 1 still refuses after the wait.

## Rejected
- Changing the gate to treat "nothing answers" as cannot-tell: that loosens the provably-broken refusal.
- Reading app/package.json as the stopgap does: a second reader that can disagree with the gate.

## Weakest premise
That a board on the staging channel is the board the gate checks. When it is a prod-channel board, the
wait times out (30 min) and the gates hold as before; KOSMOS_PROMOTE_BOARD_WAIT=0 skips it.

## Tests
test-staging-channel-2036.sh (board wait cases) and test-staging-experience-check.sh (--print-version cases
with a nonce-log control). Each rule was also mutated BY HAND (backup copy, mutate, run, restore) to see the
tests go red; those mutants are not committed, and the PR body lists them with their results.
