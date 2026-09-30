# signinflake-4694: render-plus-signin-enter-0929's enrol-pair arm stops flaking

Card: kosmos#4694. Kosmos+ sign-in is one of Josh's priorities, and a check that flakes on main reds every PR whose
Plus change selects it.

## Done looks like
The enrol-pair arm of docs/browser-checks/render-plus-signin-enter-0929.js cannot be undone by a repaint: it passes
every run, and a repaint landing between showing the pair and pressing Enter (what failed CI) changes nothing.

## Cause (measured)
- CI run 36672061656: the email fill succeeded, then Enter sent nothing (posts `[]`), so the code row never showed and
  the next fill (`#plus-name`) timed out. The card's "email box fill timed out" was a misread; the log says otherwise.
- For WAITING (switch on, not enrolled) the pane's own paintPlus hides the connected flow (`enrolled !== true` shows
  state 1), so the check shows the pair by hand. paintPlus is async (it awaits /api/remote) and reruns on a 5s status
  tick. A paint that lands after the hand-showing and before Enter hides the pair again, so the keypress goes nowhere.

## Change (check only; no product change)
- After opening the pane, the check awaits a paint of its own (a newer PLUS_EPOCH, so any paint still in flight
  returns without touching the page), then holds every later GET /api/remote (never answered), so no repaint can
  undo the hand-shown pair.
- A deliberate repaint is fired between the fill and Enter, the gap CI hit, so every run exercises the hazard.

## Measured
- Control: the new check without the settle-and-freeze lines fails 2 of 2 with CI's exact failure (`[]`).
- Fixed: 4 of 4 alone, 8 of 8 under load (4 parallel, twice), 15 checks each.
- Not reproduced on main without the deliberate repaint (6 alone, 12 under load): the natural race is rare here.

## Weakest premise
That the CI failure's repaint came from paintPlus (the click's paint or the 5s tick). Another writer of the pair's
visibility would not be held by the frozen status read. None found: the pair's hidden state is set only in paintPlus
(web/index.html, `plus-enrol').hidden = !(r.on && r.enrolled !== true)`).

## Noted, not in scope
For every /api/remote answer, paintPlus shows the connected flow only when enrolled is true, and the enrol pair only
when enrolled is not true, so the pair may never show on a real board in this build. That is a product question for
the Plus owner, not this check.
