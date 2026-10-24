---
pre_challenge: true
method: challenge-loop
branch: signin-7042
diff_hash: 54a89301381e89f0e1c2f472f18e481218f92e1f598a7e569ec3ff186658ec93
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T12:47:15Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 blind reviewers, each given the code, the plan and the kosmos-relay server and sign-in page to check against, not my conclusions.
**Converged:** Yes (iteration 9: nothing real; one theoretical offline edge recorded in the plan)
**Total findings:** 1 BLOCKER (round 1: the web page reads no cookie, so the first hand-over left it signed out), about 20 SHOULD-FIX, the rest recorded as residuals
**Fixed:** every BLOCKER and SHOULD-FIX | **Asked (awaiting user):** 0

The full record of every round, each decision with what was rejected, and the weakest premise are in
`.claude/plans/signin-7042.md`.

#### Iterations 1 to 8 (in short)
- 1: the page keeps its session in localStorage, not the cookie -> store it there; late answers after a back-out; key errors; the Allow watch on a 401
- 2: the waiting session lived in memory only; the reload went to "/"; a denied answer is not final on the server; back-out kept the session
- 3: a dead token left on the page signed out a fresh sign-in; a computer connected later never showed its code
- 4: writing after load lost to the page's own restore() -> a document-start script, no reloads
- 5: a later sign-out sent the next sign-in to the web page (a second device) -> the native sign-in comes back
- 6: the signed-out page left showing; the restart keyed on the keychain; the web route landing on a native tab
- 7: a backed-out session handed back by the page -> the page forgets dropped sessions; an ended session is dropped
- 8: the page's in-memory copy of a dropped session -> a fresh document; the forgotten list on a rebuilt web view
#### Iteration 9
- nothing real

## Validation
- iOS logic tests: run.sh 912/912 (44 new: the coordinator's own WebCrypto vector with controls, every verify answer, the document-start script run in a script engine with a hostile token), run-actions.sh 97/97, run-settings.sh 41/41.
- Mutation: 9 breaks of the security-critical logic (the device id, the signed message, an enrol-only token, an unknown status, a 401, the script's origin check, what forget removes, a refused proof, the masked number), each caught by its own test.
- Simulator build: no warnings (checked with a planted warning as a control). Shots on my own iPhone 17 simulator, light, dark and the largest text size: ~/work/design-shots/kosmos-7042/. Design approved by Mona Lisa.
- Node tests that read the iOS sources: 597, 0 fail, 53 skipped (all Windows-only). Both browser-check gates: 0.
