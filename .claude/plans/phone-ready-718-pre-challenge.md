---
pre_challenge: true
method: challenge-loop
branch: phone-ready-718
diff_hash: a8dbfbe28d1d6d37b6e75e82fcacd7317e17a6b94d721b5671ca7b69f32492ad
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T12:03:02Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

This proof covers the final run, on the branch as rebased onto origin/main after another branch moved the
browser-checks-reason-grep count (resolved to 169, measured by that test). Earlier runs on this branch, across
six rebases (four for the old one-line gate list, one for kosmos#3929's move to docs/browser-checks/gated.txt,
one for the count), are recorded iteration by iteration in .claude/plans/phone-ready-718-20260926T025211Z.md,
each fix with a measured browser-check control.

**Iterations:** 4 (blind reviews; this run's 6.0 validation was the post-rebase run, 9960 tests, 0 fail)
**Converged:** Yes
**Total findings (this run):** 7 actionable (0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs) plus 21 NITs
**Fixed:** 3 | **Deferred:** 4 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the mid-drag hold, written by this branch's earlier loop)
- [WARNING] web/index.html paintOrg hold — keyed on ORG_LIVE.dragging, which only the release clears; a failed poll mid-drag cleared the map, the release never arrived, and the chart stayed blank for good --> FIXED (commit c0729ae8c: orgDragHolds() keyed on a moved node that is still connected, plus lostpointercapture; arm "poll failed mid-drag" draws 5 of 5; control with the flag-only hold: 0 of 5)
- [WARNING] web/index.html pointerdown — the flag was set on a plain tap --> FIXED (same commit: the hold starts only once the node has moved)
- [WARNING] web.orgchart-phone-718.test.js — source-text regex pins rather than behaviour tests --> DEFERRED: repo practice; the browser check carries the behaviour (every arm has a measured control)
- [NIT] x3 (natural-size edge callouts in a slightly wider box, duplicated size write, temp dirs) --> not taken

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html hub drag clamp can invert on a chart under ~188px --> DEFERRED: unreachable; the squeeze floor draws at least (120 * 0.7 + 42) * 2 = 252px
- [WARNING] web/index.html a detached ORG_LIVE lingers after a failed poll mid-drag --> DEFERRED: inert, not user-visible, ends at release; the recovery itself is covered by the failed-poll-mid-drag arm
- [NIT] x2 --> not taken

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 2 of the above (the drag hold and its comment, written by iteration 1)
- [WARNING] web/index.html pointermove — a repaint between pointerdown and the first 4px of movement rebuilt the nodes and the drag steered a detached copy --> FIXED (commit c56d5f0c6: pointermove drops a drag whose node is no longer connected; unit pin)
- [WARNING] web/index.html "capture lost ends the drag too" comment claimed more than the listener does --> FIXED (commit c56d5f0c6: the claim deleted, per the rule for self-written prose)
- [NIT] misplaced orgBoxPlain comment, focus without preventScroll --> fixed in c56d5f0c6; other NITs not taken

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html paintOrg hold | SELF | a lost release freezes the chart | FIXED | c0729ae8c |
| 2 | 1 | WARNING | web/index.html pointerdown | BRANCH | the hold flag set on a tap | FIXED | c0729ae8c |
| 3 | 1 | WARNING | web.orgchart-phone-718.test.js | BRANCH | regex source pins | DEFERRED | repo practice; browser check carries behaviour |
| 4 | 2 | WARNING | web/index.html drag clamp | BRANCH | hub clamp inversion under 188px | DEFERRED | unreachable (floor 252px) |
| 5 | 2 | WARNING | web/index.html tick failure path | BRANCH | inert detached ORG_LIVE | DEFERRED | not visible; recovery covered by an arm |
| 6 | 3 | WARNING | web/index.html pointermove | SELF | drag steers a rebuilt node | FIXED | c56d5f0c6 |
| 7 | 3 | WARNING | web/index.html lostpointercapture comment | SELF | comment overclaims | FIXED | c56d5f0c6 (deleted) |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] natural-size chart in a box only slightly wider: edge callouts centred and may be cut (iteration 1)
- [NIT] the size write before the repaint guard duplicates a later one (iteration 1)
- [NIT] six mkdtemp sandboxes not removed (iterations 1, 3)
- [NIT] orgBoxPlain / orgscroll toggled on every paint (iterations 2, 3)
- [NIT] touch-action pan-y not explained in the comment (iteration 2)
- [NIT] scroll listener reads clientWidth per event (iteration 3)
- [NIT] co-l / co-r toggled on natural-size charts too (iteration 3)
- [NIT] spring rest length not scaled by k (iteration 4)
- [NIT] touch drag off on any overflowing chart (documented trade-off) (iteration 4)

### Strengths (across all iterations)
- orgFit / orgNatural are pure and unit-tested with constants read from the page; one derivation of the natural square (iterations 1-4)
- The drag hold is layered: orgDragHolds at the top of paintOrg (every caller), a pointermove guard for a rebuilt node, and a release that catches up on held-off width changes, each with a browser arm and a measured control (iterations 3, 4)
- The browser check drives the real server in Chromium and WebKit at four phone sizes, desktop and a deep fleet, and fails on an unknown engine name (iterations 1-4)
- The tick failure-path harnesses inject orgBoxPlain and one asserts the call (iterations 1, 4)
