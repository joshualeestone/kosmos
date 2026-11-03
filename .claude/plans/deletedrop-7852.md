# deletedrop-7852: a dropped delete request no longer says "Nothing was deleted"

Card: kosmos#7852 (found in review of #7835).

## Call
When the DELETE of what is left gets no readable answer (no response, or a body that is not JSON: a reload, a sleep,
a proxy's page), the dialog asks for the plan again (GET .../leftover) and says what that finds
(`deleteNoAnswerLine`):
- the plan refuses: its own words. After a finished delete that is "nothing of X is left on this computer"; while a
  delete runs off the board (#7835's branch) it is "a delete of what is left of this agent is running now".
- the plan still offers a delete: "what is left of this agent is still here. Try again." (not "nothing was deleted",
  which a delete that got partway would make false).
- no plan either: "we cannot tell whether anything was deleted. Look again in a moment."
What the screen does with it (`deleteNoAnswerShow`, review 1):
- still offered: the dialog repaints with THAT plan (a delete that got partway can leave less, or ask for the name),
  so the list and the typed-name gate are current, and the line is shown.
- refused: nothing is offered any more, so the dialog closes and the screen is put right exactly as after a delete
  (`deleteSettled`, shared with the success path: the name leaves the kept leftovers, the detail page's box hides,
  the removed list redraws), with the board's words where the success line goes.
- no plan: the line in the dialog, and the button stays off.
A late answer is dropped if the dialog was closed or opened again meanwhile (`DEL_OPENED`, bumped on open and close).
A refusal WITH an answer is unchanged.

## Why it helps on main as well
On main the delete runs on the board's own thread, so the second GET waits for it and answers with the state after
it. On #7835's branch the GET answers at once with "running now". Both are true answers.

## Rejected
- The board keeping the last delete's answer for a while (the card's other option): a server change for a case the
  re-asked plan already answers.

## Not built here: the card's second half
A page reloaded during a delete hides the delete box (the plan refuses with "running now") and says nothing. The words
come from #7835's branch (DELETING_BECAUSE), which is Angel's and not merged. Recommendation on the card: give that
plan a `running: true` field, and have loadLeftover show its `because` in the box instead of hiding it.

## Weakest premise
That the re-asked plan answers at all after a dropped request. If the board is unreachable for the second read too,
the line says nobody knows, which is honest but not helpful.
