---
pre_challenge: true
method: challenge-loop
branch: tasks-look-3559
diff_hash: 68e17005b81c51be75627ddd63db9df03c2ca036c6c9053fa5de94c2763b6159
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T16:47:04Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20 blind reviewer passes, alternating Opus and Sonnet
**Converged:** Yes (iteration 20, Sonnet: NO FINDINGS)
**Total findings:** 45 (1 BLOCKER, 25 WARNINGs, 12 CONVENTIONs, 7 NITs), plus the NITs listed below
**Fixed:** 39 | **Deferred/accepted:** 6 (DELIBERATE and ACCEPTED entries in the plan) | **Asked (awaiting user):** 0

Scope grew during the loop by instruction. At iteration 6, Splinter relayed Josh's ruling that the
Tasks tab appears only at 25 tasks, to be built into this branch. The branch was also rebased onto
main twice (the conflict was server.js, main's `swarms` field beside `tasksTab`; both were kept).
Iteration 10 found nothing, but the rebase after it changed the diff, so the loop continued.

Validation: the full suite through the validation helper PASSED on 30e5441b (9158 pass, 0 fail,
148 skipped; lint, type-check and build clean; subdir audit clean; helper hash 68e17005b81c).
Three earlier reds were load flakes, not this diff (engine/feedbacksend #1760 timing, since fixed
on main by #3722). They were filed as kosmos#3710 and passed alone every time.

### Per-Iteration Breakdown

#### Iterations 1-5 (the four look notes)
**Reviewer models:** opus, sonnet, opus, sonnet, opus
**New findings:** 0 BLOCKERs, 9 WARNINGs, 2 CONVENTIONs, 8 NITs
**Self-generated:** 6
- [WARNING] web/index.html tskRow: "has not said" claimed more than the field proves --> FIXED (5281bd93, "has not reported what it is working on yet")
- [WARNING] web/index.html: the project card and the task page still showed the engine's prose for the same fact --> FIXED (f6827e55, claimNotReported)
- [WARNING] web/index.html #tsk-msg: collapsing the status line made the list jump when a message appeared --> FIXED (d00c461f, one reserved line; browser arm red on the old version)
- [WARNING] web/index.html paintTaskPage: "It has not reported" on a task kept as parts --> FIXED (d00c461f)
- [WARNING] fed comments overclaimed "never" for a wrapping message --> FIXED + ACCEPTED in the plan (aa1bb2b4)
- [WARNING] engine/tasks.js claimFor: named the agent of a finished part --> FIXED (2da4e0e9)
- [WARNING] paintTaskPage: said it twice (claim line and why line) --> FIXED (2da4e0e9)
- [CONVENTION] a browser arm could pass without measuring (crumbEmpty) --> FIXED (5281bd93)
- [CONVENTION] a derivation computed twice in tskRow --> FIXED (aa1bb2b4)

#### Iterations 6-10 (the 25-task gate joins the branch)
**Reviewer models:** sonnet, opus, sonnet, opus, sonnet
**New findings:** 0 BLOCKERs, 6 WARNINGs, 4 CONVENTIONs, 5 NITs
**Self-generated:** 5
- [WARNING] engine/tasks.js tasksTabShown: the automatic flag write could clobber an unreadable settings.json (the person's timezone) --> FIXED (85c19ac8, then store.writeSettingsIfReadable b92956b7)
- [WARNING] a failed flag write was never retried, although the comment said it was --> FIXED (85c19ac8)
- [WARNING] paintTaskPage: "it" for other could-not-tell reasons on a parts task --> FIXED (32b6616c)
- [WARNING] the checkbox aria-label repeated the state when grouped by project --> FIXED (32b6616c)
- [CONVENTION] sayShown and firstOpen were two derivations of one fact --> FIXED (096b5dec)
- [CONVENTION] the settings path and parse were derived again outside the store --> FIXED (b92956b7)
- [NIT] a failed count was cached as hidden --> FIXED (b92956b7)
- Iteration 10: NO FINDINGS, then the rebase onto main changed the diff and the loop continued

#### Iterations 11-15
**Reviewer models:** opus, sonnet, opus, sonnet, opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 5
- [BLOCKER] web/index.html paintProjectTasks: the card put the claim beside a FINISHED part --> FIXED (55639f11, one helper tkSayPart)
- [WARNING] the claim was said once per part, not once per agent --> FIXED (38e7ec65)
- [WARNING] the card dropped a finished agent's reason --> FIXED (d04d3b70)
- [WARNING] a could-not-tell reason was said twice on the task page --> FIXED (cedbec23)
- [WARNING] ROOT CAUSE: the engine read a task's claim for the first agent ever named, so a finished part's agent decided "In progress" --> FIXED (31c1eada, tasks.claimWho + claim.about, and every surface reads it)
- [CONVENTION] render-user-menu-3051 counted nav markup but read as on-screen --> FIXED (38e7ec65)

#### Iterations 16-19
**Reviewer models:** sonnet, opus, sonnet, opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 4 CONVENTIONs, 4 NITs
**Self-generated:** 4
- [WARNING] with Closed no longer a tile, the Closed count was checked nowhere --> FIXED (b3e1666f, the fold's count)
- [WARNING] the close-note keyed on the legacy t.who, so a parts-assigned task never showed "does not stop Mona" --> FIXED (41299c99)
- [WARNING] claimWho ignored the task's own closedAt (closing leaves parts open) --> FIXED (30e5441b)
- [WARNING] a definite claim leads the close-note as well as the part line --> DELIBERATE (render-tasks pins it; the plan says why)
- [CONVENTION] stale comments (whoOf's doc line, the claim join, the card, claimFor), the browser-check README row, a misplaced #3703 comment --> FIXED (b3e1666f, 66874d38, 30e5441b)
- [NIT] the server's unreadable-project fallback used the old rule --> FIXED (66874d38)

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html tskRow | BRANCH | sentence claimed more than the field | FIXED | 5281bd93 |
| 2 | 3 | WARNING | web/index.html #tsk-msg | SELF | list jumped when a message appeared | FIXED | d00c461f |
| 3 | 7 | WARNING | engine/tasks.js | BRANCH | flag write could clobber settings | FIXED | 85c19ac8, b92956b7 |
| 4 | 12 | BLOCKER | web/index.html card | SELF | claim beside a finished part | FIXED | 55639f11 |
| 5 | 15 | WARNING | engine/projects.js | BRANCH | claim read for the first agent ever named | FIXED | 31c1eada |
| 6 | 18 | WARNING | web/index.html close-note | BRANCH | missing on parts-assigned tasks | FIXED | 41299c99 |
| 7 | 19 | WARNING | engine/tasks.js claimWho | SELF | closed task kept an agent | FIXED | 30e5441b |
| 8 | 17 | WARNING | web/index.html close-note | BRANCH | definite claim said again in the note | DELIBERATE | plan |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- ACCEPTED (plan): a rare wrapping message pushes the list one line; a brief tab hide when both files are unreadable at once; an unwritable settings.json retried quietly each poll; the tab can go away if settings.json stays unparseable and the count later falls; below 25, View All or ?tab=tasks opens the view while its tab is hidden.
- Source-regex test arms that have behavioural twins in the browser check.

### Strengths (across all iterations)
- The root cause (whose claim it is) was fixed in the engine once, instead of patched on each surface (iteration 15).
- Every fix carries a test that a mutation turns red; browser arms measure real geometry, bounded both ways.
- The settings write can never clobber a person's settings: one guarded read-and-merge owned by the store.
