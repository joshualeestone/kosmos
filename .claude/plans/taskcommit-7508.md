# taskcommit-7508: record the commit a code fix landed as, and flag a closed fix whose change cannot be found (kosmos#7508)

Design approved by Mona Lisa on the card (comment 6477647461 and her wording reply).

## Decided
- `kosmos task built <project> <n> --commit <ref>`, both CLIs: the CLI resolves the ref in the agent's checkout (full
  sha, `--git-common-dir` so a removed worktree does not lose it, whether `git branch -r --contains` finds it). A ref
  that is no commit here, an empty `--commit`, and `--commit` with `--clear` are refused before the board.
- Stored in its own task fields (landedCommit, landedRepo, landedOnRemote, landedBy, landedAt), not built ones:
  closing keeps them; `--clear`, a reopen (by the person or by its parts) and new work drop them; a mark without
  `--commit` keeps a recorded one. The screen's mark never records one.
- The check runs when the Tasks view is read (engine/landedcheck.js), asynchronously (never blocking the board), for
  every row that names a commit: whether a remote-tracking ref has it replaces the CLI's mark-time answer, and closed
  rows carry kept / missing / unknown. Missing only when `cat-file -e` exits 1 or no ref contains it; a time limit, a
  signal or any other failure is unknown. Bounded: 3 s per git call (at most four per check), 5 min cache, 10 new
  checks per read; past the budget no answer, so no false "could not check". The page is never sent the repository
  path.
- Words (Mona Lisa): row "Saved as change abc1234" (", only on this computer so far" while no remote has it); missing
  "Kosmos cannot find the change this task was finished with (abc1234). It may not have been saved. Ask the agent that
  did it to check."; unknown "Kosmos could not check whether this task's change was saved."; CLI "Recorded commit
  abc1234. It is not pushed yet: push it so it is not only on this computer."
- Agents' working rules ask for `--commit HEAD` on a code fix (doctrine 43).

## Rejected
- A commit on every built mark (most tasks deliver no code); a check in the CLI only (the loss happens later); ancestry
  of the default branch (squash and rebase merges rewrite the sha).

## Weakest premise
A fix merged by squash or rebase whose branch is then deleted on GitHub and locally leaves its sha on no ref, so it
reads missing; the words say "may not have been saved". Rare while the fleet keeps branches and remote-tracking refs.

## Proof
- server.builtcommit-7508.test.js: engine (store, refuse shapes, keep through close, drop on reopen and clear), route
  (agent only, /api/tasks carries it), Mac and Windows CLIs against real git repos (local, pushed, refusals), and the
  route's check end to end (kept, then missing once the branch is deleted).
- engine/landedcheck-7508.test.js: kept, missing (deleted branch, unknown sha), unknown (gone repo, failing git),
  cache, budget.
- web.task-landed-7508.test.js: the row's lines from the real tskRow, controls included.
- Mutations red: close dropping the commit; CLI always "pushed"; route never checking.
