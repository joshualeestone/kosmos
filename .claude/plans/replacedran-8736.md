# replacedran-8736: a task replaced after it ran is not counted "never run" (kosmos#8736)

Card: kosmos#8736 (from the review of #8734, Mona Lisa's taskcli-8734, which refuses `--not-run` over a record that
says the task ran). Off main; opened only after taskcli-8734 merges, and at that rebase its inline "it ran" test is
switched to call `ranOnRecord` (agreed with Mona Lisa in Fleet Builders, 10:35 CST 11-19: my name and shape, her rules).

## Finished means
`kosmos task close <n> --replaced-by <m>` on a task whose own record says it ran (a check reported met, a run recorded,
or a built mark, or what its close kept of one) records it replaced and done, not "closed without running": a parent's
subtask count puts it in done and not in unrun. A replaced task with nothing on record is still unrun, exactly as
#8301 counts it. Replacing finished work stays allowed (no refusal). Proven by engine tests, with controls.

## How
- engine/tasks.js `ranOnRecord(t)`: { met, ran, built, any } from the task's own record, read before a close takes the
  built mark away. Met checks only (an unmet one can mean the part moved on, movedTo); `lastRunAt` (kept through a
  close and a reopen); `builtAt`, or `closedHow` 'note'/'change', or a `landedCommit`. Exported.
- setClosed: a newly replaced task gets `closedUnrun: true` only when `ranOnRecord(t).any` is false; when it ran, it
  gets `closedUnrun: false`. A reopen deletes the field, as before.
- `closedUnrunOf(t)` is the one place the subtask count decides unrun: `closedUnrun === true`, or replaced and
  `closedUnrun !== false`. So a task replaced before #8301 (no field at all) still counts unrun by its link, as it
  always did, and only a ran-then-replaced task (explicit false) leaves the unrun bucket.

## Decided
- Not a refusal: the card's own reasoning (replacing finished work is legitimate).
- An explicit `false` rather than leaving the field unset: the count also reads the replaced link (#8301 kept old
  replaced tasks counted unrun), so unset would still count it unrun. Every other reader tests `closedUnrun === true`
  (tasklist.js, the Windows CLI, web/index.html), so `false` reads as "not marked never run" everywhere.
- Rejected: changing the count to ignore the link altogether (it would move every pre-#8301 replaced task to done).

## Weakest premise
That nothing outside the readers grepped (`closedUnrun` and `.unrun` across engine, server, web, tools, ios) treats a
present-but-false `closedUnrun` as truthy-present. The grep found only `=== true` tests.

## Tests
- engine/tasks.replacedran-8736.test.js (8): nothing on record stays unrun (control); a met check, a built mark, a run
  recorded, and a built close replaced later each count done and not unrun; an unmet check stays unrun; a pre-#8301
  replaced task (no field) still counts unrun; a reopen clears the false; ranOnRecord's own cases.
- 30 existing test files that mention closedUnrun, replacedBy, unrun, subtaskProgress or treeOf: 488 pass, 0 fail
  (run from the repo root).
