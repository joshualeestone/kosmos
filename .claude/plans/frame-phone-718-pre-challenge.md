---
pre_challenge: true
method: challenge-loop
branch: frame-phone-718
diff_hash: 1f0b340635d959dfbb7f2ef76b331160f6828a89574a399b10edc9940e4a5a6d
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T15:28:43Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

The branch was reviewed after its check was first measured (106 arms, controls on main and
without the negative margins red). Each iteration's fixes were measured in the browser, in
Chromium and WebKit, before the next review; each new arm has a control measured red with its
fix undone. The branch was rebased twice onto a moving main during the run (the only conflict
was the reason-grep count, re-measured: 173, then 174). The final check passes 190 of 190 on
the final base, and the full validation on that base is 10015 tests, 0 failed.

**Rebase after approval (2026-09-26T15:28Z):** #3977 merged first (8df7ce5ab), so this branch was
rebased onto it. The only conflict was the reason-grep count, re-measured at 175 (main's 174 + this
check's one site). On that base the browser check passes 190 of 190 in Chromium and WebKit. The local
full validation could not run there: release 0.6.97 reserved the machine until 10:54 CDT, and
the validation helper refuses while a release holds it. The 10015 / 0 full suite above is the previous
base; the suite on this base is the PR's CI `test` job, which is the result to read for it.

**Iterations:** 8 (blind reviews, alternating Opus and Sonnet)
**Converged:** Yes
**Total findings:** 17 actionable (12 WARNINGs, 5 CONVENTIONs) plus ~25 NITs
**Fixed:** 17 | **Deferred:** 0 | **Asked (awaiting user):** 0 (two scope calls were made and recorded in the plan's Rejected list: landscape out of scope, every back link in scope)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] the .back rule reaches every back link, not the two measured --> FIXED (kept for all, now in plan, README and check: the Add a project link, red on main at 15px)
- [WARNING] landscape keeps the old sizes --> FIXED (recorded as out of scope in the plan's Rejected list, with the reason: (hover: none) would change the header on every desktop touchscreen)
- [WARNING] web.safe-area-718.test.js rejected the house fallback form var(--safe-x, 0px) --> FIXED (accepts it and raw env(); control arm, red with the fix undone)
- [NIT] safe-area FRAME matched descendants; Cover in another case passed --> FIXED (both, with controls)
- [NIT] the desktop arm skipped a missing control --> FIXED (all six must show)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] .vt also grows the projects list's toggle, unmeasured beside its tuned wrap --> FIXED (measured there: 44x44, no overlap with Add Project or the sort, no sideways scroll; overlap control red)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 4 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (the CSS comment's stale measurements, the plan's "box, not drawing")
- [WARNING] the switcher's border and the menu's fill draw larger, which the plan and comment denied --> FIXED (stated as intended; Johnny cleared it, m995)
- [WARNING] no arm at the rule's edge --> FIXED (640 phone sizes, 641 old; the rule at 41rem reds the 641 arm)
- [CONVENTION] the composer comment said --safe-bottom was not yet defined --> FIXED
- [CONVENTION] the CSS comment carried before-measurements --> FIXED (intent only)
- [CONVENTION] commit subjects not in the `<branch> -- <message>` form --> FIXED (all reworded; tree unchanged, verified)
- [CONVENTION] measurement shas orphaned by a rebase --> FIXED (the PR cites the final head's runs only)
- [NIT] the safe-area padding match was unanchored (scroll-padding counted) --> FIXED (anchored, control red)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] back links with a short project or task name could be tall but narrow --> FIXED (min-width 44px; a one-character label is 10.9px wide without it)
- [WARNING] the projects list between its 30rem wrap and this 40rem rule was unmeasured --> FIXED (a 600px arm)
- [NIT] the edge arm picked controls by array index --> FIXED (by selector)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above (the plan's WebKit wording)
- [WARNING] inline-flex dropped the space in Project settings' "← name" --> FIXED (column-gap; measured gap 0 without it, 3.6px with it)
- [WARNING] the stand-in back link could not see that case --> FIXED (Project settings' link measured)
- [CONVENTION] the plan said WebKit was gated --> FIXED (by hand)
- [NIT] the K mark's focus ring drifted out with the padding --> FIXED; [NIT] 641 did not pin the back link --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 1 of the above
- [CONVENTION] the plan's weakest part still said the header gets taller --> FIXED (rewritten to the real weak points)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] the switcher's and You's menus touched their grown buttons (they hang from the 32px wrapper) --> FIXED (drop by the extra 6px; the check opens each menu, 0px without the fix, 6px with it)
- [WARNING] a throw in the Project settings arm would escape unlabelled --> FIXED (reported as a labelled FAIL)
- [NIT] the edge arm did not name a missing back link --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html .back | BRANCH | rule reaches unmeasured back links | FIXED | 408c2327e |
| 2 | 1 | WARNING | web/index.html media query | BRANCH | landscape keeps old sizes | FIXED | 408c2327e (plan) |
| 3 | 1 | WARNING | web.safe-area-718.test.js | BRANCH | fallback form read as unpadded | FIXED | 408c2327e |
| 4 | 2 | WARNING | web/index.html .vt | BRANCH | projects toggle unmeasured | FIXED | b6d78cc4b |
| 5 | 3 | WARNING | web/index.html switcher/menu | SELF | drawing grows, plan denied it | FIXED | 0edc05f34 |
| 6 | 3 | WARNING | render-frame-phone-718.js | BRANCH | no arm at the rule's edge | FIXED | 0edc05f34 |
| 7 | 3 | CONVENTION | web/index.html composer comment | BRANCH | stale --safe-bottom note | FIXED | 0edc05f34 |
| 8 | 3 | CONVENTION | web/index.html frame comment | SELF | stale measurements in comment | FIXED | 0edc05f34 |
| 9 | 3 | CONVENTION | commits | BRANCH | subject form | FIXED | reworded |
| 10 | 3 | CONVENTION | commits/PR | BRANCH | orphaned measurement shas | FIXED | final-head runs cited |
| 11 | 4 | WARNING | web/index.html .back | BRANCH | short labels narrow | FIXED | 6a9bfeb9e |
| 12 | 4 | WARNING | render-frame-phone-718.js | BRANCH | 481-640 band unmeasured | FIXED | 6a9bfeb9e |
| 13 | 5 | WARNING | web/index.html .back | BRANCH | inline-flex dropped a space | FIXED | 6128d5e2b |
| 14 | 5 | WARNING | render-frame-phone-718.js | BRANCH | stand-in link blind to it | FIXED | 6128d5e2b |
| 15 | 5 | CONVENTION | plan | SELF | WebKit said to be gated | FIXED | 6128d5e2b |
| 16 | 6 | CONVENTION | plan | SELF | weakest part stale | FIXED | a3e455335 |
| 17 | 7 | WARNING | web/index.html menus | BRANCH | menus touch grown buttons | FIXED | 145384b02 |
| 18 | 7 | WARNING | render-frame-phone-718.js | BRANCH | unlabelled throw path | FIXED | 145384b02 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] the sandbox temp dirs are not removed (sibling checks share the shape) (iterations 1, 4)
- [NIT] a grown box can reach past other header items (notice chips); only control-to-control overlap is measured (iterations 7, 8; named in the plan's weakest part)
- [NIT] #d-files-back and the Talk rule restate min-height the .back rule now gives (iterations 6, 7)
- [NIT] the safe-area controls inject at the first </style> (iteration 7)
- [NIT] the reason-grep comment line keeps growing (pre-existing, iteration 8)

### Strengths (across all iterations)
- The header keeps its height through negative margins, proved against the old sizes put back rather than a remembered number (iterations 1-8)
- Controls fail rather than skip when missing; a misspelt engine is refused; each arm names the control that reds it (iterations 1-8)
- The plan's Rejected and Weakest part sections are specific and were kept true as the branch changed (iterations 3-8)
