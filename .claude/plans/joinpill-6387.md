# joinpill-6387: "Too many tries" is Needs you on the pairing pill

Card: kosmos#6387. Page-only.

## What changes
On the joining computer, after every code is used, the block says "Too many tries. On <name>, press Not me on this
request, then sign this computer in again." The computer is still held, so the pill kept "Waiting to be allowed",
which says nothing is needed. `plusJoinPillWord` (web/index.html) now says "Needs you" for `failed === true` as well
as for `needs_retry === true`, under the same live-pairing condition (`plusJoinLive`).

## Decided
- Same word as needs_retry ("Needs you"): both are held, and neither moves until the person acts.
- `failed === true`, strict, as the card says and as needs_retry is read (a page value is never truthy-coerced here).

## Measured (both arms, plusJoinPillWord and plusJoinLive lifted from each page and run)
- main: failed -> Waiting to be allowed (the bug); this branch: failed -> Needs you.
- Unchanged on both: needs_retry -> Needs you; neither -> Waiting to be allowed; a pairing no longer live (not held,
  no code) with failed -> Waiting to be allowed.

## Tests
- docs/browser-checks/render-connect-sheet-4637.js: in the existing "too many tries" step, the pill reads Needs you
  (beside the step for a code that ran out, which already pins Needs you).
