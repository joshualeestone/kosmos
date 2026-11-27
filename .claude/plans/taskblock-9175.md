# kosmos#9175: the task list in an agent's instructions file goes stale

## What was measured (origin/main 0f16043fe1)
- The block's list (`engine/projects.js` blockBody, `mine`) filters by `tasks.whoOf` and `progressOf().closed`, the same
  owner test the live list's `whoNames` uses (`tasks.js` whoOf). So the OWNER filter already agrees.
- The block is rewritten only by `projects.syncAgent`, which server.js calls on membership, close/reopen, part give,
  part add, hold, title edit. **The built route (`POST /api/project/<id>/task/<n>/built`, mark and clear) never calls it.**
- The live list groups by `tasks.listGroup` (open, held, built, done); `kosmos task list --mine` and `--open` leave a built
  task out of the open list. **The block listed a built task as plain open work**, with no mark.
- Reassignment: #8989 (in 0.8.26) already re-syncs a part's previous holder (server.js givePart, `before`). The 11-26
  report most likely came from an older board. Locked here by a test, not changed.

## Change
1. `blockBody`: a task in the built group (tasks.listGroup, the live list's own grouping) is marked
   `[built<, waiting on ...>: nothing to start; it comes back as open work if it is reopened]`. A held or paused one keeps
   only its hold mark (it says more). Kept on the list, as a held task is: it is still the agent's until closed.
2. Built route: on a changed mark or clear, `tellEveryoneOn(out.task, roster, { notice: { projectId, by } })`, as close
   does: each holder's section is rewritten, and a holder who did not make the change is owed a re-read (#8989).

## Decided, and the weakest premise
- Mark, not drop: dropping would match `--mine` exactly, but the agent would lose sight of a task still on it that can
  be reopened onto it; the per-project list shows built tasks with a [built] mark, which this matches. Weakest premise:
  that agents read the mark as "nothing to start". Would change my mind: an agent restarting built work after this.
- The person's screen mark owes the holder a re-read (by is null for the screen, as owesNotice treats it for a close).

## Test
`server.taskblock-built-9175.test.js`, end to end, nothing stubbed: mark, clear, the owed re-read both arms, and a
reassignment. Red without the fix (2 of 3; the reassignment one passes on main, by #8989), and red with either site
reverted alone.
