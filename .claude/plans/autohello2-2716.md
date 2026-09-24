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

Why it cannot land in the wrong dialog: while the interstitial is up there is no
way out of the modal (keep is hidden, Escape is gated on the disabled button),
so the first manual line that appears was painted by this restart's own `say`.
After that, a reopen resets chg-msg and the content check stands down.

Rejected: letting changeDialog's floor render choose the confirmation or the
manual line. It is cleaner in principle, but it changes the dialog shared by
every changeDialog caller, for a case the wait already covers.

Weakest premise: that nothing can close or replace the dialog between the
report and the paint. It holds today because the interstitial has no exit. If a
backdrop-click close is ever added (the #1313/#1316 comments contemplate one),
arm 8 of the browser check covers the closed case, and the content check covers
a reopen.

## Merge notes (onto current main)
- changeProviderNow's provName on main has a keyOnlyProvider branch; kept main's
  line and added the #2716 lines under it.
- main's autoHelloAfterRestart gained an optional `deliver` argument (#3492); the
  switch helper omits it and gets the plain hello.
- Registry: added render-autohello-switch-2716 after render-autohello-2686;
  EXPECTED_CATCH_SITES 90 -> 91 (one launch catch; the top-level catch is
  multi-line), confirmed by browser-checks-reason-grep.test.js.

## Verification
- docs/browser-checks/render-autohello-switch-2716.js, 12 checks. The old source
  invariant (2 x poll > hold), which was red by design, is replaced by three
  behavioural arms: an early report still lands once the line is painted;
  nothing is written if the dialog closes first; the wait gives up after the
  bound. Perturbations, each confirmed applied: no retry reds arm 7, no deadline
  reds arm 9, no closed-dialog guard reds arms 4 and 8.
- web.change-dialog.test.js (source wiring, run from the repo root): 3 pass.
