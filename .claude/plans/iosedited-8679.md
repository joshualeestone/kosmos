# iosedited-8679: the iPhone task activity words edited and check-reported as the page does

Card: kosmos#8679 (follow-up from #8664). Night shift, Renet Tilley.

## Problem
ios/Kosmos/TaskPageLogic.swift's activityPhrase (the iPhone's copy of the page's tkActPhrase) had no case for
`check-reported` (#8464) or `edited` (#8664, `kosmos task edit`), so both fell to `default: return kind` and the
person saw the bare word in a task's activity.

## Decision
Two cases, word for word with the page's tkActPhrase:
- check-reported: "<agent> says done-when check <n> is met|is not met[: <how>]" ("An agent" when nobody is named,
  "?" for a check number that is not 1 or more).
- edited: "<who> changed the title from <old> to <new>", "changed the detail", "cleared the detail", joined with
  "and"; "You" for the person; capitalised when nobody is named; "changed the task" with no fields.
Checks in ios/LogicTests/taskpage/main.swift use the fixtures engine/taskactphrase.test.js holds the page to.

Rejected: a shared phrase source for the page, the CLIs and the iPhone (the iPhone cannot run the page's JS; the
page and engine keep their own copies under a parity test, and this follows that).

## Weakest premise
That `edited` ships with these fields. It is on #8664's branch, not yet on main; if review there renames a field,
this case must follow it.
