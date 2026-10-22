# rollup-6501: one press closes the built subtasks and then the parent

Card: kosmos#6501 (agent feedback 10-18 and 10-22, two installs). Item 1 shipped in #6505. Decided on the card
(comment 6348486307, after Splinter's 13:04 hand-off); the superseded state is split out as #6923.

## Decided
- The parent's task page already says, when every subtask is closed or built, "All subtasks are built. Check each one
  and close it, then close this task." with nothing to press. It now reads "All subtasks are built. Check each one first."
  (Mona Lisa's design review: the old words repeated the link's) with a link, "Close them and this task", in the style of the all-done line's
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
- The existing bulk route, POST /api/tasks/close (screen-only, an ordered list, the same tasks.close): it carries on
  past a refusal and skips tasks already closed, so the parent could close after a subtask was refused. This press
  must stop at the first refusal and leave the parent open, so it makes one call per task, in order. (Corrected in
  review round 3: the first version of this line said no such route existed.)
- The same link on the Tasks board row ("all subtasks built, ready for you to check"): the check happens on the
  parent's page, where the person sees each subtask.

## Weakest premise
- That closing the built subtasks is what the person means by accepting them. A subtask never marked built keeps the
  line hidden, so this never closes unbuilt work.

## Tests
- web.subtasks-3861.test.js pins the line's new HTML.
- docs/browser-checks/mobile-shots.js: a task-rollup-6501 screen (a throwaway project, deleted after) for the design shots.
- docs/browser-checks/render-subtasks-3861.js, at 1400 and 390: the line offers the link; a refusal on subtask 3
  stops after closing 2, names #3 and leaves the parent open; a second press closes 3 and then the parent; the
  already-closed subtask stays closed; no message after success.

## Review round 1
- The press was live again before the reload, so a quick second press re-posted every close (no wrong state, but
  fresh close times and fresh notices). It now repaints first, then re-enables, as Mark as done does; the node test
  pins that order.
- Not changed: a person's repeat rule dropped on a built subtask. The engine never lets the two meet: setBuilt
  refuses a repeating task ("a recurring job is never built, waiting"), and setRepeat drops the built mark.
- Also: the subtasks are sorted by number (as the list), the stale-state guard also covers every subtask already
  closed and clears an old message, a refused parent says its built subtasks are closed, and focus moves to Mark as
  done once the line is gone.

## Review round 2
- The browser check now also drives a request with no answer (aborted on task 3: 2 closes, the parent stays open,
  "We could not finish closing them") and a double press, counting the close requests (3, then the parent, once
  each). The node order pin alone could not see a missing disabled flag.
- Not changed (NITs): focus after a refusal (as Mark as done), a press that outlives leaving the page (the reload
  repaints), and the subtask-refusal message not counting the subtasks it already closed (the list shows them).

## Review round 3
- The plan said no route closes a family in one call; POST /api/tasks/close does. The real reason not to use it is
  now written above: it carries on past a refusal, and this press must stop there with the parent open.
- A refused subtask now counts what this press already closed ("1 subtask before it is closed."), as the
  refused-parent message already did.
- Focus moves to Mark as done only when the reload worked (the line is gone only then).
- The browser check has a third built subtask after the refused one, so it proves the press stops (5 is never
  asked), and it checks the focus move.
- mobile-shots.js: the two throwaway-project screens delete through one helper, throwawayProjectGone(page, name).
- Known, stated: a built subtask that has open subtasks of its own counts as built (as tkPaintSubtasks shows it), so
  this press closes it and leaves its own subtasks open. The line says to check each one first; the engine allows it
  (nothing cascades).
