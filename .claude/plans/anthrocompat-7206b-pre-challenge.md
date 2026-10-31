---
pre_challenge: true
method: challenge-loop
branch: anthrocompat-7206b
diff_hash: 09056741b58c30a66bf3823e559b944b8ab1f5afc7a459437bf5b534c2b6e107
validation: focused-passed; full suite not run locally (withdrawn from a 7-deep queue), PR CI carries it
subdir_audit: passed
timestamp: 2026-10-26T22:56:25Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6: 0 BLOCKERs, 0 WARNINGs, 3 NITs: one fixed, one documented, one accepted)
**Fixed:** every BLOCKER and WARNING of iterations 1-5 | **Deferred:** the items the plan lists as required before the switch is turned on (all unreachable while it is off) | **Asked:** 0

Changes after convergence, stated so nobody reads the review as covering them:
- The DeepSeek row's own browser check, render-deepseek-add-7206.js (hermetic, gated), and the defect it found:
  acctShowSuccess's hide list did not name acct-compat-flow, so the emptied key form stayed on screen under Success.
  One id added to that list and to #1656's stub test. Red before the fix; a mutant forcing compatAsk on reds all four
  OFF arms (8 pass, 4 fail).
- A plan file named for the branch (it points at the shared plan).
- Rebased onto main twice (1a merged as #7253; later main). Clean both times.

Validation (6j), stated as it happened:
- Focused, on the head after the last rebase: the 7206 engine, server, supervisor and create tests; the four
  full-suite-only guards (engine.reachable, windows-coupling-audit-1732, windows-tests-1777; no macRequest added);
  agentpermission-5406; web.connect-success-1656; the browser-check wiring tests (indexed, reason-grep, wired):
  118 tests, 117 pass, 1 skipped (the live Claude test), 0 fail. render-deepseek-add-7206.js 12/12, rc 0. Both
  browser-check gates rc 0 on the pre-rebase head.
- Full local suite: queued 17:2x CDT, withdrawn at 17:5x still 7 deep (this Mac's queue was holding a TestFlight
  build). PR CI carries the full suite. Not recorded as a local pass.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the check route sent a stored key to the vendor with the switch off --> FIXED (obeys the switch; red-checked)
- [WARNING] Repair would rebuild and launch a vendor agent with the switch off --> FIXED (red-checked)
- [WARNING] setAccount could move an agent across providers --> FIXED (setVendorAccount: DeepSeek to DeepSeek only)
- [WARNING] compatAsk raced and could clear a pasted key on a failed ask --> FIXED (one shared request, 5s reuse, keeps the last answer)
- [NIT] failover may send work to an idle DeepSeek agent --> ACCEPTED (only while the switch is on; Qwen's behaviour)

#### Iteration 2
- [BLOCKER] my vendor block sat inside Qwen's account block in setProvider, so a switch onto Qwen lost its trust write --> FIXED (restored; pinned by a test red with the misplacement put back)
- [WARNING] an agent made while the switch was on would still launch after it was turned off --> FIXED (launch-env refuses: a kill switch)
- [WARNING] the agent page treated a DeepSeek agent as Claude --> FIXED (accountForAgent, providerOf, RUNNER, CURRENT.account)

#### Iteration 3
- [WARNING] the environment-variable half of the switch never reached an agent's launch --> FIXED (the marker is the only on-state)
- [WARNING] the detail panel's model picker and move list treated DeepSeek as Claude --> FIXED (mirrors Qwen; modelLine pinned)

#### Iteration 4
- [WARNING] the test switch helper could resolve to the REAL data folder on a missing argument --> FIXED (refuses any folder outside the temp folder; pinned)
- [NIT] DeepSeek naming in the world view, tally and org rollup --> DEFERRED (required before the switch is turned on)

#### Iteration 5
- [WARNING] the vendor leg of GET /api/accounts could fail the whole list --> FIXED (.catch to [])

#### Iteration 6
No blockers, no warnings.
- [NIT] a test wrote the marker without the helper's guard --> FIXED
- [NIT] accountConnectable reads the real platform --> DOCUMENTED
- [NIT] a late repaint can briefly show the previous agent's provider --> ACCEPTED (cosmetic, unreachable while off)

### Final ledger
Converged at iteration 6. Decisions and the before-the-switch list: .claude/plans/anthrocompat-7206.md.
