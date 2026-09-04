---
pre_challenge: true
method: challenge-loop
branch: paneless-restarting-test-2019
diff_hash: 7b5bb5d989eec00fb3ca08d6af6865a59e19a64704220eced90ef6a38958c628
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T04:27:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 found no blocker/warning/convention)
**Total findings:** 1 WARNING, 5 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 1 WARNING + 5 NITs | **Deferred:** 0 | **Asked:** 0

### Change under review (#2019 follow-up, test-only)

Arms the merged #2019 offline early-return guard (`a.running === false && a.state !== 'restarting'`
in card() and lrow()) for the paneless `running:false` path, which the #2111 browser check never
exercised. An untested guard is an unarmed guard, and now that #2105 emits `state='restarting'` for
a paneless agent, this path is live. Test-only: `docs/browser-checks/render-restarting-2019.js` +
a plan file. No product code.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the guard lives at two sites (card + lrow); the first arm exercised only card() --> FIXED: added a paneless lrow() arm + its control.
- [NIT] the card label field was read but not asserted --> FIXED: assert === "Restarting agent".
- [NIT] the comment implied `present` was load-bearing for card() --> FIXED: only `running` is.

#### Iteration 2
**Converged** -- no blocker/warning/convention. The reviewer confirmed the arms are non-vacuous (each fails if the guard is removed), the controls genuinely discriminate (a non-restarting running:false agent still reads "Not running" at both sites), the selectors match what the product emits, lrow(a) does not throw for a running:false/context:null restarting agent, and the harness exit handling cannot false-pass.
- [NIT] the plan conflated the card/lrow early-return guard with the members present-branch (a different construct) and did not explicitly defer members --> FIXED in the plan.
- [NIT] the plan described the fixture as present:false but the fixture omits present --> FIXED in the plan.
- [NIT] haveFns did not check lrow (a ReferenceError would be a hard error, not a clean FAIL) --> FIXED: added `typeof lrow === 'function'`.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | render-restarting-2019.js | only card() armed, not lrow() | FIXED |
| 2 | 1 | NIT | render-restarting-2019.js | card label read but not asserted | FIXED |
| 3 | 1 | NIT | render-restarting-2019.js | comment implied present load-bearing | FIXED |
| 4 | 2 | NIT | plan | conflated card/lrow guard with members present-branch | FIXED |
| 5 | 2 | NIT | plan | fixture described with present:false | FIXED |
| 6 | 2 | NIT | render-restarting-2019.js | haveFns missing lrow check | FIXED |

### Outstanding questions (ASKED)
None.

### Validation

Test-only (docs/browser-checks is not in npm test). Node/shell suite green (4199/4199) as a
formality; the meaningful gate is the browser check itself: all arms pass both themes on origin/main,
with discriminating controls. Not a web/ product change, so the #1720 browser-check gate does not
apply. The members present-branch (pjMember) is a deliberately-deferred separate follow-up.

### Strengths (iteration 2)
- [STRENGTH] The arms are non-vacuous: each paneless assertion fails if the guard is removed (the agent takes the offline early-return, cardClass becomes off/notrunning, the K drops, the label becomes "Not running").
- [STRENGTH] The controls discriminate: a non-restarting running:false agent still reads "Not running" at both card and row, proving the pass is the guard, not a globally-defeated early-return.
- [STRENGTH] Selectors match the product; lrow(a) is null-tolerant for a running:false/context:null agent; exit handling (process.exit + .catch) cannot false-pass; no em dashes.
