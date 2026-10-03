---
pre_challenge: true
method: challenge-loop
branch: chevwrap-5053
diff_hash: 9d7550a18107ae8afb5292d71cf46a0f86dac108dc96cf5930ab8897df9f7dc9
validation: passed
subdir_audit: passed
timestamp: 2026-10-03T01:44:29Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 5 WARNINGs, 3 CONVENTIONs (0 BLOCKERs), plus NITs
**Fixed:** 8 | **Deferred:** 0 | **Asked (awaiting user):** 0

Full validation passed at 659b3e458 (validation-log hash 9d7550a18107, the same diff as this proof). The commit after
convergence (659b3e458) is surface-gate trailers only, with no file change, so the reviewed diff is the diff hashed here.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] web/index.html - the title's 20px line-height made wrapped 24px lines touch --> FIXED (phone width; pinned)
- [WARNING] web/index.html - the flex version centred the chevron on the whole title block --> FIXED (phone grid, align-self start; 4px chevron-top assertion)
- [CONVENTION] .claude/plans/chevwrap-5053.md - plan described the superseded design --> FIXED
- [CONVENTION] web/index.html - stale "may wrap" comment --> FIXED
- [NIT] docs/browser-checks/mobile-shots.js - "built-in seed" wording (taken)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - above 40rem a long title wraps in its own box at 20px lines, so lines touched at 641-800px --> FIXED (line-height 1.2 at every width; 1280 head-height rule and a 700px arm added)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 1 of the above (the desktop arm iteration 1's fix did not cover)
- [WARNING] web/index.html - on desktop the chevron centred on a wrapped title --> FIXED (align-self flex-start; control: centring again fails only the new 700 rule)
- [WARNING] docs/browser-checks/render-subback-4586.js - the 700 arm probably never wrapped --> FIXED (a name long enough to wrap at 700, asserted h > 36)
- [CONVENTION] .claude/plans/chevwrap-5053.md - stale line-height decision --> FIXED
- [NIT] web/index.html - the CSS comment names both button heights (taken)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | wrapped title lines touched at phone width | FIXED | line-height, pinned |
| 2 | 1 | WARNING | web/index.html | BRANCH | chevron centred on the title block | FIXED | phone grid |
| 3 | 1 | CONVENTION | .claude/plans/chevwrap-5053.md | BRANCH | plan for the old design | FIXED | rewritten |
| 4 | 1 | CONVENTION | web/index.html | BRANCH | stale comment | FIXED | removed |
| 5 | 2 | WARNING | web/index.html | BRANCH | touching lines above 40rem | FIXED | line-height 1.2 |
| 6 | 3 | WARNING | web/index.html | SELF | desktop chevron centred on wrapped title | FIXED | flex-start |
| 7 | 3 | WARNING | docs/browser-checks/render-subback-4586.js | BRANCH | 700 arm never wrapped | FIXED | longer name, asserted |
| 8 | 3 | CONVENTION | .claude/plans/chevwrap-5053.md | BRANCH | stale decision | FIXED | updated |

### NITs and items left (across all iterations)
- The loose "(right of or below)" long-name arm stays; the per-width rules are stricter (iterations 1, 2).
- A future third child in the head would auto-place into row 3 (iteration 2).
- The 390/360 "|chevTop - titleTop| < 24" belt-and-braces; the 4px phoneHead rule is the real one (iteration 3).
- The 44px touch-tablet row puts the chevron about 4px above a one-line title's centre (iteration 4, inside tolerance).
- A dead `project.name = LONG` before the 700 block; an unclosed context on a thrown error (iteration 4).

### Strengths (across all iterations)
- DOM, visual and tab order match; no JS measures the head; 640px exactly gets the grid (iteration 3).
- Each new geometry rule has a control that fails it (iterations 2, 3).
- The fixture is restored on every path (iteration 4).
