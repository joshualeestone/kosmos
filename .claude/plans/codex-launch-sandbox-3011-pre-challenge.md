---
pre_challenge: true
method: challenge-loop
branch: codex-launch-sandbox-3011
diff_hash: 20caae0bfa3db1a5534c312db755afca06b8cf5f15ecb8f64d36462dc5302819
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T22:30:04Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 WARNING, 2 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 1 (iteration-1 WARNING) | **Deferred:** 1 (iteration-2 WARNING) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty at the first reviewer pass; 6.0 passed clean)
- [WARNING] tools/test-launchagent-leak-guard-3011.sh -- the three "is the guard wired"
  source-invariant legs used unanchored substring greps, so a comment or commented-out
  reference could false-pass them (the sibling codexhome-2858 pins to statement syntax).
  --> FIXED (commit b99e7e9): grep a comment-stripped view of run-tests.sh for the existence
  legs; the ordering leg skips comment lines (`^[[:space:]]*[^#[:space:]]`).
- [NIT] the fail-soft leg exercised only the non-existent-dir arm, not the missing-baseline
  arm. --> FIXED (commit b99e7e9): added a missing-baseline fail-soft leg.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (the WARNING is about the guard's real-home snapshot, a BRANCH line)
**Duplicates/deferrals:** the WARNING is the plan's documented weakest premise.
- [WARNING] tools/run-tests.sh -- the guard snapshots the operator's REAL
  ~/Library/LaunchAgents, so a legitimate concurrent real-agent create/re-install during a
  `yarn test` run could false-red the suite. --> DEFERRED. This is exactly the weakest
  premise the plan documents, and the reviewer itself rated it "acceptable": CI runners never
  create real fleet agents so the gate cannot false-red there; on a dev box it needs a
  concurrent real create inside the test window (uncommon) and costs a re-run, matching
  run-tests.sh's existing #708 contention philosophy. Escalation path if it proves noisy in
  practice: scope the guard to plists whose content references a temp/sandbox path (the leak
  signature), so a real-path create never trips it. What would change the deferral: an
  observed false-red on a real create.
- [NIT] launchagent-leak-guard.sh -- 1-second mtime granularity has a theoretical
  false-negative only if a plist is rewritten in the same wall-clock second as its baseline
  mtime; impossible here since the baseline is taken immediately before the suite. Reviewer:
  "not actionable." No change.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-launchagent-leak-guard-3011.sh | BRANCH | unanchored existence-leg greps could false-pass on a comment | FIXED | b99e7e9 |
| 2 | 1 | NIT | tools/test-launchagent-leak-guard-3011.sh | BRANCH | fail-soft leg missed the missing-baseline arm | FIXED | b99e7e9 |
| 3 | 2 | WARNING | tools/run-tests.sh | BRANCH | real-home snapshot could false-red on a concurrent real create | DEFERRED | documented weakest premise; reviewer-confirmed acceptable; CI-safe |
| 4 | 2 | NIT | tools/lib/launchagent-leak-guard.sh | BRANCH | 1s mtime granularity theoretical false-negative | DEFERRED | not actionable (baseline predates suite) |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (across all iterations)
- test-launchagent-leak-guard-3011.sh missing-baseline fail-soft arm (iteration 1) -- FIXED.
- 1-second mtime granularity inherent limit (iteration 2) -- not actionable.

### Strengths (across all iterations)
- Root-cause fix is minimal and correct: create.js:238 agentsDir() falls back to real
  ~/Library/LaunchAgents only when AGENT_WORKFORCE_LAUNCH is unset; the test now sets +
  mkdirs it before the fleet/create requires, matching all ~51 sibling test files (both iters).
- The guard is parameterized by dir so its control test drives real red/green/scope/modify/
  fail-soft assertions against a temp dir, never touching or re-leaking into real home (both).
- comm -13 over `<mtime>\t<path>` catches BOTH new and modified plists; LC_ALL=C consistent;
  stat BSD/GNU portable; pre-existing real fleet plists sit in the baseline and never trip it (both).
- Guard wiring is well-ordered and safe: snapshot before the suite, check after node + shell
  tests, runs even beside a red, only overwrites NODE_STATUS when it was 0, temp files cleaned,
  set -uo pipefail safe, no top-level side effects when sourced (iteration 2).
- End-to-end proof: after a full-suite validation run, real ~/Library/LaunchAgents held 0
  com.kosmos.agent.* (before the fix it would have leaked 5), and the guard did not false-fire.
