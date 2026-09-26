---
pre_challenge: true
method: challenge-loop
branch: mobile-chatfirst-718
diff_hash: fa181e5435001aa601904f0a2920fb612b2ad76a9745efc3d1800b5fb8e4c7c0
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T03:15:00Z
iterations: 19
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19 (iteration 1 = the initial validation pass; 18 blind review rounds: 13, then 5 more after
rebasing onto a fast-moving main).
**Converged:** No. Stopped under a directive from Liu Kang (m767): "fix only each round's findings, with no
new scope" and "If round 15 still is not clean, open the PR anyway with the open findings listed by
severity in the body." Round 19's findings are all fixed and verified (checks and controls below), but
those fixes have NOT been re-reviewed by a further blind round. The PR body lists the open risks by
severity for Liu Kang to decide.
**Total findings:** 8 BLOCKERs, 34 WARNING entries (some bundle several), 3 CONVENTIONs, many NITs
**Fixed:** all BLOCKERs, WARNINGs and CONVENTIONs found | **Deferred:** 3 NITs (below) | **Asked:** 1
(the swarm header on the phone chat, answered by Liu Kang m794 and applied)

Reviewer model: sonnet for iterations 2 and 4 (first attempt), then opus only after the sonnet weekly
limit (Liu Kang m711, until Sunday 5pm). This is a known weakness: most rounds ran on one model.

Final state (head 044cf3744, rebased onto origin/main 5a181ae17): tools/run-tests.sh 9659 tests, 9507 pass,
0 fail, validation PASSED (hash fa181e543500), subdir audit clean. render-dm-chatfirst-718.js 606 PASS,
0 FAIL on Chromium + WebKit; negative control against origin/main's page: 312 FAIL of 606. Re-run on
this tree: render-waiting-phone-718 13/13, render-swarm-ui-3564 60/60, render-dm-emoji-3744 70/70,
render-dm-phone-718 176/176, render-help-tips-3574 120/120, render-no-left-bars-3692 141/141.
Landing controls (render-waiting-phone-718 arm e): A reveal removed PASS; B reveal and chat-first removed
FAIL (talkTop 769 below the fold); C chat-first removed PASS (scrolled branch); D box hidden FAIL; E box
half below the fold FAIL. Every heavy run went through the fleet gate (m821/m829/m841) and was stopped
and re-run whenever another run started. Unrelated flakes seen and re-run clean: engine/create.test.js
(#323) and server.xsite-1636 (ENOTEMPTY teardown race).

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none (helpers)
- [BLOCKER] initial-validation: server.test.js stylesheet guard read a `body:has(` selector line as a stray declaration --> FIXED (9f273a86; plus seven Browser-check-surface trailers)

#### Iteration 2
**Reviewer model:** sonnet
- [BLOCKER] web/index.html: body overflow:hidden clipped the world-switcher menu --> FIXED (lock dropped)
- [WARNING] cascade dependency on the 56rem block undocumented --> FIXED
- [WARNING] no long-name fixture --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] talk box overflow:hidden hid a send error while typing --> FIXED (control 8 FAIL)
- [WARNING] iOS pan not handled --> FIXED for window.scrollY; offsetTop case on Johnny's simulator list

#### Iteration 4
**Reviewer model:** opus (sonnet spawn failed on its weekly limit and was re-run)
- [BLOCKER] identity notes could take the whole screen (thread 0px) --> FIXED (capped .dhead; control 8 FAIL)
- [WARNING] WebKit Post press brought the header back --> FIXED (mousedown handler; control 16 FAIL)
- [WARNING] programmatic Post focus false-passed; listener untested; iOS pan offsetTop --> FIXED / on simulator list

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] memory ring drawn 100px over the compact header --> FIXED (control 8 FAIL)
- [BLOCKER] check used #d-conflict, removed on main --> FIXED
- [WARNING] crowd case ran with the composer hidden; list conflict; #conn note --> FIXED
- [CONVENTION] plan contradicted the focus rule --> FIXED

#### Iteration 6
**Reviewer model:** opus
- [BLOCKER] centred capped header spilled above its scroll box (name, Start this agent unreachable) --> FIXED (control 8 FAIL)
- [WARNING] header hid on focus without a keyboard --> FIXED (kosmos-keyboard-up gate; control 8 FAIL)
- [WARNING] action buttons below the fold --> accepted trade, recorded in the plan

#### Iteration 7
**Reviewer model:** opus
- [WARNING] emoji button (main #3744) untreated; layout-shrinking keyboards undetected; listener untested --> FIXED (controls fail)

#### Iteration 8
**Reviewer model:** opus
- [WARNING] list conflict; emoji button WebKit focus; search box 13px (iOS zoom) --> FIXED

#### Iteration 9
**Reviewer model:** opus
- [WARNING] composer could slip under the keyboard with notices above --> FIXED (sticky; control 2 FAIL)
- [WARNING] Post keep-focus only mouse-tested --> touch arm added; iOS on simulator list
- [WARNING] landscape --> stated out of scope in the plan

#### Iteration 10
**Reviewer model:** opus
- [WARNING] panel order rule untestable --> FIXED (rule removed)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] emoji panel items flashed the header --> FIXED (delegated handler; control 2 FAIL)
- [WARNING] surface tokens incomplete --> FIXED
- [CONVENTION] branch behind main (#3770) --> FIXED (rebased, check re-run)

#### Iteration 12
**Reviewer model:** opus
- [WARNING] rotating while typing reset the keyboard baseline --> FIXED (per-width baseline; control 2 FAIL)
- [CONVENTION] 40rem duplicated between CSS and script --> FIXED (pinned in the check; control FAIL)

#### Iteration 13
**Reviewer model:** opus
- [WARNING] emoji panel could open under the keyboard (481 to 640px) --> FIXED (visual-viewport floor; control 2 FAIL)

#### Iteration 14
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
NITs 1 and 2 fixed in a1487a9d. This round read as converged at the time; the rounds below, run after the next rebase, found more, so it was not.

#### Iteration 15 (post-rebase round 1)
**Reviewer model:** opus
- [BLOCKER] Agent Swarms (#3564, new on main): the cluster avatar drew at 88px in the 40px slot --> FIXED (re-sized once laid out)
- [WARNING] swarm controls could sit below the capped header on the phone chat --> ASKED, answered (Liu Kang m794): keep Active/Paused and Stop now in the header, sliders stay on Profile --> FIXED
- [WARNING] emoji and rotation arm labels overstated what they assert --> FIXED

#### Iteration 16 (post-rebase round 2)
**Reviewer model:** opus
- [BLOCKER] cluster re-size read the record captured at open --> FIXED (fresh board row; no `|| CURRENT`, web.agent-nav.test.js)
- [WARNING] sticky composer under the open reaction bar; emoji panel ceiling ignored the visible top --> FIXED
- [WARNING] touch and swarm arms could not fail on what they name --> FIXED
- [WARNING] Kano's landing arm (render-waiting-phone-718 e) failed on the chat-first shape --> FIXED (either shape; size above zero, Kano m901; controls A to E)

#### Iteration 17 (post-rebase round 3)
**Reviewer model:** opus
- [WARNING] after rebasing onto main (help tour, phone Settings nav): tab row lacked the fade cue and snapping; the help tour's 100vh overrode the visible height --> FIXED
- [WARNING] search field itself not 44px; emoji panel did not re-place on an iOS pan --> FIXED
- [WARNING] landing arm did not require Talk shown --> FIXED

#### Iteration 18 (post-rebase round 4)
**Reviewer model:** opus
- [WARNING] Stop now's explanation hidden on the phone chat though it acts at once --> FIXED (two lines)
- [WARNING] emoji panel handler caught non-button presses; two definitions of typing --> FIXED
- [WARNING] per-width baselines unbounded; README and plan stale --> FIXED

#### Iteration 19 (post-rebase round 5)
**Reviewer model:** opus
- [WARNING] Stop now explanation still truncated --> FIXED (full text)
- [WARNING] the phone-pairing card stayed while typing with the keyboard up --> FIXED (control: without it the SE arm fails)
- [WARNING] typing controls defined twice (script and CSS) --> FIXED (one script list, CSS pinned to it; control: a short list fails)
- [WARNING] an emoji arm could not fail --> FIXED (removed; the panned-view edge is on the iOS simulator list)
**Not re-reviewed:** the loop stops here under Liu Kang m767 (see Summary).

### Deferred (NITs)
- The memory-full badge sits exactly at the capped header's top edge; not clipped today, no arm covers it.
- tallestByWidth keeps one entry per width ever seen (harmless, unbounded on desktop drags).
- No scroll cue on the capped identity block (recorded trade in the plan).

### Strengths
- Every phone rule is gated to Talk below 40rem; tablet and desktop pinned unchanged by the check
- The check drives the real listener through a stubbed visualViewport and uses real pointer and touch input
- Each credited behaviour has a control that turns its own assertion red when removed alone
