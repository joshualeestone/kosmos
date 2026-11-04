---
pre_challenge: true
method: challenge-loop
branch: korb-7896
diff_hash: c892b47fbf539a78c3ac7933436c811650f8d1ff9f3112e28ed4681f5e073cfb
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T04:28:02Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. The loop STOPPED AT THE 8-ROUND CAP: round 8 still raised 2 WARNINGs. Both were fixed in a73b486bde
(a first draw that throws now puts the old dots back; an unreadable --spin-dot falls back to gold), and those fixes
were NOT put through another blind round.
**Total findings:** 24 actionable (1 BLOCKER, 22 WARNINGs, 1 CONVENTION), many NITs
**Fixed:** 24, each in the commit after its round (6898143f3d, d41731fa3d, c3003f05ff, 53b71ef62a, 271ec4a83e,
a99ad99d77, 0f990f9e63, a73b486bde) | **Deferred:** NITs only (below) | **Asked (awaiting user):** 0

Final validation: the first run at a73b486bde FAILED 3 tests, all from this branch. An arrow-form resize listener
shadowed the layout handler web.consolidated-breakpoint.test.js finds by its first arrow resize listener (now the named
korbResized), and browser-checks-reason-grep SITE_COUNTS needed [2, 2] for the check's new catch. Fixed in 1247cd7cb7,
a fix made after the cap and not blind-reviewed. The rerun on 1247cd7cb7 PASSED: validation-log hash c892b47fbf53
(matches the diff_hash above), 26872 node tests, 0 failed, 0 cancelled; subdir audit exit 0.

Merge base is 70 commits behind origin/main; git merge-tree against origin/main is clean and main has not touched
web/index.html or docs/browser-checks since the base. CI on the PR runs on the merge ref.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 7 NITs
- [BLOCKER] web/index.html - the loop never stopped: four .spin-sweep spans live hidden in the page --> FIXED (6898143f3d): runs only while a spinner is visible (IntersectionObserver); measured 0 frames with none showing
- [WARNING] per-orb cost not shared --> FIXED (6898143f3d): one placing of the dots per frame, painted into every visible orb
- [WARNING] reduced motion switched on mid-turn froze the last frame, not the K --> FIXED (6898143f3d)
- [WARNING] reduced motion never re-read the colour --> FIXED (6898143f3d)

#### Iteration 2
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] per-frame cost (a fill per dot) --> FIXED (d41731fa3d): 8 strength groups, one path and one fill each
- [WARNING] still orb colour never re-read --> FIXED (d41731fa3d)
- [WARNING] a querySelectorAll on every added node --> FIXED (d41731fa3d)

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] a spinner taken off the page and put back stopped turning for good --> FIXED (c3003f05ff): reattach arm, red 3 of 3 runs without the fix
- [WARNING] new spinners showed the old dots for two frames --> FIXED (c3003f05ff)

#### Iteration 4
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] a still orb never re-read its size or density --> FIXED (53b71ef62a): resize redraws still orbs
- [WARNING] the theme watcher fired on frequent html/body writes --> FIXED (53b71ef62a)
- [WARNING] no cleanup for orbs observed but never shown --> FIXED (53b71ef62a)

#### Iteration 5
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 7 NITs
- [WARNING] new spinners blank for 2 to 3 frames --> FIXED (271ec4a83e): drawn in the step before paint
- [WARNING] the resize arm checked width, not drawing --> FIXED (271ec4a83e): reads pixels
- [WARNING] plan claimed reds for draw(), which nothing calls --> FIXED (271ec4a83e): claim pointed at paint(), measured 5 FAILs

#### Iteration 6
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] N inserted spinners did N place() calls before paint --> FIXED (a99ad99d77): canvases first, then one shared placing
- [WARNING] a throw in frame left the loop marked running forever --> FIXED (a99ad99d77): the loop resets
- [WARNING] no arm for the first-frame paint --> FIXED (a99ad99d77): first-frame arm
- [WARNING] a still orb missed a --sz change without a resize --> FIXED (a99ad99d77)

#### Iteration 7
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
- [WARNING] the resize arm changed --sz, so it never tested density --> FIXED (0f990f9e63): the arm doubles the density with the CSS size unchanged
- [WARNING] the plan's KORB-removed red count was stale --> FIXED (0f990f9e63): remeasured, 3 FAILs with clean messages
- [CONVENTION] plan wording --> FIXED (0f990f9e63)

#### Iteration 8
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] a place() throw in the first draw left the dots hidden and nothing drawn --> FIXED (a73b486bde), UNREVIEWED
- [WARNING] an invalid --spin-dot left fillStyle at black --> FIXED (a73b486bde), UNREVIEWED

### Deferred NITs (stated, not hidden)
- place() still allocates small arrays each frame (raised in rounds 2, 3, 7); the cost is measured and bounded by the 30 fps cap; a typed array is the next lever if an older Windows laptop shows it.
- A move between screens of different density without a resize is reasoned, not tested: headless fires neither event.

### Weakest premise
The cost on an older Windows laptop is not measured here.
