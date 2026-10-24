---
pre_challenge: true
method: challenge-loop
branch: ownseal-ui-4658
diff_hash: PENDING
validation: PENDING
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: PENDING
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: no BLOCKER, WARNING or CONVENTION; three NITs, all fixed)
**Total findings (new, across iterations):** 2 BLOCKERs, 29 WARNINGs, 0 CONVENTIONs, about 12 NITs
**Fixed:** 2 BLOCKERs, 29 WARNINGs, every NIT | **Deferred:** 0 from the loop (the plan's "Not in this branch" list
is scope, decided before the loop) | **Asked:** 0

Origin / Self-generated: the blame lookup was NOT run per finding, so neither field is recorded, rather than filled
in by judgement. Observed by reading: several later findings were in this loop's own earlier fixes (the focus
fallback in iteration 7, the code-blind refocus in iteration 8, the "Confirmed" claim in iteration 9).

Reviewer models alternated: opus on odd iterations, sonnet on even. Every fix was committed with
render-ownseal-4658 green, and each new or strengthened assertion was shown red against the previous UI or a mutant
(named per iteration in the commit messages).

### Per-Iteration Breakdown (detail in each "address challenge-loop iteration N" commit message)

#### Iteration 1 (opus): 5 WARNINGs, NITs, all FIXED (18b17403c0, 6a9b049e12)
Press sentence lost when the section emptied; sentence outlived its state; focus fell to the page; out-of-order
loads; the line above the room ignored the upright tablet.
#### Iteration 2 (sonnet): 3 WARNINGs, 1 NIT, all FIXED (7723898d6a)
A press took its project from the page; one failed read wiped rows or code; buttons stayed busy until the reload.
#### Iteration 3 (opus): 1 BLOCKER, 4 WARNINGs, 1 NIT, all FIXED (5b3cb3319f)
BLOCKER: the consolidated view hid the Members card, so a waiting computer could never confirm (now drawn in the
rail). Plus: line shown in consolidated, a press after re-entering a project, live region rebuilt filled, no tablet arm.
#### Iteration 4 (sonnet): 3 WARNINGs, 1 NIT, all FIXED (5eca8cddad)
Live region cleared and filled in one task; a failed reload kept the pressed row; a refresh in flight painted
pre-press rows.
#### Iteration 5 (opus): 3 WARNINGs, 1 NIT, all FIXED (6a1f5744a4)
The confirmed code came back with buttons before the Allow; rail focus lost on every poll; no check waited
through a poll.
#### Iteration 6 (sonnet): 3 WARNINGs, 1 NIT, all FIXED (692e8702e5)
No way out once confirmed; a code kept through failed reads; the failed-read check did not prove the failure.
#### Iteration 7 (opus): 1 BLOCKER, 3 WARNINGs, NITs, all FIXED (423e65794e)
BLOCKER: after a repaint focus fell to the first button left, on the owner's side another computer's Allow. Plus:
load at openProject, own reset split from fedMembersReset, the confirm sentence chosen after the reload.
#### Iteration 8 (sonnet): 2 WARNINGs, all FIXED (99ba30a55c)
Refocus ignored a changed code; a superseded press sentence was cleared by the next refresh.
#### Iteration 9 (opus): 3 WARNINGs, all FIXED (d031c4a9ed)
A missing code read as "Confirmed"; focus restored on every paint; owner rows kept through any number of misses.
#### Iteration 10 (sonnet): 0 BLOCKER/WARNING, 3 NITs, all FIXED (6d1186a8a2 after rebase)
Rows kept on an answer with no list; the rail-focus check could pass with no rebuild; the after-Allow focus check
passed with focus on the page. Mutant (both refocus paths disabled): 6 FAIL.

### Validation
render-ownseal-4658 150/150 on the rebased head (chromium and webkit, 1280 and 390, consolidated, chromium tablet).
Browser-check surface trailers name and ran render-fed-plus-gate, render-federation-invite-4649,
render-shell-noscroll-4872, render-star-6719 and render-project-members-3387. Mortals full suite: PENDING.
