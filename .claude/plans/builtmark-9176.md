# #9176: the instructions task list shows built tasks as open work

Split from #9166 item 5 (feedback triage 11-26).

## Measured (origin/main 0f16043fe1)
- engine/projects.js `blockBody` lists every task the agent holds that is not closed. A built task (builtAt: done,
  waiting on a release or a check) reads exactly like work to do.
- `kosmos task list --mine` shows open tasks by default and built ones only with `--built` (tasks.listGroup). So the two
  lists disagreed, which is what the report saw.
- The report's other half (a task kept after it moved to someone else) was fixed by kosmos#8989 (11-24, in 0.8.25):
  the previous holder is synced when a part moves. Not in this card.

## Change
- A task the list would group as built (`tasks.listGroup(t) === 'built'`) gets
  " [built: waiting on a release or a check; nothing to do on it unless it is reopened]". It stays on the list: the
  agent still holds it and uses its number to follow up.
- A hold or a paused project is still named first (`held(t) || built(t)`), as #5864 keeps a built task in a paused
  project "on hold". One mark per task.

## Rejected
- Dropping built tasks from the block: the agent would lose the number it reports against, and the CLI keeps them too
  (behind --built).

## Weakest premise
That listGroup's "built" is the right reading for the block. The block's task rows carry no projectPaused, which is why
the pause check must come first (held), and the paused-project test pins it.

## Tests: engine/builtmark-9176.test.js (4)
- built marked, open not (CONTROL); built + on hold reads on hold only; marked exactly when listGroup says built;
  built in a paused project reads on hold only.
- Controls: the mark removed (2 fail); the mark added even when held (`held(t)${built(t)}`: 1 fail, the paused case;
  the first version of the tests missed this, so the paused test was added).
- Existing: engine/onhold-4771 (incl. #5864's built-in-paused case) and the 50 files that render the block or sync
  agents: 1789 tests, 0 fail.

## Reviews
