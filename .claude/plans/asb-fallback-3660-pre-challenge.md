---
pre_challenge: true
method: challenge-loop
branch: asb-fallback-3660
diff_hash: f32efb7cef039d61eb1363a1d5c69afeebec4c6dd23fed3655ec54ce705a2684
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T20:12:28Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 had nothing at WARNING or above)
**Total findings:** 0 BLOCKERs, 4 WARNINGs, 3 NITs (iteration 1); 0 at WARNING or above, 2 NITs (iteration 2)
**Fixed:** 4 WARNINGs, 3 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] A send in the fallback waited for the board before ASB.sending was set, so two quick Enters asked the
  backup twice. Fixed: sending is held across the board's answer.
- [WARNING] With a sign-in problem, the guide's own "sign-in isn't working" line (always naming Claude) showed beside
  the fallback's line, and the backup at work showed no working row. Fixed: no guide sign-in line in the fallback, and
  the hosted working row while the backup answers.
- [WARNING] "Your own AI is answering again." was erased by the guide send that followed it on the way out. Fixed: the
  line stays while that message goes to the guide; H29 asserts it.
- [WARNING] In the fallback the poll no longer asked whether the guide was still there. Fixed: it confirms the guide
  (a removed guide or a taken name is acted on at once) without reading "answers again", which stays on the next
  message as Josh asked.
- NITs fixed: a one-poll flicker of the guide's thread on entering the fallback; no "ended" aside stored for a
  fallback answer landing while folded; Antigravity named as accountproblem.js names it.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs
**Self-generated:** 0
Verified each fix: no path leaves sending stuck (asbConfirmGuide catches its own errors); the asbPoll recursion is
bounded at one level; keepFallback suppresses only the recovered transition, never the removed one; backNow is set
before any await. NITs not taken: two back-to-back GETs on entering the fallback from a poll (bounded, harmless); a
failed send after flipping back shows the failure rather than the back line (the error is the more useful news).

## After convergence
- The surface gate named render-agentdm-3414 (the token 'msg'): the change is the assistant's #asp-msg line, not the
  DM's .msg rows; the check runs green on this branch (40 pass), recorded in a per-check trailer.
- Rebased onto main (after #3690, #3771, #3776): the README rows only.

## Validation
6j on HEAD: full suite clean (hash f32efb7cef03), subdir audit clean. render-assistant-hosted-3660: 106 pass (H27-H29),
render-assistant-bubble-3034: 75 pass, render-agentdm-3414: 40 pass, all on today's main.
