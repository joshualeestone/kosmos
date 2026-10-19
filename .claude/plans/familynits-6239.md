# familynits-6239 (kosmos#6239: follow-ups from the #6304 review ledger)

Picked with Renet 07:48 CDT 10-16 ("take your own ledger follow-ups as one PR"). Test-only.

## What this does
- R20 in `docs/browser-checks/render-org-family-6239.js`: sign-out (paintPlus's not-signed-in branch) also resets
  `PLUS_ORG.carried`, `reviewAccepted` and `at`, but R19 pinned only the words closing and the held-back release. R20
  plants each, signs out and in through paintPlus, and asserts the first signed-in paint reads at once (the gate) and
  shows neither the carried leave-refused line nor "could not record". One mutant per reset must red R20.

## Decided, not done
- The review-18 NIT "Not now can focus nothing if a read hid the words row" is NOT fixed: it is unreachable. Every path
  that could leave the row hidden once the words close (a read saying not joined or not needed, `wordsRefused`, a
  sign-out) also closes the words itself: plusOrgPaint's panel-follows-view rule on every read that changes the state;
  `wordsRefused` is set only where the words are already closed or never opened; a sign-out hides them. While an
  Accept is in flight, Not now returns early (busy). So Not now cannot be pressed with the row hidden. A
  guard for it would be code no arm can drive. What would change this: a path that sets `wordsRefused` while the review
  panel stays open.

## Weakest premise
That the planted values match what the real flows leave: `carried` is the shape plusOrgMaybe writes, `reviewAccepted`
is a time before the read (as plusOrgFamilyAccept sets it), `at` is now (as any read sets it).
