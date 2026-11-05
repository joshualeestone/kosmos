---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0791
diff_hash: 4e56792dc6d5012b08d81f8772fad314a1a6e25456819e6458a2ac8cf370c851
validation: passed (Mortals, full suite: 27241 tests, 0 failed, entry status clean, on this head 6e7fb9cc0)
subdir_audit: passed
timestamp: 2026-11-05T04:45:49Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Iteration 1's BLOCKER, WARNING and NITs are all wording, taken as the reviewer wrote them; no further round.
**Total findings:** 1 BLOCKER, 1 WARNING, 2 NITs

Four What's New pool items for 0.7.91 and the list rebuilt.

### Iteration 1
- [BLOCKER] "An agent's card shows how much memory and CPU it is holding" was false: machineFlag shows one figure only over a threshold, so a normal card shows nothing; the always-on figures are on the agent's page --> FIXED in the pool and the release entry.
- [WARNING] "who last changed a file" claims what the feature deliberately does not: the record is made before the edit --> FIXED: "last touched", "about to change it", "a later change Kosmos did not see".
- [NIT] the owner notice read wider than the code --> FIXED: "a room note", "at most hourly".
- [NIT] --mine shows open tasks by default --> FIXED.
- [STRENGTH] the mac tag on the memory line is right: engine/machinecost.js returns null on win32. Linux has the feature by code but cannot be named in the window, so this under-tells Linux and misleads nobody.
- [STRENGTH] `since` 0.7.91 is right for all four: none is an ancestor of the v0790 bump, with controls.
- [STRENGTH] the rebuild is byte-identical; whats-new-check 0.7.91 passes mac (5) and windows (4), 0.7.92 refuses rc 3; prod-check rc 0; Windows pointers read 0.7.86.

### Weakest premise
Prod is still 0.7.86. If Josh promotes 0.7.90 before the cut freezes, the cut stops at step 1b-ii and What's New is rebuilt with whats-new-pool.js build 0.7.91.
