# Auto-hello after model and provider switch restarts (kosmos#2716)

Carries PR #2732 (draft, branch autohello-switch-2716, 2026-09-14) onto current
main as a fresh branch, and fixes the race that kept it in draft.

## What it does
After a model switch (changeModelNow) or a provider switch (changeProviderNow)
restarts an agent, the dialog shows "Restarted on <provider>. Waking them..."
and sends the wake `hello` through #2686's shared `autoHelloAfterRestart`. The
line then resolves: to "Reactivated on <provider>, and said hello to wake
<agent>." if the hello was placed, or to "Say hello to <agent> to reactivate them
on <provider>." if it was not. So the dialog never claims a greeting that did not
land, and never tells a person to do by hand what the app is already doing. This
is the pattern the restart and start flows already use ("Restarted. Waking
them...", "Started X. Waking them...").

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

## The waiting line: a reversed call
I first kept the manual "Say hello to ..." line as what the dialog paints, and
only replaced it with the confirmation. Two blind reviewers (passes 3 and 5)
objected, and the second was right on the numbers: my "the report usually lands
within a second of the paint" used the fastest accept (the second 2000ms poll).
A real respawn often stays restarting longer, so the common case was: the dialog
tells the person to say hello, they click Done, the app says hello anyway, and
nothing on screen admits it (or they type hello too). I kept the manual line
because it is the #768 reduced line Josh approved; but that line was written
when there was no auto-hello, and the sibling flows he approved already show a
waiting line. Copy is reversible, so this is decided, not asked.

What would change my mind: Josh preferring the instruction to stay visible even
while the app is sending the hello.

## Merge notes (onto current main)
- changeProviderNow's provName on main has a keyOnlyProvider branch; kept main's
  line and added the #2716 lines under it.
- main's autoHelloAfterRestart gained an optional `deliver` argument (#3492); the
  switch helper omits it and gets the plain hello.
- Registry: added render-autohello-switch-2716 after render-autohello-2686;
  EXPECTED_CATCH_SITES 90 -> 91 (one launch catch; the top-level catch is
  multi-line), confirmed by browser-checks-reason-grep.test.js.

## Verification
- docs/browser-checks/render-autohello-switch-2716.js, 19 checks. Arms 1-9 run
  with a 300ms test hold so no retry outlives its arm; the real-path arms use a
  1500ms hold (a reviewer measured a 767ms report under 20x CPU throttling).
  Comparing against the wrong line reds 8 of the 19. The old source
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
  Arm 9b paints 500ms past the hold, measured from the report, so dropping the
  one-second margin reds it. Arm 11c: a real switch that does not restart
  (outcome partial) sends no hello; dropping `restarted` from the guard reds it.
- web.change-dialog.test.js (source wiring, run from the repo root): 3 pass. It
  now expects the waiting line and pins switchWaiting's construction and use.
- render-model-restart-interstitial.js (#768/#2692) asserted the reduced
  "Say hello" line after the hold; it now asserts "Restarted on <provider>.
  Waking them..." and keeps its one-vocabulary check (Anthropic, never Claude).
  Passes.
