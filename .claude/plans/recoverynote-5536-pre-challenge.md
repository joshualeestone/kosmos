---
pre_challenge: true
method: challenge-loop
branch: recoverynote-5536
diff_hash: 656fb3b044187fb402982ce7295a76f59835c1f91d92194edfee967eb73bcd1e
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-05T13:31:52Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes. Iteration 4 raised no new BLOCKER, WARNING or CONVENTION.
**Total findings:** 9 (0 BLOCKERs, 6 WARNINGs, 3 CONVENTIONs), plus NITs below
**Fixed:** 7 | **Deferred:** 2 | **Asked (awaiting user):** 0

**Departures from the skill, stated so nobody reads this as the standard path:**
- **6.0 and 6g were not run each round.** Per the fleet's queue rule, the full suite ran only at the end through the heavy queue, so no round restarted it. Each round ran the notice's own tests, the neighbouring tests and the browser check instead.
- **Rounds 1 to 3 reviewed a stacked diff** (a802b1a09a, the head of PR #8028, to HEAD), because #8028 had not merged. The branch was rebased onto main after #8028 merged, before round 4, which reviewed origin/main...HEAD.
- **The Self-generated line was not measured.** The 6c-bis blame lookup was not run, so each iteration says so rather than giving a number.

**Validation history, in full:**
- 06:22 CST on Agent1s at 6df15203bc: red, 6 failures. One was mine, the browser-check surface gate, which I had not re-run after the review fixes. All 8 flagged checks were then run on this branch and passed, and commit 47c1881bba names each with a per-check trailer. The other 5 failures were in code this branch does not touch.
- 06:59 CST on Agent1s at 47c1881bba: red, 5 failures, load up to 85. Only two test files repeated from the first run, each on a different case or arm. Four failing files passed alone at load 8.
- 07:31 CST on Mortals at 47c1881bba: **passed**. 27357 tests, 0 failed, 423 skipped, hash 656fb3b04418 matching this proof.
- **Weakest point:** that the Agent1s reds were load is inferred from the Mortals pass and the alone runs, not shown by a controlled comparison. PR CI is the next independent read.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** not measured
- [WARNING] web/index.html: See who centred a list taller than the screen, so the newest row could be off screen and still count as seen --> FIXED (6277eaf7e6)
- [WARNING] server.recoverynote-5536.test.js: the agent arm sent no screen header, so it could pass without the token check --> FIXED (6277eaf7e6)
- [NIT] server.recoverynote-5536.test.js: the no-rows test did not assert enrolled --> taken (6277eaf7e6)
- [NIT] render-recoverynote-5536.js: comment on the stand-in for the page's repaint --> taken (6277eaf7e6)
- [NIT] web/index.html: the land loop duplicates the reviewer notice's --> left
- [NIT] mobile-shots.js: no shot for this notice --> taken in iteration 3
- [NIT] plan: a second weakest premise, the shared read --> left

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] web/index.html: one sentence for both kinds of row said less than the list for files opened --> FIXED (856801134e): it says opened only when an unseen row does
- [WARNING] web/index.html: a new browser shows the notice for up to 30 days of rows, and the plan did not say so --> DEFERRED: intended, recorded in the plan; missing a recovery is the worse error
- [NIT] engine/orgenroll.js: stale comment calling this slice the next one --> taken (856801134e)
- [NIT] web/index.html: the tab guard is a single check --> left
- [NIT] web/index.html: duplicate land loop --> left

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 CONVENTIONs, 5 NITs
**Self-generated:** not measured
- [WARNING] web/index.html: a tab in the background could mark a recovery seen --> FIXED (6df15203bc)
- [WARNING] web/index.html: the heading alone counted as seen, with the first row below the fold or under the header --> FIXED (6df15203bc)
- [CONVENTION] mobile-shots.js: no registered design shot --> FIXED (6df15203bc)
- [CONVENTION] web/index.html: raw 200 cap --> FIXED (6df15203bc)
- [CONVENTION] plan file name has no timestamp --> DEFERRED: the sibling plans have the same shape, and the hook finds it by branch
- [NIT] web.recoverynote-5536.test.js: misleading name on the key test, and no reverse arm for closing --> taken (6df15203bc)
- [NIT] CLAUDE.md: row did not mention this notice --> taken (6df15203bc)
- [NIT] web/index.html: seen keys hold the reviewer's name in this browser's storage --> left, as the reviewer notice does
- [NIT] web/index.html: a throw in the reviewer paint skips the recovery paint --> left
- [NIT] web/index.html: near copy of the reviewer notice --> left

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
**Converged:** no new actionable findings.
- [NIT] web/index.html: the comment could add that rows below the fold also count as seen
- [NIT] web/index.html: the seen set is parsed on each repaint
- [NIT] server.js: comment on which side is the authority for the family rule

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | not measured | See who centred a long list | FIXED | 6277eaf7e6 |
| 2 | 1 | WARNING | server.recoverynote-5536.test.js | not measured | Agent arm could not fail on the token | FIXED | 6277eaf7e6 |
| 3 | 2 | WARNING | web/index.html | not measured | One sentence for both kinds of row | FIXED | 856801134e |
| 4 | 2 | WARNING | web/index.html | not measured | New browser shows old rows | DEFERRED | Intended, in the plan |
| 5 | 3 | WARNING | web/index.html | not measured | Background tab marks seen | FIXED | 6df15203bc |
| 6 | 3 | WARNING | web/index.html | not measured | Heading alone counts as seen | FIXED | 6df15203bc |
| 7 | 3 | CONVENTION | mobile-shots.js | not measured | No design shot | FIXED | 6df15203bc |
| 8 | 3 | CONVENTION | web/index.html | not measured | Raw cap literal | FIXED | 6df15203bc |
| 9 | 3 | CONVENTION | plan file | not measured | Name has no timestamp | DEFERRED | Sibling plans match |

### Mutation arms, run by hand on the committed code (all red)

Route family guard, route not cleaning, page family guard, page enrolled guard, key losing fields, See who to the wrong list, list not counting seen, x clearing nothing, reviewer x clearing this notice, notice naming the person, no slot, token check gone, seen on any sliver, scroll back to centre, wrong field for the opened wording, hidden-tab guard gone, header ignored, fold ignored.

### Outstanding questions (ASKED, still unresolved when the run ended)

None.

### Strengths (across all iterations)
- The notice is fixed text with no name in it, so it has no injection surface and shows no name on a shared screen (iterations 1, 3).
- The family rule is enforced in both the route and the page, with company controls (iterations 1, 4).
- Tests pair each blank with a control that shows the notice, so they can fail (iterations 1, 2, 3, 4).
