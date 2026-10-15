---
pre_challenge: true
method: challenge-loop
branch: mktemp-4298-rebuild
diff_hash: 1c52ec6d0e9472c55ce9cb2efd5d0b7ea7d35d3e87c76aa5ec5cc80b9cc67aa3
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T18:36:23Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (fresh blind agent each; models rotated Sonnet / Opus / Fable / Sonnet / Opus)
**Converged:** Yes, at iteration 5 (zero NEW BLOCKER/WARNING/CONVENTION, no unresolved ASKED).
**Total findings:** 5 WARNINGs, 1 CONVENTION, 6 NITs (plus many STRENGTHs).
**Fixed:** 5 | **Deferred:** 7 | **Asked (then resolved):** 1

The loop earned its keep twice. It caught that two of MY OWN comment "fixes" (iterations 1 and 2)
rested on a wrong model of bash signal handling, which iteration 3 then flagged and I corrected by
MEASURING the real behavior (bash runs an EXIT trap on a normal exit AND on any catchable signal;
only an uncatchable SIGKILL, or a signal arriving mid-trap, escapes). Iteration 4 went deeper and
showed, again by measurement, that the `trap 'exit 143' INT TERM HUP` added earlier to light-side
was counterproductive: it did not enable cleanup (the EXIT trap already did) and could defer it until
a foreground child returned, losing it entirely if that child outlived the watchdog's KILL. That was
raised as ASKED to the PM (it reversed a prior directive and needed a re-run), who chose to remove the
trap; removal was validated as a leaf + alone-PASS under a kt-shaped TMPDIR + a TERM control (exit 143,
`$T` gone). The code delta of the whole loop is comment-accuracy plus one trap removal; no templating
site changed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (the flagged comment predates this loop's fix commits)
- [WARNING] tools/test-queued-heavy-4977.sh:19 -- comment overstated cleanup ("every catchable path / only SIGKILL") --> FIXED (b29399dc1)
- [WARNING] tools/mktemp-template-check.js -- checker accepts a literal /tmp, so it cannot tell a sanctioned exception from an accidental one --> DEFERRED (documented contract: the guard checks a template EXISTS, not where it lands; an allowlist is an enhancement beyond this card)
- [NIT] tools/test-mktemp-template-4298.sh -- the 35-shape control list is hand-maintained (control already pins each by exact line)
- [NIT] tools/test-mktemp-template-4298.sh -- git ls-files scope misses an untracked new test until staged (documented)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 at flag time (lines predate this loop's fixes)
- [NIT] tools/test-light-side-4911.sh:12 -- comment overclaimed "only SIGKILL can escape" --> FIXED (dc44d7ed4)
- [CONVENTION] tools/lib/app-port-selftest.sh:38 -- templated but outside the guard's tools/test-*.sh scope --> DEFERRED (the plan's explicitly named weakest part; documented in CLAUDE.md conv 8 and the guard header; the card's measurement-based mitigation covers the broader residual)

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 2 of the WARNINGs (they were on the comments my iteration-1 and iteration-2 fixes had just written, the kosmos#120 pattern; caught and corrected by MEASURING bash behavior rather than writing another confident claim)
- [WARNING] tools/test-queued-heavy-4977.sh:20 -- comment claimed untrapped INT/HUP skip the EXIT trap; measured false --> FIXED (2bfd40b90)
- [WARNING] tools/test-light-side-4911.sh:13 -- same wrong model (SIGQUIT escapes); measured false --> FIXED (2bfd40b90)
- [NIT] tools/test-light-side-4911.sh:11 -- stale "as test-cut-guard.sh uses" (its primary $T is now TMPDIR-rooted) --> FIXED (2bfd40b90, now "secondary roots")

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (the trap predates this loop; it was added in the original light-side #4298 work)
- [WARNING] tools/test-light-side-4911.sh:16 -- `trap 'exit 143' INT TERM HUP` defers cleanup until a foreground child returns (measured 7.85s vs 0.00s without it) and the EXIT trap already covers the signals --> ASKED the PM (reversed a prior directive + needed a re-run) --> FIXED (34541bd14, trap removed per PM choice A; validated leaf + alone + TERM control)
- [NIT] tools/test-light-side-4911.sh:15-17 -- tiny orphan-holder window between the holder spawns and the trap re-arm --> DEFERRED (microscopic window; orphaned `sleep 600` holders are caught by the suite's process leak guard)
- [NIT] tools/mktemp-template-check.js:150 -- variable/literal/relative templates pass --> DEFERRED (documented in header + CLAUDE.md conv 8)
- [NIT] tools/{light-side,queued-heavy} -- /tmp SIGKILL residue --> DEFERRED (named, lands in /tmp not the real root, documented tradeoff)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings; signal/trap claims independently re-measured and confirmed accurate (incl. /bin/bash 3.2.57).
- [NIT] tools/test-mktemp-template-4298.sh:31 -- the guard's own scratch dir drops the `test-` prefix (still identifies the test) --> DEFERRED (cosmetic; a behavioral rename for zero functional gain, not worth re-validation)
- [NIT] tools/{queued-heavy,light-side} -- SIGKILL residue tradeoff re-noted --> DEFERRED (documented)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | test-queued-heavy-4977.sh:19 | BRANCH | comment overstated cleanup coverage | FIXED | b29399dc1 |
| 2 | 1 | WARNING | mktemp-template-check.js | BRANCH | literal /tmp indistinguishable from accidental | DEFERRED | documented contract |
| 3 | 2 | NIT | test-light-side-4911.sh:12 | BRANCH | comment overclaim "only SIGKILL" | FIXED | dc44d7ed4 |
| 4 | 2 | CONVENTION | lib/app-port-selftest.sh:38 | BRANCH | templated but outside guard scope | DEFERRED | plan's named weakest part |
| 5 | 3 | WARNING | test-queued-heavy-4977.sh:20 | SELF | wrong bash signal model | FIXED | 2bfd40b90 |
| 6 | 3 | WARNING | test-light-side-4911.sh:13 | SELF | same wrong signal model | FIXED | 2bfd40b90 |
| 7 | 3 | NIT | test-light-side-4911.sh:11 | SELF | stale cut-guard parenthetical | FIXED | 2bfd40b90 |
| 8 | 4 | WARNING | test-light-side-4911.sh:16 | BRANCH | signal trap defers/loses cleanup | FIXED (ASKED->A) | 34541bd14 |
| 9 | 4 | NIT | test-light-side-4911.sh:15-17 | BRANCH | tiny orphan-holder window | DEFERRED | leak-guard-caught |
| 10 | 4 | NIT | mktemp-template-check.js:150 | BRANCH | var/literal/relative templates pass | DEFERRED | documented |
| 11 | 5 | NIT | test-mktemp-template-4298.sh:31 | BRANCH | guard scratch drops test- prefix | DEFERRED | cosmetic |
| 12 | 1-5 | NIT | queued-heavy/light-side | BRANCH | /tmp SIGKILL residue | DEFERRED | documented tradeoff |

### Outstanding questions (ASKED, still unresolved when the run ended)
None. The one ASKED finding (iteration 4, the light-side signal trap) was answered by the PM (remove it, choice A) and the answer was applied and validated before convergence.

### NITs (non-blocking, across all iterations)
- [NIT] guard control list hand-maintained (iter 1); ls-files misses untracked new tests (iter 1)
- [NIT] orphan-holder window (iter 4); checker variable/literal/relative gap (iter 4, documented)
- [NIT] guard scratch dir drops test- prefix (iter 5, cosmetic); /tmp SIGKILL residue (iters 4/5, documented tradeoff)

### Strengths (across all iterations)
- Static checker clean on the real scope (142 files, floor 120) and RED on an injected bare mktemp; negative control pins all 35 bare shapes by exact line, positive control proves templated/comment/message are not flagged.
- Every templated site preserves original `-d`/file semantics and trailing code; names derive from the basename; no `-t name`/`-p` special naming lost.
- Guard genuinely wired into test:shell (bash -n plus a run); CLAUDE.md convention 8 matches enforcement; documented gaps named honestly.
- The two literal-/tmp exceptions justified by the measured kt-sandbox rule; signal/trap claims measured, not asserted.
