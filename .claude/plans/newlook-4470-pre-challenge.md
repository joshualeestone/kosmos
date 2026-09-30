---
pre_challenge: true
method: challenge-loop
branch: newlook-4470
diff_hash: acdd243ce04e05cb6b5d806c16062f47ba345b680f89d71ba0cbabf7218e6227
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T11:49:53Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14 (iteration 1 is the 6.0 full-suite pass; 2 to 14 are blind reviews)
**Converged:** Yes. Iteration 14 (opus) returned no new BLOCKER or WARNING; its two NITs are below.
**Total findings:** 65 (9 BLOCKERs, 31 WARNINGs, 0 CONVENTIONs, 25 NITs)
**Fixed:** 49 | **Deferred:** 16 | **Asked (awaiting user):** 0

The session moved accounts (account-b to account-d) between iterations 13 and 14; the ledger carried
across in the handoff at ~/Library/Application Support/Kosmos/handoffs/monalisa.md (05:59).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** n/a (6.0 full test suite)
**New findings:** 6 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 (6.0's own pass)
- [BLOCKER] web/index.html: 5 test reds: unseen member lost its dashed border (#2804); --k-sunk / --label-3 / bubble tokens redefined broke the one-per-theme and contrast guards --> FIXED (no redefinition; direct fills) (258497a)
- [BLOCKER] 6g: the browser-check surface gate needed per-check trailers --> FIXED (every named check RUN green first, trailers added) (17f4082)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [BLOCKER] crumb snapped back on a direct load (placeProjectHead async) --> FIXED + negative control (17f4082)
- [WARNING] tour's Tasks selector --> FIXED (17f4082)
- [WARNING] plan's consolidated wording --> FIXED (17f4082)
- [WARNING] check had no On-after-reload arm --> FIXED (17f4082)
- [WARNING] unused --nl-gold / --nl-amber --> FIXED (17f4082)
- [NIT] listener order, closed subtask, README row, count, generator unit test --> FIXED (17f4082)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
- [WARNING] "Part of" line drawn below its row --> FIXED + negative control (e1864a0)
- [WARNING] task title truncation --> DEFERRED: the drawing does it; the button opens the task
- [WARNING] divider after a hidden card --> FIXED ([hidden]) (e1864a0)
- [WARNING] consolidated toggle outside showTab --> DEFERRED: one toggle site; showTab always re-places
- [WARNING] hollow ring contrast --> FIXED (e1864a0)
- [WARNING] no placeLook unit test --> DEFERRED: covered by the gated browser check
- [BLOCKER] 6g: layout-picker lifted function broke isolation --> FIXED (e1864a0)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] content alt fallback --> FIXED (373c5ea)
- [WARNING] no On sideways-scroll arm --> FIXED (373c5ea)
- [WARNING] no consolidated + On arm --> FIXED (373c5ea)
- [WARNING] unit docblock overclaim --> FIXED (373c5ea)
- [NIT] h2 hidden assert --> FIXED (373c5ea)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
- [WARNING] other pages under the new tokens --> FIXED (Agents-page contrast arm) (2c2bed3)
- [WARNING] ordering fragility --> DEFERRED: markup order is deliberate (#1017)
- [WARNING] divider keyed on [hidden] --> DEFERRED (duplicate of iteration 3; no other hide in the tab layout)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] swarm member's Off covered by the minus --> FIXED (736e937)
- [WARNING] VoiceOver lost the task text (font-size:0) --> FIXED (vh clip, data-task, markup restored) (736e937)
- [WARNING] hover contrast --> FIXED (page ground) (736e937)
- [WARNING] long state word --> FIXED (ellipsis) (736e937)
- [NIT] live-off arm --> FIXED (736e937)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] active tab marked by colour only --> FIXED (weight 600) (1bad0d2)
- [WARNING] divider [hidden] --> DEFERRED (duplicate)
- [NIT] plan data-n --> FIXED (1bad0d2)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] multi-part tasks: a "Nobody yet" part got a filled dot --> FIXED + negative control (20fc5ec)
- [NIT] pjOff read, focus double move, --nl-face unused --> FIXED (20fc5ec)

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1
- [WARNING] comment overclaimed alt-text behaviour --> FIXED by deleting the claim (09fb075)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1
- [BLOCKER] crumb not first after reload (from the iteration 8 fix) --> FIXED + negative control (158ff0f)
- [WARNING] state word hid on row hover --> FIXED (minus only, asserted) (158ff0f)
- [NIT] vh comma, app-wide comment, dead test clause --> FIXED (158ff0f)
- [NIT] webhook-line row, tour order --> DEFERRED: outside this card's page; tour order follows markup

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT (no code change)
**Self-generated:** 0
**Duplicates of prior findings (confirmed resolved):** 1 (divider [hidden])
- [WARNING] mixed palette on pages not yet designed --> DEFERRED: by design, page by page; the Agents arm guards contrast
- [WARNING] name read twice --> DEFERRED: today's look shows crumb and h2 too; not a regression
- [WARNING] state word read twice --> DEFERRED: verified false (room column emits no AT state; avatar aria-hidden)
- [NIT] tkcard position:relative for the clipped number --> DEFERRED

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1
**Duplicates of prior findings (confirmed resolved):** 1 (webhook row)
- [WARNING] the minus covered the state word (from the iteration 10 fix) --> FIXED: a reserved 28px lane on member rows, task rows aligned + negative control (f40295d)
- [NIT] title on the word, check docblock, pass floor 90 --> FIXED (f40295d)

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the lane comment)
- [WARNING] header rule removal unasserted on other pages --> FIXED: Agents-page arm asserts it; negative control red at all three widths without the rule (0e75be9)
- [WARNING] parts vs claim order --> DEFERRED: verified in the render, the claim sits inside its part line and reads in markup order
- [NIT] task-row lane comment said task rows have a minus --> FIXED (reworded) (0e75be9)
- [NIT] two-window staleness (same as theme), duplicate title (kept for truncation) --> DEFERRED

#### Iteration 14
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged**: no new actionable findings.
- [NIT] web/index.html:9415 comment gave #98989d on black as 7.4:1; it is 7.31:1 --> FIXED (7.3:1) (2e4e8de)
- [NIT] placeLook: Back comes after the left box's controls in keyboard order --> DEFERRED: deliberate (#1017, the keyboard meets it where the eye does); not a WCAG 2.4.3 defect; phones put the conversation first

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html | BRANCH | 5 suite reds (token redefinition, #2804 border) | FIXED | 258497a |
| 2 | 1 | BLOCKER | commit trailers | BRANCH | surface gate trailers | FIXED | 17f4082 |
| 3 | 2 | BLOCKER | placeProjectHead | BRANCH | crumb snapped back on direct load | FIXED | 17f4082 |
| 4 | 3 | BLOCKER | layout picker | BRANCH | lifted fn not self-contained | FIXED | e1864a0 |
| 5 | 3 | WARNING | tkcard | BRANCH | title truncation | DEFERRED | drawing does it |
| 6 | 3 | WARNING | showTab | BRANCH | consolidated toggle placement | DEFERRED | one toggle site |
| 7 | 3 | WARNING | placeLook | BRANCH | no unit test | DEFERRED | gated browser check |
| 8 | 10 | BLOCKER | placeLook | SELF | crumb not first after reload | FIXED | 158ff0f |
| 9 | 12 | WARNING | .pj-minus | SELF | minus covered state word | FIXED | f40295d |
| 10 | 13 | WARNING | render-newlook-4470.js | BRANCH | header rule unasserted on Agents | FIXED | 0e75be9 |
| 11 | 14 | NIT | web/index.html:9415 | BRANCH | contrast figure 7.4 vs 7.31 | FIXED | 2e4e8de |

(Every other finding is listed per iteration above with its resolution.)

Negative controls run (red without the fix, green with): composer chosen-Dark, working pulse, direct-load
header, "Part of" placement, multi-part hollow dot, crumb first after reload, minus overlap, Agents-page
header rule.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Back after the left box in keyboard order (iteration 14), deferred as deliberate.
- tkcard position:relative for the clipped number (iteration 11).
- two-window staleness, duplicate title (iteration 13).

### Strengths (across all iterations)
- Off by default with no attribute set, so no new-look rule can match today's app (iteration 14 verified).
- DOM moves rather than CSS reordering, so keyboard order follows what is seen (#1017).
- Every regression fix paired with a negative control.
