# taskcase-8177: Windows Remove does not take a case variant of an agent's name as the agent (#8177)

## Done when
- On win32, `jobFor('Cai')` is null when the agent is `cai` (folder `cai`), so `plan('Cai')` refuses with "cannot find".
- `jobFor('cai')` and `plan('cai')` still find and plan the real agent (control).
- Pinned by engine/remove.win32-case-8177.test.js, red without the remove.js change.

## Decision (after review 7)
Judge by the folders, never by how schtasks spells the task it prints. `remove.folderIsAnotherSpellings(clean)`: on
win32, in this Kosmos's own world, when `clean` has no folder of its own and a folder with the same name in other
letter case exists, any task found for `clean` is that folder's agent's (Task Scheduler cannot hold two case variants
of one task name, and a Windows folder by default cannot either), so `jobFor` returns null. Only `jobFor` changes;
win32job.js, `presence`/`status` (`registered` stays true, so create and import still see the task) and
delete-leftover.js are main's.

## Kept as main does (measured in reviews 3, 5, 6, 7)
- An agent asked by its own exact folder name keeps its task, whatever case the task was stored in.
- An agent with no folder at all keeps its task (it is nobody else's; refusing would leave a task nothing can clear).
- Another Kosmos's job (a non-current worldId) is not judged by this Kosmos's folders.

## Rejected
- Reading the task's spelling back from the `/Query /FO LIST` answer (rounds 1 to 6): it rests on schtasks printing
  the stored spelling, which is not measured, and it misses a third spelling (folder `cai`, task stored `Cai`, asked
  `CAI`). The folder rule needs neither.
- A refusal in `plan` for a task stored in other case (round 2): it stranded a real agent (folder `caix`, task `Caix`).
- A refusal in delete-leftover (round 1): realCaseName already turns `Cai` into `cai` when cai's folder exists, so it
  could only fire on a task nobody owns.
- `win32job.list()` or `machineTaskPaths()`: current world only, or a whole-machine listing per lookup.

## Weakest part / known gaps
- A folder recorded in the profile does not carry the spelling (#8112), so a recorded agent keeps main's answer: its
  variant still finds its task. Pinned by a KNOWN GAP test; #8112's folderIsExactly is the test to use there once it
  lands. So the PR says Addresses, and #8177 stays open for it.
- A Windows folder made case-sensitive by hand (fsutil setCaseSensitiveInfo) could hold `cai` and `Cai` side by side;
  then the exact-folder look is still right for each.
- Not measured on a Windows box (#7820, #7890 are parked needs-device for it). The Windows CI job runs the new file.
- #8112 (April) also edits engine/remove.js; rebase onto it if it lands first.
