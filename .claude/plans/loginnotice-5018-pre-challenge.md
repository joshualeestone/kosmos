---
pre_challenge: true
method: challenge-loop
branch: loginnotice-5018
diff_hash: 5c59982c10537db6bd266859fbc85ce6fa684d9591c817224bac692b693ab590
validation: focused (fast-update path per Splinter / #4601; 293 focused + 34 guard tests green on the merged tree; the 0.7.20 cut's suite is the full run)
subdir_audit: n/a (no subdir CLAUDE.md changed)
timestamp: 2026-10-02T20:16:23Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12 feature (opus/sonnet alternating) + 3 browser-check rounds + 1 confirming pass = 16
**Converged:** Yes - the final confirming blind pass (opus) on the rebased head found zero actionable.
**Total findings:** many across the loop; the final head's last pass had 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs.
**Fast-update path** (rides 0.7.20): merged on the converged loop + a clean merge-tree + focused tests on the
MERGED tree (rebased onto current main, which had changed status.js and index.html) + no CI check that ran red.

### Per-Iteration Breakdown

#### Iteration 1-12 (feature loop, opus/sonnet alternating, pre-reboot)
[BLOCKER] claudeloginlive TDZ reject on Windows (iter1) --> FIXED
[BLOCKER] render-update-toast pinned inline placement (iter3) --> FIXED
[BLOCKER] a fixture without a service made the X undo itself (iter11) --> FIXED
[WARNING] consolidated z-order, reload-vacuous, enrichment untested (iter1) --> FIXED
[WARNING] explicit CCD email, on-top control (iter3) --> FIXED
[WARNING] stale expired dismissal (iter8); prune too eager (iter9) --> FIXED
[CONVENTION] comment wording, X a11y name, phone width, :empty (iter2) --> FIXED
Iterations 4 and 12 (sonnet) found 0 new. A #3071 fixture-name guard red was FIXED.

#### Iteration 13-15 (browser-check control, post-reboot, blind)
[WARNING] the on-top control measured only the notice centre, which lands in a body-grid gap in the consolidated layout (false) --> FIXED: sample a 5x3 grid; the control requires real content under a sampled point.
[WARNING] the control counted a wrapper that CONTAINS the notice as "content underneath" --> FIXED: isContent also excludes an ancestor that contains(n), so it needs a real competing layer.
[CONVENTION] two comment-accuracy fixes --> FIXED

#### Iteration 16 (confirming pass, opus, on the rebased head)
[NIT] loginAdvHiddenMem in-memory array pruned per-paint but not size-capped like its localStorage copy (harmless)
[NIT] #topnotes DOM-nested in .headleft but anchors to the position:relative header (works; cosmetic)
[STRENGTH] the on-top check is non-vacuous: a hidden-stack control proves real content sits under the sampled points before asserting the notice covers them.
[STRENGTH] the claudeloginlive login-generation race (in-flight read not reused, never overwrites a newer answer) is correct and covered by a test; the X keys on the credential so a transient email/pane read cannot resurrect a closed notice.
[STRENGTH] the email derivation matches the #2129 set-vs-unset split exactly; the floated #topnotes anchors correctly without growing the header.
**Converged** - no new actionable findings.

### Final Ledger

| # | Category | Area | Status | Resolution |
|---|----------|------|--------|------------|
| 1 | BLOCKER | claudeloginlive TDZ (Windows) | FIXED | feature loop iter1 |
| 2 | BLOCKER | update-toast placement | FIXED | iter3 |
| 3 | BLOCKER | X-undoes-itself fixture | FIXED | iter11 |
| 4 | WARNING | on-top control centre-only | FIXED | grid sampling (04fd97726) |
| 5 | WARNING | control counts a wrapper as content | FIXED | !contains(n) (2b8caa32c) |
| 6 | NIT | loginAdvHiddenMem mem not capped | DEFERRED | pruned per paint; harmless |
| 7 | NIT | #topnotes DOM nesting | DEFERRED | anchors to header; cosmetic |

### Deferred
- The two NITs above are cosmetic / harmless on a mature branch and were not chased.

### Verify
293 focused tests (loginexpiry-signin-5018, loginexpiry-snapshot-3532, loginexpiry, claudeloginlive,
claudelogin-3997, whatsnew-3955, status) + 34 guard tests (browser-checks-indexed, reason-grep, no-brand,
no-name, fixture-discipline) all green on the rebased merged tree. The live rendering is the PR's own
GitHub browser-checks CI job.
