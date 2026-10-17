# askbanner-6315: the Kosmos+ join notice can be dismissed, and Review clears it

Card: #6315 follow-up (Josh 2026-10-16 19:41, via Splinter). Owner: Angel. Target: 0.7.55, with the relay pairing fix.

## Done means
On any view but Kosmos+, the one-line "Your computer X wants to join. Review" notice has a close button. Pressing it,
or Review, puts that set of requests away: the notice stays hidden across repaints and a reload (per browser). A new
request brings it back. The request cards on the Kosmos+ page are unchanged.

## Steps
1. [x] web/index.html: paintAsk's off-Plus branch keys the notice on the waiting request ids plus the "here" browser
   (ASK.noteKey) and hides it when that key was dismissed; askAct 'note-dismiss' and 'open' record it
   (localStorage kosmos.asknote.dismissed, in-memory if storage throws). A 44px close button.
2. [x] render-plus-asks-signin-4610.js: dismiss hides, a repaint keeps it hidden, CONTROL a new request brings it
   back, Review clears it, at 1400 and 390. Mutant (ignore the dismissal): 6 arms red.
3. [x] render-plus-panel-3829.js: its earlier Review press now dismisses, so the #3978 focus arm restores the
   notice first.

## Decided, not missed
- Per browser, not per board: join requests end on Allow or Not me, so the store only needs to outlive a reload.
  Mona Lisa's #6341 project notices are server-side because they last; same rule (a new thing comes back), two
  stores, agreed with her 19:4x.
- The cards on Kosmos+ keep no dismiss: they are the place the decision is made.
