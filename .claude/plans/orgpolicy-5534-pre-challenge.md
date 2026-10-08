---
pre_challenge: true
method: challenge-loop
branch: orgpolicy-5534
diff_hash: 5213aa0f706db8efc09f3372176a56494d8fd6193c091c2a3c2f14f29d5ebf59
validation: passed (focused: the 6 touched test files in full and 8 file-scanning guards, rebased on origin/main; the full suite runs in CI before merge)
subdir_audit: passed
timestamp: 2026-10-08T05:37:26Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (opus and sonnet alternating, each blind)
**Converged:** Yes (iteration 6: nothing above NIT)
**Total findings:** 3 BLOCKERs, 14 WARNINGs, 4 CONVENTIONs, about 20 NITs
**Fixed:** every BLOCKER; every WARNING fixed or documented as a stated limit | **Asked (awaiting user):** 0

The change (Enterprise E0.5, board side, slice 1, #5534): the board verifies the coordinator-signed company policy (KST1 org_policy), keeps the last good one, refuses rollback per org, and refuses creating, connecting, importing or switching an agent onto a provider or model the policy does not allow. Running agents are never stopped (nothing is bricked).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] connecting a folder and importing skipped the policy --> FIXED: both ask; tests red without the gates.
- [BLOCKER] another org's bundle in between reopened rollback --> FIXED: per-org version marks; deleting the record stays a stated limit (needs E0.3).
- [WARNING] a model list dodged by naming no model --> FIXED.
- [WARNING] per-Kosmos policy; no way out until E0.2; coordinator side not built --> DOCUMENTED in the header and card; iat as the token format names it.
- [CONVENTION] create by key when listed by full id untested; stateDir comment; header said LAUNCHED --> FIXED.

#### Iteration 2 (sonnet)
- [WARNING] Gemini's "default" was a Claude model; a switch was judged before its picked model --> FIXED (setProvider takes the picked model; the route passes it).
- [WARNING] Repair would start a policy-held import --> FIXED (policyHeld mark).
- [WARNING] setModel refuses a vendor default under a list --> DECIDED (a vendor default no list can name stays refused).
- [CONVENTION] a test failed when run alone --> FIXED.

#### Iteration 3 (opus)
- [BLOCKER] a model-less Claude agent runs Claude Code's own pick, not sonnet --> FIXED: refused under a model list (decided, weakest premise on the card).
- [WARNING] Gemini and Grok have pinned defaults --> FIXED (win32keyed.DEFAULT_MODEL).
- [WARNING] Repair never cleared the held mark --> FIXED.
- [WARNING] five uncatchable mutations --> FIXED with tests.
- [WARNING] the header understated what a local user can do --> FIXED.
- [WARNING] a switch whose model write fails restarts on the runner's pick --> DOCUMENTED (rare).

#### Iteration 4 (sonnet)
- [WARNING] setModel bypassed policyAllows --> FIXED.
- [WARNING] a Gemini/Grok switch refusal named a model the person did not pick --> FIXED in wording.
- [NIT] exp, Grok default, fail-open untested; mark cleared before install --> FIXED.

#### Iteration 5 (opus)
- [WARNING] the rollback test could not fail on either half of the marks --> FIXED (three orgs and an old record; each half red when removed).
- [WARNING] the switch test switched Claude to Claude --> FIXED.

#### Iteration 6 (sonnet)
- Nothing above NIT. 23 of 24 mutations red. NITs stated in the plan.

### Not in this slice (on the card)
Enrollment gate and leaving a company (E0.2), the coordinator storing the reported version (needs a consent line, E0.3), the AI policy text, the console (E0.4 #5533).
