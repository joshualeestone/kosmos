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
  never sends it, so it is never offered there. A placed or unconfirmed post with `closing: true` says "This went through
  as your one summary while the room is held; anything more is not posted until the hold lifts."
- The bash CLI reads both flags with case globs on the captured body (compact, or one space after the colon), not
  printf | grep -q, which this file avoids under pipefail.

Not here: the room's held strip wording in web/index.html (card item 3). A web/index.html change runs every web test,
so it is its own branch.

Rejected: keeping the CLI's inference from a missing `closingUsed` (offered what the board could refuse).

## Version skew
The board and both CLIs ship together in the app, and #6920 (the board side of the exception) is not in a release yet,
so no released board has the exception without `closingEligible`. A new CLI against an older board offers nothing,
which is right: that board cannot take a summary.

## Weakest premise
That `closingEligible` matches what the board then does. Both read the same refused row and closing rows, but the
eligibility is computed at refusal time and the next post can land in a new window (countFrom moved), where the
refused row no longer counts: the summary is then held again and refused with an eligible offer for the new window.

A second, narrower gap: `refusalRecorded` trusts the log snapshot this post read when the row was already there; a row
removed from disk in between (rotation) would make the offer wrong once, followed by a plain refusal.

## Tests
- engine/messages.test.js "#6920": a refused member's refusal carries closingEligible; one that used its summary does not.
- cli.room-reopen-2710.test.js and tools.windows-kosmos-cli-570.test.js: offered with closingEligible; not with
  closingUsed; not from an older board (no flag); the landed line on `closing: true` (placed and unconfirmed; the bash
  test includes a spaced-JSON body) and not on an ordinary post. Mutants, each red: a compact-only bash match (spaced
  case); the bash unconfirmed line removed.
- Not tested: the refused-row write failing (refusalRecorded false); simple to read, hard to arrange in this harness.
