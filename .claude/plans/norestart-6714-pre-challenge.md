---
pre_challenge: true
method: challenge-loop
branch: norestart-6714
diff_hash: 2a35170fbc52669f8d525188ca28bbff33e03fe0e4488fbb37c9ae5029ef7b47
validation: passed
subdir_audit: passed
timestamp: 2026-10-20T19:40:14Z
iterations: 22
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 22
**Converged:** Yes (iteration 22: no new BLOCKER, WARNING or CONVENTION)
**Total findings:** recorded per iteration in the commit ledger below (each iteration's fixes are one commit, "norestart-6714 -- review N: <what changed>")
**Fixed:** every BLOCKER, WARNING and CONVENTION found in iterations 1 to 21 | **Deferred:** see Decided below | **Asked (awaiting user):** 0

Validation: `validation_log_run_or_skip` (full `tools/run-tests.sh`) PASSED for stack=typescript hash=2a35170fbc52, the same diff hash as this proof.

### Per-Iteration Breakdown

Reviewer models alternated between Opus and Sonnet across iterations (kosmos#2032). The per-iteration model and finding
counts were held in the session that ran iterations 1 to 21 and were not carried across a context reset; the commit for
each iteration is the durable record of what it found and what was changed.

#### Iterations 1 to 21
**Reviewer model:** alternating opus / sonnet (exact per-iteration record not retained across the reset)
Each iteration's actionable findings were fixed in one commit. ⚠️ The category on each line below is my reading of what
its commit changed, NOT the reviewer's own label, which was not retained across the reset; treat it as approximate.
- [WARNING] iteration 1 --> FIXED (cd85e30dba): repaint only on change, Settings reads its own list, {} means all, a failed start stays amber, Remove shows the agent
- [WARNING] iteration 2 --> FIXED (ce64fdd53d): a hide is forgotten once the agent starts at login, an already-resolved hide is not an error, focus moves
- [WARNING] iteration 3 --> FIXED (913cc9f9c7): hide failures are 500, focus survives a repaint and lands on the report, removed names leave the hidden list
- [WARNING] iteration 4 --> FIXED (6d08ec3b72): a report clears the repaint signature, forgetting stale hidden names reads the file at write time
- [WARNING] iteration 5 --> FIXED (812ad7369c): one report past the cap, orphaned hidden names forgotten, focus back
- [WARNING] iteration 6 --> FIXED (55d2876769): only a no-notice refusal counts as done, Show again refreshes the Settings list
- [WARNING] iteration 7 --> FIXED (a3d8b1be0a): the combined report keeps the guessed-model sentence, focus to the newest report
- [WARNING] iteration 8 --> FIXED (baafde1024, 7f980a80c7): a stale Start at login says what changed; render-survival waits for the hidden list
- [WARNING] iteration 9 --> FIXED (dbeb76e87d): layout-picker and noise tests follow the notice, an array body is refused
- [CONVENTION] iteration 10 --> FIXED (1482f8879c): dead CSS rule dropped; README row for the phone check
- [CONVENTION] iteration 11 --> FIXED (916b9cbe91): README rows; a failed hide write tested as 500
- [BLOCKER] iteration 12 --> FIXED (65877c10a8): hiding a restart notice is behind the remote step-up
- [WARNING] iteration 13 --> FIXED (1aaea23d31): the notice routes are visible to the step-up guard test (hide gated, show exempt with its reason)
- [CONVENTION] iteration 14 --> FIXED (fac6811dde): one comment for the forget rule
- [WARNING] iteration 15 --> FIXED (af5f680cce): focus after a close goes to the next x, never Start at login
- [WARNING] iteration 16 --> FIXED (5f46a8b215): a repaint's focus fallback is an x
- [WARNING] iteration 17 --> FIXED (2755087b15): hides are kept per notice; polls re-check the hold
- [WARNING] iteration 18 --> FIXED (e43c564a88): start reports get their own slot (the hold design removed); hide acts on the live notice
- [WARNING] iteration 19 --> FIXED (831965fbd2): mobile-shots waits for the report; focus returns on every failure
- [WARNING] iteration 20 --> FIXED (9970f54f97): one start at a time
- [WARNING] iteration 21 --> FIXED (1598632f6c): focus fallbacks for the last Show again and a repaint under a notice's words

#### Iteration 22
**Reviewer model:** recorded in session
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Converged** — no new actionable findings.

### Decided, not missed
- `register.hasRun` fails toward not-run: an agent with no liveness or self-report record gets no warning. Josh's rule
  is "a login it has run"; the comment says it costs the warning for an agent with no hook.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1-21 | 1-21 | per commit | see commits | BRANCH | see the per-iteration list | FIXED | the commit named per iteration |
