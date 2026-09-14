---
pre_challenge: true
method: challenge-loop
branch: proj-working-glow-2837
diff_hash: 10ab5adab353617c8c941b728812843faa864b5f00ad2fa67edd67fb5e54492d
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T06:24:21Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (converged on iteration 7 with zero new BLOCKER/WARNING/CONVENTION findings)
**Converged:** Yes
**Total findings:** 1 BLOCKER, 3 WARNINGs, 4 CONVENTIONs, several NITs, many STRENGTHs
**Fixed:** 1 BLOCKER + 3 CONVENTIONs + 2 WARNINGs + 2 NITs | **Deferred:** 1 CONVENTION + 1 WARNING (filed #2882) + several NITs | **Asked:** 0

Model rotation (kosmos#2032): opus, sonnet, opus, sonnet, opus, sonnet, opus. The
rotation earned its keep on iteration 2 -- sonnet reproduced as a live BLOCKER the
archived double-light that iteration 1 (opus) had rated a NIT and the author had
wrongly deferred.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 (ITER_COMMITS empty; base fix commit predates the loop -> BRANCH)
- [CONVENTION] commit subject not `<branch> -- <message>` --> FIXED (amended 49c67c15)
- [NIT] projects.js sole-membership lights an archived project --> initially DEFERRED, UPGRADED to BLOCKER + FIXED at iteration 2
- [NIT] status.js two helpers duplicate the freshness computation --> FIXED iteration 2 (consolidated)
- [NIT] no end-to-end test for the screen-led carry --> FIXED (fb909fb0, red-capable)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0 (findings on the base commit's lines -> BRANCH)
- [BLOCKER] projects.js:soleActiveMembership lit an ARCHIVED project a working agent belongs to when its sole active membership was elsewhere -- the same global fact on two tiles, the #2837 bug --> FIXED (f80a107d, `project.archived !== true` guard + dedicated red-capable test)
- [CONVENTION] status.js helper duplication (dup of iter-1 NIT) --> FIXED (consolidated to one `workingProject(screenLed)`)
- [CONVENTION] stale #763 stateProject comments now inaccurate (working carries a project too) --> FIXED (updated to #763/#2837)
- [NIT] dead-fresh comment on the stale-branch carry --> FIXED (accurate inline note)
- [NIT] plan/code drift (`soleActiveMembership(name)` vs `(m)`) --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (BRANCH)
- [CONVENTION] plan filename lacks `-<timestamp>` suffix --> DEFERRED (prevailing repo practice is `<branch>.md`; measured across committed plans; the hook + Step 4 resolve by `<branch>`)
- [NIT] test comments still named `workingProjectFromScreen` after the iter-2 rename --> FIXED (c23eaedf)
- [NIT] curly apostrophe --> DEFERRED (the test file uses curly apostrophes pervasively; matches house style; not an em dash)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (BRANCH)
- [WARNING] the sole-membership fallback fired fail-OPEN when `all` is not an array -- would silently re-light every project, reintroducing the bug --> FIXED (9a755e9f, fail-CLOSED via `Array.isArray(all)`)
- [NIT] 4th near-duplicate freshness derivation in reconcileReport --> DEFERRED (a shared helper touches pre-existing rules 3/3b/5, out of scope)
- [NIT] no working-count breakdown siblings (needsYouElsewhere-style) --> DEFERRED (explicitly out of scope per plan; copy follow-up if Josh wants it)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 0 NITs
**Self-generated:** 1 (the CONVENTION -- a comment the loop wrote at iteration 4, commit 9a755e9f in ITER_COMMITS -> SELF; the kosmos#120 pattern, caught and corrected)
- [CONVENTION] the iter-4 fail-closed comment claimed "describe is unexported", but it IS exported --> FIXED (0b4e4124, corrected the false clause)
- [WARNING] `paintRoomBusy` (web/index.html) over-claims the same way on a sibling surface --> DEFERRED out of scope + FILED as follow-up #2882 (pre-existing, different surface, needs a web change + browser gate)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (the plan's fail-open passage was authored by the pre-loop base commit -> BRANCH)
- [WARNING] the plan's verification section still documented the OLD fail-open design after iter-4 flipped the code to fail-closed --> FIXED (8331f727, rewrote to fail-closed)
- [NIT] freshness-derivation duplication (re-raise of the iter-4 deferral) --> DEFERRED again (pre-existing, out of scope)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** -- no new actionable findings.
- [NIT] "Freshness-gated exactly like #763" is slightly imprecise about #763's reported arm --> recorded, not fixed (harmless: the reported-working branch is only reached under `!stale`, so the gate can never wrongly null a fresh project; the reviewer confirmed harmless)
- [NIT] the documented false-calm tradeoff (multi-project unnamed working agent lights none) --> recorded, not a defect (Josh-accepted, in the plan's weakest premise; producer follow-up + #2882 are the next steps)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | (commit) | BRANCH | commit subject not `<branch> -- <msg>` | FIXED | amended 49c67c15 |
| 2 | 1 | NIT->BLOCKER | projects.js:996 | BRANCH | sole-membership lights an archived project | FIXED | f80a107d + test |
| 3 | 1 | NIT | status.js:5691 | BRANCH | two helpers duplicate freshness calc | FIXED | f80a107d (consolidated) |
| 4 | 1 | NIT | projects.test.js | BRANCH | no screen-led carry test | FIXED | fb909fb0 |
| 5 | 2 | CONVENTION | status.js | BRANCH | stale #763 stateProject comments | FIXED | f80a107d |
| 6 | 2 | NIT | projects.js | BRANCH | plan/code drift on helper signature | FIXED | f80a107d |
| 7 | 3 | CONVENTION | .claude/plans | BRANCH | plan filename lacks timestamp | DEFERRED | prevailing practice is `<branch>.md` |
| 8 | 3 | NIT | projects.test.js | BRANCH | stale `workingProjectFromScreen` comment | FIXED | c23eaedf |
| 9 | 3 | NIT | projects.test.js | BRANCH | curly apostrophe | DEFERRED | matches file's house style; not an em dash |
| 10 | 4 | WARNING | projects.js:996 | BRANCH | sole-membership fallback failed OPEN | FIXED | 9a755e9f (fail-closed) |
| 11 | 4 | NIT | status.js | BRANCH | 4th freshness-derivation copy | DEFERRED | shared helper touches pre-existing rules |
| 12 | 5 | CONVENTION | projects.js:987 | SELF | iter-4 comment falsely said describe unexported | FIXED | 0b4e4124 |
| 13 | 5 | WARNING | web/index.html:21017 | BRANCH | paintRoomBusy over-claims (sibling surface) | DEFERRED | filed #2882 (out of scope) |
| 14 | 6 | WARNING | .claude/plans:68 | BRANCH | plan still documented fail-open | FIXED | 8331f727 |
| 15 | 6 | NIT | status.js | BRANCH | freshness dup (re-raise) | DEFERRED | pre-existing |
| 16 | 7 | NIT | status.js:5680 | BRANCH | "exactly like #763" imprecise | RECORDED | harmless (reviewer-confirmed) |
| 17 | 7 | NIT | projects.js:996 | BRANCH | documented false-calm tradeoff | RECORDED | Josh-accepted, in plan |

### NITs (non-blocking, across all iterations)
- [NIT] status.js:5680 -- "Freshness-gated exactly like #763" is imprecise about #763's reported arm (harmless; the gate cannot wrongly null a fresh project on the only branch that uses the report-led path)
- [NIT] projects.js:996 -- the accepted false-calm tradeoff: a multi-project working agent that names no project lights none of its tiles. Producer follow-up (`report working --project X` at launch) and the sibling `paintRoomBusy` over-claim (#2882) are the next steps.

### Strengths (across all iterations)
- Faithful mirror of the #763 needsYou precedent: same decay window, same projectInferred semantics, same "null project falls back to sole-membership" shape -- the two cannot drift.
- Single-derivation `workingProject(screenLed)` helper across all working returns (honors the repo's most-cited defect class, two derivations of one fact).
- Fail-closed defensive guard: a future/test caller passing a non-array `all` cannot re-light every project.
- The archived-membership guard prevents an archived sibling tile from lighting; dedicated red-capable test.
- Tests exercise the real fleet.install/snapshot()/reconcile pipeline with a dark-tile control on every arm; every new assertion proven red-capable by perturbation.
- No consumer regresses: every stateProject/needsYou reader gates on needs_you; web reads stateProject nowhere; no web/ change so no browser-check gate.
