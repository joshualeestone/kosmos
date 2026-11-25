---
pre_challenge: true
method: challenge-loop
branch: createdead-9031
diff_hash: e776f912eff3cd37c4790316130117d2cb7728b3c1f5443044d01592c859c315
validation: passed
subdir_audit: passed
timestamp: 2026-11-25T19:13:17Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1: no blocker, nothing above a minor in this diff; its minors are in tests' words, fixed)
**Fixed:** every finding in this diff | **Deferred:** 1 MAJOR and 1 MINOR that are not in this diff (kosmos#9083) | **Asked (awaiting user):** 0

Validation: full run on Mortals at aff2355065, EXIT=0, ENTRY status clean, hash equal to the local one (13:12 CST 11-25; tests 31280 fail 0 ).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 MAJOR and 1 MINOR outside this diff, 1 MINOR, 1 NIT --> the last two FIXED (aff2355065), the others filed
A tool's output quoting "Not logged in" reads as a sign-in failure, and usagepoll says login-ended before the identity check: kosmos#9083.

**What the reviewer checked and found sound:**
- The word list is byte-identical to 0.8.22's (2d01d7b753), and create.js differs from 0.8.22 only by the comment.
- With the three sentences restored in a scratch copy, exactly the three new tests fail; the create test drives the real probe and route,
  the other two stand the probe in.
- The verdict's only callers are the create gate and Check now (server.js).
- The default row's loginEnded, checkLive and usagepoll all read the plain Keychain entry, and the mover moves for usage only, so an
  ended login never causes a move.
- #9038 compares the process's login with the probed one before clearing anything.
