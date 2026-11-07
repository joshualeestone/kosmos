---
pre_challenge: true
method: challenge-loop
branch: shots-8140
diff_hash: a4eb89aa81f815985a5a70736434268212a0618de2240656f660e42273930919
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T01:33:25Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (round 1, whole branch: 0 BLOCKERs, 0 WARNINGs, 3 NITs)
**Fixed:** 0 | **Left:** 3 NITs

Validation (local): web.subtasks-3861 and web.task-card-761 31/31; with the old index.html restored, 3 fail (the
three pinned chips). Static guard set 3813/3813; browser-check surface gate and #1720 gate pass (trailer on the fix
commit). Design shots: 12 taken, 0 overflow, 0 errors, each looked at; the gap is gone in all of them.

### Iteration 1 (opus, whole branch)
Checked and sound: the gap mechanism (.vh is absolute, so it is no flex item, but it splits the text into two
anonymous flex items, and the 4px gap goes between them); every chip form (the all-done and all-built strings never
had the hidden span; the button form is one string after its caret); no CSS reaches into the chip's children except
.car on the button form; the grid rules target the chip itself, still a direct child of .tkcard; screen-reader order
unchanged; the browser checks read textContent, which is identical; the screens copy task-rollup-6501's shape, each
with its own project and an after that deletes it; the Tasks row screen shows the plain chip, not the button.
- [NIT] the row screen waits on a bare .tsk-chip, then scrolls to #panel-tasks .tsk-chip: nothing else matches on a fresh page. Left (changing it means reshooting for no difference).
- [NIT] the tests pin markup, not layout; a later CSS change could bring the gap back unseen: the design shots are the layout check. Left.
- [NIT] the all-done and all-built strings get a wrapper they do not need: one shape, harmless. Left.
