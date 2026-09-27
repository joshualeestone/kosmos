---
pre_challenge: true
method: challenge-loop
branch: reland-4108
diff_hash: 229c6c73f570b9448add429f7c4b2294619f26f9a31aea7c735a913fbf3e351e
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T13:23:10Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 raised no findings)
**Total findings:** 29 (0 BLOCKERs, 8 WARNINGs, 2 CONVENTIONs, 19 NITs), plus one final-validation finding
**Fixed:** 20 | **Deferred:** 9 (1 WARNING, 8 NITs) | **Asked (awaiting user):** 0

Reviews read only the COMMITTED branch head (`git show HEAD:<path>`), because a measurement script swapped web/index.html
in the working tree during some of them; that changes how files were read, not what was reviewed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html — the scroll only works when the window scrolls and has room --> FIXED (d481c4376): the limit is stated in the comment (later guarded, iteration 3)
- [WARNING] web/index.html — a later relayout (scroll/resize) does not make room --> DEFERRED (by design, d481c4376): the fix acts once as the step opens; moving the page while the person scrolls would fight their hand; stated in the comment and the plan
- [WARNING] render-chatbox-phone-4108.js — "a pointing card is never moved" was unproven --> FIXED (d481c4376): the check counts the tour's scrollBy calls per step and asserts only the Conversation step scrolls
- [NIT] web/index.html — the focus comment merged onto the closing brace --> FIXED (d481c4376)
- [NIT] browser-checks-reason-grep.test.js — the ledger lost the 189 -> 188 -> 189 history --> FIXED (d481c4376)
- [NIT] web/index.html — the `r.bottom > need` guard unexplained --> FIXED (d481c4376, reworded 043bea14f)
- [NIT] web/index.html — the 4px slack could be a ceil --> DEFERRED: named as measured slack (TIP_ROOM_SLACK, aac751f91)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] web/index.html — the fix is in tour code all stepped tips share, and only the project tour was tested --> FIXED (2f1436c79): the check also walks the agent-page tip and the board tour at the same sizes, judged where the page made room (measured: they point at every step; the page never scrolled for them)
- [CONVENTION] web/index.html — `12 + 12` duplicated tipPlace's spacing --> FIXED (2f1436c79): TIP_GAP and TIP_PAD named once and shared
- [NIT] web/index.html — stepEl used a plain querySelector, tipPlace the first showing match --> FIXED (2f1436c79): one tipTarget for both
- [NIT] web/index.html — the empirical 4px slack --> DEFERRED: named (aac751f91) and in the plan's weakest part

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 3 of the above
- [WARNING] web/index.html — a part-way scroll (scrollY smaller than the shortfall) moves the page and leaves it flat --> FIXED (a770ad446): scroll only when `window.scrollY >= need - r.top`
- [WARNING] render-chatbox-phone-4108.js — nothing asserted the fix ran at 360/375 --> FIXED (a770ad446): the check asserts the page made room for the Conversation step at ordinary text size
- [NIT] web/index.html — tipLayout's ring used a plain querySelector --> FIXED (a770ad446): tipTarget
- [NIT] web/index.html — the touch-tablet agent search pill is about 58px --> DEFERRED: #4131's own sizing (the 44px version was about 54px), not this change
- [NIT] web/index.html — `:has()` in the room pill selector --> DEFERRED: #4131's selector; the page already relies on :has()
- [NIT] render-chatbox-phone-4108.js — the scrollBy wrapper credits any caller --> DEFERRED: it is installed only while a tip is walked

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above
- [CONVENTION] web/index.html — the 4px slack a raw literal beside named constants --> FIXED (aac751f91): TIP_ROOM_SLACK
- [NIT] render-dm-chatfirst-718.js — its label still says a 44px target --> DEFERRED: #4131's own content; it names that check's minimum
- [NIT] .claude/plans/reland-4108.md — the ring's tipTarget not in the plan --> FIXED (aac751f91)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] render-chatbox-phone-4108.js — a non-project tip that failed to open printed PASS, and a walk with no steps asserted nothing --> FIXED (043bea14f): it fails, and each walked tip must have a step
- [NIT] web/index.html — tipLayout still gates on tipVisible --> DEFERRED: TIP_PLACES keeps a selector only when its first match shows, so the two agree
- [NIT] web/index.html — the guard's comment described a different condition --> FIXED (043bea14f)
- [NIT] web/index.html — the scroll is not undone when the step changes --> FIXED (043bea14f): stated in "Its limits"
- [NIT] web/index.html — `:has()` in a selector list drops the whole rule on an old webview --> DEFERRED: #4131's selector

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Converged** — no findings.

#### Final validation (6j), after iteration 6
- [BLOCKER] final-validation: the browser-check surface gate (#2518) refused: seven checks mapped to tokens this change touches (d-talk-box, pj-post, pj-room-search, d-talk-search), whose #4131 trailers the revert-of-revert did not carry --> FIXED (ba3782e82, an empty commit): all seven were re-run on this branch (both engines where honoured), all pass, and each is named with its measured result in a `Browser-check-surface:` trailer. The diff (and this hash) is unchanged.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | scroll needs a scrollable window | FIXED | d481c4376, a770ad446 |
| 2 | 1 | WARNING | web/index.html | BRANCH | no make-room on relayout | DEFERRED | by design, stated |
| 3 | 1 | WARNING | render-chatbox-phone-4108.js | BRANCH | never-moved unproven | FIXED | d481c4376 |
| 4 | 2 | WARNING | web/index.html | BRANCH | other tours untested | FIXED | 2f1436c79 |
| 5 | 2 | CONVENTION | web/index.html | BRANCH | spacing duplicated | FIXED | 2f1436c79 |
| 6 | 3 | WARNING | web/index.html | SELF | part-way scroll | FIXED | a770ad446 |
| 7 | 3 | WARNING | render-chatbox-phone-4108.js | SELF | fix-ran unasserted | FIXED | a770ad446 |
| 8 | 4 | CONVENTION | web/index.html | SELF | slack literal | FIXED | aac751f91 |
| 9 | 5 | WARNING | render-chatbox-phone-4108.js | SELF | a failed open printed PASS | FIXED | 043bea14f |
| 10 | 6j | BLOCKER | (surface gate) | BRANCH | trailers lost in the revert-of-revert | FIXED | ba3782e82 |

(NITs are listed per iteration above.)

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Deferred: the 4px ceil (iter 1, 2), the tablet pill and `:has()` (#4131's own, iter 3, 5), the scrollBy wrapper scope (iter 3), the 718 label (#4131's, iter 4), tipVisible (iter 5).

### Strengths (across all iterations)
- The fix acts only on a card that is already flat, once, when the window can take the whole shortfall, so every screen that already pointed is untouched, and the check proves it by counting the tour's own scrolls (iterations 1 to 6)
- One tipTarget and named spacing constants shared by placing, making room and the ring (iterations 2 to 6)
- The plan measured the cause in pixels, names its weakest part (the slack, the x1.3 guard), and 2806 was not relaxed (iterations 1, 5, 6)

### Measured (on 043bea14f; ba3782e82 adds only trailers)
- The 4108 check + render-room-busy-scope-2882, -msgbox-2806, -reply-3745, -scroll, both engines: all pass on the branch.
- Controls: the 4108 check on main's page, 14 FAIL (the old heights 44, 40, 24px and "the fix ran"); without the tour fix, 8 FAIL (the Conversation step flat at 360 and 375 in both engines, and "the fix ran"); render-room-msgbox-2806 without the fix, 2 FAIL (both engines).
- The agent-page tip and the board tour point at every step at 360, 375 and 375 x1.3; the page never scrolled for them.
- The seven surface-mapped checks pass on the branch (see ba3782e82).
- Full suite and subdir audit: 10810 tests, 0 fail (the rest skipped: platform-only), validation-log PASSED hash 229c6c73f570; subdir audit exit 0
