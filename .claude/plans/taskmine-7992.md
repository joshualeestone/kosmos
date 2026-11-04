# taskmine-7992: `kosmos task list --mine`, an agent's own tasks across its projects (item 1)

Card: kosmos#7992 item 1 (feedback: to find its own tasks an agent listed every project's and scanned past everyone
else's). Item 2 (a following feed that broadens) is a separate branch.

## Decided
- The board keeps the list, not the CLI: GET /api/tasks?all=1&mine=1 keeps the tasks the CALLING agent holds, in the
  projects it is on, by the same rule GET /api/tasks/mine (#6506) uses. Only the board can say which agent a token
  names, including twins and the key spelling. Both now use two shared functions, agentTokenCaller (the agent's own
  token, whatever the board token says: the CLI sends both, which is why agentTokenOnlyCaller cannot answer this) and
  heldByCaller.
- mine=1 is refused without all=1 (400) and without a token naming an agent (403), never ignored; the answer says
  `mine: true`, and engine/tasklist.js refuses an answer without it ("older than --mine"), so an older board's whole
  list is never printed as yours.
- `kosmos task list --mine [--blocked|--built|--stale [<days>]]` and `--all --mine ...`, on both CLIs, through the one
  printer; the count says "of yours". Without an agent token the CLIs refuse before asking.
- Doctrine v46: one sentence in the tasks paragraph names `--mine`; doctrine-past regenerated, fingerprint pinned.
- Rejected: filtering in the CLI by the agent's name (the CLI does not reliably know its own name or its twins);
  calling GET /api/tasks/mine (open only, another shape, so no --blocked, --built or --stale).
- Weakest premise: that agents will look for `--mine`. The doctrine names it and both CLIs' help names it.

## Steps
1. Server: shared helpers, /mine on them, mine=1 parse, filter and echo. done
2. engine/tasklist.js: the mine option. done
3. Both CLIs: parse, token check, mine=1, help. done
4. Doctrine v46. done
5. cli.task-list-mine-7992.test.js (engine, board, Windows, Mac; controls); mutants: the board filter off fails 3, the
   printer's older-board check off fails its test. Related tests: 166 files, 1963 tests, 0 fail. done
