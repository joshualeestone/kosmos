# #1818 - Runner mid-run-edit immunity + loud cut-short

## Problem (from the card)

`tools/browser-checks.sh` freezes a detached worktree and reassigns `REPO` so the
CHECKS read immutable code. But bash keeps reading the RUNNER SCRIPT ITSELF from
the mutable `$0`. Editing `tools/browser-checks.sh` mid-run corrupts bash's
incremental read and kills the gate with a syntax error on an innocent line. And
because it dies before the summary, it leaves no `FAILED:` line and no run-log
entry, so a reader grepping for FAIL reads the dead run as green
(`a-killed-suite-prints-a-passing-tally` shape).

The existing freeze protects the CHECKS, not the RUNNER: it moves where checks
read code from; it cannot move the file bash is already reading as its script.

## Decision

**Option 1 (primary): re-exec the runner from the frozen copy.** After freezing,
the parent re-execs `bash "$FREEZE_BUILD/tools/browser-checks.sh"` so the file
bash executes lives on an immutable path nobody edits. The whole class disappears.

- The parent must survive to thaw the worktree, so it does NOT `exec`; the child
  is a subprocess and the wait+thaw+exit is wrapped in a function on purpose:
  bash parses a function body in full before the call, then runs it from memory,
  so once the long child run is underway the parent reads nothing further from the
  mutable source. Inlining those trailing lines (`$?`, thaw, exit) would
  reintroduce the very bug, because bash would read them from the mutable file
  after the child returns.
- The parent's thaw is on a `trap '_parent_thaw' EXIT`, NOT straight-line code.
  The parent blocks in the function for the whole child run and never reaches the
  RUN_DIR block's `trap cleanup EXIT` far below (it exits inside the function). So
  without a parent-scoped trap, a SIGTERM/SIGINT to the parent WHILE IT WAITED ran
  no thaw and leaked the frozen worktree + FREEZE_ROOT, a regression the old
  single-process path did not have (its EXIT trap covered SIGTERM). Fix:
  `_parent_thaw` (idempotent) on EXIT, plus `INT->exit 130` / `TERM->exit 143` so
  the EXIT trap fires on signal. The traps and `_parent_thaw` are parsed into
  memory here, before the child run, so a mid-run edit cannot corrupt them either;
  the child is a separate bash process and sets its own traps.
- The child skips the cut-guard refuse check (`KOSMOS_BC_FROZEN_RUNNER`): the
  parent stays alive as a live page layer it already cleared, and parent + child
  carry different run cookies, so the child would otherwise refuse itself.
- The child takes the existing detached-HEAD branch (frozen worktrees are
  detached) so it does not freeze again - the flag guard makes that explicit and
  prevents any re-exec loop.

**Option 2 (defense-in-depth): a completion sentinel.** `CHECKS_STARTED` /
`RUN_COMPLETED` gate a cleanup banner + run-log entry so a run that dies after the
checks begin but before the summary is LOUD, not silently green.

## Rejected alternatives

- **Self-snapshot the runner to /tmp and `exec` from there.** Rejected: `REPO` is
  derived from `dirname $0/..`, so a /tmp copy breaks REPO (checks would read
  /tmp). The git freeze already produces a full tree whose `tools/browser-checks.sh`
  sits at a valid repo root, so re-execing from the frozen copy keeps REPO correct.
- **Option 2 alone.** Rejected as insufficient: it makes the death loud but does
  not prevent it. Option 1 removes the class; option 2 is the backstop for
  kill/OOM that option 1 cannot address.

## Coverage boundary (stated honestly)

The sentinel fires whenever bash runs its EXIT trap: the syntax-error death (the
actual #1818 incident - bash exits itself), other error exits, and SIGTERM/SIGINT
(the re-exec parent now converts these to an exit so its EXIT trap fires and thaws
- see the Decision note; and this is safe against a mid-run thaw, verified, per the
Signals section below). It does NOT fire on SIGKILL (uncatchable), which is how the OOM
killer terminates. Option 1 already removes the edit-induced death, which was the
incident; the residual SIGKILL/OOM case is named, not claimed covered.

## Testing (tools/test-runner-reexec-1818.sh, wired into test:shell)

Three arms, all browser-free and deterministic, each proven to catch its own
regression by perturbing the fix and watching the arm go red:

- **ARM 1 - re-exec fires and runs from an immutable path.** Creates its OWN
  branch worktree off HEAD (so the symbolic-HEAD condition holds even in CI's
  detached checkout - otherwise the arm would silently never run), runs the real
  runner with no Playwright + `KOSMOS_SKIP_BROWSER_CHECKS=1` so it takes the clean
  early skip, and asserts the parent froze, the child re-execed, and the child's
  runner path is a distinct `kosmos-bc-freeze` copy - NOT the source `$0`. Proven:
  committing a perturbation that removes the re-exec turns this red (2 fails).
- **ARM 2 - a cut-short run is loud.** A narrow browser-free test seam
  (`KOSMOS_BC_TEST_CUTSHORT`, off by default) reaches the `CHECKS_STARTED` state a
  real kill leaves, without launching a browser; asserts the banner fires, says
  "NOT a pass", exits non-zero, and writes an `incomplete-exit137` run-log line.
  Proven: removing the banner condition turns this red (3 fails). ARM 1 also
  asserts the banner does NOT false-fire on a legit early skip.
- **ARM 3 - the frozen-runner child skips the live-run guard**, with a CONTROL
  (same live probe, no `KOSMOS_BC_FROZEN_RUNNER`) that DOES refuse, proving the
  probe can return the dangerous answer. Proven: removing the `:110` guard-skip
  turns the subject red.

## Weakest premise

ARM 1 proves the fix's GUARANTEE (the child runs from an immutable frozen path, so
a mid-run edit to the source cannot reach the child's read), not the card's exact
SYMPTOM (the specific syntax-error death against the real runner under a live gate),
which is deferred because it needs the browser and a live gate the cut owns. The
chain from guarantee to symptom is tight - the symptom WAS a corrupted read of the
mutable `$0`, and the child no longer reads a mutable `$0` - but it is a chain, not
a direct replay.

## Signals: safe against a mid-run thaw (verified)

An earlier draft of this plan claimed a residual "parent-only-kill thaws mid-run"
race. It does not exist, and the code comment was corrected to match. The child
runs as a SYNCHRONOUS FOREGROUND command, and bash defers a trapped signal until
the foreground command it is waiting on returns. Verified empirically: a
`kill -TERM <parent>` fired while the child was mid-run did NOT run the parent's
trap until the child finished, then thawed. So `_parent_thaw` never runs while the
child is still reading the frozen tree, for INT and TERM alike; Ctrl-C is the same
(the process-group SIGINT kills the foreground child first). The only uncatchable
case is SIGKILL to the parent: no trap runs, so the frozen worktree leaks (a disk
cost, cleaned by later sweeps) and the orphaned child keeps reading an intact tree
nobody thawed. That leak is benign and is exactly what the old single-process path
also did under SIGKILL, so it is not a regression.

## The release-cut path is unchanged

release.sh invokes the runner from a detached worktree (no `KOSMOS_BC_FROZEN_RUNNER`),
which takes the untouched else-branch: no re-exec, no double freeze. Zero change to
the release path.
