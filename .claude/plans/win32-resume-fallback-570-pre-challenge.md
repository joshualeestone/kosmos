---
pre_challenge: true
method: challenge-loop
branch: win32-resume-fallback-570
diff_hash: df7788dc27b80ad24ae8d63ccf262bf3b850411504c4bf28d513ac4186aab5d5
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T01:19:40Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (round 3: "NO NEW FINDINGS")
**Total findings:** 4 (2 WARNINGs, 1 CONVENTION, 1 NIT)
**Fixed:** 4 | **Documented as residual:** the exit-before-last-stdout-line race (unproven in about 450 measured runs) | **Asked (awaiting user):** 0

`diff_hash` is sha256 of `git diff 3824c835 -- . ':!.claude/plans/win32-resume-fallback-570-pre-challenge.md'`
at fee24662. That is the branch's full change from its merge-base with `main`,
after it was rebased onto `main` once #2669 merged. The proof file itself is
excluded. The pre-challenge-gate hook is not installed on this Windows box, so the
recipe is written out here.

**Validation of record:**
- The full suite after the rebase: 5916 tests. Its failures are exactly those of the #2669 branch run (effectively main at 3824c835): 796, 0 new.
- The full suite on the Windows box against `main`: no new failure.
- macOS CI on the PR.

**Live on the box** (`crash-repro.js` through `live-2726.js`, on a winstream-1 that
had never been messaged):
- Before the fix, on main: `resumed` then `died -- No conversation found ...`,
  every 30s, for as long as it was watched.
- With the fix (before the rebase, and again after it at 01:17): `resumed`, `died -- No conversation found ...`,
  `resume-impossible`, `throttled`, then `started` on a new session that stayed
  up. Afterwards the box went back on main, and all 5 cards were idle.

**Control runs:** every fix has a test that fails when the fix is removed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] The `wasCurrent` comment described a path that cannot happen, and
  nothing tested the guard. --> FIXED bd689e3d: the comment now names the real
  case, a stop during a failed resume. A test checks that a stop keeps the row and
  emits no `resume-impossible`; its control (guard removed) fails.
- [NIT] The order between `died` and `startFreshAfter` was not pinned.
  --> FIXED bd689e3d: an assertion that the `died` event names the dead id. Its
  control (order swapped) fails.
- Documented: Node may fire `exit` before the child's last stdout line. The
  reviewer measured the line first in 20/20 real runs, 400 synthetic runs, and 30
  runs behind a 2MB backlog.

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] Nothing pinned `saysNothingToResume`'s structural checks. A non-error
  result carrying the text would have abandoned a conversation, and a non-list
  `errors` could have thrown inside the stdout handler. --> FIXED: a test that
  sends both shapes. The conversation still resumes and nothing throws, and the
  controls (each check removed) fail.
- [CONVENTION] The forget-and-report block was duplicated between #2669's rekey
  and the fresh start. --> FIXED: one `forgetAndReport(id)` helper, used by both
  paths. The existing forget-failure tests cover both callers.

#### Iteration 3
**Reviewer model:** opus
**NO NEW FINDINGS.**
- The reviewer confirmed the `forgetAndReport` refactor leaves `rekeyTo` unchanged
  byte for byte: the same text, events and order, and the same null-`oldId` case.
- It confirmed the comments match the code, and checked the state file, the start
  gate and the token side effects of a fresh start.
- Three mutations stayed green, and none is a finding:
  - dropping the `!id` guard (unreachable);
  - the relative order of `forget-failed` and `resume-impossible` (both reach the
    task log either way);
  - #2669's forget-before-`rekeyed` order (log order only, and out of this
    branch's scope).

### Strengths (across all iterations)
- One structured signal (`saysNothingToResume`), read only for a resumed child.
- Only that one answer from claude abandons a session. Every other death still
  resumes it.
- The fix was driven by a live reproduction with the supervisor's own log, and
  verified by the same script.
