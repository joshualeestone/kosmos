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
What the screen does with it (`deleteNoAnswerShow`):
- still offered: the dialog repaints with THAT plan (a delete that got partway can leave less, or ask for the name),
  so the list and the typed-name gate are current, and the line is shown.
- refused: the board's words in the dialog, the button off, Keep focused, and that agent's delete box hidden (the
  page's rule for any refusal, as loadLeftover), only when the detail page is that agent's (review 5). The kept leftovers are NOT cleared: a refusal can be passing ("try again in a
  moment") or mean the agent is back ("is running"), so the next read decides the removed list (review 2).
- no plan (no answer, or a GET that is not the route's own 200: fetchLeftoverPlan now refuses those): the line, and
  the button as the dialog's own plan (taken when the delete was sent) gates it, so a retry is open (the board re-plans before it acts) (review 3).
The name and a dialog token (`DEL_OPENED`, moved on every open and close) are taken BEFORE the DELETE is sent (review
2: taken after it, Keep pressed during a hanging delete re-asked for a null name). If the person left the dialog
while the delete ran: no answer says nothing in the dialog (see above); a refusal says nothing; a success still settles the screen for the
name that was deleted (`deleteSettled`, shared with the plain success path) but does not close a dialog that is no
longer its own, unless that dialog is open again for the same (now deleted) agent, which closes (review 4). deleteSettled touches the detail page's box and line only when the detail page is the deleted
agent's, and the shared DEL_PLAN only when it is that agent's plan (review 3; before, a delete started from the
removed list wrote its line into whichever agent's page was open).
JSON that is not the route's own (no outcome and no error, whatever the status: a gateway's page, a proxy's {})
counts as no answer. If the person left the dialog meanwhile, the plan is still asked again, and a refusal takes
that agent's delete box and plan away without touching any dialog.
A refusal WITH an answer is unchanged, except that it is dropped once the person has left the dialog.

fetchLeftoverPlan (shared with the detail page and the removed list's Delete): the route's 200 is a plan; its 400 or
500 `{error}` is a refusal in the board's words; anything else is no plan. So only a request the board did not answer
says it could not be reached (review 7).

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
