---
pre_challenge: true
method: challenge-loop
branch: win32-resume-token-570
diff_hash: b23213ae9803fa8ef1235c1d3c22b06fbcdbd0bfd83ca94c2da56f15dfa7d5cf
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T00:06:36Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (round 6: "NO NEW FINDINGS")
**Total findings:** 13 (0 BLOCKERs, 6 WARNINGs, 4 CONVENTIONs, 3 NITs)
**Fixed:** 12 | **Documented as residual:** 1 WARNING (the host-gone grace can outlive a slow agent's retire) | **Asked (awaiting user):** 0

`diff_hash` is sha256 of `git diff bc275978 -- . ':!.claude/plans/win32-resume-token-570-pre-challenge.md'`
at 50f9ad98. That is the branch's full change from its merge-base with `main`,
excluding this proof file. The pre-challenge-gate hook is not installed on this
Windows box, so the recipe is written out here. The branch was rebased onto
`main` bc275978 after the loop converged; that rebase touched none of this
branch's files. Each fix below is named by its round, because every commit
subject names the round and the rebase rewrote the commit ids.

**Validation of record:**
- All 16 win32 suites after the rebase: 248/248.
- `sendertoken.test.js`: its 10 POSIX file-mode tests fail on clean `main` on this
  box too; nothing else fails.
- The full suite on the Windows box against `main`: no new failure. The only
  name-level differences are `reporthook.test.js`'s `#1467` pair, which fail
  identically on clean `main` 61594aa0 (checked directly).
- macOS CI on the PR.

**Control runs:** every fix has a test that fails when the fix is removed. The
mutations were checked in the worktree with an exact byte restore, and by the
reviewers in scratch copies.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] The "keeps the record" test could not fail: the row was never recorded
  first. --> FIXED (round 1 commit).
- [CONVENTION] `prepareSession`'s doc block was detached from its function.
  --> FIXED.
- [CONVENTION] `mintForRun`'s doc said the store never records which run a token
  belongs to. --> FIXED.
- [CONVENTION] The supervisor header claimed the task restarts a dead supervisor.
  --> FIXED.
- [CONVENTION] A failed retire and a token-less start were swallowed. --> FIXED:
  `token-not-retired`, a `because` on started/resumed, and the retire failure
  appended to the launcher's refusal.
- [NIT] A test name ("a RESUME mints nothing") was false. --> FIXED.
- Also fixed: the stale "NOT WIRED IN THIS COMMIT" comment.

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] The host-gone 2s self-exit can beat the retire when an agent takes
  longer than 2s to exit. --> DOCUMENTED in the plan's Weakest part. Lengthening
  the grace would widen the headless `/End` overlap.

#### Iteration 3
**Reviewer model:** opus
- [WARNING] The launcher's failed-retire refusal was untested. --> FIXED.
- [WARNING] A resumed run's token-less line was untested on both sides.
  --> FIXED, with three controls.
- [NIT] `retireRun`'s doc listed only two of its three callers. --> FIXED.
- Also pinned: `retireRun`'s no-name and no-instance branches.

#### Iteration 4
**Reviewer model:** sonnet
- No lifecycle findings.
- [WARNING] Only the resume path pinned the returned `instance`. A fresh launch
  that dropped it would leave every fresh run's token un-retired. --> FIXED: the
  fresh-launch test asserts the instance it minted, and a control fails without
  the fix.

#### Iteration 5
**Reviewer model:** opus
- No correctness findings.
- [WARNING] The supervisor's DEFAULT retire, the one `main()` uses in production,
  was never exercised: every test injected a fake. --> FIXED: a test against the
  real sandboxed token store, with a control (a no-op default) that fails.
- [NIT] Nothing pinned that a resume mints only after the trust gate. A mint moved
  above the gate would leak one token per refused restart. --> FIXED: a test for a
  trust-refused resume, with a control (the mint moved above the gate) that fails.

#### Iteration 6
**Reviewer model:** sonnet
**NO NEW FINDINGS.** The reviewer:
- re-read the full diff and traced the token lifecycle end to end;
- confirmed both round-5 tests are isolated and clean up after themselves;
- re-ran the suites (74/74);
- mutated the `runInstance` guard, which turned the right test red;
- checked the changed lines against CLAUDE.md.

### Strengths (across all iterations)
- One mint point (`mintForRun`) and one retire (`retireRun`), shared by the
  launcher, `abandon` and the supervisor's death handler.
- Retire, never revoke. Each run's token is keyed by its own instance, so retiring
  a finished run can never touch the run that replaced it.
- Nothing about a token fails a launch, and every token failure reaches the task log.
