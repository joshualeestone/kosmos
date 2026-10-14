# kosmos#6157 slice B: which agent put a task in Needs your decision, and why

## Change
- engine/tasks.js `waitingOnOf(task, roster, members)`: `[{ who, reason }]` from the SAME cards as waitingOnPerson
  (cardsNeedingPerson), in roster order; `reason` is the project page's code (projects.needsYouReason).
- server.js `GET /api/tasks`: each row carries `waitingOn` (empty unless waiting; a missed run the person reviews
  names no agent, its repeat line says it).
- web/index.html tskRow: a decision row adds "<agent>: <the project page's words for that reason>" (PJ_NEEDS_WHY),
  after its "Waiting on you for ..." line. A missed run is not repeated (its repeat line already says it).

## Decided
- Reuse needsYouReason and PJ_NEEDS_WHY rather than a second list of reasons and words, so the task row and the
  project's Issue list say the same thing.
- A roster card is passed to needsYouReason as present and tied: cardsNeedingPerson already required isNamedOurs.

## Weakest premise
That the project page's words read right on a task row. They were written per agent ("Waiting for your answer."),
which a row prefixed with the agent's name keeps true.

## Evidence
- engine/tasks-waitingon-6157.test.js (real fleet cards): question, trust and crash loop named in order; another
  project's question, a holder off the project and a working agent are not; a done task or no roster names nobody.
- server.tasks-tab-3559.test.js: two asking holders on one task are both named; a task nobody waits on names nobody.
- web.tasks-look-3559.test.js: the page's own tskRow, tskAgentName and PJ_NEEDS_WHY: the line, an unknown code worded
  generally, no line for a missed run, a non-decision or an older board.
- docs/browser-checks/render-tasks-view-3559.js: the real decision row names Max and his question.

## Review
1. opus: no blocker or warning. Taken: the row test now uses the page's real esc with a hostile agent name (removing
   esc reds it); an own-key check on the reason lookup (a `__proto__` code is worded generally; removing the check reds
   it); the missed-run entry dropped from the API (untested and unread); a test message corrected. Left: own_bound's
   "Open it" wording on a row; tskNeedsSig not re-reading on a crash loop (older, not this slice).
