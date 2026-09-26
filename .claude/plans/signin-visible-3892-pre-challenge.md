---
pre_challenge: true
method: challenge-loop
branch: signin-visible-3892
diff_hash: 45e2251162f1389f0ba379463dd8656eba4ea0843ef50eecde09334e801884c3
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T14:07:48Z
iterations: 15
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 15 (iteration 1 = the initial validation, which failed on the #2518 surface gate and was fixed; iterations 2 to 15 = fourteen blind review rounds)
**Converged:** Yes. Round 13 (iteration 14) had no new findings. The before/after screenshots then showed a short name squeezed to "A.." and I fixed it, so round 14 (iteration 15) reviewed that change. It also had no new findings; its warnings duplicated round 8's recorded decision and the gap deferred in rounds 10 and 12.
**Total findings:** 1 BLOCKER (validation), about 24 WARNINGs, 6 CONVENTIONs, many NITs. Every round is in the plan's Review list.
**Fixed:** all but the deferrals below | **Deferred:** 4 (reasons below) | **Asked:** 1, put to Liu Kang or Josh in the PR (round 8's trade-off)

Reviewer model: Opus for every round. Sonnet is off limits until Sunday 2026-09-27 17:00 CDT (the weekly limit, Liu Kang m711), so a single model witnessed the convergence. That is a known weakness.

Final state (head b4ea40a9b, rebased onto origin/main after validation):
- tools/run-tests.sh on the previous base (b2c2fd39a): 9960 tests, 9808 pass, 0 fail, validation PASSED (hash 240493d21663), subdir audit clean. The surface gate needed three re-run checks, recorded in the commit trailers.
- After the rebase (67 commits; the only conflict was browser-checks-reason-grep's pinned site count, now main's 172 plus 1), re-run on this head under gate v4:
  - render-signin-visible-3892 348/0 on Chromium and WebKit. The check also fails if it ran any number other than 174 per engine.
  - render-dm-chatfirst-718 634/0.
  - render-swarm-ui-3564 60/0.
  - browser-checks-reason-grep and tools.browser-checks-wired 14/0.
  - CI runs the full suite on the pushed head.
- Against main's page 144 of 348 fail. Controls, each removing one piece: pin 40, swarm floor 10, one-line row 8, inset ring 8, 16px gap 8, hiding the role 2, defensive Start floor 2, 30% cap 1.

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none (helpers)
- [BLOCKER] initial-validation: #2518 surface gate flagged touched checks --> FIXED (re-run on the tree; per-check trailers)

#### Iterations 2 to 13 (rounds 1 to 12)
**Reviewer model:** opus
Each round's findings and what happened to each are in .claude/plans/signin-visible-3892-20260926T100834Z.md, "Review".
- [WARNING] round 1: a swarm agent's Stop now was covered by the pinned button on an SE --> FIXED (floor for the swarm case)
- [WARNING] round 2: the pinned button's focus ring was clipped --> FIXED (drawn inside; Tab arm)
- [WARNING] round 3: notes were shown by hand, so the painter was untested --> FIXED (painter-driven arms)
- [WARNING] round 4: Start and Sign in again never show together --> FIXED (re-scoped to the swarm case; Start is a defensive arm)
- [WARNING] round 5: a long name pushed Stop now under the button --> FIXED (one-line name row)
- [WARNING] round 6: flex settings contradicted the comment --> FIXED (the task sentence is hidden in that state)
- [WARNING] round 7: the fade lay over the quote's last line --> FIXED (16px gap); count guard added
- [WARNING] round 8: the pinned button lies over Stop now's warning --> DECIDED (190px floor; the warning scrolls clear; ASKED of Liu Kang or Josh in the PR)
- [WARNING] round 9: the swarm budget was unchecked on the painted case --> FIXED
- [WARNING] round 10: the floors had no height ceiling --> FIXED (held to 30% of the height; sideways arm)
- [CONVENTION] rounds 11 and 12: plan text leftovers, commit message round count --> FIXED
- [WARNING] round 12: the defensive Start branch could hide a task sentence --> FIXED (the one-line rules are swarm only)

#### Iteration 14 (round 13)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs (one duplicated round 8's decision), 0 CONVENTIONs, NITs only
**Converged.**

#### Iteration 15 (round 14, after the screenshot-found name fix)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 new WARNINGs (both duplicated recorded decisions or deferrals), 0 CONVENTIONs, NITs. The check's surface annotation gained the one-line elements.
**Converged.**

### Deferred (with reasons in the plan)
- The 16px gap and 44px height also apply when nothing overflows (Sign in again alone grows the header by about 36px within its cap).
- The Kosmos+ gradient and help-tour dim show against the flat --k-bg pinned band.
- The long one-line-state selectors are not grouped; the floors are not custom properties.
- Phones narrower than 375, and the sideways layout's pre-existing lack of conversation room (a follow-up).
