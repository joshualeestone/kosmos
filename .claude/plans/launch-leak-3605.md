# Plan: #3605, a test can never write a job file into the real ~/Library/LaunchAgents

## Finished looks like
An unsandboxed test cannot write or delete a job file in the real ~/Library/LaunchAgents,
whichever code does it. A direct fs write from a test throws in the test; a write through
create.js comes back as that step's failed result plus a #3605 line on stderr, and its
rollback does not delete the real file. When the
after-the-suite leak guard does fire, its report says where the leaked file came from.

## What the card said, and what measurement showed
The card guessed freeze-at-require (a module capturing the LaunchAgents dir before the test
set AGENT_WORKFORCE_LAUNCH). That is not it:
- `create.agentsDir()` already reads the env on every call (made lazy under #1432).
- Measured 2026-09-24, each arm with HOME pointed at a scratch dir: the codex-observed test
  on current main wrote 0 plists; the same test in a worktree that predates #3011
  (`agent-workforce-store-mode-hardening`) wrote all 5.
- Five worktrees on agent1 still carry the pre-#3011 test. A suite run from one of them leaks
  into the shared real folder, and whichever branch is validating at the same moment is
  blamed by its guard (the #3596 run). A second leak landed at 11:26:51, and the 11:27
  console login loaded all five into launchd (exit 127, respawning). Unloaded and moved to
  ~/.cache/angel-launchagent-quarantine-2026-09-24/.

## Change
1. `test-support/launch-guard.js`, preloaded by `tools/run-tests.sh` with
   `node --test --require` (node forwards it to every file's process). It wraps the fs
   calls listed in its WRITERS table (write, append, copy, cp, rename and link
   destinations, truncate, write streams, write-mode opens, and the rm/unlink/rmdir
   deletes, in sync, callback and promise forms) so one whose target is inside the real
   LaunchAgents, or is the folder itself, throws a named #3605 error BEFORE the call. This is the load-bearing part: about sixty tests
   write job files themselves with fs.writeFileSync(create.plistPath(...)), which a guard
   inside create.js never sees (measured: with only (2), the control still leaked).
2. `engine/create.js`: the three product plist writes go through `writePlistFile`, which
   refuses the real folder when NODE_TEST_CONTEXT is set, and createAgent's rollback skips
   deleting a real-folder job file under test (it may be a real agent's). Covers direct
   `node --test <file>` runs without the preload and child processes tests spawn (they
   inherit NODE_TEST_CONTEXT, not the preload).
3. The leak report in run-tests.sh prints each leaked plist's WorkingDirectory (its test
   sandbox) and says a concurrent older checkout is a possible writer, with bootout advice.

"Real" is the account home from the password database (os.userInfo), not $HOME or
AGENT_WORKFORCE_HOME, so a test that points either seam at its sandbox is left alone.

## Rejected
- Rewriting the ~60 test-side writes to go through a helper: large churn, and the next new
  test can hand-roll the write again. The preload catches the wrapped fs calls wherever they are made.
- Downgrading the leak guard to a warning when the leak looks foreign: the guard cannot prove
  whose run it was, and a green over a real leak is the worse failure.
- Deleting the five stale worktrees: they belong to other agents and may hold unpushed work.
  Named on the card instead.

## Weakest premise
Coverage has two known edges. (a) The preload sees only in-process fs calls: a child
process a test spawns (cp, launchctl, a node child without the preload) is not covered,
except that a node child running create.js still has the NODE_TEST_CONTEXT half.
(b) A hand run of `node --test <file>` has no preload, and then only create.js's writes
and its rollback delete are guarded: engine/remove.js and delete-leftover.js can still
delete a real job file for a test that forgot the sandbox. Under run-tests.sh and CI the
preload covers those deletes too. Left there rather than threading the check through
more product files; a follow-up if a hand-run leak is ever seen.
The preload only arms through run-tests.sh (and CI, which runs it). A developer running
`node --test file` by hand has only the create.js half, which does not cover test-side
writes. Nothing in this tree can protect against a checkout that predates it.

## Verification
- engine/create.launch-refuse-3605.test.js: the create.js refusal (no write in any arm),
  $HOME independence, call-time dir resolution (the card's ask), every product write goes
  through writePlistFile, the preload in a fresh child with recorders installed first
  (refused before write, sandbox and rename-away allowed), and the run-tests.sh wiring.
- tools/test-launchagent-leak-guard-3011.sh: origin helper arms.
- End-to-end control: codex-observed test with its sandbox line removed, run with the
  preload: 5 fail on the #3605 refusal, real folder unchanged (ls diff). With the line: 5 pass.
