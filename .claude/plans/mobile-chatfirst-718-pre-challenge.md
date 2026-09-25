---
pre_challenge: true
method: challenge-loop
branch: mobile-chatfirst-718
diff_hash: ca7cf888c811bfe8dd925e0559dd6666f081b81f21f56a77a112b9aa1d1ed82c
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T19:24:48Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14 (iteration 1 = the initial validation pass, which failed and was fixed; 13 blind review rounds)
**Converged:** Yes, at iteration 14 (NITs only)
**Total findings:** 3 BLOCKERs, 20 WARNINGs, 2 CONVENTIONs, many NITs
**Fixed:** all BLOCKERs, WARNINGs and CONVENTIONs | **Deferred:** 3 NITs (see below) | **Asked:** 0

Reviewer model: sonnet for iterations 2 and 4 (first attempt), then opus only from iteration 4 on
after the sonnet weekly limit (Liu Kang m711). Iteration 4's first spawn failed on that limit and was
re-run; it is not counted. The branch was rebased onto main five times during the loop (list-line
conflicts in tools/browser-checks.sh only; every resolution keeps all of main's gated checks and adds
render-dm-chatfirst-718; one resolution briefly committed conflict markers locally and was repaired
with a fixup before any push). Liu Kang m767 set the rule "fix only each round's findings".

Final state (head a1487a9d): tools/run-tests.sh 9312 pass, 0 fail, PASSED read from the log with no
release holding the machine; render-dm-chatfirst-718.js 577 PASS exit 0 on Chromium + WebKit;
negative control on origin/main 293 FAIL of 577; render-dm-emoji-3744 70/70; render-dm-phone-718
176/176. Two unrelated flakes seen during the loop and re-run clean: engine/create.test.js (#323, once)
and server.xsite-1636 (ENOTEMPTY teardown race, 0 of 12 on main and branch on rerun). Origin column:
BRANCH throughout (fail-safe; no finding acted on as SELF).

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none (helpers)
- [BLOCKER] initial-validation: server.test.js stylesheet guard read a `body:has(` selector line as a stray declaration --> FIXED (9f273a86; plus seven Browser-check-surface trailers)

#### Iteration 2
**Reviewer model:** sonnet
- [BLOCKER] web/index.html — body overflow:hidden clipped the world-switcher menu --> FIXED (lock dropped)
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
**Converged.** NITs 1 and 2 fixed in a1487a9d (emoji panel buttons in the step-aside list; plan records the emojiPlace change).

### Deferred (NITs)
- The memory-full badge sits exactly at the capped header's top edge; not clipped today, no arm covers it.
- tallestByWidth keeps one entry per width ever seen (harmless, unbounded on desktop drags).
- No scroll cue on the capped identity block (recorded trade in the plan).

### Strengths
- Every phone rule is gated to Talk below 40rem; tablet and desktop pinned unchanged by the check
- The check drives the real listener through a stubbed visualViewport and uses real pointer and touch input
- Each credited behaviour has a control that turns its own assertion red when removed alone
