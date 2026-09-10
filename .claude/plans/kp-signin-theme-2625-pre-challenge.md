---
pre_challenge: true
method: challenge-loop
branch: kp-signin-theme-2625
diff_hash: 8a302c50f279db323b8248eb7ed9a5201d59f8fe64dff06d1a16a7d2d3e284c0
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T14:30:05Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found no new BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 4 actionable (1 BLOCKER, 3 WARNING, 1 CONVENTION) + several NITs
**Fixed:** 5 | **Deferred:** 1 | **Asked (awaiting user):** 0

Card #2625 (Josh product-review): in-app Kosmos Plus tab (web/index.html state1) —
sign-in link above the logo, "See Kosmos+" -> "Join Kosmos+" + "Already a member? Sign in",
and the too-dark near-black ground brightened to the reference navy radial-gradient.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first pass; findings are on
the pre-loop implementation commit, so BRANCH)
- [BLOCKER] docs/browser-checks/render-plus-blue-1615.js:37,123,125 — a committed browser-check
  still pinned the removed flat #070c16 ground as canonical (body backgroundColor + .apphead),
  so it reds against the new navy design; invisible to `yarn test` (browser-checks are not run
  there) --> FIXED (7335a286): assert the body gradient via backgroundImage and .apphead == the
  lifted --k-bg #132140 (rgb(19,33,64)). Also satisfies the #1720 browser-check gate properly.
- [WARNING] web.label-contrast.test.js:98 — plus grounds stale after the token change
  (--k-surface #132140 -> #1c2c4f; #070c16 no longer a ground) --> FIXED (7335a286): read the
  real new --k-surface + the gradient's deep stop #0b1428.
- [WARNING] web/index.html — all three affordances point at KOSMOS_SITE + '/plus', blurring
  Sign-in vs Join --> DEFERRED: documented, reversible one-liner, tracked #2626 (move the two
  sign-in links to login.kosmosplus.com's direct route once it is live and branded).
- [CONVENTION] .claude/plans/kp-signin-theme-2625.md:1,48 — two em dashes (Josh's banned char)
  --> FIXED (7335a286).

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per 6a)
**New findings:** 1 WARNING (+ 2 NITs)
**Self-generated:** 0 of the above (the top sign-in was added in the pre-loop implementation
commit, not a loop fix; BRANCH)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] web/index.html:11637 — the top sign-in affordance used the plain-text foot-link
  style, diverging from the reference first-step.html topbar (a bordered pill .signin-btn) and
  from Josh's own wording ("the sign-in box above the logo") --> FIXED (2b99a194): new
  .plus-signin-pill matching the reference's bordered pill; still an <a> so state1 stays
  control-free.
- NITs (accepted): the browser-check's unused backgroundColor captures are harmless
  informational (left as-is rather than risk an unverifiable edit to a check this session
  cannot run); the two sign-in links sharing an accessible name + interim /plus target is the
  tracked #2626 follow-up.

#### Iteration 3
**Reviewer model:** opus (default; rotation returns to it)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (4 NITs)
**Self-generated:** 0 actionable (the em-dash NITs sat on lines iteration 1 edited, so SELF for
those NIT lines; no actionable BLOCKER/WARNING/CONVENTION)
**Converged** — no new actionable findings. Applied the cheap NITs as polish (d8348d04):
- foot link .plus-signin-link pinned font-size .92rem to match the reference exactly.
- removed two em dashes from browser-check problem strings on lines this branch edited.
- plan CSS list now names .plus-signin-pill.
- Accepted NIT: the pill border rgba(120,150,200,.4) composites ~1.9:1 on the navy ground
  (below the 3:1 UI-boundary floor), kept because it is a byte-for-byte copy of the
  operator-approved reference .signin-btn and the affordance is carried by its high-contrast
  text (#E6EBF7, ~13:1). A measured ratio is not a veto once the design owner has chosen.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | docs/browser-checks/render-plus-blue-1615.js:37 | BRANCH | browser-check pinned old #070c16 ground | FIXED | 7335a286 |
| 2 | 1 | WARNING | web.label-contrast.test.js:98 | BRANCH | stale plus grounds after token change | FIXED | 7335a286 |
| 3 | 1 | WARNING | web/index.html (paintPlus) | BRANCH | 3 affordances share /plus target | DEFERRED | interim, tracked #2626 |
| 4 | 1 | CONVENTION | .claude/plans/kp-signin-theme-2625.md:1,48 | BRANCH | two em dashes | FIXED | 7335a286 |
| 5 | 2 | WARNING | web/index.html:11637 | BRANCH | top sign-in not the reference bordered pill | FIXED | 2b99a194 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- browser-check unused backgroundColor captures (iter 2) — accepted, harmless informational.
- two sign-in links share accessible name + interim target (iter 2) — tracked #2626.
- browser-check problem-string em dashes (iter 3) — FIXED d8348d04.
- plan CSS list missing .plus-signin-pill (iter 3) — FIXED d8348d04.
- foot link missing font-size vs reference (iter 3) — FIXED d8348d04.
- .plus-signin-pill border contrast ~1.9:1 (iter 3) — accepted, matches operator-approved reference.

### Strengths (across all iterations)
- Gradient stops and pill styling are byte-for-byte copies of the reference first-step.html
  (.app / .signin-btn), verified against the file, not the comment (iter 2, iter 3).
- Browser-check and contrast test updated in genuine lockstep with the token change; the
  gradient is asserted via backgroundImage (avoiding the shorthand's transparent
  backgroundColor trap), NAV_NAVY matches the hex-to-rgb conversion, contrast grounds re-point
  to the real new surfaces (iter 2, iter 3).
- web.plus-tab.test.js's TEXT-scanning no-controls-in-state1 rule respected in both markup and
  the explanatory comment (which avoids spelling the forbidden tags) (iter 2, iter 3).
- paintPlus href writes null-guarded so the behavioral new Function test survives (iter 3).
- Full canonical suite green (5606/5606 node tests) with the browser-check surface-map
  validation passing (iter 2).
