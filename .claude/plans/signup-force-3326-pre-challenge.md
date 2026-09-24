---
pre_challenge: true
method: challenge-loop
branch: signup-force-3326
diff_hash: 08bebf462c754611077adc77ccb21bf5e494ad929447c6403742b93ce2be33bc
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T21:53:11Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 20 reviewer findings (1 BLOCKER, 19 WARNINGs) plus 1 synthetic validation finding, and 13 NITs
**Fixed:** 21 | **Deferred:** 0 | **Asked (awaiting user):** 0

**Validation, stated exactly:** the validation helper runs tools/run-tests.sh, which includes
engine/win32anchor.test.js, and on this branch (cut before the #3634 fix) that test crashes syspolicyd
on Agent1s (Splinter's 15:53 hold). So validation was run as its manual equivalent: `node --test
--require test-support/launch-guard.js` over the same `engine/*.test.js *.test.js` set minus
engine/win32anchor.test.js (764 files), then `yarn test:shell`. Final run on 633b6099: 8768 tests,
0 failures, shell tests clean. The subdir audit passed. CI runs the full suite on Linux.

### Per-Iteration Breakdown

#### Iteration 1 (plus the 6.0 validation)
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs, 3 NITs (and 1 synthetic 6.0 finding)
**Self-generated:** 0 of the above
- [BLOCKER] (synthetic) engine.reachable.test.js — setRefreshExpiryReader exported with no excuse --> FIXED (357e63d1)
- [BLOCKER] engine/connect.js:113 — a null baseline (a failed read) let a later good read of the OLD credential look new --> FIXED: fail closed (12838a08)
- [WARNING] engine/connect.js:96 — a synchronous keychain read every ~3 s on the board --> FIXED: proof moved to the pane-death gate only (12838a08), later made async (7ceeb646)
- [WARNING] engine/connect.js:2905 — finishing on an expiry move while auth login still ran --> FIXED: pane-death gate only (12838a08)
- [WARNING] engine/connect.js:113 — a concurrent writer on the shared entry --> FIXED: bounded by checkLive CONNECTED, documented (12838a08)
- [WARNING] engine/connect.test.js — the CCD expectation restated the code; the unset arm was untested --> FIXED: read from the recorded launch argv, both arms (12838a08)
- [WARNING] server.test.js — a comment named a non-existent file --> FIXED (12838a08)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1 of the above
- [WARNING] server.test.js:5667 — a source-regex test replaced a real one --> FIXED: a real /api/connect/start route test (7eb25fb9)
- [WARNING] server.js:10064, engine.reachable.test.js:59 — comments named loginLanded --> FIXED (7eb25fb9)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] plan — the observed 0.6.84 symptom was not shown to be the fixed mechanism --> FIXED: stated in the weakest premise; real-Mac check includes an abandoned login (94ce9b66)
- [WARNING] server.js:10058 — the comment called the strand fixed on an unmeasured premise --> FIXED (94ce9b66)
- [WARNING] engine/connect.js:2767, :1821 — two #1922 comments made false by the change --> FIXED (94ce9b66)
- [WARNING] engine/connect.js:95 — macOS-only coverage undocumented --> FIXED (94ce9b66)
- [WARNING] engine/connect.js:2668 — a possible keychain consent prompt undocumented --> FIXED (94ce9b66)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above
- [WARNING] engine/connect.js:96 — the synchronous 5 s `security` read on every forced sign-up could stall the board --> FIXED: async execFile, parsing kept in loginexpiry (7ceeb646)
- [NIT] the reader seam was not reset by resetForTests --> FIXED (7ceeb646)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/connect.js:107 — the comment still said "synchronous" --> FIXED (633b6099)
- [WARNING] plan — a background refresh on the shared entry, not stated as a premise --> FIXED (633b6099)
- [WARNING] plan — agents already running on the credential, not covered --> FIXED (633b6099)
- [NIT] server comment wording; brittle source pin dropped; cancel-race and dead-credential tests added (each red-controlled) (633b6099)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 6.0 | BLOCKER | engine.reachable.test.js | BRANCH | unexcused test seam | FIXED | 357e63d1 |
| 2 | 1 | BLOCKER | engine/connect.js:113 | BRANCH | null baseline false success | FIXED | 12838a08 |
| 3 | 1 | WARNING | engine/connect.js:96 | BRANCH | per-tick sync keychain read | FIXED | 12838a08, 7ceeb646 |
| 4 | 1 | WARNING | engine/connect.js:2905 | BRANCH | finish while auth login still running | FIXED | 12838a08 |
| 5 | 1 | WARNING | engine/connect.js:113 | BRANCH | concurrent writer on the shared entry | FIXED | 12838a08 |
| 6 | 1 | WARNING | engine/connect.test.js | BRANCH | CCD restated; unset arm untested | FIXED | 12838a08 |
| 7 | 1 | WARNING | server.test.js | BRANCH | wrong file named | FIXED | 12838a08 |
| 8 | 2 | WARNING | server.test.js:5667 | BRANCH | source regex instead of behaviour | FIXED | 7eb25fb9 |
| 9 | 2 | WARNING | server.js:10064 | SELF | stale loginLanded name | FIXED | 7eb25fb9 |
| 10 | 3 | WARNING | plan | BRANCH | symptom not tied to mechanism | FIXED | 94ce9b66 |
| 11 | 3 | WARNING | server.js:10058 | SELF | overclaimed fix | FIXED | 94ce9b66 |
| 12 | 3 | WARNING | engine/connect.js:2767 | BRANCH | stale #1922 comment | FIXED | 94ce9b66 |
| 13 | 3 | WARNING | engine/connect.js:1821 | BRANCH | stale #1922 comment | FIXED | 94ce9b66 |
| 14 | 3 | WARNING | engine/connect.js:95 | BRANCH | macOS-only undocumented | FIXED | 94ce9b66 |
| 15 | 3 | WARNING | engine/connect.js:2668 | BRANCH | keychain consent prompt | FIXED | 94ce9b66 |
| 16 | 4 | WARNING | engine/connect.js:96 | BRANCH | sync read stalls the board | FIXED | 7ceeb646 |
| 17 | 5 | WARNING | engine/connect.js:107 | SELF | comment said synchronous | FIXED | 633b6099 |
| 18 | 5 | WARNING | plan | BRANCH | background refresh premise | FIXED | 633b6099 |
| 19 | 5 | WARNING | plan | BRANCH | running agents premise | FIXED | 633b6099 |

### NITs (non-blocking, across all iterations)
- [NIT] server.test.js — doesNotMatch scanned comments (anchored to code shapes, iteration 1)
- [NIT] engine/connect.js:98 — the NODE_TEST_CONTEXT guard covers only node --test (commented, iteration 5)
- [NIT] web/index.html:49534 — "never short-circuits" rescoped (iteration 1)
- [NIT] engine/connect.test.js — FAIL-CLOSED now asserts one read (iteration 3)
- [NIT] engine/connect.js:123 — watch not armed for a dead credential (iteration 3)

### Strengths (across all iterations)
- The keychain entry read is the entry the launch writes, checked against the recorded launch argv in both the CCD-set and unset arms (iterations 1, 3, 5, 6)
- Fails closed: a null baseline disables the proof, and the gate still requires checkLive CONNECTED (iterations 3-6)
- Secret handling: only the refreshTokenExpiresAt number ever leaves loginexpiry (iterations 1, 5, 6)
- Every new guard has a red control: expiry arm, fail-closed guard, route forward, cancel race, dead-credential skip
