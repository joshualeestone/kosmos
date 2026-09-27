---
pre_challenge: true
method: challenge-loop
branch: orghover-4052
diff_hash: fabb2f6768f9f22f53010c55870a9df5e26debfd0bd615e80f55ccd4bc7aee70
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T06:59:42Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 reviewer passes
**Converged:** Yes, at iteration 8 (both its WARNINGs repeat deferred items)
**Total findings:** 21 actionable (0 BLOCKERs, 18 WARNINGs, 3 CONVENTIONs), plus NITs
**Fixed:** 16 | **Deferred:** 5 | **Asked (awaiting user):** 0

### Validation, stated as it happened

- The final gate (6j) first went red on the browser-check surface gate: the CSS touches the `orgmap` and
  `onode` selectors, which three org-chart checks assert. Those three checks (render-orgchart-phone-718,
  render-org-rings-2576, render-dm-badges-2863) were RUN on this branch and passed on the first attempt,
  and per-check trailers record that. The rerun then passed: validation and subdir audit exit 0.
- Earlier 6g runs on this branch were red once on #1618 (unrelated; its fix is #4073) and once on
  contention; each such test was green alone.
- Final browser runs on d1c9df96 (render-swarm-ui-3564, render-org-drag): green, S41 passed both times.

### How the fix was measured (Chromium)

S41 compares decoded pixels of each cluster not hovered (2/255 noise floor) and every cluster's box,
with the status poll held, scroll pinned, and the reproducing pair (hover crew2, compare crew) required.
Attempt counts: no will-change, every attempt red (up to 10/255); faces only, 2 of 6 red; faces and
nodes layered (shipped), 12 of 12 green over 11 runs. The Mac app (WKWebView) is unverified.

### Per-Iteration Breakdown

The Self-generated line is recorded as not measured: the 6c-bis blame lookup was not run, and this field
must not be filled in by judgement.

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** not measured
- [WARNING] the callout's own opacity transition was not layered --> FIXED (will-change, as a precaution)
- [WARNING] the pixel capture missed a cluster's overflow --> FIXED then REVERTED in iteration 2 era (the margin caught 1/255 noise; the circles are laid out inside the face, stated in the check)
- [WARNING] only the callout was treated as cover --> FIXED (the hovered node's whole painted extent)
- [CONVENTION] README row lacked S40/S41 --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** not measured
- [WARNING] a zero cover margin could flip at exactly touching --> FIXED (1px slack)
- [CONVENTION] plan filename lacks a timestamp --> DEFERRED (the PR hook requires .claude/plans/<branch>.md)
- Outside the review: S41 had been comparing PNG bytes (identical pixels encode differently) and was red with and without the fix; it now decodes pixels with a 2/255 floor, measured to discriminate (fixed 2/2 green, unfixed red).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** not measured
- [WARNING] no count proved the reproducing pair was compared --> FIXED
- [WARNING] an in-flight poll could still land --> FIXED (a landed-poll counter, asserted)
- [WARNING] a scroll would read as a box moving --> FIXED (scroll offsets asserted)
- Then measured: faces-only still red 2 of 6; the node layer was added (12/12).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 1 NIT
**Self-generated:** not measured
- [WARNING] the measurement counts disagreed between code and plan --> FIXED (stated once, in attempts)
- [WARNING] the race is rarer, not proven gone --> FIXED (named in the plan's weakest premise)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** not measured
- [WARNING] a glow painted past the node was not cover --> FIXED (box-shadow and outline reach)
- [WARNING] text on a layer may soften on non-Retina --> DEFERRED (named in the plan)
- [WARNING] layer and mask cost --> DEFERRED (count stated: three layers per agent plus a clip mask; unmeasured on a large fleet)
- [CONVENTION] the cost comment said two layers --> FIXED
- NIT taken: the poll hold is released in finally (and three assertions that briefly left scope were moved back inside before commit)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 new WARNING (one repeat), 1 repeat CONVENTION, 1 NIT
**Self-generated:** not measured
- [WARNING] the cover heuristic's scope was unstated --> FIXED (comment)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 new WARNINGs (two repeats), 3 NITs
**Self-generated:** not measured
- [WARNING] code comments claimed "never repaints" --> FIXED (they claim what was measured)
- [WARNING] the text-on-a-layer premise named only the callout --> FIXED (initials and badge text too)
- NIT taken: a scale transform removed from the unmodelled list (the rects already show it)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 new (both WARNINGs repeat the Chromium-only and layer-cost deferrals), 1 NIT
**Self-generated:** not measured
**Converged** -- no new actionable findings.

### Deferred (open, named in the plan)

- Verified in Chromium only; Josh saw it in the Mac app (WKWebView). A #4052 card comment asks for a check on the next cut build; the PR says Addresses, not Closes.
- The fix makes the race rare (0 of 12), not provably gone: a future S41 red should be read as this race first.
- Layer cost (three per agent plus a clip mask) unmeasured on a large fleet.
- Text on these layers (initials, badge, callout) may soften on non-Retina or ClearType displays.
- Plan filename convention (hook requires <branch>.md).

### Strengths
- The check discriminates, measured both ways, and cannot pass by skipping the reproducing pair
- The wrong first fix (rounding positions) was measured and rejected
- Every claim in the comments is one that was measured
