---
pre_challenge: true
method: challenge-loop
branch: resend-7753
diff_hash: 5f39a417dce8ee7bb71846f2e9cade847eff9dcd3767827424616d2e70aa09c3
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T04:53:28Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap Splinter set for review loops (usage, 2026-10-22). Round 8 found 2 WARNINGs, fixed after it in 7246aa76 (an unanswered re-send waits in the process only; 'other' documented to cover an earlier device key), unreviewed. Suites and the full validation ran on it.
**Total findings:** 44 (0 BLOCKERs, 19 WARNINGs, 3 CONVENTIONs, 22 NITs)
**Fixed:** 18 actionable | **Deferred:** 1 (decided, stated) | **Asked (awaiting user):** 0

Each round: backupmemberkey-7753, -5744, orgkeypin-5686, personalbackupkey-7404 and engine.reachable (129 of 129 at the end), with a red control per guard (break in place, restore byte for byte). The 64-byte echo check is redundant and stated so (a shorter echo already fails the byte comparison).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/backupmemberkey-7753.test.js:213 - the padding half could not fail --> FIXED: file asserted
- [WARNING] engine/backupmemberkey.js:198 - each re-send costs a limiter pass and an escrow open --> FIXED: weekly, cost named; told Renet
- [WARNING] engine/backupmemberkey.js:203 - a re-send's echo not checked for epoch and key --> FIXED: same-epoch-and-key check

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/backupmemberkey.js:219 - an unwritable file meant a POST every run --> FIXED: in-process lastTry; red control
- [WARNING] engine/backupmemberkey.js:276 - the re-send's latency on the answer --> FIXED: stated
- [WARNING] engine/backupmemberkey.js:204 - a computer that cannot sign reads its key every run --> FIXED: lastTry covers it; tested

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 CONVENTIONs, 4 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/backupmemberkey-7753.test.js:256 - the wrong-key case never posted (state leaked between tests) --> FIXED: reset seam in beforeEach; red control
- [WARNING] engine/backupmemberkey.js:205 - test order dependence --> FIXED: same seam
- [WARNING] engine/backupmemberkey.js:217 - the file's time across a restart untested --> FIXED: tested, red control
- [CONVENTION] stale "a day" wording and an overclaimed plan line --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupmemberkey.js:309 - any other echo stops for good --> DEFERRED: decided knowingly, plan records it
- [WARNING] engine/backupmemberkey.js:253 - a NaN clock posts every call --> FIXED: no usable time never re-sends; red control
- [WARNING] engine/personalbackupkey.js:152 - drops the sig fields on rewrite --> FIXED: stated why nothing is lost

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/backupmemberkey.js:227 - the epoch half of the check unpinned --> FIXED: tested, red control

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupmemberkey.js:222 - a stale write-back after the POST could undo another writer --> FIXED: re-read and merge; red control

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/backupmemberkey.js:237 - the merge's same-key guard unpinned --> FIXED: tested, red control

#### Iteration 8 (final)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/backupmemberkey.js:215 - an earlier device key reads as 'other' --> FIXED after the round: documented, unreviewed
- [WARNING] engine/backupmemberkey.js:258 - an offline re-send used up the week --> FIXED after the round (7246aa76): kept in the process only, unreviewed

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/backupmemberkey-7753.test.js:213 | BRANCH | padding half vacuous | FIXED | iteration 1 |
| 2 | 1 | WARNING | engine/backupmemberkey.js:198 | BRANCH | re-send cost | FIXED | weekly |
| 3 | 1 | WARNING | engine/backupmemberkey.js:203 | BRANCH | echo not tied to epoch and key | FIXED | iteration 1 |
| 4 | 2 | WARNING | engine/backupmemberkey.js:219 | SELF | unwritable file loops | FIXED | iteration 2 |
| 5 | 2 | WARNING | engine/backupmemberkey.js:204 | SELF | unsignable reads every run | FIXED | iteration 2 |
| 6 | 3 | WARNING | engine/backupmemberkey-7753.test.js:256 | SELF | test leak hid a case | FIXED | iteration 3 |
| 7 | 3 | WARNING | engine/backupmemberkey.js:217 | SELF | restart time untested | FIXED | iteration 3 |
| 8 | 4 | WARNING | engine/backupmemberkey.js:309 | SELF | other echo stops for good | DEFERRED | decided, plan |
| 9 | 4 | WARNING | engine/backupmemberkey.js:253 | SELF | NaN clock | FIXED | iteration 4 |
| 10 | 5 | WARNING | engine/backupmemberkey.js:227 | SELF | epoch half unpinned | FIXED | iteration 5 |
| 11 | 6 | WARNING | engine/backupmemberkey.js:222 | SELF | stale write-back | FIXED | iteration 6 |
| 12 | 7 | WARNING | engine/backupmemberkey.js:237 | SELF | merge guard unpinned | FIXED | iteration 7 |
| 13 | 8 | WARNING | engine/backupmemberkey.js:258 | SELF | offline re-send waits a week | FIXED | 7246aa76, unreviewed |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] engine/backupmemberkey.js:215 - a small backward clock step can cause one extra re-send
- [NIT] git history - the first commit's subject says daily; the code says weekly

### Strengths (across all iterations)
- The caller's answer never changes; every re-send failure is swallowed (every iteration)
- A re-send can only repeat the registered key; the echo counts only for the same epoch and key, as bytes (iterations 1 to 8)
- Two layers of rate limit and sound clock guards, each with a red control (iterations 2 to 8)
