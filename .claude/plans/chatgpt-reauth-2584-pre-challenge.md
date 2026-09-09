---
pre_challenge: true
method: challenge-loop
branch: chatgpt-reauth-2584
diff_hash: 8dd42b4d0ce76b204001cce7b4d5b3e8c57fd1c091fb8d3cadb553d3d26af050
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T18:34:10Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, ~7 NITs
**Fixed:** 1 BLOCKER + 4 WARNINGs + 3 NITs | **Deferred:** 4 NITs | **Asked:** 0

Reviews the #2584 chatgpt reauth-in-place DRIVER MODE (stage-and-promote). Cross-model:
Sonnet (iter 2, 4) + Opus (iter 3, 5), 4 blind passes. The Sonnet iter-2 pass caught a
real fail-open BLOCKER in the identity guard that the design otherwise looked correct.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation pass)
**Reviewer model:** n/a (orchestrator validate pass)
**New findings:** 0 code findings. The initial validation was blocked by the machine-claim
gate (the box was reserved for release 0.6.51), an environment WAIT, not a defect; waited
for the release to finish, then validation passed clean on the branch baseline.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 NIT
**Self-generated:** 0 (all cited pre-loop branch commits)
- [BLOCKER] engine/openaiaccounts.js identity guard -- the `&&` match chain failed OPEN when either email was undecodable (an undecodable id_token still yields authMode:chatgpt, email null), so an unverifiable sign-in would be promoted over the live account --> FIXED (e4e0345c): fail closed (promote only when both identities readable AND equal); reauthTarget also refuses an emailless live account. New tests: emailless sign-in refused + live byte-identical; emailless target refused.
- [WARNING] no reservation of reauthDir (only the staging slot) -> a second concurrent reauth of the same account was allowed --> FIXED (e4e0345c): reserve reauthDir in activeChatgptDirs, released on every terminal path.
- [WARNING] copy-then-rename left a crash window where both dirs held a valid auth.json (a #1492 duplicate) --> FIXED (e4e0345c): promoteReauth is a single atomic renameSync move.
- [NIT] happy-path test captured `before` unused --> FIXED (e4e0345c): asserts the live auth.json was actually replaced (a pre-reauth marker is gone).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0 acted on as SELF (the WARNING was about tests for iter-2 code, fixed by adding tests)
- [WARNING] the concurrent-reauth refusal and the promote-failure paths (added iter 2) were untested --> FIXED (4e6bec8f): a concurrent-reauth test (refused + reservation released after) and a promote-failure test (chmod 0o500 live dir -> renameSync throws -> error, live byte-identical).
- [NIT] case-sensitive email match --> DEFERRED (fails SAFE: a casing change refuses a refresh, never wrong-promotes).
- [NIT] rowFor could return null in a microsecond window --> addressed next iteration as a defensive guard.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** the docblock + rowFor NITs were on iter-2/iter-1 loop lines (fixed normally, code/doc not a false-comment)
- [WARNING] forgetAccount/removeAccount did not respect the in-flight-reauth reservation -> a concurrent Disconnect/Remove could pull the live dir out from under a pending promote (safe today: renameSync then throws, account unchanged; but confusing) --> FIXED (9fb2dff8): both refuse while activeChatgptDirs.has(dir); new test asserts both refuse mid-reauth and the account is untouched.
- [NIT] promoteReauth docblock + plan still said "copy-to-temp + rename" (stale from iter 1) --> FIXED (9fb2dff8): corrected to the direct atomic renameSync move.
- [NIT] reauth success used rowFor unconditionally --> FIXED (9fb2dff8): null guard for parity with finishChatgptLogin (never report connected with a null account).

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings.
- [NIT] case-sensitive email match -- DEFERRED (duplicate of iter 3; safe direction).
- [NIT] dropDirIfOurs removes the whole staging dir regardless of madeDir -- DEFERRED (by design and documented; the staging slot is always disposable and never the live dir; no live-account risk).
- [NIT] cosmetic wording drift between the concurrent-reauth refusal and the forget/remove refusal messages -- DEFERRED (cosmetic; left to avoid a no-value re-review cycle at convergence).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | BLOCKER | engine/openaiaccounts.js (identity guard) | BRANCH | fail-open promote when email undecodable | FIXED | e4e0345c |
| 2 | 2 | WARNING | engine/openaiaccounts.js (reservation) | BRANCH | reauthDir not reserved -> concurrent reauth | FIXED | e4e0345c |
| 3 | 2 | WARNING | engine/openaiaccounts.js (promoteReauth) | BRANCH | copy-then-rename duplicate window | FIXED | e4e0345c |
| 4 | 2 | NIT | test happy-path | BRANCH | unused `before` | FIXED | e4e0345c |
| 5 | 3 | WARNING | reauth test | SELF | untested concurrent + promote-fail paths | FIXED | 4e6bec8f |
| 6 | 3 | NIT | identity compare | BRANCH | case-sensitive email | DEFERRED | safe direction |
| 7 | 4 | WARNING | forgetAccount/removeAccount | BRANCH | not coordinated with in-flight reauth | FIXED | 9fb2dff8 |
| 8 | 4 | NIT | promoteReauth docblock + plan | BRANCH | stale "copy-to-temp" wording | FIXED | 9fb2dff8 |
| 9 | 4 | NIT | reauth success rowFor | SELF | no null guard | FIXED | 9fb2dff8 |
| 10 | 5 | NIT | dropDirIfOurs staging cleanup | SELF | whole-dir rm regardless of madeDir | DEFERRED | by design, no live risk |
| 11 | 5 | NIT | refusal-message wording | SELF | cosmetic drift | DEFERRED | cosmetic |

### Outstanding questions (ASKED)
None.

### NITs (deferred, non-blocking)
- case-sensitive email match (safe-direction refusal)
- dropDirIfOurs whole-staging-dir cleanup (by design, disposable slot, never the live dir)
- cosmetic wording drift between two refusal messages

### Strengths (across iterations)
- The live account is genuinely never in the failure path: the live dir is written by exactly one call site (promoteReauth's renameSync), reached only after finish + fail-closed identity match; every error branch falls through to the shared cleanup without touching it (iters 3, 5).
- Fail-closed identity guard is not attacker-bypassable; expectEmail is fixed from the live account, newEmail only from the fresh sign-in (iters 3, 5).
- staging == live is structurally impossible (reauthTarget requires a decodable chatgpt auth.json; nextWorkDir returns only auth-less .codex-work<n> slots), closing the "dropDirIfOurs would rm the live dir" hazard (iter 3).
- Reservation released on every terminal path; atomic renameSync closes the #1492 duplicate window (iters 3, 5).
- Test suite asserts the live auth.json is byte-identical on every destructive/abnormal path, not just "no exception" (iters 3, 5).
- No regression to the non-reauth add path (session.reauthDir null -> new branches inert) or existing #2338/forget/remove behavior (iter 5).
- No em dashes anywhere in the diff (all five spellings checked, every iteration).
