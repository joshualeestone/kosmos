---
pre_challenge: true
method: challenge-loop
branch: gpt-clone-3731
diff_hash: 6a3055321770a17ea6eca1a797db30178bbd97ac76c7f31db42d82bbdd21ec2e
subdir_audit: passed
timestamp: 2026-09-25T14:55:31Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind reviewers: opus, sonnet, opus, sonnet)
**Converged:** Yes. Pass 4 found 0 blockers and one missing arm, added and proven red.

## Iteration 1 (opus): 0 blockers
- [WARNING] Gemini and Grok result and progress lines lacked GPT's CSS -> FIXED, arm red without it.
- [WARNING] Connected was a plain sentence, not GPT's gold box, and offered no Next -> FIXED, arms.
- [WARNING] Grok's first-run Stop did not return to the choice -> FIXED, arm red without it.
- [WARNING] Timeout copy named Download, the button is Confirm -> FIXED.
- [WARNING] Settings showed the key box and Grok's choice before the install check answered -> FIXED.
- [WARNING] A late read could reopen a panel another Connect had closed -> FIXED (generation bump), arm red
  without it after two rounds of making the arm able to fail.
- [NIT] KEYED_SUB_START map; bar and progress reset on reopen; arms for each -> FIXED.

## Iteration 2 (sonnet): 0 blockers
- [WARNING] Settings' Add a provider buttons still drew the browser's blue ring -> FIXED, arm red without it.
- [NIT] aria-controls lists 2 of 4 panels and the install sentence lives in two places: both byte-for-byte
  GPT's own shape. Not taken.

## Iteration 3 (opus): 0 blockers
- [WARNING] A slow paint left Gemini's key form open under "connected" -> FIXED (as GPT's #2621), arm.
- [WARNING] Settings' Grok Stop stayed on the sign-in -> FIXED (back to the choice, as GPT's Settings).
- [WARNING] The "nothing before the install check answers" rule had no arm that could fail -> arm added.
- [WARNING] The visit guard in acctApikeyShow had no arm that could fail -> arm added (made to fail first).
- [NIT] Failed-start retry arm; Connect pressed again starts clean; acctKeyedWindows leaves Grok's sign-in -> FIXED.
- [NIT] Five more not taken, each with its reason in .claude/plans/gpt-clone-3731.md (all GPT-identical or harmless).

## Iteration 4 (sonnet, confirming): 0 blockers
- [WARNING] A sign in again's Stop branch had no arm -> arm added, red when the branch is collapsed.
- [WARNING] Informational: a Grok sign-in poll can write its waiting line over a just-painted gold box for
  1.2 to 2.4 s, then self-heals. GPT's frOpenaiSubWatch is identical and documents it as accepted. Not taken:
  ending the sign-in from the paint could cancel the sign-in that just finished.

## Focus ring (Josh, 0.6.94)
- The ring is Kosmos's ink in first run and Settings. Measured in Chromium and WebKit: a real mouse press
  draws no ring there; the blue in the screenshot came from the check pressing buttons by script. A
  hide-for-mouse rule was built, found by perturbation to change nothing, and removed.

## Measured
- Full suite PASSED on 713e3797f (9285 tests, 0 failed, surface gate 0 FAILED).
- render-firstrun-keyed-connect-3658.js, render-grok-subscription-3391.js, render-keyed-install-3713.js pass;
  every new arm was perturbed red by me or a reviewer. Five other checks whose tokens moved pass unchanged.

## Weakest premise
- Gemini's subscription waits on #3568 (Angel's Antigravity sign-in). KEYED_SUB_START.google is the one
  place that turns its choice on.
