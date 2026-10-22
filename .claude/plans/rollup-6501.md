# rollup-6501: one press closes the built subtasks and then the parent

Card: kosmos#6501 (agent feedback 10-18 and 10-22, two installs). Item 1 shipped in #6505. Decided on the card
(comment 6348486307, after Splinter's 13:04 hand-off); the superseded state is split out as #6923.

## Decided
- The parent's task page already says, when every subtask is closed or built, "All subtasks are built. Check each one
  and close it, then close this task." with nothing to press. It now reads "All subtasks are built. Check each one,
  then close them and this task." with a link, "Close them and this task", in the style of the all-done line's
  "Close this task".
- One press closes each built subtask (ascending), then the parent, one POST each to the same close route Mark as done
  uses. No engine change, no new state, no new tile. Closing stays the person's act (#3951).
- The first refusal stops it: "Task #N: <the route's sentence>. This task is still open." A thrown fetch says it could
  not finish and that the list shows where it stopped (the page cannot know whether the last request landed); the
  reload repaints the truth either way.
- If the poll moved the world since the paint (the parent closed, or a subtask no longer closed or built), the press
  repaints instead of acting, as Mark as done does.

## Rejected
- Auto-closing built tasks (#3951: closing is the person's "it is live").
- A "reviewed and delivered" state; the daily status view (item 3) stays parked.
- One server route that closes a family in one call: a second close path to keep in step with setClosed's side
  effects (built, hold and repeat dropped, events). Several calls through the one route keep one path.
- The same link on the Tasks board row ("all subtasks built, ready for you to check"): the check happens on the
  parent's page, where the person sees each subtask.

## Weakest premise
- That closing the built subtasks is what the person means by accepting them. A subtask never marked built keeps the
  line hidden, so this never closes unbuilt work.

## Tests
- web.subtasks-3861.test.js pins the line's new HTML.
- docs/browser-checks/render-subtasks-3861.js, at 1400 and 390: the line offers the link; a refusal on subtask 3
  stops after closing 2, names #3 and leaves the parent open; a second press closes 3 and then the parent; the
  already-closed subtask stays closed; no message after success.
