---
pre_challenge: true
method: challenge-loop
branch: msgcopy-5312
diff_hash: 5972cfe68c49f12a6984ef921bff5d9223beacdbe61e93e95542a51c52cec254
validation: not run locally as yarn test (the machine's suite queue was 14 deep). Run instead on head fc3a82513: page tests 2452/2452 (node --test web.*.test.js); browser checks all passed, none skipped: render-msgref-4631 (Chromium as Windows and Mac, touch, real WebKit), render-dm-tapreact-718 (four phone sizes), render-room-msgbox-2806, render-room-reply-3745, render-dm-reply-4256, render-dm-reactions-3650, render-reactions-2255, render-voice-4409. CI runs the full node and shell suites on the PR head.
subdir_audit: not run (same)
timestamp: 2026-10-05T17:22:28Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes (iteration 14: NITs only)
**Total findings:** 46 (1 BLOCKER claimed and disproved, 30 WARNINGs, 0 CONVENTIONs, 15 NITs recorded)
**Fixed:** 32 | **Deferred:** 5 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] docs/browser-checks/README.md: catalog row stale --> FIXED (d397e0c)
- [WARNING] render-msgref-4631.js: guest arm hand-built --> FIXED (drawn by pjRoomRow's external branch)
- [NIT] arrow keys from no item --> FIXED

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] web/index.html msgRecordOf: a detached room row could read a DM record --> FIXED (no store guessed off-thread; C5d)
- [WARNING] C6 measured the viewport, not the thread; the eighth button wrapped and covered the DM's own row (render-dm-tapreact-718 red) --> FIXED (touch: seven buttons, Copy opens the menu; checks count shown buttons)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1
- [WARNING] an empty menu could open --> FIXED (no menu with nothing to copy; C2c)
- [WARNING] focus return on a touchscreen with a keyboard --> DEFERRED: rare, nothing lost; recorded in the plan
- [NIT] leading blank lines; stale comments --> FIXED

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1
- [WARNING] touch Copy named "Copy message" but opens a menu --> FIXED ("Copy message or its id", aria-haspopup)
- [WARNING] the person's own DM rows on a phone --> DEFERRED: no hover bar there (#4256); system selection, recorded
- [WARNING] stale header comments in the check --> FIXED
- [NIT] early return without msgMenuClose --> FIXED

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1
- [WARNING] the touch label set once at paint --> FIXED (msgCopyRelabel on a change of the touch test)
- [WARNING] the screen fallback's strip list is hand-kept; pending rows reach it --> DEFERRED: pinned on the real renderer (C4); pending rows recorded in the plan

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION-like, 5 NITs
**Self-generated:** 0
- [WARNING] the DM's touch menu untested --> FIXED (render-dm-tapreact-718, four phone sizes)
- [WARNING] keyboard on a touchscreen loses focus --> duplicate of iteration 3 (recorded)
- [NIT] title vs label, Home and End, dead touch rule, markdown copies as written --> FIXED or recorded

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] a store painted for another project or agent could be read --> FIXED (PJ_ROOM_POSTS_OF / DM_ROWS_OF, the reply code's test; C5 stale arm)
- [NIT] touch test in the TDZ --> FIXED (try)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] the screen fallback copied a link's preview card --> FIXED (.lpv dropped; C5p, mutation control proven)
- [WARNING] "Copy message id" on a row with no number copies a sentence --> DEFERRED: Josh's label kept exactly; the toast shows the words; recorded
- [NIT] stale names in comments --> FIXED

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1
- [WARNING] a bar painted before PJ_TOUCH_MQ existed keeps a pointer name --> FIXED (relabel once at start)
- [WARNING] Copy on a touchscreen with nothing to copy did nothing --> FIXED (toast)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] real WebKit never clicked Copy message; the plan over-claimed --> FIXED (R12 step, focus and copy; plan exact)
- [WARNING] a pointer's empty press was silent --> FIXED (toast)
- [NIT] fenced blocks in the fallback --> FIXED (.mdcb)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] the CSS hide rule and the script's touch test are tied only by convention --> FIXED (web.msgcopy-5312.test.js; mutation control proven)

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] a guest's row on a touchscreen has no Copy --> FIXED (plan scoped to a pointer)
- [WARNING] the wider right-click takeover on a pending reply unpinned --> FIXED (C5 pending arm)
- [NIT] a replaced row on touch was silent; brittle test regex --> FIXED

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER (disproved), 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2
- [BLOCKER] hidden menu items still drawn (.msg-menu-i is display:block) --> NOT AN ISSUE: the page-wide `[hidden] { display: none !important }` (line 571) wins; C4 now measures the computed display (none)
- [WARNING] msgRef kept on a menu that did not open --> FIXED
- [WARNING] a late empty row on touch was silent --> FIXED (toast)

#### Iteration 14
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Converged** — no new actionable findings.

### Final Ledger (WARNINGs and above)

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | catalog row stale | FIXED | README |
| 2 | 1 | WARNING | hand-built guest fixture | FIXED | real renderer |
| 3 | 2 | WARNING | detached row reads a DM record | FIXED | no store off-thread |
| 4 | 2 | WARNING | eight-button touch bar covers the DM row | FIXED | touch menu |
| 5 | 3 | WARNING | empty menu | FIXED | no menu |
| 6 | 3 | WARNING | keyboard on touch focus | DEFERRED | rare, recorded |
| 7 | 4 | WARNING | touch name vs behaviour | FIXED | named for its menu |
| 8 | 4 | WARNING | own DM rows on a phone | DEFERRED | system selection |
| 9 | 4 | WARNING | stale check comments | FIXED | headers |
| 10 | 5 | WARNING | label at paint only | FIXED | relabel |
| 11 | 5 | WARNING | fallback strip list | DEFERRED | pinned on the real renderer |
| 12 | 6 | WARNING | DM touch menu untested | FIXED | 718 arm |
| 13 | 7 | WARNING | stale store read | FIXED | painted-for test |
| 14 | 8 | WARNING | preview card in the fallback | FIXED | .lpv |
| 15 | 8 | WARNING | id label on numberless rows | DEFERRED | Josh's label |
| 16 | 9 | WARNING | name before PJ_TOUCH_MQ | FIXED | relabel at start |
| 17 | 9 | WARNING | silent touch press | FIXED | toast |
| 18 | 10 | WARNING | WebKit Copy message | FIXED | R12 step |
| 19 | 10 | WARNING | silent pointer press | FIXED | toast |
| 20 | 11 | WARNING | CSS and script query | FIXED | page test |
| 21 | 12 | WARNING | guest row on touch | FIXED | plan scoped |
| 22 | 12 | WARNING | pending right-click | FIXED | C5 arm |
| 23 | 13 | BLOCKER | hidden items drawn | NOT AN ISSUE | measured: display none |
| 24 | 13 | WARNING | msgRef on a closed menu | FIXED | set on open |
| 25 | 13 | WARNING | late empty row | FIXED | toast |

### NITs (non-blocking, across all iterations)
- aria-expanded on the touch Copy; Home and End untested; Safari before 14's addListener; same-millisecond DM rows; nested markup in the fallback (iterations 6 to 14, not changed)

### Strengths (across all iterations)
- Copy message reads the record, as written and in full, only from a store painted for what is on screen
- The touch bar keeps #4409's seven buttons; the DM overlap regression was measured, not assumed
- Every new arm proven able to fail by a mutation control
