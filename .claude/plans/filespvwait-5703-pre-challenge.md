---
pre_challenge: true
method: challenge-loop
branch: filespvwait-5703
diff_hash: 11762a176dd4549b8fdda20ac603e419f734a0676fcc7acedd6f4f2623af6ecb
validation: passed (on current origin/main; render-files-preview-4997 run 3 times before and 3 times after the review fix, 90/90 PASS each, chromium and webkit; reason-grep, fixture-discipline, brand and name guards 35/0 fail. The race itself is reasoned from the code, not reproduced locally)
subdir_audit: passed
timestamp: 2026-10-09T18:52:17Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet; each blind)
**Converged:** Yes (iteration 2: no BLOCKER and no WARNING)
**Total findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
**Fixed:** the WARNING and 1 NIT; 3 NITs left with reasons | **Asked (awaiting user):** 0

The change (kosmos#5703): render-files-preview-4997 retried on WebKit in 2 of 6 nightly runs, always on the first
d-files-list open (own:false). A 5 s page poll can supersede the check's in-flight paint, which then draws nothing;
the poll's paint draws the row moments later. The check now waits up to 3 s for the painter's row (listed files
only) and after the F4 redraw. A painter that never draws still fails.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- Confirmed the cause; no stamp-equal path to own:false (the stamp is nulled before the paint, a superseded paint returns before writing it).
- [WARNING] the unlisted away.png waited the full 3 s on three lists in two engines (about 18 s a run) --> FIXED (a listed flag).
- [NIT] the comment named only the agent poll --> FIXED (names the project tick too).
- [NIT] the cause is reasoned, not measured --> LEFT, stated in the plan; the nightly runs measure it.

#### Iteration 2 (sonnet)
- Nothing above NIT. [NIT] two loop shapes could share a helper --> LEFT (two sites). [NIT] a repaint between the F4 wait and Escape --> LEFT (pre-existing, tiny, and fails real rather than passing false).
