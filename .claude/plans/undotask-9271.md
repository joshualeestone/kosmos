# undotask-9271 (kosmos#9271)

**Problem.** On Windows, someone adds a found agent and then presses Undo (discover.disconnect). The agent's Scheduled Task survives, so the next Add answers "Kosmos already looks after an agent by that name". `disconnect` deleted the job only as `job.plist` (macOS) or `job.unit` (Linux, #5432). On Windows, remove.jobFor returns `{ label, plist: null, ours: true, worldId }`, so neither branch ran.

**Change.** A third branch, keyed on jobFor's win32 shape (a task label, no plist, no unit) and passing create.cleanName(key) as teardown does, with the same rule as the other two: only after the teardown fully landed, only a task that is ours, and best effort. It calls `win32job.remove(create.cleanName(key), job.worldId)` (`/Delete /F`; a task already gone counts as removed). engine/disconnect-agent.test.js joins the Windows job (ALSO), and gains an arm that checks the rule on every platform (a stubbed teardown, win32job's runner recording /Delete): a partial teardown keeps the task, a full one deletes it, a padded name deletes the task teardown acted on.

**Measured.**
- GitHub windows-latest: disconnect-agent 8/8 three times with the new arm (run 46124947656; 7/7 x3 before it, run 46124653940). At the head before this change it was 4 pass, 3 fail (run 46120990799), on the three undo arms the card names.
- On this Mac, the 17 test files touching discover or disconnect pass 345/345, and windows-tests-1777 passes 24/24.

**Rejected.** Making remove() delete the task. It deliberately keeps the task for Restore, which re-enables it; only an undo has no Restore.

**Weakest premise.** A task /Delete that fails for another reason (access denied) answers ok:false and is not acted on, as the macOS and Linux branches do not act on theirs. The row then still cannot be re-added. That is the same visible failure as before, not a new one.
