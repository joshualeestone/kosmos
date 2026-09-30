# signinflake-4694: render-plus-signin-enter-0929's enrol-pair arm stops flaking

Card: kosmos#4694. Kosmos+ sign-in is one of Josh's priorities, and a check that flakes on main reds every PR whose
Plus change selects it.

## Done looks like
The enrol-pair arm of docs/browser-checks/render-plus-signin-enter-0929.js is not undone by a paintPlus repaint,
whether the repaint started before the hand-showing (still in flight) or after it (the 5s tick, where CI failed):
the arm passes every run. The after case is asserted in the check (the post-fill repaint must be held, and the
pair visible at Enter). The before case rests on paintPlus's epoch order and was proven red/green by a probe (below),
not by an arm in the check.

## Cause (measured)
- CI run 36672061656: the email fill succeeded, then Enter sent nothing (posts `[]`), so the code row never showed and
  the next fill (`#plus-name`) timed out. The card's "email box fill timed out" was a misread; the log says otherwise.
- For WAITING (switch on, not enrolled) the pane's own paintPlus hides the connected flow (`enrolled !== true` shows
  state 1), so the check shows the pair by hand. paintPlus is async (it awaits /api/remote) and reruns on a 5s status
  tick. A paint that lands after the hand-showing and before Enter hides the pair again, so the keypress goes nowhere.

## Change (check only; no product change)
- After opening the pane the check lets one paint run, then holds every later GET /api/remote (never answered).
- Then, BEFORE showing the pair, it starts one more paint. That paint waits on a held read forever and takes a newer
  PLUS_EPOCH, so any paint still in flight (one that started during the first and was answered before the hold)
  returns without touching the page. Round 1's review reproduced that case: awaiting one paint alone did not cover it.
- A repaint that starts between the fill and Enter (the gap CI hit) is fired on purpose; its read is held.

## Measured
- A repaint AFTER the hand-showing: without the hold, 2 of 2 red with CI's exact failure (`[]`).
- A repaint that started DURING the settle (a second paint, its read slowed 400ms, a 500ms slow-machine wait before
  the fill): without the held paint before showing the pair, 5 of 6 red; with it, 0 of 6.
- The check itself: 4 of 4 alone after the round 1 fix (8 of 8 under load before it), 15 checks each.
- Round 2: the arm now asserts the hold engaged (at least 2 held reads before Enter) and that the pair is on screen
  after it is shown. A route that stops consulting the hold, and a missing hold, each fail with "the hold engaged: 0"
  named first, not only a later timeout. 3 of 3 green with 17 checks.
- Round 3: visibility is checked again just before Enter (the gap CI hit), the first held read must happen before the
  pair is shown, and a missing code request skips the code step with a named FAIL instead of a 30s timeout.
- Round 4: the hold check now requires the post-fill repaint's own read to be held (the count must rise past its
  value at the fill), so a tick read cannot satisfy it; the claims now say which case the check asserts and which a
  probe proved.
- Round 5: the email fill is short and named (3s, a named FAIL), so a repaint between the show and the fill fails by
  name with exit 1 instead of a 30s timeout (hiding the flow before the fill: 4 named FAILs, exit 1). Comments say
  which guard covers which moment. The unreachable pair is its own card, #4698.
- Not reproduced on main without the deliberate repaint (6 alone, 12 under load): the natural race is rare here.

## Weakest premise
That the CI failure's repaint came from paintPlus (the click's paint or the 5s tick). Another writer of the pair's
visibility would not be held by the frozen status read. None found: the pair's hidden state is set only in paintPlus
(web/index.html, `plus-enrol').hidden = !(r.on && r.enrolled !== true)`).

## Noted, not in scope
For every /api/remote answer, paintPlus shows the connected flow only when enrolled is true, and the enrol pair only
when enrolled is not true, so the pair never shows on a real board in this build: certain from the code (the enrol
write runs only after the early return for enrolled !== true, and nothing else writes plus-enrol); not seen on a live
board. Filed for the Plus owner as #4698. The arm shows the pair by hand and freezes
repaints, so it tests the Enter handler only and cannot see this.
