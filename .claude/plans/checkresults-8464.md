# checkresults-8464: structured done-when check reports (#8464 item 2)

Shape on the card (comment 6832982923); two calls differ, recorded on the card (comment 6833063347).

## What
- `doneWhenResults` on a task, index-aligned with `doneWhen`: null or `{ met, how, by, at }` per check.
  `doneWhen` stays a list of strings, so none of its readers change. No migration.
- `tasks.setCheckResult(project, n, check, met, how, { by })`: named agent required (403), closed task 409,
  no checks / no such check 409, one line of at most 200 characters, an unfilled `<placeholder>` refused,
  the same report again records nothing. Transcript kind `check-reported`.
- Reports go when what they describe goes: a changed check drops its own report, a new or cleared list
  drops all, taking the built mark off / new work / a reopen drop them (with LANDED_FIELDS). Closing keeps them.
- setBuilt: a task whose checks are ALL reported MET may be marked built without a note; a check reported
  not met still needs the note, to say what is left.
- Route `POST /api/project/<id>/task/<n>/check` on done-when's caller terms (processCaller,
  notOnProjectRefusal); the screen is refused (a report is an agent's word). Agent-token pattern list.
- `kosmos task check <p> <n> <i> met|unmet "<how>"` in install/kosmos and the Windows CLI.
- Readers: task show prints each report under its check ("<agent> says met: ..."), task list appends
  "[N of M checks reported met, K reported not met]", the task page gains a Done when list, the Tasks row
  a count. The page phrase for `check-reported` matches engine/taskactphrase.js.
- Rules v49, the built refusal and the two nudge commands name `kosmos task check`.

## Decided, and why
- NOT in BUILT_FIELDS: setBuilt rebuilds from withoutBuilt(t) on every mark, which would wipe the reports.
- Any named project member may report, not only the holder (changeDoneWhen review 4's reasoning: names
  arrive in more than one spelling, assignees let go and retake). Every report names its agent.

## Rejected
- doneWhen as objects (every reader assumes strings; old records would need migrating).
- Parsing the built note (#5705 refused that).

## Weakest premise
That agents use the separate verb rather than only the note. Rules, refusal and nudges point at it.
