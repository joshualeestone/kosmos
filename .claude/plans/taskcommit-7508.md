# taskcommit-7508: record the commit a code fix landed as, and flag a closed fix whose change cannot be found (kosmos#7508)

Design approved by Mona Lisa on the card (comment 6477647461 and her wording reply).

## Decided
- `kosmos task built <project> <n> --commit <ref>`, both CLIs: the CLI resolves the ref in the agent's checkout (full
  sha, `--git-common-dir` so a removed worktree does not lose it, whether `git branch -r --contains` finds it). A ref
  that is no commit here, an empty `--commit`, a value starting with a dash, and `--commit` with `--clear` are refused
  before the board. Review 5/6: naming the checkout's own HEAD while tracked files have uncommitted changes is refused
  (HEAD would be the commit before an uncommitted fix); an older commit already made is not. The CLI says "Recorded
  commit" only when the board's answer carries it (an older board drops the field).
- Stored in its own task fields (landedCommit, landedRepo, landedOnRemote, landedBy, landedAt), not built ones:
  closing keeps them; `--clear`, a reopen (by the person or by its parts) and new work drop them; a mark without
  `--commit` keeps a recorded one. The screen's mark never records one.
- The check runs when the Tasks view is read (engine/landedcheck.js), asynchronously, for every row that names a
  commit: a later push upgrades "only on this computer" (never the reverse: a remote branch pruned after a merge does
  not turn a pushed fix local again), and closed rows closed in the last 14 days carry kept / missing / unknown.
  Review 3: kept means the repository HAS the commit object (it was committed), with or without a ref, because this
  repo merges by rebase and cleanup deletes branches; missing means `cat-file -e` exits 1 (no such object); a time
  limit, a signal or any other failure is unknown. Git prunes unreachable objects after two weeks by default, so older
  closed tasks are not checked. Git runs with fsmonitor and hooks off, no optional locks, no lazy fetch and every
  transport refused. Bounded: 3 s per git call, 5 min cache (30 s for unknown), 10 new checks per read, and the page
  waits at most 1.5 s for them; a check already running is shared, and at most 8 run at once on the board. The Tasks view does not send the repository
  path (other routes that return a stored task still carry it, as project records carry absolute folder paths).
- Words (Mona Lisa): row "Saved as change abc1234" (", only on this computer so far" while no remote has it); a CLOSED
  row still only on this computer, in amber: "Saved as change abc1234, but only on this computer. Ask the agent that
  did it to save it online."; missing, in red
  "Kosmos cannot find the change this task was finished with (abc1234). It may not have been saved. Ask the agent that
  did it to check."; unknown "Kosmos could not check whether this task's change was saved."; CLI "Recorded commit
  abc1234. It is not pushed yet: push it so it is not only on this computer."
- Agents' working rules ask for `--commit HEAD` on a code fix (doctrine 43).

## Rejected
- A commit on every built mark (most tasks deliver no code); a check in the CLI only (the loss happens later); ancestry
  of the default branch (squash and rebase merges rewrite the sha).

## Residual, named
The repository is a path a token-holding agent names, and git reads that repository's own config. The checks only
read, and fsmonitor, hooks, lazy fetch, transports and the system config are switched off; a config key outside that
list that could launch a program on a read is not covered.

## Costs, named (review 8)
- A slow repository delays the Tasks view by up to 1.5 s on each read while its 'unknown' is re-checked (every 30 s).
- engine/doctrine-past.js carries a second version-42 row: tools/doctrine-past.js reads every commit on main that
  touched engine/defaults.js, including a merged branch's unreleased intermediate text (its own header says such a row
  "matches nothing"). Main's table was generated before that branch merged; the rows are the tool's output, not edits.

## Weakest premise
A commit that was never pushed and whose worktree was removed, but whose object git has not yet pruned, still reads
kept: the check proves it was committed, not that it is safe. The row then says "only on this computer so far", which
is the honest part. And a closed task older than 14 days is not checked at all.

## Proof
- server.builtcommit-7508.test.js: engine (store, refuse shapes, keep through close, drop on reopen and clear), route
  (agent only, /api/tasks carries it), Mac and Windows CLIs against real git repos (local, pushed, refusals), and the
  route's check end to end (kept, then missing once the branch is deleted).
- engine/landedcheck-7508.test.js: kept, missing (deleted branch, unknown sha), unknown (gone repo, failing git),
  cache, budget.
- web.task-landed-7508.test.js: the row's lines from the real tskRow, controls included.
- Mutations red: close dropping the commit; CLI always "pushed"; route never checking.
