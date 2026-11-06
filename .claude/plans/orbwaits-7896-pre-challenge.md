---
pre_challenge: true
method: challenge-loop
branch: orbwaits-7896
diff_hash: 5b008486ba41833d1ac1d89feee7196af9c1b8d966a167396693d837be07abb3
validation: failed
timestamp: 2026-11-06T19:34:04Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap (standing instruction to all Kosmos builders, Splinter 2026-10-22: past 8, continue only while a BLOCKER is open). No BLOCKER was raised in any round. Rounds 6, 7 and 8 each read the whole branch.
**Total findings:** 0 BLOCKERs, 19 WARNINGs, 8 CONVENTIONs, 35 NITs (summed from the per-iteration headers below)
**Fixed:** all WARNINGs and CONVENTIONs except where marked; **Deferred:** listed below with reasons; **Asked (awaiting user):** 0

Scope grew mid-loop by Josh's rulings (11-06 12:17, 12:18, 12:29, verbatim in the plan file and on kosmos#7896): the orb replaced the K loader everywhere, small marks became the Sweep dots, and making an agent ends with the orb's dots becoming the green check. Rounds 6 to 8 reviewed the whole widened branch.

**ITER_COMMITS:** 2a40325e0a8fbdcc8ee0c29753efc805950113e5, 2b06d82aba944ae82a045e0c12525dc9b1afcda8, d19cedbb5e029ef89221e49a38d3332850c4ed97, 3e49ba04e6246d4783987420a69c8ae0d1da26a4, ee76089ed9daca8c018efe18c8f844085c77efbb, 997138df90c667e7e95eefeeedf90c9ed1a691b3, 96df05a9e4cd5978ca14dbfcbdaeb11a287b31e3, e11ea2ad016ec09ff9f7e94b8ad21f5e34fb39b1. (0f0016e9c9, 4f3a35a740 and 7677737dd8 are the rulings' own work, between rounds 5 and 6.)

**Measured outside the suite (Chromium; WebKit hangs on this Mac, kosmos#8114):** the finish, light and dark, motion and reduced; a finish while hidden; a theme change after and during the finish; a planted mid-flight failure giving the CSS check; first paint with the boot orb against plain dots (28 ms either way). Browser checks run green here: render-model-spinners-2365, render-model-restart-interstitial (22), render-restart-screen-4343 (80), render-restarting-2019 (116), render-restart-timedout-2019 (20), render-restart-kloader-2831 (16), render-handoff-restart-3492 (14), render-reassign-update-3050 (14), render-muse-signin-3939 (170), render-plus-signin-3478 (209, its WebKit arms not run). render-create-made fails locally on unchanged main too (a harness difference), so CI judges it.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 7 NITs
- [WARNING] small-spinner contrast --> FIXED: the dots keep --spin-gold (the deep gold on light grounds)
- [WARNING] the dot colour was unasserted --> FIXED: asserted equal to the orb's
- [WARNING] orb arms at the wrong sizes --> FIXED: first-frame and density arms at 88 px
- [NIT] x6 comments (KORB "small on purpose", four hidden spinners, the `all` comment, the overlay 2x canvas, cstep-made, createnav) --> FIXED
- [NIT] the orb-to-K cut at finish --> FIXED in iteration 3 (and replaced by the orb's own finish since 4f3a35a740)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] render-computers waited a fixed 400 ms --> FIXED: polls for orb ink, bounded 5 s
- [WARNING] no tick check --> DEFERRED then superseded: render-create-made asserts the green tick; since iteration 7 the spinner check proves the finish directly
- [NIT] label unescaped --> FIXED
- [NIT] dropMyLoader finish on walk-away --> FIXED in 4f3a35a740 (stop(), never a check)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 7 NITs
- [WARNING] the orb-to-K cut at finish --> FIXED (then superseded by KORB.finish)
- [WARNING] the "stopped" arm lost its premise --> FIXED: a hidden orb stays in the page during that arm
- [NIT] x7 stale comments and a weak colour compare --> FIXED (3e49ba04e6)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] the update overlay's orb was the deep gold on its dark scrim --> FIXED: `.upd-back { --spin-gold: var(--gold) }`, with an arm that reds without it
- [NIT] stale "four spinners" comment --> FIXED
- [NIT] the #9c741b literal --> KEPT: that arm's page is light; [NIT] the plus-signin hold comment --> FIXED in iteration 5

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 6 CONVENTIONs, 4 NITs
- [WARNING] render-plus-signin-3478 accepted any canvas --> FIXED: `#plus-si-k .orb-wait canvas.korb` with ink; mobile-shots.js the same
- [CONVENTION] x6 stale comments (startMadeMark finish paths, retry leak, K loader header, KORB sizes, reply-where guard on KORB, mobile-shots) --> FIXED; the no-progress guard now reads KORB
- [NIT] x4 (crossfade, gold-button arm, dot===orbDot, 88 px wording) --> FIXED or superseded

#### Iteration 6
**Reviewer model:** sonnet, whole branch
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] a finish while hidden shrank the canvas --> FIXED: parked, drawn on showing at full size
- [WARNING] a queued visibility entry could redraw the turning orb over the check --> FIXED: the `finishing` guard in every draw path
- [WARNING] the plan described the earlier branch --> FIXED: rewritten
- [WARNING] the Mac installer page keeps a K --> DEFERRED to its own branch (instorb-7896), recorded on kosmos#7896
- [CONVENTION] reduced-motion restarting dots pulse where the K held still --> RECORDED on kosmos#7896 (the overrun case is still fully still)
- [NIT] stale K comments --> FIXED (quotes of Josh kept verbatim)

#### Iteration 7
**Reviewer model:** opus, whole branch
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 6 NITs
- [WARNING] a partial and a never-seen ending left the orb turning forever --> FIXED: hold() (still, unfinished)
- [WARNING] the check kept its colour through a theme change --> FIXED: redrawn in the new --ok and size
- [WARNING] no direct proof of the finish --> FIXED: the spinner check's finish arms (control reds without the fixes)
- [CONVENTION] the finish copied paint's projection --> FIXED: one project()
- [NIT] blend per dot --> FIXED (8 steps); parked orb never released --> FIXED; "nothing appears" overstated --> FIXED; Muse dots unasserted --> FIXED
- [NIT] K_LOADER_CYCLE_MS name --> KEPT (now the restart hold's length, commented); gold-button orb arm --> KEPT (a defensive rule, harmless)

#### Iteration 8
**Reviewer model:** sonnet, whole branch, final
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] a theme change or resize during the flight, or while hidden, was lost --> FIXED: remembered and applied (korbStale); an arm switches the theme mid-flight (control reds without it)
- [WARNING] the redraw set held removed orbs --> FIXED: pruned on each finish and when the observer sees them leave
- [WARNING] a failed finish left no check --> FIXED: a CSS check stands in, at the start or mid-flight (measured with a planted failure)
- [NIT] "exactly" in the projection comment --> FIXED; the hidden-gold and dark arms --> FIXED; stale README rows and check comment --> FIXED

**Final validation:** recorded `failed`, 2 of 27,555 tests (27,125 pass, 428 skipped), at e11ea2ad01:
- engine/restoresink.test.js: hung at 0% CPU for over 9 minutes on /Volumes/BigLobsterStorage, which is stuck on this Mac (Splinter 11:41: "A full local suite can hang on engine/restoresink.test.js; that is this drive, not your change"). I stopped that one test process (PID recorded, mine only); CI judges it.
- tools.shell-shard-4317 "#6791 review 2": red because it runs the browser-check surface gate, which found 13 checks covering surfaces this branch changed (the boot cover, the Kosmos+ sign-in card, the dialogs) and not touched by it. It passes on unchanged main and at this branch's base. Answered by the Browser-check-surface trailers on the commit that adds this file, each check run here first: render-agentdm-3414 40, render-allagents-4812 60, render-dialog-gutter-4506 52, render-gutter-return-4506 15, render-layer-gutter-4494 13, render-phone-offline-718 20, render-plus-asks-signin-4610 64, render-plus-company-5628 22, render-plus-computer-name-5995 40, render-plus-signin-enter-0929 12, render-star-6719 108, render-unread-edge-3743 72, all 0 fail. render-boot-no-flash: its boot-cover arms pass; its four What's New arms fail the same way against unchanged main's page (my static server has no board version API), so CI's real board judges them.
