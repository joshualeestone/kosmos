---
pre_challenge: true
method: challenge-loop
branch: no-buildmark-3641
diff_hash: a9e586b2731d79a3fe14528fd4cb31ffae7aa50e3023bbfbea9c20a747451ed5
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T21:56:55Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 raised no code finding; its one WARNING was that this proof file did not exist yet)
**Total findings:** 1 BLOCKER, 7 WARNINGs, 1 CONVENTION, plus NITs (and 1 out-of-loop red from the 6j gate)
**Fixed:** 8 | **Deferred:** 2 | **Asked (awaiting user):** 0

Note on the 6j gate: the first final validation (after iteration 2 converged) failed on
tools/test-bc-surface-map.sh: the rewritten check declared `buildmark`, a token with no functional
occurrence (the thing is gone). The annotation was dropped (6c416a00) and, per 6j, the loop ran another
iteration, which found the fine-grained surface gate BLOCKER below. The final 6j run passed on f9af9880
after rebasing onto origin/main (which carries the #3634 syspolicyd fix; the full-suite hold was lifted
16:28).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] browser-checks-reason-grep.test.js — the rewrite dropped one finding-emit site and one catch/launch site (129 -> 128, 91 -> 90) --> FIXED (74c7f9a9): the directory's guarded launch and per-finding FAIL loop restored; counts measured at 129/91
- [WARNING] render-build-marker-2066.js M5 — a failed click re-read the board --> FIXED (74c7f9a9): asserts the agent page opened, clicks the visible card (it was silently failing in the consolidated layout)
- [WARNING] render-talk-fill-2622.js A1n — out of scope, and the comment claimed Linux CI --> FIXED (74c7f9a9): comment corrected (the check runs at the cut on a Mac), plan and README record it; kept in this PR because the PR already edits the file and the .93 cut runs it on this Mac
- [WARNING] surface token `build` too broad --> FIXED (74c7f9a9), then dropped entirely (6c416a00)
- [NIT] x4 (launch outside try, M3 wording, README row, plan) --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** -> 6j failed (surface map), fixed, loop continued per 6j.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 1 of the above (the A1n comment)
- [BLOCKER] the removed Talk-view override named d-sec-talk, which render-agentpage-fullwidth-2012 declares --> FIXED (f9af9880): per-check override trailer (the line only positioned the deleted marker)
- [WARNING] A1n header comment contradicted the measurement --> FIXED (f9af9880)
- [WARNING] a green cut on an overlay-scrollbar Mac does not prove the edge control --> FIXED (f9af9880): stated in the README row
- [CONVENTION] plan did not mention the surface gate --> FIXED (f9af9880)
- [NIT] absence regex only matched a leading literal --> FIXED (f9af9880): matches the words anywhere; control red on old main
- [NIT] paintBuildLine control regex brittle; M4 single point; CI timing; rebase --> DEFERRED (tripwire by design) / noted / rebased

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] no pre-challenge proof file yet --> DEFERRED: not a defect; this file is the loop's output
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | browser-checks-reason-grep.test.js | BRANCH | emit-site counts broken | FIXED | 74c7f9a9 |
| 2 | 1 | WARNING | render-build-marker-2066.js M5 | BRANCH | click failure swallowed | FIXED | 74c7f9a9 |
| 3 | 1 | WARNING | render-talk-fill-2622.js A1n | BRANCH | scope + wrong CI claim | FIXED | 74c7f9a9 |
| 4 | 1 | WARNING | render-build-marker-2066.js:1 | BRANCH | surface token too broad | FIXED | 74c7f9a9, 6c416a00 |
| 5 | - | BLOCKER (6j) | tools/test-bc-surface-map.sh | BRANCH | dead surface token | FIXED | 6c416a00 |
| 6 | 3 | BLOCKER | web/index.html (removed line) | BRANCH | surface gate: d-sec-talk | FIXED | f9af9880 |
| 7 | 3 | WARNING | render-talk-fill-2622.js A1n | SELF | comment contradicts measurement | FIXED | f9af9880 |
| 8 | 3 | WARNING | README render-talk-fill row | BRANCH | overlay cut does not exercise edge control | FIXED | f9af9880 |
| 9 | 3 | CONVENTION | plan | BRANCH | surface gate unrecorded | FIXED | f9af9880 |
| 10 | 4 | WARNING | .claude/plans | BRANCH | proof file absent | DEFERRED | the loop writes it |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- chk()'s ternary emit is outside the reason-grep matcher's shapes (the counted per-finding loop covers it) (2)
- plan filename has no timestamp (4)
- paintBuildLine control regex anchors on whitespace (3); M4 samples one point (3); new timing waits in a CI-allowlisted check (3)

### Strengths (across iterations)
- The removal is complete by content (element, both CSS rules, painter, both calls) and guarded by absence tests with a real control (the Settings version line), in the unit test and on a booted board in both layouts
- sourceChannel stays and its comments now say why (the federation gate reads it)
- The reason-grep counts are neutral by construction, not by bumping numbers
