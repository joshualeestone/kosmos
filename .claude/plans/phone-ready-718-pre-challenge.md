---
pre_challenge: true
method: challenge-loop
branch: phone-ready-718
diff_hash: 08426c1fb1fdf59fcd21165a3bc5933bae0d700d1f5e629b7b5f3759b2b52c38
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T09:14:05Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

This proof replaces the pre-rebase one. The branch had converged over 6 iterations (5 blind reviews: sonnet,
opus, sonnet, opus, sonnet), was rebased onto origin/main (57 new commits; the only conflict was the
tools/browser-checks.sh gate list line, resolved by keeping main's new entry and adding this branch's), and
this re-run reviewed the rebased branch from scratch. 6.0's initial validation for this run was the
post-rebase validation (9896 tests, 0 fail), so iteration 1 is the first blind review.

**Iterations:** 4
**Converged:** Yes
**Total findings:** 6 actionable (1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs) plus 14 NITs; the BLOCKER is a synthetic 6g validation finding
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (no commit in this run yet)
- [WARNING] web/index.html orgFit / .onode .callout — a hidden callout is still laid out; with realistic names the rightmost node's callout widened the page (measured 406px at 375, 414 at 393, 424 at 412, 433 at 430) --> FIXED (commit 49ae26e0: .orgwrap overflow-x: clip, not a scroller so overflow-y stays visible; long-callout arm at every phone size; control fails all four)
- [WARNING] web/index.html pointerdown — a touch on a node of an overflowing chart started a drag that jittered before the pan cancelled it --> FIXED (commit 49ae26e0: no touch drag on .orgwide; unit pin only, Playwright cannot drive a real pan's pointer sequence)
- [NIT] touch-action: none on a fitted chart blocks page scroll by swipe (pre-existing) --> not taken
- [NIT] ORG_VIEW_W recorded from a zero-width box --> fixed
- [NIT] regex source pins in the unit test --> not taken
- [NIT] rescale is proportional, not exact (measured drift, accepted) --> not taken

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] web/index.html .orgwrap.orgscroll — the scrolling box is not keyboard focusable or named --> FIXED (commit 5cf28862: tabindex 0, role region, aria-label while it scrolls; arm checks them; measured Chromium focuses a scroller by itself, so the control fails on the attributes)
- [WARNING] web/index.html paintOrg — a chart that grows a ring while scrolled at the same width drifts off centre --> FIXED (commit 5cf28862: scroll moves by half the growth; ring-added arm; control 62 vs centre 114)
- [NIT] two base .orgwrap rules --> fixed (merged)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER (6g), 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (the cited lines predate this run's commits or are main's own failure path)
- [WARNING] web/index.html tick() failure path — a failed poll cleared the chart but left the scrolling box's classes and region attributes --> FIXED (commit 5b7c9e08: orgBoxPlain() on every path that clears the chart; failed-poll arm made in the page's own fetch, since the board's service worker carries requests past page.route in WebKit; control fails in both engines. Keyboard arrow-key assertion made Chromium only: headless WebKit does not pan a focused box by keyboard, measured over three runs)
- [BLOCKER] 6g validation: server.test.js and web.offline-note.test.js (x2) run tick()'s failure path with every dependency injected and had no orgBoxPlain --> FIXED (commit 6545734d: injected like their other tick dependencies; server.test.js asserts the failure path calls it; control without the call fails)
- [NIT] resize misses a page scrollbar appearing (self-heals on the next poll) --> not taken
- [NIT] extract the box geometry into its own function --> not taken
- [NIT] regex source pins --> not taken
- [NIT] plan Change item 2 stale --> fixed

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] ORG_SIZE / ORG_VIEW_W not reset on the empty/failed paths (self-corrects on the next paint)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html .orgwrap / callout | BRANCH | hidden callout widens the page | FIXED | 49ae26e0 |
| 2 | 1 | WARNING | web/index.html pointerdown | BRANCH | touch drag jitter on a wide chart | FIXED | 49ae26e0 |
| 3 | 2 | WARNING | web/index.html .orgwrap.orgscroll | BRANCH | scrolling box not focusable or named | FIXED | 5cf28862 |
| 4 | 2 | WARNING | web/index.html paintOrg scroll | BRANCH | same-width growth drifts off centre | FIXED | 5cf28862 |
| 5 | 3 | WARNING | web/index.html tick failure path | BRANCH | failed poll leaves scrolling box state | FIXED | 5b7c9e08 |
| 6 | 3 | BLOCKER | 6g validation (3 tick harness tests) | BRANCH | orgBoxPlain not injected | FIXED | 6545734d |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] touch-action: none on a fitted chart blocks a page scroll that starts on it (pre-existing) (iteration 1)
- [NIT] unit test pins source text rather than executing the scroll/rescale logic (iterations 1, 3)
- [NIT] rescale is proportional, not exact (iteration 1)
- [NIT] a page scrollbar appearing does not fire resize; self-heals on the next poll (iteration 3)
- [NIT] box geometry could be its own function (iteration 3)
- [NIT] ORG_SIZE / ORG_VIEW_W not reset on the empty/failed paths (iteration 4)

### Strengths (across all iterations)
- orgFit gives up margin first, then brings the rings in to a floor, and never shrinks a node, so every face stays a 44px tap target; desktop gets exactly the old natural square (all iterations)
- The scroll handling is sequenced around the repaint guard, a same-width poll never writes the scroll, and the resize handler compares with the width last painted (iterations 1, 3, 4)
- The browser check drives the real server in Chromium and WebKit at four phone sizes, desktop and a deep fleet, and every arm has a measured control that fails without its fix (iterations 1-4)
- The tick harness tests keep their positional arguments aligned and one now asserts the failure path resets the box (iteration 4)
