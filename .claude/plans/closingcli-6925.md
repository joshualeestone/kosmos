# closingcli-6925: offer the closing summary only when the board will take it, and say when one landed

Card: kosmos#6925 (follow-up to #6920, claimed: icecreamkitty).

## Problem
After #6920 both CLIs offered "the one exception" on every `room_held` refusal without `closingUsed`. That included a
refusal whose refused row was never written (best-effort), after which the board would hold the summary again, and any
refusal from an older board that has no exception at all. A summary that landed (`closing: true`) was not mentioned, so
the agent learned it was used only on its next refusal.

## Decision
- engine/messages.js: the `room_held` refusal carries `closingEligible: true` when this member's refusal row is recorded
  (already there, or written now without throwing), it has not used a summary in the window, and it has a name.
- install/kosmos and tools/windows/kosmos-cli.js: the exception line is said only on `closingEligible`; an older board
  never sends it, so it is never offered there. A placed post with `closing: true` says "This went through as your one
  summary while the room is held; anything more waits until the room opens."
- The bash CLI reads both flags with `grep -E '"flag": *true'`, so a space after the colon does not hide them.

Not here: the room's held strip wording in web/index.html (card item 3). A web/index.html change runs every web test,
so it is its own branch.

Rejected: keeping the CLI's inference from a missing `closingUsed` (offered what the board could refuse).

## Weakest premise
That `closingEligible` matches what the board then does. Both read the same refused row and closing rows, but the
eligibility is computed at refusal time and the next post can land in a new window (countFrom moved), where the
refused row no longer counts: the summary is then held again and refused with an eligible offer for the new window.

## Tests
- engine/messages.test.js "#6920": a refused member's refusal carries closingEligible; one that used its summary does not.
- cli.room-reopen-2710.test.js and tools.windows-kosmos-cli-570.test.js: offered with closingEligible; not with
  closingUsed; not from an older board (no flag); the landed line on `closing: true` and not on an ordinary post.
