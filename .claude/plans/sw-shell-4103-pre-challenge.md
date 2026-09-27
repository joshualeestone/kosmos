---
pre_challenge: true
method: challenge-loop
branch: sw-shell-4103
diff_hash: a0fda2f9f20fddd0544abefccef54bbd63743bc5c1ed62f8e6ae8bd901ca30ed
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T06:03:50Z
iterations: 3
converged: true
---

# Challenge loop proof: sw-shell-4103 (#4103, the phone app's offline copy is only ever the board)

Three blind reviews, alternating Opus and Sonnet. The ledger is in the plan `.claude/plans/sw-shell-4103-*.md`.
Validation rc=0 and subdir audit rc=0 at 932e9f8c4 (first run). Both browser-check gates rc=0.

## Per-iteration findings
- Iteration 1 (Opus): 6 NEW.
  - [WARNING] A non-navigation GET of '/' could still cache the sign-in page unchecked. FIXED.
  - [WARNING] render-push-718 used fixed waits and did not isolate the navigation path. FIXED (deadline polling;
    the cached '/' is deleted first).
  - [NIT] x4: redirected responses, comments, and cancelling the unused copy. FIXED.
  - While fixing the last NIT, an awaited tee cancel was found to hang. Not awaited now.
- Iteration 2 (Sonnet): 3 NEW.
  - [WARNING] No offline-install test. FIXED.
  - [WARNING] The tee-cancel comment. The claim stands; it now names ReadableStreamDefaultTee.
  - [NIT] Left.
- Iteration 3 (Opus): 0 NEW BLOCKER, WARNING or CONVENTION. CONVERGED.
  - [NIT] The install's third clone (GC). Left.
  - [NIT] A long comment line. Left.
  - The reviewer ran both tests against main: the unit file fails the right 6 of 9, and render-push-718 fails
    exactly the "not replaced" arm, with the v1 cache holding the sign-in page.

## Evidence
- web.sw-shell-4103.test.js: 9 tests on the real handlers with the real board page. Each fix was mutation-checked.
- render-push-718: 21/21 on the branch. With main's sw.js the offline copy becomes the sign-in page (the bug
  reproduced in Chromium).
