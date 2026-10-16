---
pre_challenge: true
method: challenge-loop
branch: unknownjobs-6320
diff_hash: 0d6e04a7fb5b8a202c2da0f61dff53db06a1ab9dfbabdd1baaf8e3b4b2b63cef
validation: not-run (the local full suite was not run; the shared machine queue is backed up today; PR CI is the merge gate; focused runs below passed after the rebase onto main)
subdir_audit: not-run
timestamp: 2026-10-16T18:49:57Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating), reviewed while stacked on loginjob-6310, then rebased onto main
after #6323 merged (clean, 8 own commits).
**Converged:** Yes (iteration 8: one WARNING restates the plan's recorded over-inclusion; one asks for an extra edge test
of logic the reviewer confirmed correct; NITs otherwise)
**Fixed:** all but the recorded decisions | **Deferred:** 3 | **Asked (awaiting user):** 0

**Validation, stated as it is:** the canonical full-suite helper did NOT run. After the rebase onto main:
`engine/register.test.js` 47/47, `web.survival.test.js` 11/11, the coarse browser-check gate (overridden by the
recorded `Browser-check:` trailer, and mobile-shots.js is touched) and the surface gate clean. Screenshots: 12 shots from
`docs/browser-checks/mobile-shots.js` (restart-unknown, restart-both, restart-both-done; iPhone 15 and desktop; light and
dark), 0 overflow, looked at. The PR's CI is the gate.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
3 WARNINGs, 1 CONVENTION: plutil-budget deferrals named as unreadable; Windows failures banner forever; alarm style with
nothing to fix; no screenshot. Fixed in f974feb7f3 (screenshot later).
#### Iteration 2 (sonnet)
2 WARNINGs: no combined unreadable+waiting test; ordering note; Mac-only unpinned. Fixed in b1c5c8a79e.
#### Iteration 3 (opus)
4 WARNINGs: a budget skip dropped the log record; one waiting plist hid real unknowns; the Linux control could not fail;
next-survey read unasserted. Fixed in 6ab0e753e0; a new test then caught a real bug (a broken plist naming the folder was
hidden while others waited), fixed in the same round.
#### Iteration 4 (sonnet)
3 WARNINGs: no browser check or trailer for the page change; module-global null reasons; over-inclusion wording.
Fixed in the iteration-4 commit (per-survey reasons, mac:false elsewhere, Browser-check trailer).
#### Iteration 5 (opus)
CONVENTION screenshot owed (recorded), WARNING over-inclusion (recorded); NITs. Screenshots then taken (two new
mobile-shots screens); the shots showed the combined panel crammed under its button, fixed (9d4fcbfe8c).
#### Iteration 6 (sonnet)
2 WARNINGs: the repair report dropped the could-not-check line; a failure line landed under it. Fixed in fb04ed7b9b with
a third screen (restart-both-done).
#### Iteration 7 (opus)
3 WARNINGs: singular copy said "these agents"; the dashed shape contradicts the file's own rule for could-not-read; the
report screen's wait could not fail. Fixed in 4682509aff.
#### Iteration 8 (sonnet)
0 new actionable. **Converged.**

### Deferred, with reasons
- Over-inclusion when a genuinely unreadable file exists beside waiting ones: every unknown agent is listed (the safe
  side), recorded in the plan.
- An extra test for an already-cached plist with an expired retry hitting a spent budget: the reviewer traced it correct.
- The offline card's `create.jobMissing` half of #6320 stays on the card as a second step.

### Strengths (across all iterations)
- `unknown` and `missing` share one filter on the other answer, so they never overlap; Repair acts only on `missing`.
- Every new rule has a test that fails without it; the rendered panels were looked at in light and dark.
