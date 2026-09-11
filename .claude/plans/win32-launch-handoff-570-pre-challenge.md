---
pre_challenge: true
method: challenge-loop
branch: win32-launch-handoff-570
diff_hash: 2a5b786fc26877c8ae90de7fcd029e74337a69016383ae11edb9cf147d7dba47
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T06:00:00Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, alternating opus and sonnet.
**Converged:** Yes. Round 8 (sonnet) returned "NO NEW FINDINGS".
**Fixed:** every finding, 7 rounds of them. None is left as a residual beyond what
the plan's "Weakest part" records: the grace allowance, the Node-runtime update
limit, and the restore/clear race.
**Asked (awaiting user):** 0.

`diff_hash` is sha256 of the raw bytes of `git diff 98c2ab38 HEAD -- .
':!.claude/plans/win32-launch-handoff-570-pre-challenge.md'` at e98176d0: the
branch's whole change from its merge-base with `main`, without this proof file. It
was computed with node over git's own output. The pre-challenge-gate hook is not
installed on this Windows box, so the recipe is written out here. The branch was
rebased onto main 98c2ab38 after the loop converged, so the commit ids in the log
below are from before that rebase.

**Validation of record:**
- The win32, world and boot-guard suites after the rebase: 361/361.
- The full suite on the Windows box: main 98c2ab38 ran 5970 tests with 806 failing names;
  the branch ran 6016 with 805. There are 0 new names. The one absent name,
  `create.trust-configdir-1629`, is the box's known EPERM flake.
- macOS CI on the PR.

**Live on the box:** zips built from the branch, and from the branch merged with
win32-kosmos-cli-570 and win32-package-text-570, unpacked through Explorer's shell
with the Mark of the Web set:
- first run: exit 0 in 3.5s, headless board;
- relaunch: 2-2.5s, "already running", board untouched;
- update by hand (a new zip unpacked over the running install): exit 0 in
  8.8-10.1s, board replaced headless, all agents kept running;
- task switched off: serves in the window as before;
- a PORT=17000 launch: serves in its window, task board untouched;
- the `x-kosmos-board` header reads `0.6.55+<sha12>@default` on the candidate.

**Control runs:** every fix has a test that fails without it (listed per round in
the plan).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
Five bugs, all fixed:
- the same version on another commit;
- PORT and root overrides handed to a task that ignores them;
- a fallback that could outlast the browser opener;
- fact gathering outside the try;
- a task board still booting at logon.

Also a test gap: the server.js wiring. Before the round, the version source moved
from the page meta to a header, because the page is read per request.

#### Iteration 2 (sonnet)
The port-release floor was not counted against the budget. The budget is now 12s,
and the 18s worst case is spelled out and tested.

#### Iteration 3 (opus)
Bugs:
- named-world users never got the hand-off (the bootstrap's env was read as an
  override);
- the world boot attempt was left behind.

Also a probe could start past its wait, a spent budget ended an older board, and a
comment was wrong.

#### Iteration 4 (sonnet)
The identity was not world-aware. The boot-attempt clear became a tested function.

#### Iteration 5 (opus)
The launcher's attempt was still on disk when the task board read it, so a
never-served world was abandoned (the reviewer measured it). Now the attempt is
retracted before `/Run` and restored on fallback, and `worldbootguard.retractAttempt`
is new. The test env and the build-only wording were fixed too.

#### Iteration 6 (sonnet)
Test hygiene (worldenv state after the sandbox), the already-running path on a real
registry, and the restore race recorded.

#### Iteration 7 (opus)
No code bugs: stray CR bytes in the plan, the Mac-change wording, a spare identity
derivation removed, and the runtime-update limit recorded.

#### Iteration 8 (sonnet)
**NO NEW FINDINGS.** The round-7 fixes were verified, and 97/97 tests pass.

### Strengths (across all iterations)
- Every uncertain path falls back to serving in the window, which is the
  behaviour before this change, within a budget the opener outlives.
- One identity derivation (`boardIdentity(buildIdentity, bootedWorld)`), used by
  both sides.
- The world boot guard is kept exact: this boot's own attempt is retracted and
  restored; nothing is cleared.
