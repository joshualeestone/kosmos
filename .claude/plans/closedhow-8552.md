# Plan: kosmos#8552, a closed task says how it closed

Card: joshualeestone/kosmos#8552 (split from #8261 item 2; recommendation decided there: derive it, do not ask for it).

## Call
- Derive the word in the engine (engine/tasks.js closedHowAt) from the marks a task carries AS IT CLOSES, and keep it on
  the task (`closedHow`), because closing drops the built mark (#3951) and the fingerprint with it. Both close paths:
  setClosed (explicit close) and writeParts (the last part closing). A reopen clears it; a re-close keeps the first.
- change: landedCommit with landedOnRemote === true, or builtFingerprint / builtFilePath. note: built with neither
  (a commit only on this computer included: the card says "on a remote"). unbuilt: never marked built.
- Readers get the engine's closedHowOf on both task reads (allTasks for the Tasks view and the CLI, joinTaskClaims for the
  task page). It is null for open tasks, replaced and not-run closes (they keep their own words, #6923 / #8301), and for
  tasks closed before this, except a commit on a remote, which survives a close and so can still be read.
- Shown: Tasks view row (a quiet .why line), task page state words, `kosmos task show` state. Left out where the board's
  landedCheck says the change cannot be found (that line already says so; "with a change" would contradict it).

## Rejected
- A flag or verb on close (self-reported: the weakness the card names).
- Deriving at read time from live fields (closing deletes them).
- Guessing "unbuilt" for old closes with no record (they may have been built).
- A new gated browser check: one more text line with the existing .why class; the real page functions are run by lifted
  tests (web.subtasks-3861, web.task-page). Trailer on the commit.

## Weakest premise
A landed commit proves something was committed and pushed, not that it fixed the thing.

## Tests
engine/tasks.closedhow-8552.test.js (every arm, controls, both read paths, CLI words), plus row and task page tests.
Mutants run on every site; each red.
