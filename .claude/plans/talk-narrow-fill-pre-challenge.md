---
pre_challenge: true
method: challenge-loop
branch: talk-narrow-fill
diff_hash: 1321eea349a55abc6eacc1f9a32e7ce37de40af3cf7234bac5550686a47ea7e7
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T15:03:31Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 10 actionable (0 BLOCKERs, 7 WARNINGs, 3 CONVENTIONs) plus 14 NITs, plus 1 synthetic validation finding
**Fixed:** 10 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation along the way: two runs recorded failures that were contention (server.supervisor-refresh.test.js
ENOTEMPTY on temp cleanup; passes 4/4 alone; the branch touches no server code) and one real gate
(browser-check surface gate, see ledger 11). Final run on HEAD da4125a7e (after merging origin/main):
8612 tests, 0 fail, surface gate green.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the arm written in the first commit)
- [WARNING] web/index.html:2621 — the window-tall box sits under the sticky header at every scroll position --> FIXED: header not sticky in the narrow Talk view (commit 2c500662f)
- [WARNING] render-talk-fill-2622.js:278 — A2b/A2d never measured against the header --> FIXED: A2d at the scrolled-to position, A2e at the end of the page (commit 2c500662f)
- [WARNING] render-talk-fill-2622.js:293 — A2c could no longer fail; its grid-rows rule was inert --> FIXED: both removed (commit 2c500662f)
- [WARNING] docs/browser-checks/README.md:312 — row described the old narrow fill --> FIXED (commit 2c500662f)
- [CONVENTION] web/index.html:2453 — #3497 comment said narrow keeps the fill --> FIXED (commit 2c500662f)
- [CONVENTION] web/index.html:2395 — #2622 KNOWN LIMITATION note and rule count stale --> FIXED: replaced with the per-layout height note (commit 2c500662f)
- [NIT] TOL comment, narrow section header, control width naming, min-height note --> FIXED (commits 2c500662f, 816b87a73)

#### Iteration 2
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 7 NITs
**Self-generated:** 2 of the above (the short-window note and the plan written at iteration 1)
- [WARNING] web/index.html:2608 — scroll-padding-top (for the sticky header) pushed a focused box's composer off screen --> FIXED: zeroed in this view; arm A2f (commit 816b87a73)
- [WARNING] web/index.html:2609 — 100vh under a phone toolbar --> FIXED: 100dvh after 100vh (commit 816b87a73)
- [WARNING] plan:27 — the static-header trade (notices scroll away) unnamed --> FIXED: named in the comment and plan (commit 816b87a73)
- [CONVENTION] plan file name --> FIXED: talk-narrow-fill-20260924.md (commit 816b87a73)
- [NIT] short-window note wrong --> FIXED (commit 816b87a73)
- [NIT] build marker vs Post at narrow max scroll unpinned --> FIXED: A2f (commit 816b87a73)
- [NIT] docblock, TOL, README sizes --> FIXED (commit 816b87a73)
- [NIT] #conn at narrow max scroll hides 21px of the box top; 56.01rem sub-pixel band

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] web/index.html:2614 — 320px floor has no stated reason for the number
- [NIT] render-talk-fill-2622.js:247 — narrowAt('end') vs ('max') naming

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:2621 | SELF | box under sticky header | FIXED | 2c500662f |
| 2 | 1 | WARNING | render-talk-fill-2622.js:278 | BRANCH | arms blind to the header | FIXED | 2c500662f |
| 3 | 1 | WARNING | render-talk-fill-2622.js:293 | BRANCH | A2c could not fail | FIXED | 2c500662f |
| 4 | 1 | WARNING | docs/browser-checks/README.md:312 | BRANCH | README stale | FIXED | 2c500662f |
| 5 | 1 | CONVENTION | web/index.html:2453 | BRANCH | #3497 comment stale | FIXED | 2c500662f |
| 6 | 1 | CONVENTION | web/index.html:2395 | BRANCH | #2622 note stale | FIXED | 2c500662f |
| 7 | 2 | WARNING | web/index.html:2608 | BRANCH | scroll padding vs focus | FIXED | 816b87a73 |
| 8 | 2 | WARNING | web/index.html:2609 | SELF | 100vh under phone toolbar | FIXED | 816b87a73 |
| 9 | 2 | WARNING | plan:27 | SELF | trade unnamed | FIXED | 816b87a73 |
| 10 | 2 | CONVENTION | plan file name | BRANCH | naming | FIXED | 816b87a73 |
| 11 | - | BLOCKER | validation | BRANCH | surface gate: two checks unmapped (both pass unchanged) | FIXED | per-check trailers |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- a #conn notice at narrow max scroll hides ~21px of the box top (scroll up shows it) (iteration 2)
- the 56.01rem sub-pixel band gets the fixed-offset fallback (iteration 2)
- the 320px floor's number has no stated reason (iteration 3)
- narrowAt('end') / ('max') naming (iteration 3)

### Strengths (across all iterations)
- A2d measures the box against the header's actual position, so it holds whatever the header's height; controls recorded against origin/main and against each earlier version (iterations 2, 3)
- The inert grid-rows rule was removed together with the arm that guarded it (iterations 2, 3)
- Scoped by :has() to the shown Talk section at narrow width; the wide layout is untouched (all iterations)
