---
pre_challenge: true
method: challenge-loop
branch: board-token-3838
diff_hash: 4fb282df405acab192dad603be7ffa64229cd9460b5ab248b7af41b964e68cd9
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T00:29:01Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes
**Total findings:** 27 (0 BLOCKERs, 12 WARNINGs, 1 CONVENTION, 14 NITs)
**Fixed:** 12 WARNINGs, 6 NITs | **Deferred:** 8 NITs (stated in the plan) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] engine/remote.js:401 - the tunnel was told the primary token path while the board may enforce a legacy-leaf-only token → FIXED (0f263fd, boardauth.enforcedTokenPath)
- [WARNING] engine/remote.test.js:824 - the test compared against tokenPath() itself → FIXED (0f263fd, literal DATA_ROOT/board.token)
- [NIT] stale run-env record; throw logged as the wrong failure; cross-repo contract → run-env cleared, throw logged as what it is; contract stated in the PR

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] engine/remote.test.js:816 - the test could not tell enforcedTokenPath() from tokenPath() → FIXED (99bb295, enforcedTokenPath replaced by a legacy-only answer in the test; control with tokenPath() fails)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] engine/boardauth.js:187 - enforcedTokenPath re-implements readToken's precedence with nothing tying them → FIXED (55d4e4c, agrees() in every arm plus an empty-primary arm; control with existsSync fails)
- [WARNING] engine/remote.test.js - the no-argv check covered one flag spelling → FIXED (55d4e4c, no argv element contains board.token)
- [NIT] stale inherited env var → FIXED (55d4e4c, deleted before set)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] engine/remote.js:407 - the inherited-env drop had no test → FIXED (409c988, stale inherited value + throwing enforcedTokenPath; control fails)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
- [WARNING] engine/remote.test.js - nothing proved the token VALUE never reaches env or argv → FIXED (2878468, planted value; control fails by name)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] engine/remote.test.js:37 - the fake wrote the child's whole environment to a temp file → FIXED (probe-and-names record; the two dumps left by earlier runs deleted)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] engine/remote.js:398 - the comment claimed mode 600, untrue for a legacy-leaf copy → FIXED (states what holds: it is the file the board already trusts)
- [NIT] value-leak test did not clear the run record first → FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/remote.js:401 | SELF | legacy-only token not the path handed over | FIXED | 0f263fd |
| 2 | 2 | WARNING | engine/remote.test.js:816 | SELF | test could not tell the two paths apart | FIXED | 99bb295 |
| 3 | 3 | WARNING | engine/boardauth.js:187 | SELF | precedence not tied to readToken | FIXED | 55d4e4c |
| 4 | 5 | WARNING | engine/remote.test.js | SELF | value-never-in-env/argv untested | FIXED | 2878468 |
| 5 | 6 | WARNING | engine/remote.test.js:37 | SELF | fake dumped the whole environment | FIXED | round 6 |
| 6 | 7 | WARNING | engine/remote.js:398 | SELF | comment overclaimed file mode | FIXED | round 7 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- lazy require inside startChild; other tunnel verbs inherit a launcher's env var (none reads it); win32 env-key case; path chosen at tunnel start (no rotation exists); enforcedTokenPath can throw where readToken returns null (remote.js catches it); SANDBOX-level fake records hold a path and []

### Strengths (across all iterations)
- The tunnel half (kosmos-relay#139) was measured end to end against this Mac's REAL enforcing board: /api/projects 200 through the tunnel, and the control with the header insert disabled fails
- Every fix has a control that fails without it

### Note
- After converging, the branch was re-applied as one commit on current main (Pete's #3843 changed the same test file; both tests kept). Validation passed on that commit.
