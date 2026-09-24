# Auto-hello after model and provider switch restarts (kosmos#2716)

Carries PR #2732 (draft, branch autohello-switch-2716, 2026-09-14) onto current
main as a fresh branch, and fixes the race that kept it in draft.

## What it does
After a model switch (changeModelNow) or a provider switch (changeProviderNow)
restarts an agent, the dialog sends the wake `hello` through #2686's shared
`autoHelloAfterRestart`. If the hello is placed, the dialog's line changes from
"Say hello to <agent> to reactivate them on <provider>." to "Reactivated on
<provider>, and said hello to wake <agent>." Anything short of placed leaves the
manual line, so the dialog never claims a greeting that did not land.

## The race, and the call
#2692 raised changeDialog's hold (RESTART_HOLD_MS) to one K-loader loop, 4400ms.
The readiness wait can accept after two polls, 4000ms. So on a fast respawn the
confirmation arrived before the dialog painted the manual line, the helper saw
no manual line to replace, stood down, and the confirmation was lost.

My 09-14 note held the fix because it touches Josh's hand-tuned interstitial.
Decided now (2026-09-24): the fix does not have to touch it. The report waits
for the manual line: it checks every 100ms until the line appears, the dialog
closes, the agent changes, or RESTART_HOLD_MS + 1s passes. changeDialog, its
hold, and the K loader are untouched, so the timing Josh tuned is unchanged.

Why it cannot land in the wrong dialog: the report keeps its restart's token
(RESTART_HELLO_SEQ, bumped synchronously when autoHelloAfterRestart starts) and
stands down once a newer restart of the agent exists. The matching line alone is
not enough: two switches of one agent to the same provider paint the identical
manual line, and the first restart's report can still be waiting (the review
measured it writing "said hello" into the second dialog). The newer switch bumps
the token before or in the same turn as its own paint. After that, a reopen
resets chg-msg and the content check stands down. The wait's bound reads the
same hold changeDialog was given, test seam included, plus one second.

Rejected: letting changeDialog's floor render choose the confirmation or the
manual line. It is cleaner in principle, but it changes the dialog shared by
every changeDialog caller, for a case the wait already covers.

Weakest premise: that the paint trails the report by less than the hold plus a
second. Reasoned in review: the paint lands at max(busyStart + hold, T0) and the
report no earlier than T0 + 2 polls, so the gap is about 400ms in production.
Only heavy background-tab timer throttling could stretch it past the bound, and
then the dialog shows today's manual line, not a false claim.

(My first statement of the weakest premise, "nothing can close or replace the
dialog before the paint", was the wrong premise: the stale-report case above
was the real gap, and I had not seen it.)

## Deliberately not changed
While the hello is pending the dialog shows the manual "Say hello to ..." line,
where the restart and start flows show "Waking them..." first. A person who reads
it and types hello quickly sends a second, harmless hello. Changing it would
replace the #768 reduced line Josh approved on this interstitial, so it is left
as a follow-up option on the card, not done here. In production the report
usually lands within about a second of the paint (accept at 4000ms or later,
paint at 4400ms).

## Merge notes (onto current main)
- changeProviderNow's provName on main has a keyOnlyProvider branch; kept main's
  line and added the #2716 lines under it.
- main's autoHelloAfterRestart gained an optional `deliver` argument (#3492); the
  switch helper omits it and gets the plain hello.
- Registry: added render-autohello-switch-2716 after render-autohello-2686;
  EXPECTED_CATCH_SITES 90 -> 91 (one launch catch; the top-level catch is
  multi-line), confirmed by browser-checks-reason-grep.test.js.

## Verification
- docs/browser-checks/render-autohello-switch-2716.js, 17 checks. The old source
  invariant (2 x poll > hold), which was red by design, is replaced by three
  behavioural arms: an early report still lands once the line is painted;
  nothing is written if the dialog closes first; the wait gives up after the
  bound. Perturbations, each confirmed applied: no retry reds arm 7, no deadline
  reds arm 9, no closed-dialog guard reds arms 4 and 8.
  Arm 10: a stale report from an earlier restart of the same agent does not
  land in the next dialog (red without the token check). Arm 11 clicks the real
  #d-model-go with the hold (600ms) longer than two readiness polls, so the hello
  is placed before the held render for real (measured 187ms) and the dialog
  still ends on the confirmation. Arm 11b does the same through the real
  #d-provider-go (measured 231ms), which has its own call site and an extra
  accounts refresh. Removing the retry reds arms 7, 11 and 11b; removing the
  provider call site reds 11b.
- web.change-dialog.test.js (source wiring, run from the repo root): 3 pass.
