---
pre_challenge: true
method: challenge-loop
branch: pane-staleness-1930
diff_hash: ada73cbefff1f83fb677666cdae89d2ea77ec514d1b1ae7ef44d1fefbcc70c0d
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T00:53:13Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind review passes
**Converged:** Yes -- iteration 4 found no new false-calm path beyond the two documented,
accepted residuals; zero new BLOCKER/WARNING/CONVENTION.
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, several NITs.
**Fixed:** 4 code WARNINGs + 3 NITs | **Deferred/Accepted:** 2 residuals (documented) + 1 NIT

The dangerous direction throughout is FALSE CALM (suppressing a genuine auth failure). The
design was ruled correct against the freshness-gate alternative (which reds the existing #966
test) and then hardened across four passes; the safety contract -- suppress ONLY on positive
live-HEALTHY evidence -- was mutation-tested non-vacuous by two independent reviewers.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 3 WARNINGs, 2 NITs
- [WARNING] status.js -- snapshot collapsed an unresolvable job and the default account into
  configDir=null, so a named non-default agent with an unreadable job could be judged by the
  default account (false calm). Extracted liveAuthForAuthFailed(): probe only a positively
  resolved job --> FIXED (0bdc9961)
- [WARNING] engine.reachable.test.js -- authprobe's single-line module.exports evaded the #265
  regex, so its exports (incl. test seams) were never inspected. Multi-lined + excused the
  seams; perturbation confirms it now covers authprobe --> FIXED (0bdc9961)
- [WARNING] authprobe.js -- a bounded (<=30s) re-expiry false-calm window --> ACCEPTED, documented
- [NIT] redundant drift-guard test --> folded into the CONTROL (0bdc9961)
- [NIT] kickCheck unused nowMs param --> removed (0bdc9961)

#### Iteration 2
**New:** 1 WARNING, 2 NITs
- [WARNING] status.js -- reconcileReport early-returned on a no-report agent BEFORE rule 3b, so
  a NEVER-REPORTED agent (the card's actual dead-agent subject) kept reading auth_failed even
  with a live-HEALTHY account. Moved the suppression to the TOP of reconcileReport; simplified
  rule 3b --> FIXED (154ff6b0)
- [NIT] liveAuthForAuthFailed did not wrap verdictFn --> wrapped (throw -> undefined) (154ff6b0)
- [NIT] empty-string configDir --> deferred (unreachable), later hardened in iter 4

#### Iteration 3
**New:** 1 WARNING, 2 NITs
- [WARNING] the suppression uses an ACCOUNT-level check for a per-AGENT question; a shared-account
  live-401-loop residual --> ACCEPTED, documented (inherent to the best available signal)
- [NIT] LIVE_AUTH_HEALTHY duplicated the 'healthy' string --> imported authprobe.HEALTHY (79f3a3c6)
- [NIT] plan over-specified "checked Ns ago" --> aligned with the implemented evidence line (79f3a3c6)

#### Iteration 4
**New:** 0 actionable (no new false-calm path). 2 NITs.
- [NIT] empty-string configDir (re-flagged) --> HARDENED (defense-in-depth, 2ed2dae9)
- [NIT] inline require of authprobe in snapshot --> left (cached, consistent with file convention)
- **CONVERGED.**

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | status.js | unresolvable-job -> default-account misattribution | FIXED | 0bdc9961 |
| 2 | 1 | WARNING | reachable test | vacuous #265 guard over authprobe | FIXED | 0bdc9961 |
| 3 | 1 | WARNING | authprobe.js | bounded <=30s re-expiry window | ACCEPTED | documented |
| 4 | 1 | NIT | status.test.js | redundant drift guard | FIXED | 0bdc9961 |
| 5 | 1 | NIT | authprobe.js | unused kickCheck param | FIXED | 0bdc9961 |
| 6 | 2 | WARNING | status.js | never-reported agent not suppressed | FIXED | 154ff6b0 |
| 7 | 2 | NIT | status.js | verdictFn not throw-guarded | FIXED | 154ff6b0 |
| 8 | 3 | WARNING | status.js | shared-account per-agent residual | ACCEPTED | documented |
| 9 | 3 | NIT | status.js | duplicated 'healthy' string | FIXED | 79f3a3c6 |
| 10 | 3 | NIT | plan | evidence-line over-specification | FIXED | 79f3a3c6 |
| 11 | 4 | NIT | status.js | empty-string configDir | HARDENED | 2ed2dae9 |
| 12 | 4 | NIT | status.js | inline require | DEFERRED | cached/consistent |

### Accepted residuals (documented in the plan, not papered over)
- **Bounded <=30s re-expiry window**: a HEALTHY verdict is trusted up to TTL_MS; a genuine
  re-expiry within it shows calm until the next re-probe. Bounded, self-healing, inherent to the
  off-tick cache #1885 mandates. The stale-HEALTHY downgrade caps any UNBOUNDED exposure.
- **Shared-account per-agent residual**: the live check is account-level, answering a per-agent
  question, because the pane (by this card's finding) cannot distinguish stale from current. A
  running agent still in a live 401 loop on a re-signed-in shared account could be suppressed
  until it restarts. Narrow; closing it fully needs per-agent pane-change liveness (a larger,
  separate mechanism). The account-level condition is the best available signal.

### Strengths (independently confirmed across iterations)
- No false-calm path beyond the two documented residuals: HEALTHY is returned only on positive
  CONNECTED evidence; EXPIRED / UNKNOWN / UNCHECKED / thrown / stale-HEALTHY all keep auth_failed.
- The top-of-function suppression is non-recursive (re-entry state is UNKNOWN) and reaches the
  never-reported agent; the CONTROL, GUARD, UNRESOLVABLE, NEVER-REPORTED, throwing-verdictFn, and
  authprobe SAFETY arms all genuinely red when reverted (mutation-tested).
- #966/#886/#1884/#1259/#1233 preserved: a fresh report alone never suppresses a scraped
  auth_failed. Only snapshot passes the 4th arg; other callers are unaffected.
- Off-tick + cost-bounded per #1885 (fire-and-forget, per-account debounce, lazy requires); no
  circular require; the reachable guard now genuinely covers authprobe. Full suite 3844/0.

## Delivery note
Kosmos beta app. Per Josh's ruling and the Kosmos-beta scope, a ready PR is self-merged on green
without waiting. This is a hot-path change to the board's state reconciliation (the "false calm"
area), reviewed across four blind passes; the two accepted residuals are documented for a
follow-up (per-agent pane-change liveness).
