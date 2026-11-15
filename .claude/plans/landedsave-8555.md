# landedsave-8555: save the commit check's upgrade so every screen says the same closed-how word

Card: kosmos#8555 (follow-up from #8552's review). Built on #8552's branch; rebased onto main once #8552 merges.

## Problem (from the card)
The Tasks view checks a task's commit (engine/landedcheck.js) only on /api/tasks, only within 14 days of a close, and
keeps nothing. So a task closed on a note whose commit was pushed later:
1. reads "with a change" on the Tasks row for up to 14 days, then "on a note" again;
2. reads "on a note" on the task page the whole time (the project payload never gets the check), and the task page says
   "with a change" for a commit the board cannot find.

## Decision
- `tasks.saveOnRemote(projectId, n, sha)`: when the check finds the commit kept on a remote and the task does not say so,
  save `landedOnRemote: true`. Only upward, only when the task still names that sha (a reopen or a new mark since the
  check moved it on), and no write when it already says so, so each task is written once. Never throws.
- /api/tasks calls it, also when the page was already answered (the check's work is kept).
- `setBuilt`: a re-mark of the same commit and repository keeps a saved `true` (a checkout that had not fetched says
  "not on the remote", which is older news than the board's own check). A different commit says what its mark says.
- `landedcheck.cachedFor(t)`: the cached answer, never a git call. `projects.joinTaskClaims` carries it as
  `landedCheck` for a closed task within CHECK_WINDOW_MS, and the task page leaves out its closed-how word when it is
  `missing`, as the Tasks row does.

## Rejected
- Writing back from inside landedcheck's cache (the card's weakest-premise alternative): the cache has no project id or
  task number and runs for any caller; a writer that knows the task is the route, which already holds the row.
- Running the check from the task page's payload: joinTaskClaims is synchronous and serves several routes; the cache
  peek gives the same answer at no cost.
- A new task-page line for a missing change: new words need a design pass. Here the page only stops claiming a change.

## Weakest premise
A GET route now writes to the store. Bounded: at most once per task ever, at most 10 checks per read, and the write is
an upgrade the read already shows. It bumps the project's `updatedAt` (nothing on the board reads it for activity;
checked: `lastActivityOf` reads task times only).

## Tests
- engine/landedsave-8555.test.js (8): save and read through closedHowOf and the task page row; past the window; once,
  only for the sha, a bad sha / missing project refused; a reopen saves nothing; re-mark keeps / new commit control;
  cachedFor; page landedCheck for closed in window only.
- server.builtcommit-7508.test.js: route with real repositories: saved, read by the task page row, a second read writes
  nothing, past the window the Tasks row still reads with a change.
- web.task-page.test.js: the task page drops "with a change" only for `missing`.
- Mutants (each reverted from a scratch copy): no save (4 red), re-mark downgrade (1), no sha guard (2), no page
  check (1), window ignored (1), page guard removed (1), route save removed (1).
