# kosmos#6157 slice B: which agent put a task in Needs your decision, and why

## Change
- engine/tasks.js `waitingOnOf(task, roster, members)`: `[{ who, reason }]` from the SAME cards as waitingOnPerson
  (cardsNeedingPerson), in roster order; `reason` is the project page's code (projects.needsYouReason).
- server.js `GET /api/tasks`: each row carries `waitingOn` (empty unless waiting); a missed run the person reviews is
  `{ who: null, reason: 'missed_run' }`.
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
