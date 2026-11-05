# hookif-8063: the move's loss check reads two losses as none, and its skill read is unbounded (#8063)

Follow-up to #8048 item 3 (`engine/accountcarry.js`, the check `kosmos agent move` and the board run before moving an
agent to another Claude account folder). Its eighth review round left three warnings; items 1 and 2 are the card's own
class, a loss read as none.

## What
1. A hook's `if`, `timeout`, `async` and `shell` (and, since review 6, every field beside its identity) are part of its wiring. A gate with the same script and matcher but a
   narrower `if` on the target fires less often, so it is not kept. `timeout`, `async` and `shell` change how it runs,
   so a difference there is not kept either. Prompt hooks fold them in too; other hook types already hash their whole body.
2. A hook the agent has now whose command names a script this cannot resolve (a relative path, `%USERPROFILE%`, a path
   with a space, which splits) makes the whole answer `{ ok: false, because }`, so `--yes` needs `--accept-loss` and the
   board's plan says it could not check. Before, it was kept on its wiring alone, and review 8 measured `%USERPROFILE%`
   with the script absent on both sides as `hooks: []`.
3. The skill comparison runs on the board's thread. A file is hashed from its first 1 MB plus its size; one skill reads
   at most 8 MB, 400 files and 200 folders (per skill, not per comparison), and a cut read says so in its sum.

## Not done (cards 4 to 6, low)
- 4: a different copy of a skill still does not block `--yes` (decided in #8048 review 3).
- 5: Windows case-sensitive path compare for "already on that account".
- 6: `hookId` naming `notes.sh` for `bash -c 'cat notes.sh'` (message only; the comparison is unaffected).

## Review 1
- The exec form (`command` plus `args`) is compared by its arguments, its script resolved as one word.
- SKILL.md is hashed first, outside every cap.
- A hook that cannot be checked no longer hides the known skill and hook losses: they ride beside `ok: false`.
- `$CLAUDE_PROJECT_DIR` and a relative path resolve in the agent's own folder, which the route passes as `project`.
- `async: false` and a timeout written as text are the defaults.

## Review 2
- A bare script name as the command (`gate.sh`) runs from PATH, so it is cannot tell, never inline.
- A skill read only in part that reads the same is listed as `partlyRead`.
- `once` is a compared run field.
- The route's agent folder is tested end to end; both launchers start the agent in `workerDir(name)`.

## Review 3 (a blocker in review 1's own change)
- Resolving a relative script in the agent's folder made a missing one read as "does not run here", although bash then
  looks on PATH, and a `cd` first moves the working folder. Now a script found only through the agent's folder must be
  there and must not follow a `cd` or `pushd`; otherwise cannot tell. A full path that is missing still does not run.
- The exec form's bare command name runs from PATH, as in the shell form.
- `partlyRead` is said in the sentence, so the CLI does not claim a whole-folder comparison it did not make.

## Review 4
- Only a regular file is ever opened: a named pipe or device in a skill, or as a hook script, hashes as not a regular
  file instead of blocking the board's thread (mutant hangs, killed by an alarm).

## Review 5 (the agent-folder rule moved, not patched again)
- Reviews 3 and 5 both got past a cd check from different sides. So the rule changed shape: "reached through the agent
  folder" is decided by how the path resolved, not by where it landed, and such a script is checked only in one plain
  invocation (no shell operators, no cd, pushd, -C, --chdir or -c). Anything else is cannot tell.
- SKILL.md's existence check reads capped.

## Review 6
- Every field beside a hook's identity (type, command, args, prompt) counts, so an unknown field is a difference.
- A script the board is refused is cannot tell; only ENOENT or ENOTDIR means it does not run.
- The plain-command rule also refuses --directory, --cwd and combined flags such as -lc. It is best effort.

## Residual, stated
- The caps are per skill. A comparison reads up to about 16 MB per skill name on both sides together, and one folder
  with a huge number of entries is listed whole before its caps apply. Both run on the board's thread.
- A run field written out at its default on one side (`timeout: 60` against none, `shell: "bash"` against none) reads
  as a difference: a false loss, the safe direction, which asks for --accept-loss.
- The relative and `$CLAUDE_PROJECT_DIR` resolution rests on the agent's hooks running in `workerDir(name)`: both
  launchers set it as the job's working folder (create.js plist, linuxjob.js unit), and the route test pins that the
  route passes it. A session that changes its own folder before a hook runs is not modelled.
- Any other variable in a hook path (beyond HOME, CLAUDE_CONFIG_DIR and CLAUDE_PROJECT_DIR) still answers cannot tell.
- A gate whose `if` is wider on the target is also read as not kept (a false loss, the safe direction).
- Two skills that differ only past the folder or byte cap read as the same copy.
- Item 2 is strict: an unresolvable path identical on both sides (it may well be the same file) still answers "cannot
  tell". That is the card's call: a loss check that cannot read the script should not claim it is kept.
