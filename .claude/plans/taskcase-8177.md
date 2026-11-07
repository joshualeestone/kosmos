# taskcase-8177: Windows Remove does not take a case variant of an agent's name as the agent (#8177)

## Done when
- On win32, `jobFor('Cai')` is null when the agent is `cai`, so `plan('Cai')` refuses with "cannot find".
- `jobFor('cai')` and `plan('cai')` still find and plan the real agent (control).
- Pinned by engine/remove.win32-case-8177.test.js, red without the remove.js change.

## Decision (after review 9)
Decide by the name. Every task Kosmos registers is named from a machine name, and a machine name is lowercase:
`create.NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/`, enforced by `installJob` (every task-installing path: create,
register, discover, worldstarts) since agents were first built (1dec3e96a5, #24, before Windows support). So on win32
a name with a capital letter has no task of its own, and `jobFor` returns null for it whatever schtasks found. One
line in `jobFor`; nothing else changes (`presence`/`status` keep `registered`, so create and import still see the
task; delete-leftover is main's). A test pins the premise (installJob refuses a capital letter).

It holds whatever the folder is called (renamed by case in Explorer), wherever it is recorded (profile-recorded
agents, which a folder test cannot tell apart), in every world, and however schtasks prints the task.

## Rejected (rounds 1 to 8)
- Reading the task's spelling back from the `/Query /FO LIST` answer: rests on unmeasured schtasks output and missed a
  third spelling.
- Judging by the folders (no exact folder beside a same-letters one): a folder renamed by case (`cai` to `Cai`) made
  the real agent `cai` lose its own task (review 9, measured); and it could not handle profile-recorded folders.
- Refusals in `plan` and delete-leftover for a task stored in other case: they stranded real agents.

## Weakest part
The premise that no Kosmos task name holds a capital letter. It is enforced at the one install gate and pinned by a
test; a task made by hand in the Kosmos folder with a capital letter would be hidden from that name. Not measured on a
Windows box (#7820, #7890 are parked needs-device); the Windows CI job runs the new file.

## Not done
- `restart('Cai')` now answers "Cai was not started by Kosmos" where plan says "cannot find"; a typed variant reaches
  restart only from the CLI. Left as it is.
- #8112 (April) also edits engine/remove.js (its folderIsExactly calls jobFor with the lowercase key, which this
  leaves alone); rebase onto it if it lands first.

## Review ledger (challenge loop)
10 blind iterations, opus and sonnet alternating; converged at iteration 10 (no BLOCKER, WARNING or CONVENTION).
Deferred NITs from 10: run the case check before the schtasks query (same behaviour); the comment's "however schtasks
prints it" means the name asked for; the create guard test does not exercise worldimport itself.
Left: the full suite (validation_log_run_or_skip) waits on the Mortals turn (Splinter), then the proof file and the PR.
