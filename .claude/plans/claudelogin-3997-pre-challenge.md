---
pre_challenge: true
method: challenge-loop
branch: claudelogin-3997
diff_hash: bf8c78da12ec5e614ca6fdbd9e6cafbd42ad94564908e3a11154f066c821e6f2
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T15:46:47Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (iteration 1 is 6.0's fix-and-validate pass; iterations 2 to 5 are blind reviews)
**Converged:** Yes
**Total findings:** 20 (1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 15 NITs)
**Fixed:** 5 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** none (validation helper)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (6.0's synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: yarn test, 1 fail: web.empty-scope.test.js "no screen asserts a count of agents as a fact about the computer" (two new comments paired "no agent" with "on this computer") --> FIXED (commit 4658d9a56): comments reworded.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/claudeloginlive.js / server.js — /api/accounts waited for every row's keychain read (up to 5 s on a miss, again each minute) --> FIXED (commit 1f4706377): validUntilWithin waits 750 ms at most, reads are shared, a miss is cached 10 minutes; three unit tests.
- [NIT] loginGood's default duplicated '401' --> FIXED (1f4706377): observed.OUTCOME.REJECTED.
- [NIT] re-login after a rejection stays unconfirmed --> recorded in the plan's weakest part.
- [NIT] tooltip built for every row --> FIXED (1f4706377, then 85978d6e9).
- [NIT] a second copy of the security read --> FIXED in iteration 3.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (the cited read predates the loop)
- [WARNING] engine/claudeloginlive.js vs engine/loginexpiry.js — the same `security find-generic-password` read spelled out twice (three times with connect.js) --> FIXED (commit 85978d6e9): loginexpiry holds KEYCHAIN_READ/KEYCHAIN_OPTS with a sync and an exported async reader; claudeloginlive and connect.js use it (connect tests 219/219).
- [NIT] tooltip as a thunk --> FIXED (85978d6e9): a plain string.
- [NIT] the date has no year --> FIXED (85978d6e9): the year when it is not this year.

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web.badge-observed-1921.test.js — the honesty pin's regexes did not reach the new login-good arm --> FIXED (commit c0106e382): it asserts .acct-loginok and never green or amber; control: making that arm green reds it.
- [WARNING] engine/claudeloginlive.js and the plan — "a rejection of any age" was false (engine/observed is in memory, back to the board's last start) --> FIXED (c0106e382): the claims corrected, and the restart limit named in the plan's weakest part. Persisting rejections is a separate change to observed's storage, not done here.
- [NIT] stdio is ignored by execFile --> FIXED (c0106e382): the comment says what each reader does.
- [NIT] non-signed-in rows were read from the keychain --> FIXED (c0106e382): only connected rows are read.
- [NIT] the server repeated the rejected constant --> FIXED (c0106e382).
- [NIT] the date line did not say why it uses the viewer's calendar --> FIXED (c0106e382).

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] GREEN_FROM_LOGIN's true branch is untested (a hardcoded off switch) — the ruling makes it a deliberate code edit for Josh; noted.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | initial-validation | BRANCH | copy guard: "no agent" + "on this computer" | FIXED | 4658d9a56 |
| 2 | 2 | WARNING | engine/claudeloginlive.js | BRANCH | keychain read held /api/accounts | FIXED | 1f4706377 |
| 3 | 3 | WARNING | engine/claudeloginlive.js | BRANCH | the security read defined three times | FIXED | 85978d6e9 |
| 4 | 4 | WARNING | web.badge-observed-1921.test.js | BRANCH | honesty pin missed the login-good arm | FIXED | c0106e382 |
| 5 | 4 | WARNING | engine/claudeloginlive.js | BRANCH | "any age" claim false (in-memory store) | FIXED | c0106e382 |

### Final validation (6j)
- HEAD c0106e382: yarn type-check, lint-fix, test (11266 tests, 11101 pass, 0 fail, 165 skipped), build: PASSED, hash bf8c78da12ec. Subdir CLAUDE.md audit: passed. Browser-check surface and coarse gates: pass.

### Evidence beyond the suite
- render-account-badge-1921.js with the login-good row: main renders amber "Signed in" (3 FAILs); this branch passes.
- server.claudelogin-3997.test.js mutation controls: dropping the rejection guard reds the rejection test; reading the default account with its folder set reds the mapping test.

### NITs (non-blocking, across all iterations)
- re-login after a rejection stays unconfirmed (iteration 2; plan)
- GREEN_FROM_LOGIN true branch untested (iteration 5)

### Strengths (across all iterations)
- Only the refresh-token date leaves loginexpiry; no token is read out, renewed or rotated (iterations 2 to 5).
- The default account maps to an unset CLAUDE_CONFIG_DIR (the #2129 class), pinned by unit and server tests (iterations 2 to 5).
- The ruling is kept: the badge stays unverified, green sits behind an off switch, a rejection and a real request both still win, Check now stays (iterations 2, 4, 5).
- Tests at three levels: the rule, the real route, the rendered page (iterations 3, 5).
