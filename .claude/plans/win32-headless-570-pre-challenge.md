---
pre_challenge: true
method: challenge-loop
branch: win32-headless-570
diff_hash: 7c8cfa5c9b36a1d37d680890b5fff81a507f91ed52c0772d767b87dae9c25814
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T22:58:23Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (round 5: "No issues found")
**Total findings:** 14 from reviewers (0 BLOCKERs, 5 WARNINGs, 6 CONVENTIONs, 3 NITs), plus 1 WARNING found live on the box
**Fixed:** 14 | **Documented as residual:** 1 NIT (the two-concurrent-clears race) | **Asked (awaiting user):** 0

`diff_hash` is sha256 of `git diff 0e1c6fee -- . ':!.claude/plans/win32-headless-570-pre-challenge.md'`
at b53e6aa8. That is the branch's full change from its merge-base, excluding this
proof file. The pre-challenge-gate hook is not installed on this Windows box, so the
recipe is written out here.

**Validation of record:**
- The 14 affected win32 and inventory suites: 208/208.
- The full suite on the Windows box against clean `main`: no new failure. The one
  file-level difference, `create.trust-configdir-1629.test.js`, fails alone on
  clean `main` too (EPERM on its temp dir).
- macOS CI on the branch.

**Live on the box, through Kosmos's own code** (re-registering every task, then
exercising every stop path with process counts and a before/after window diff):
- 20/20 checks passed;
- 0 windows appeared, in each of 3 full runs.

**Control runs:** every fix has a test that fails when the fix is removed,
checked in a scratch copy of `engine/` (recorded in the plan).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] A restart's new supervisor could fail to listen on the pipe the old
  one still held. The async EADDRINUSE was swallowed.
  --> FIXED 4a9f0e25: `serve()` retries a busy pipe and reports other errors.
- [WARNING] Remove: the old supervisor could relaunch the agent it had just lost.
  --> FIXED 4a9f0e25: `mayStart()` is checked before every launch.
- [CONVENTION] Two doc blocks sat on the wrong function. --> FIXED 4a9f0e25.
- [CONVENTION] The plan claimed an EPERM test that did not exist, and understated
  what pid reuse costs. --> FIXED 4a9f0e25: an injectable kill, a new test, and
  corrected wording.
- [CONVENTION] The unref test could not fail. --> FIXED 4a9f0e25 and d94d33ae: it
  asserts `hasRef()`, and `try/finally` makes a regression fail rather than hang.
- [NIT] Two derivations of "is this pid alive". --> FIXED 4a9f0e25: `win32stop`
  delegates to `win32orphan`.

Found live, the same round: the old supervisor's stop erased the new
supervisor's state file (by name), so an idle card read UNKNOWN.
--> FIXED 4a9f0e25: `clearState` clears only its own pid's file.

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] `started()` with no pid cleared with no owner. --> FIXED 2ec7b55b.
- [WARNING] `clearState` did read-then-delete (a TOCTOU), and deleted an
  unreadable file. --> FIXED 2ec7b55b: an atomic rename claim, then a hard-link
  put-back.
- [CONVENTION] The close-cancels-retry and give-up-and-report paths were untested.
  --> FIXED 2ec7b55b: injectable retry timing.

#### Iteration 3
**Reviewer model:** opus
- [WARNING, reproduced] A launch that never spawned still erased the file one event
  later, through `stopped()`. --> FIXED 7d7ebb55: nothing clears a state file by
  name.
- [CONVENTION] The put-back removed the claim on ANY link error. --> FIXED
  7d7ebb55: only on EEXIST; otherwise the claim is kept and the call returns false.
- [NIT] Two concurrent clears can resurrect an older state (a microsecond window).
  --> DOCUMENTED as a residual in the plan.

#### Iteration 4
**Reviewer model:** sonnet
- No correctness findings.
- [CONVENTION] The non-EEXIST put-back was untested. --> FIXED b53e6aa8, with a
  control.
- [NIT] A header comment overclaimed. --> FIXED b53e6aa8.

#### Iteration 5
**Reviewer model:** opus
**No issues found.** Every changed file was re-read in full, every stop and start
path was traced, the Mac CI behaviour of each new test was checked, and 208/208
tests passed. One PRE-EXISTING comment (not written by this branch) in
`win32supervisor.js` wrongly says a dead supervisor comes back with `--resume`
under the same session id. It will be corrected in `win32-resume-token-570`.

### Strengths (across all iterations)
- Every ambiguous reading fails safe:
  - EPERM or a throwing check counts as alive;
  - an unowned or unreadable state file is never deleted;
  - a failed put-back keeps the claim;
  - a throwing `mayStart` fails toward starting.
- One headless wrapper (`headlessExec`) and one pid rule (`pidAlive`), shared by
  the job, the board, `win32stop` and the watch.
- Every timing path is injectable, so the tests are deterministic, and they clean
  up in `finally`.
- The fix was driven by measurement on the real box, and each race was found by
  reviewers or live runs, not assumed away.
