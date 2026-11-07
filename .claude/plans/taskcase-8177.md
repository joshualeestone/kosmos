# taskcase-8177: Windows Remove does not take a case variant of an agent's name as the agent (#8177)

## Done when
- On win32, `jobFor('Cai')` is null when the only task is `cai`'s, so `plan('Cai')` refuses with "cannot find".
- `jobFor('cai')` and `plan('cai')` still find and plan the real agent (control).
- Pinned by engine/remove.win32-case-8177.test.js, red without the remove.js change.

## Decision
`schtasks /Query /TN <name> /FO LIST` answers a query in any letter case, and its answer carries the task's path in
the task's own spelling. `win32job.spelledOtherwise(tn, out)` reads that path (bounded, compared without case) and
returns the real spelling when the output names the task only in spellings other than the one asked for.
`presenceNow` adds it as `spelledOtherwise` (only when set, so existing deep-equals are untouched); `status` passes it
through; `jobFor` returns null for it only when `remove.taskIsAnotherSpellings` says the task is another spelling's:
the answer names it in another spelling AND this spelling has no exact folder of its own (Windows cannot hold `cai`
and `Cai` side by side). `delete-leftover.plan` refuses on the same test. Nothing else changes meaning: `registered` stays true, so create's collision
checks still see `cai`'s task when someone makes `Cai`.

## Rejected
- Comparing against `win32job.list()` (the card's suggestion): it lists only the CURRENT world, while `jobFor` takes a
  worldId, and it costs a second schtasks call per lookup.
- `machineTaskPaths()`: locale-proof but a whole-machine listing per lookup, and a second call that can fail on its
  own, leaving an "unknown" arm to decide.
- Making `presence.registered` false for a variant: create.js relies on it to see the other spelling's task.

## Review decisions
- Review 1: only the name after the Task Scheduler folder is compared exactly (a folder stored as `kosmos` must not
  hide a job); a leftover delete refuses rather than delete another spelling's task; a test pins that create still
  sees the variant's task.
- Review 2 added a refusal in `plan` for a task stored in other case; review 3 measured that it stranded a real agent
  (folder `caix`, task stored `Caix`: main restarts, pauses and removes it, the branch refused all three). Removed;
  the exact-folder condition replaces it, and that agent keeps its job (tested).
- Review 4: the check applies only in this Kosmos's own world (it reads this world's folders), so another world's
  agent keeps its own task. Accepted gap restated: profile-recorded agents (below) are not fixed by this branch, so
  the PR says Addresses, and #8177 stays open for them and for the Windows measurement.
- A folder recorded in the profile (#8112's case) does not carry the spelling, so for a recorded agent this keeps
  main's answer. When #8112 lands, its folderIsExactly is the test to use there.

## Weakest part
It answers only on positive evidence: output that does not carry the task path at all keeps the old answer
(registered). If a real Windows build printed the name somewhere this does not read, the fix would quietly not apply.
Read from source and the fixtures in this repo (win32board.test.js carries the real LIST shape); not measured on the
Windows box. The Windows CI job runs the new file (its name carries win32).

## Not done
- Measuring on a real Windows box (#7820, #7890 are parked needs-device for it).
- #8112 (April) also edits engine/remove.js (folderIsExactly calls jobFor); rebase onto it if it lands first.
