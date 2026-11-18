---
pre_challenge: true
method: challenge-loop
branch: invite-sheet-403
diff_hash: 34da60c986ba8f6520f392491019e3398d80cf12d67f9b4f940dc7b223904774
validation: passed
subdir_audit: passed
timestamp: 2026-11-18T16:41:26Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 17 (1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs, 11 NITs)
**Fixed:** 9 | **Deferred:** 1 | **Asked (awaiting user):** 0

Validation: the 6.0 baseline run was stopped while still queued (nothing had run) so round 1's fixes would not land under a queued hash; between rounds the focused file web.federation-3312.test.js ran (27/27), and render-federation-invite-4649.js ran in round 3 (182 PASS; with the sheet fix reverted the 8700 arm FAILs). 6j: the full validation on 4436d7c585 PASSED (node 29794 tests, 0 fail; shell shards all passed; build), subdir audit rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] web/index.html pjFedMessage - comment "NOT body.code" false after fedRemoteSays reads code --> FIXED (16fe366b0e)
- [WARNING] web.federation-3312.test.js - fedInviteMake covered only by a source regex pin --> FIXED (16fe366b0e): fedInviteMake run on a 403
- [NIT] web/index.html - old pjFedMessage header comment sat above the new helper --> FIXED (16fe366b0e)
- [NIT] web.federation-3312.test.js - remote_step_up_signin is not a code the board sends --> FIXED (16fe366b0e): remote_step_up_clock
- [NIT] plan - weakest premise understated the safety argument --> FIXED (16fe366b0e)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html Remove/Withdraw 403 branches keep the fallback --> DEFERRED: neither route is in the step-up gated list (server.js, "Removing and withdrawing take away"), so no remote refusal reaches them; recorded in the plan with what would change it
- [NIT] plan - wider effect on join/verify not stated --> FIXED (e9d5e1253b)
- [NIT] web.federation-3312.test.js - remote_step_up_unavailable untested --> FIXED (e9d5e1253b)
- [NIT] hand-listed FEDINV_* globals in the harness may drift (would throw loudly) - noted

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/ change with no browser-check change or trailer (tools/lib/browser-check-gate.sh) --> FIXED (4436d7c585): two arms in render-federation-invite-4649.js, run 182 PASS, red with the fix reverted
- [WARNING] surface gate flags render-agentdm-3414.js and render-unread-edge-3743.js on the local name msg --> FIXED (4436d7c585): Browser-check-surface trailers; both gates rc 0
- [WARNING] fedRemoteSays regex wider than the page's four other /^remote_step_up/ readers --> FIXED (4436d7c585): narrowed to /^remote_step_up/
- [NIT] plan implied federation routes send remote_not_allowed --> FIXED (4436d7c585)
- [NIT] test title "both invite paths" overstated --> FIXED (4436d7c585)
- [NIT] duplicate comment on the 403 branch --> FIXED (4436d7c585)
- [NIT] bare block style in pjFedMessage --> FIXED (4436d7c585)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] commit 7da6e4ba message mentions remote_not_allowed, superseded by round 3
- [NIT] helper comment "the page's one test" reads as consolidation; five regex copies remain (follow-up: reuse fedRemoteSays at the other readers)
- [NIT] bad-email branch and 403 branch both consult the helper; redundant but correct
- [NIT] browser-check header line longer than its neighbours

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html pjFedMessage | BRANCH | stale "NOT body.code" comment | FIXED | 16fe366b0e |
| 2 | 1 | WARNING | web.federation-3312.test.js | BRANCH | sheet only text-pinned | FIXED | 16fe366b0e |
| 3 | 2 | WARNING | web/index.html remove/withdraw | BRANCH | 403 fallback on ungated routes | DEFERRED | not step-up routes |
| 4 | 3 | BLOCKER | web/index.html | BRANCH | browser-check gate | FIXED | 4436d7c585 |
| 5 | 3 | WARNING | web/index.html | BRANCH | surface gate on msg | FIXED | 4436d7c585 |
| 6 | 3 | WARNING | web/index.html fedRemoteSays | BRANCH | two derivations of one fact | FIXED | 4436d7c585 |

### NITs (non-blocking, across all iterations)
- harness globals hand-listed (iteration 2)
- commit 7da6e4ba message superseded (iteration 4)
- five copies of the step-up regex remain; reuse is a follow-up (iteration 4)
- redundant helper call on the bad-email path (iteration 4)
- long header line in the browser check (iteration 4)

### Strengths (across all iterations)
- fedRemoteSays returns only `error`, never `code`, so an invite secret cannot show as a message; a control pins it (iterations 1-4)
- every write is textContent (iteration 1)
- the sheet is tested by running fedInviteMake, and the browser arm's waits start from a different sentence, so they discriminate (iterations 3-4)
- server codes and the gated route list checked against server.js (iterations 2-4)
