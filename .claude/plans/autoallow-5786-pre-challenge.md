---
pre_challenge: true
method: challenge-loop
branch: autoallow-5786
diff_hash: a0ffc8a88baf88b44d81d6585edfac9e392ba9ae285843e82c1bc3cece1e5b17
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T07:30:47Z
iterations: 32
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 32. The reviewer model alternated every round: odd rounds opus, even rounds sonnet (kosmos#2032).
**Converged:** Yes. Iteration 32 (sonnet) raised one WARNING, judged not an issue, plus NITs.
**Fixed / Deferred / Asked:** most WARNINGs fixed with a test. Deferrals are listed below with reasons and in the plan's residuals. Asked (awaiting user): 0.
**Validation:**
- Full tools/run-tests.sh on Mortals at b1cfc17ad: clean entry, hash a0ffc8a88baf, base 4f5c66a7. Node suite 18826 tests, 18583 pass, 0 fail; the shell suite passed.
- Two earlier full runs were red and were fixed:
  - Run 1, at a2568ef66: engine.reachable (5 test seams untriaged) and browser-checks-wired (the new check not in gated.txt).
  - Run 2, at 09c10ae47: the #2518 surface gate. Answered by per-check trailers in b1cfc17ad, each citing its green run.
- Browser checks at 09c10ae47, after merging main, headless, rc 0:
  - render-connected-here-5786: 20 pass
  - render-plus-panel-3829: 129 pass
  - render-connect-sheet-4637: 96 pass
  - render-plus-asks-signin-4610: 20 pass
- Every new guard was mutated after its commit and went red at the named assertion. Each was then restored with git checkout.

### Per-Iteration Breakdown (fixes are in each "address challenge-loop iteration N findings" commit)

#### Iterations 1-14 (models alternate, starting with opus)
- 1: a damaged remote.json crashed the device list --> FIXED. A no-session Try again minted S --> FIXED. Switch-off and Forget end S --> FIXED. The header overclaimed "the coordinator cannot vouch" --> FIXED (it now states the residual).
- 2: Got it and Undo could hide a later allow --> FIXED (keyed by device and time). The opened URL outlived S --> FIXED. An allow after Sign out went un-noted --> FIXED. Refused allows are capped at 3 --> FIXED. A Not me device could be allowed --> FIXED.
- 3: Undo shares the Remove lock --> FIXED. A timed-out remove kept its note --> FIXED. A late allow was noted during a Forget --> FIXED. README row --> FIXED.
- 4: late allow under another identity --> FIXED. The window restarted at open --> FIXED here, REVERSED at 8 per Josh's 19:04 ruling. The 30-minute recency --> DEFERRED (Josh's own request was 6 minutes old).
- 5: an identity change drops the notes --> FIXED. The comment said what the vouch proves --> FIXED.
- 6: a busy tick counted as a try --> FIXED. A failed opener logs --> FIXED. Plan rebuilt.
- 7: tests for Forget, a failed opener and secret replacement --> FIXED. The argv residual is stated per platform --> FIXED. A thrown allow counts --> FIXED.
- 8: the window is NOT restarted (Josh's ruling) --> FIXED, with a test. Only tunnel refusals count --> FIXED. A device removed elsewhere keeps its notice for 10 minutes --> DEFERRED.
- 9: Not me during the allow wins --> FIXED (the mutant went red). data-at on Undo and Got it --> FIXED.
- 10: Not me after the allow takes the device back out --> FIXED, with a control. Notice copy fixed.
- 11: connected_here shows when switched off --> FIXED. Own-property lookups --> FIXED. Removes check their answer --> FIXED. Name validated --> FIXED.
- 12: the take-back acts only inside the notice window --> FIXED. The account-switch edge --> DEFERRED (harmless).
- 13: one device per secret --> FIXED (tested). code_wait and joining_computer arms --> FIXED (tested). No double display --> FIXED.
- 14: the double-display filter respects a newer request --> FIXED. Forget bumps the epoch --> FIXED. A missing safe address is logged --> FIXED.

#### Iterations 15-32
- 15 (opus): an Undo did not say what it reached --> FIXED (removedWords and plusWords; copy "Not yours? Undo disconnects it here."). Forget clears the in-flight own-grant too --> FIXED (resetSelfGrant). The Devices list repaints when an Undo starts --> FIXED.
- 16 (sonnet): clock skew in the newer-request check --> FIXED (60 s slack). An allow in flight at Sign out --> DEFERRED (stated residual). matchedOk initialised --> FIXED.
- 17 (opus): Not me lost when its note could not be saved --> FIXED (in-memory lastVouched, tested, mutant red). A held computer minted S --> FIXED (tested, mutant red).
- 18 (sonnet): "the relay must bind the vouch" --> DEFERRED (the board recomputes HMAC over each row's own id). A vanished pinned row --> DEFERRED (fails closed).
- 19 (opus): the Devices Remove left Undo looking enabled --> FIXED (repaints the notice). A manual Allow racing the automatic one is mislabelled --> DEFERRED (wording only).
- 20 (sonnet): the Undo line never expired --> FIXED (REMOVE_SAID_MS).
- 21 (opus): a same-identity re-register left an allow unrecorded --> FIXED (decided by mac_id; slow-allow test; mutant red). Not me's take-back skipped on a refused deny --> FIXED (deny-fails test; mutant red). Held checked every tick --> FIXED.
- 22 (sonnet): comments only. The coordinator controls freshness; Not me's two tunnel calls; the forgetting guard --> FIXED.
- 23 (opus): Not me refused BEFORE the allow answered lost --> FIXED (notMeDuringVouch; mutant red). History-sync residual --> DEFERRED, stated in the plan.
- 24 (sonnet): ForTests exports read S --> DEFERRED (in-process code can already call deviceAllow). I accepted the reviewer's premise "Undo fails after Sign out" without checking it, and wiped notes on Sign out --> RETRACTED at 25.
- 25 (opus): Not me refused before the vouch arrived --> FIXED (vouchRows skips it; mutant red). The iteration-24 Sign-out wipe is a regression (signinCancel does not un-enrol) --> REVERTED. A bare name reads "Your browser" --> FIXED.
- 26 (sonnet): comments: mac_id dependency; opened armed before the opener runs --> FIXED.
- 27 (opus): comment and plan said setup-not-finished is waited out (it ends S) --> FIXED. A failed label clear is now logged --> FIXED. A signed-in default browser can be allowed unasked --> DEFERRED, residual in the plan.
- 28 (sonnet): the on-this-computer label survived removal elsewhere --> FIXED (vouchedFor ties it to allowed_at; first engine test of the label; mutant red).
- 29 (opus): Not me after S stopped but with the allow still out lost --> FIXED (vouchAllowingId; mutant red). lastVouched set only when noted --> FIXED.
- 30 (sonnet): comments: the Not-me set is kept past stopVouch on purpose --> FIXED.
- 31 (opus): a second sign-in cleared a pending refused Not me --> FIXED (kept across startVouch; mutant red). An identity change stops S at once --> FIXED.
- 32 (sonnet): a Not me on a row blocks it for the secret's life --> DEFERRED (that is the person's answer, working as intended). The rest were NITs.
- **Converged.**

### After convergence (no review change)
- d93337232: browser-check assertion. Got it means the line is not shown; an empty section is hidden whole. The check can still fail.
- a2568ef66: merged origin/main (73 behind, clean). Engine 214/214, web 21/21, four browser checks green at 09c10ae47.
- 09c10ae47: excused the five test seams in engine.reachable and wired the check into gated.txt (from full run 1).
- b1cfc17ad: per-check Browser-check-surface trailers (from full run 2).

### NITs (non-blocking, not taken)
- The ForTests exports and vouchOpenedUrl hold S for tests (see 24).
- Got it lives in page memory only: a reload shows the notice again for the rest of its 10 minutes.
- An Undo that timed out says "If it is still on the list above".

### Strengths
- The vouch is HMAC(S, the row's own device id), compared in constant time after a length check. It is pinned to one device per secret, and S is spent on the first allow.
- vouchRows is stricter than pendingDevices on purpose (raw joining_computer and code_wait fields). It excludes this computer's own ids, denied ids, and Not-me presses the tunnel refused.
- S ends on: Sign out, switch-off, Forget, an identity change, the held state, not enrolled, the 10-minute window, three refusals, and an opener failure.
- S never reaches a log line, remote.json, or the page.
- Not me wins in every ordering the loop could build, each with a test that goes red without its fix.
