---
pre_challenge: true
method: challenge-loop
branch: onecomputer-6396
diff_hash: 7cbe7894d0f9c4bd5ccafa4fbc170f1727089785723d9a2a63cfae956455518b
validation: pending (Mortals full run queued behind an older head of this branch; PR CI's full suite is the merge gate)
subdir_audit: passed
timestamp: 2026-10-17T16:49:21Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 19 (0 BLOCKERs, 10 WARNINGs, 1 CONVENTION, 8 NITs)
**Fixed:** 11 | **Deferred:** 0 | **Asked (awaiting user):** 0

Josh's card (#6396, 11:09): with one computer on the account the top-left "This computer" is not shown.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] web/index.html:30179 — hiding with the menu open dropped focus to the page (btn.focus() on a now-hidden button) --> FIXED (commit 9a917485)
- [WARNING] web/index.html:12435 — the At a glance sheet lives inside #worldsw, so hiding left it scroll-locked and trapped --> FIXED (commit 9a917485: wvClose on hide)
- [WARNING] render-onekosmos-4815.js:107 — visibility asserts inside a hidden parent could not fail --> FIXED (commit 9a917485: read hidden attributes)
- [CONVENTION] docs/browser-checks/README.md:355 — the row said "This computer" for one computer --> FIXED (commit 9a917485)
- [NIT] floor comment, phone CSS comment, plain-text comment, tophead-stable timing, late pop-in --> comments FIXED; the rest noted

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (the fallback and the plan numbers were written by iteration 1's fix)
- [WARNING] web/index.html:30195 — the h1 fallback is display:none in the consolidated layout, so focus still fell to the page --> FIXED (commit f22515fd: first visible of the K mark, the Kosmos+ bar menu, the heading, as the login and restart notices do)
- [WARNING] render-onekosmos-4815.js:132 — the focus arms ran only in tab layout --> FIXED (commit f22515fd: both layouts)
- [WARNING] render-onekosmos-4815.js:134 — !locked had no before-control --> FIXED (commit f22515fd: lockedBefore)
- [WARNING] .claude/plans/onecomputer-6396.md:19 — stale numbers --> FIXED (commit f22515fd)
- [NIT] trailer wording overclaims "layout unchanged"; dead worldsw-fixed / aria code; long comment line --> noted (conclusion holds; the two named checks do not measure the switcher)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the inHead assert written by iteration 2)
- [WARNING] render-onekosmos-4815.js:117 — inHead accepted any element under .apphead (h1.vh too), so the K mark landing was not asserted --> FIXED (commit 75ec3eba: focus must be #klink, shown in both layouts)
- [NIT] stale MULTI_KOSMOS comment --> FIXED (commit 75ec3eba); plan names the screenshots --> FIXED; dead aria code and trailer wording --> noted

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] dead worldsw-fixed toggle and aria writes on the hidden branch; a long comment line; the 718 check's measured figures name "This computer"
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:30179 | BRANCH | focus lost when hiding with menu open | FIXED | 9a917485 |
| 2 | 1 | WARNING | web/index.html:12435 | BRANCH | At a glance sheet hidden but scroll-locked | FIXED | 9a917485 |
| 3 | 1 | WARNING | render-onekosmos-4815.js:107 | BRANCH | vacuous visibility asserts | FIXED | 9a917485 |
| 4 | 1 | CONVENTION | README.md:355 | BRANCH | stale index row | FIXED | 9a917485 |
| 5 | 2 | WARNING | web/index.html:30195 | SELF | h1 fallback hidden in consolidated layout | FIXED | f22515fd |
| 6 | 2 | WARNING | render-onekosmos-4815.js:132 | BRANCH | focus arms one layout only | FIXED | f22515fd |
| 7 | 2 | WARNING | render-onekosmos-4815.js:134 | BRANCH | scroll lock had no before-control | FIXED | f22515fd |
| 8 | 2 | WARNING | onecomputer-6396.md:19 | SELF | stale plan numbers | FIXED | f22515fd |
| 9 | 3 | WARNING | render-onekosmos-4815.js:117 | SELF | inHead accepted h1.vh | FIXED | 75ec3eba |

### Validation
- render-onekosmos-4815.js 68/68 (Chromium + WebKit, light + dark); render-dm-chatfirst-718.js all passed; six node tests touching the switcher pass.
- Mutants, each red: the hide itself (sw.hidden = false), no focus fallback, the sheet left open, heading-only focus (8 consolidated arms red).
- Both browser-check gates (#1720, #2518): 0; render-plus-bar-3837.js and render-phone-taps-5218.js overridden by trailer (only a focus selector names .apphead; neither measures the switcher).
- Full suite: the Mortals run is queued behind an older head of this branch; PR CI's full suite is the gate before merge.
- Screenshots: ~/work/design-shots/kosmos-6396/ (one computer: nothing top-left; two: the switcher), light and dark.

### NITs (non-blocking, across all iterations)
- see the per-iteration lists above

### Strengths (across all iterations)
- one gate (COMPUTERS_OPENABLE) decides the label, the menu and the phone nav's Computers entry, so they cannot disagree (iterations 1, 4)
- the MULTI_KOSMOS path returns early and is untouched; a failed re-read after a good answer keeps the label (iterations 2, 3)
- the four-computer arm is a real control for every hidden arm (iterations 1-4)
