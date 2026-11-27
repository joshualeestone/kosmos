# listmarks-9188: a task's own title cannot print a row mark in `kosmos task list`

Card: kosmos#9188 (the task list's half of #9179; claimed by Mona Lisa 11-26 21:5x). Built on PigeonPete's
markwords-9179 (PR #9198, converged and validated, held only by the 0.8.27 cut) and rebased onto main once it merges.

## Done when

In all three list printers (Mac install/kosmos `task list`, Windows tools/windows/kosmos-cli.js taskList, and
engine/tasklist.js for the compact and across lists), an ordinary task's title that uses one of the list's mark words
prints QUOTED, said to be the task's own words, so it can never read as the board's mark; a title with no mark word
is unchanged; an install without engine/markwords.js prints as before. One test per surface, red without the change.

## Measured on the base first (the card is live)

On markwords-9179 (= main for these files), an open task titled "[on hold] ship the release" prints in both CLIs as
`[N] [on hold] ship the release`, exactly a held row; "tidy the docs [added by mara]" prints another agent's mark.

## The change

- engine/markwords.js (PigeonPete's, his two functions untouched): adds `usesListMarkWord(text)`: usesMarkWord, or
  one of the list's mark phrases on the same folded copy, as whole words with the same gap rule: "not run",
  "replaced by", "project paused", "added by", "subtasks", "repeats", "waits for", "woke", "checks reported",
  "outside text"; and "done" only as the title's FIRST word (where the list prints "[done]").
- engine/tasklist.js titleOf: a non-webhook title goes through usesListMarkWord / quoteOwnWords.
- install/kosmos `task list` (inline node): loads the module from `kosmos_engine_module markwords` through
  KOSMOS_MARKWORDS; a missing module leaves the title as before.
- tools/windows/kosmos-cli.js taskList: requires engineDir()/markwords.js the same way, same fallback.

## Decided

- One fold for all four surfaces (the instructions block and the three lists): the list's words are a superset of
  the instructions block's, in the same module, so they cannot drift apart.
- "done" only as the first word: it is the one common word among the marks, and "[done]" is printed only at the row's
  start; "subtasks done" is caught by "subtasks". Rejected: "done" anywhere (most titles that finish a thing would print
  quoted).
- Fixture titles in five older tests used mark words as labels ("Task built", "Task a-built", "waits for a task"):
  renamed to "ready" and "held for" (their tests check order, groups and holds, not the title).
- Parenthesised marks ("(under task N)", "(owner: ...)") are out of scope (the card names the bracket marks).

## Weakest premise

That the word list is complete for today's list output. It was read from install/kosmos's printer (every "[" mark) and
the wake words (engine/taskwake.js waitWords: "waits for ..."); a new mark added later needs its word added here.

## Verified (round 0)

- cli.task-listmarks-9188.test.js (4): usesListMarkWord's marks and non-marks; the compact list; both CLIs against a
  real board (a forged prefix, a forged suffix, a plain control); an install without the module keeps the old output.
  Each surface put back to the base fails its test.
- Every cli.task-* test, server.webhooks-1307, the Windows CLI's 570/verbs/parity/shims tests, the #9179 test,
  tasklist.next-8576, the reachability and tree guards (533: 512 pass, 0 fail).
