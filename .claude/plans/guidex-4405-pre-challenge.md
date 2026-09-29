---
pre_challenge: true
method: challenge-loop
branch: guidex-4405
diff_hash: 8f33f92d7b671ddc184ae6466abd2d398c60aefdb1c64661252a432d7112be6a
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T11:20:34Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

Card: kosmos#4496 (Josh 09-28 15:14-15:15: a hover X on the Kosmos Guide bubble, tight hit area, turns the Guide off).

**Iterations:** 10
**Converged:** Yes (iteration 10: both WARNINGs were a by-design behaviour and a duplicate of iteration 4's decision; no ASKED findings)
**Total findings:** 27 actionable (0 BLOCKERs, 26 WARNINGs, 1 CONVENTION) plus NITs
**Fixed:** 25 | **Deferred:** 2 (plus 2 iteration-10 non-issues) | **Asked (awaiting user):** 0

Validation: `validation_log_run_or_skip` (the full kosmos suite, 11,460+ node tests plus the gates) passed at every
iteration: 18d8ece05b31, e8af75ce1096, 094db99e4425, 371a63b575aa, bf0f2576bc1d, a2c677d0e5aa, 04850522a491,
3faa0f7c5ac3, f9623fc79f0f, 8f33f92d7b67; 6j skipped on the clean 8f33f92d7b67 entry. The two early failures were the
#2518 browser-check surface gate: my first per-check trailers named the checks without `.js` (the gate keys on the full
basename); fixed with trailers citing each flagged check's own green run (render-unread-edge-3743.js,
render-assistant-hosted-3660.js 107/107, render-agentdm-3414.js). Browser check render-assistant-bubble-3034.js run by
hand after every change: 143/143 at HEAD (one run under load 28 reddened three older B1 arms; green twice alone).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [WARNING] keyboard focus leaving the bubble never hid the X --> FIXED (a0eb95f): bubble blur handler; arm; mutant red
- [WARNING] a failed save hid the focused X --> FIXED (a0eb95f): kept shown and focused; failed-save arm (refused POST); mutant red
- [WARNING] the "shows again after a hold" arm passed on keyboard focus, not a hold --> FIXED (a0eb95f)
- [WARNING] the plan claimed webkit was measured --> FIXED (a0eb95f): reworded (later resolved by B2w)
- [CONVENTION] README row lacked B2x --> FIXED (a0eb95f)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] a click while a save runs was reported as a failure --> FIXED (b4ee42e): null for "already running"; arm; mutant red
- [WARNING] surface header lacked asb-close / asb-close-msg --> FIXED (b4ee42e)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 5 NITs
**Self-generated:** 0
- [WARNING] code comments cited #4405 (the branch) instead of #4496 (the card) --> FIXED (85eac44)
- [WARNING] the failure live region was hidden when written (not announced) --> FIXED (85eac44): shown empty, filled after 60 ms
- [WARNING] an X failure wrote the Settings row's message --> FIXED (85eac44); arm; mutant red

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 5 NITs
**Self-generated:** 1 (my own success-after-failure arm could not fail: an earlier arm had hidden the words; a mutant proved it)
- [WARNING] the X saved before the setting was read --> FIXED (52d6f5b): same guard as the switch
- [WARNING] a success left an earlier failure's words up --> FIXED (52d6f5b); the arm rebuilt to cause a fresh failure first; mutant red

#### Iteration 5
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 5 NITs
**Self-generated:** 0
- [WARNING] no test of the X on a LIFTED bubble --> FIXED (4ebc1b7): B15x
- [WARNING] the failure words outlived the bubble --> FIXED (4ebc1b7): one asbCloseMsgClear on every path
- [WARNING] the tight hit area was proved in chromium only --> FIXED (4ebc1b7): a WEBKIT arm (B2w) found that WebKit, the Mac app's engine, hit-tests the X by its SQUARE box (the corners closed the Guide). Fixed with clip-path: circle(); ring as an inside border; screenshots in both engines

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 1 (my own comment "var: asbPaint may run before this line" was false; var hoists the name, not the value)
- [WARNING] a timer object read before assignment would throw --> FIXED (f997bcc): timers on ASB; the false comment deleted, not reworded

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 1 (the clip-path from iteration 5 cut the X's focus outline)
- [WARNING] keyboard focus on the X was invisible (clip cut the outline) --> FIXED (037f72f): ring inside the clip; arm reads the painted colour; mutant red
- [WARNING] after a mouse fold (script focus on the bubble) the X stayed pinned --> FIXED (037f72f): only keyboard focus keeps it; the check had blurred this sequence away, now tested; mutant red

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] a hold cut short by the chat opening could still show the X --> FIXED (b325155): the timer re-checks :hover. No arm: a check cannot hold a pointer still across the open (a mutant stayed green), so the arm was dropped rather than kept vacuous; recorded in the plan
- [WARNING] a tap started the hold on touch --> FIXED (b325155): touch pointers start no hold (Josh's spec is a hover)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (my iteration-7 ring probe blurred the X by script, which made the backwards-focus arm vacuous)
- [WARNING] the backwards-focus arm could not fail after the ring probe --> FIXED (e1cade3): probe by keyboard only, re-established state asserted; mutant red
- [WARNING] after a failed click, leaving with the pointer hid the try-again button --> FIXED (e1cade3); arm; mutant red
- [CONVENTION] a "WIP" commit subject would land on main --> handled at merge: squash merge
- [NIT] reuse ASB_SAVE_FAILED --> fixed

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 (2 WARNINGs: one by design, one a duplicate), 3 NITs
**Converged** - no new actionable findings.

### Final Ledger (actionable only)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | keyboard blur off the bubble | FIXED | a0eb95f |
| 2 | 1 | WARNING | web/index.html | BRANCH | failed save hid the focused X | FIXED | a0eb95f |
| 3 | 1 | WARNING | render-assistant-bubble-3034.js | BRANCH | re-hold arm not testing a hold | FIXED | a0eb95f |
| 4 | 1 | WARNING | .claude/plans | BRANCH | webkit claim | FIXED | a0eb95f, 4ebc1b7 |
| 5 | 1 | CONVENTION | docs/browser-checks/README.md | BRANCH | row lacked B2x | FIXED | a0eb95f |
| 6 | 2 | WARNING | web/index.html | BRANCH | busy click reported as failure | FIXED | b4ee42e |
| 7 | 2 | WARNING | render-assistant-bubble-3034.js:1 | BRANCH | surface header | FIXED | b4ee42e |
| 8 | 3 | WARNING | web/index.html | BRANCH | wrong card number | FIXED | 85eac44 |
| 9 | 3 | WARNING | web/index.html | BRANCH | live region not announced | FIXED | 85eac44 |
| 10 | 3 | WARNING | web/index.html | BRANCH | X failure wrote Settings row | FIXED | 85eac44 |
| 11 | 4 | WARNING | web/index.html | SELF | save before setting read | FIXED | 52d6f5b |
| 12 | 4 | WARNING | web/index.html | SELF | success left failure words | FIXED | 52d6f5b |
| 13 | 5 | WARNING | render-assistant-bubble-3034.js | BRANCH | lifted bubble untested | FIXED | 4ebc1b7 |
| 14 | 5 | WARNING | web/index.html | SELF | words outlived the bubble | FIXED | 4ebc1b7 |
| 15 | 5 | WARNING | web/index.html | BRANCH | WEBKIT square hit area | FIXED | 4ebc1b7 |
| 16 | 6 | WARNING | web/index.html | SELF | false var-hoisting comment | FIXED (deleted) | f997bcc |
| 17 | 7 | WARNING | web/index.html | SELF | clip cut the focus ring | FIXED | 037f72f |
| 18 | 7 | WARNING | web/index.html | BRANCH | fold's script focus pinned the X | FIXED | 037f72f |
| 19 | 8 | WARNING | web/index.html | BRANCH | cut-short hold | FIXED (no arm, stated) | b325155 |
| 20 | 8 | WARNING | web/index.html | BRANCH | touch started a hold | FIXED | b325155 |
| 21 | 9 | WARNING | render-assistant-bubble-3034.js | SELF | probe made an arm vacuous | FIXED | e1cade3 |
| 22 | 9 | WARNING | web/index.html | BRANCH | try-again hidden on pointer leave | FIXED | e1cade3 |
| 23 | 9 | CONVENTION | history | BRANCH | WIP subject | handled | squash merge |
| 24 | 10 | WARNING | web/index.html | BRANCH | X shown while hovering after keyboard moved on | DEFERRED | by design: hover shows the X |
| 25 | 10 | WARNING | web/index.html | BRANCH | silent click before the setting loads | DEFERRED | duplicate of #11's decision (matches the switch) |

Origin: SELF where the cited line was written by an earlier fix in this loop (judged against the loop's own commits);
where a SELF finding was a prose claim it was deleted, not rewritten (#16).

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Geometry numbers (+38, +60, bottom 54) are tied to the 52px bubble without a shared constant (5, 6, 8, 9)
- The X vanishes without a fade (visibility has no transition) (9)
- Escape does not dismiss a keyboard-shown X (2)
- The WebKit arm covers hit-testing only, not focus after a failed save (8, 10)

### Strengths (across all iterations)
- One switch-off path (asbSwitchOff) for the Settings switch and the X, one latch, null for "already running" (every iteration)
- The tight hit area measured in BOTH engines with a point that can fail; the webkit arm found the real Mac bug (5-10)
- Every behaviour added in review has an arm and a mutant that turns it red; one arm that could not fail was removed and stated (8)
