---
pre_challenge: true
method: challenge-loop
branch: signup-connect-3326
diff_hash: 68352aa0b822afc5e9bbe96dd9d831ae3bae5fb32db5618c37cb2c3388e9e204
validation: passed
subdir_audit: passed
timestamp: 2026-09-21T06:18:20Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (one fresh blind CTO-lens review of the full diff; both blocking findings fixed + re-verified).
**Converged:** Yes.
**Net:** #3326 (sign-up always forces a real Claude login) + #3335 (OpenAI sign-in relabel + immediate-open),
two grouped first-run connect-frontend cards.

#### Iteration 1 (blind adversarial review)

The review found TWO real BLOCKERs that would have shipped #3326 broken. Both fixed (commit 89b541f8):

- **[BLOCKER] reauth:true never reached the engine on the first-run path -> #3326 was INERT for its
  exact target.** server.js's /api/connect/start READ reauth (validated) but forwarded it ONLY on the
  accountDir "known account" branch; the DEFAULT first-run start dropped it, so connect.start() got
  reauth=false, the connected short-circuit fired, and sign-up finished on a stale credential. Confirmed
  in source (server.js default call had no reauth). FIXED: the default connect.start() now forwards
  reauth (+ comment). GUARDED by a new server.test.js source test asserting the default path forwards it.
- **[BLOCKER] FR_SUB_LOGIN_VERIFIED was set on flow-ended paths that never ran a login (cancel bypass).**
  frConnSettle set the flag unconditionally, but it is reached on frConnCancel and the idle-terminal arm
  as well as on a real login -- so cancelling a forced sign-in still marked the login "verified" and
  painted the terminal Connected. FIXED: the flag is set ONLY in frConnWatch's `connected` arm (the
  genuine login-success signal, reached only after a real claude auth login); frConnSettle no longer
  sets it. Verified: cancel/idle reach frConnSettle without that arm.
- **[NIT] no server-route test caught BLOCKER 1** -> added the source guard above (a full route harness
  is not built here; the behaviour lives in one line).

**[STRENGTH] verified by the review:** the updated tests are non-vacuous and can return the failing
answer (web.firstrun-model drives both verified + unverified connected; server.test.js control passes
FR_SUB_LOGIN_VERIFIED:true; render-firstrun-openai-sub asserts subGoHidden/startCalled + abandonment).
#3335 prevents double-start, keeps a retry on start-error, handles focus + a11y, and preserves #1008
(no Claude verdict when unverified). No em dashes in any user-facing string.

### Validation (after the fixes)
- Node suite (run-tests.sh): rc=0, 0 fail. Browser-checks.sh: rc=0, 0 FAIL (incl click-first-run,
  render-firstrun-connect-box 10/10, render-firstrun-openai-sub). Surface gate green.
- The real forced Claude login + the real OpenAI browser sign-in cannot fully run headless (they open a
  browser / run claude auth login), so Josh confirms both end-to-end in-app after the next cut.
### Weakest premise
The resume-completed-while-away edge (frConnResume reaching connected without frConnWatch's arm) shows
as unverified -> re-forces the login, which is SAFE and option-2-compliant ("no big deal to force it"),
not a dead-login pass-through. Noted for a possible follow-up.
