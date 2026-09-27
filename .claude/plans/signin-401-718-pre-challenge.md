---
pre_challenge: true
method: challenge-loop
branch: signin-401-718
diff_hash: a925fa3b6c7689e5cf4498748c8be9fe75621b2f747c42d6c70531df16e35d19
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T08:47:32Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 19 (1-6 in an earlier session, 7-19 in this one; 18-19 after a rebase onto main)
**Converged:** Yes, iteration 17 and again iteration 19 raised no new code BLOCKER, WARNING or CONVENTION.
**Total findings, iterations 7-19:** 26 (1 process BLOCKER, 19 WARNINGs, 6 CONVENTIONs), plus NITs listed below
**Fixed:** 12 | **Deferred:** 14 (including duplicates of earlier deferrals) | **Asked (awaiting user):** 0

Iterations 1-6 ran in a session that was restarted; their ledger did not survive. What they fixed is
recorded in the branch's own commits ("address challenge-loop iteration N findings", N = 1..6). The
reviewer model for those six is unknown.

Final validation (6j): `yarn test` passed on 6a4e9d9b9 (validation-log hash a925fa3b6c76, the same
diff this proof hashes), subdir audit passed. The branch's browser check
(`render-device-signed-out-401-718`) passed through `tools/browser-checks.sh` on the same commit,
25 checks. Every heavy run went through `tools/heavy-gate.sh --twice`.

Rebases: main moved three times during the run. Each time the only conflict was
`browser-checks-reason-grep.test.js`'s EXPECTED_SITES counter (this branch adds one site); it was
resolved to main's count plus one (183, 184, then 188) and the counter test passed each time.

### Per-Iteration Breakdown

#### Iterations 1-6
**Reviewer model:** unknown (earlier session)
**New findings:** see commits "address challenge-loop iteration 1..6 findings" on this branch.
**Self-generated:** unknown

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above
- [CONVENTION] web/index.html:28662 -- deviceSignedOutHtml restated ORG_SIGNED_OUT_SENTENCE as a second literal --> FIXED (6e8f3f1d, rebased)
- [NIT] browser-checks.yml -- the new check is not on the CI allowlist (timing-sensitive, left off on purpose)

Also this iteration: the initial validation's only red was `engine/updating-988.test.js` (#3626 hung-tunnel timing), untouched by this branch, 40/40 green alone at load 7.4: contention.

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:28657 -- signed-out sentences say "Mac" and skip the Windows copy layer --> DEFERRED: Kosmos+ remote access reaches Macs only (no Windows path in the connector, no remote copy in windowsCopyTable); recorded in the plan
- [WARNING] web/index.html retry handler -- "the node may have been replaced" comment now describes the rare case --> DEFERRED: pre-existing comment, still true; the block above it already says the button restores itself
- [NIT] guard rewrite arm not unit-tested; [NIT] top-level .catch prints no FAIL token; [NIT] stub() keys on object identity; [NIT] add-project hint has no button

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:20533 -- the keep-the-card guard has no fast unit test --> FIXED (web.fail-card-keep-718.test.js; control: guard removed, 2 of 4 fail)
- [NIT] ORG_SIGNED_OUT_SENTENCE name; [NIT] stub() identity check

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs (1 WARNING duplicate of iteration 8's retry comment)
**Self-generated:** 0 of the above
- [WARNING] web/sw.js -- the Sign in reload lets the service worker cache the relay sign-in page as the offline shell --> DEFERRED: pre-existing, offline-only; filed as #4103 and cited in the plan
- [NIT] test cut by text pattern; [NIT] org note keep check restates the label; [NIT] picker wording is a third copy; [NIT] redundant stub routes

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 (1 CONVENTION duplicate of the Windows-copy deferral), 2 NITs
**Self-generated:** 0
- Final validation of the iteration 10 state failed on the browser-check surface gate: render-consolidated-projects-3052 names `pj-list` --> FIXED with a per-check `Browser-check-surface:` trailer (the change is the signed-out card text, not placement); both gates rc=0. Rebased onto main; `browser-checks-reason-grep.test.js` conflict resolved to EXPECTED_SITES = 183, measured.

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (+2 duplicates), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html retry handler comment names only BOARD_NEEDS_SIGNIN --> FIXED (pointer to BOARD_SIGNED_OUT's declaration)
- [WARNING] browser check proves the node survives, not keyboard focus --> FIXED (focus assertions; control in a throwaway local worktree with the guard removed: both keep checks FAIL, twice)
- duplicates: every failure card now kept (iteration 8); relay body contract (plan's weakest part)

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [CONVENTION] web/index.html:20591,28684 -- Sign in button markup written twice --> FIXED (DEVICE_SIGNIN_BUTTON; 393/393 in the six affected files)

#### Iteration 14
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [CONVENTION] plan file name has no timestamp --> DEFERRED: most plans on main are `<branch>.md`
- [CONVENTION] commit subjects carry parentheses, colons, `#718` --> DEFERRED: matches main's recent subjects; rewriting would churn history
- [CONVENTION] the two signed-out sentences share wording with nothing pinning them --> FIXED (pinning test; control: one clause changed, test red)
- [NIT] keep-loop cut could end early --> FIXED (endsWith assertion)

#### Iteration 15
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] web/index.html loadProjects -- the projects list's Sign in button is never asserted --> FIXED (unit test and browser-check assertion)

#### Iteration 16
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (+1 duplicate), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] loadProjects' BOARD_SIGNED_OUT has no fast anti-latch test --> FIXED (web.projects-signed-out-718.test.js runs the real loadProjects; control: latch mutation, red)
- [WARNING] focus scenario takes #grid only --> FIXED (visible button in #grid or #alist)
- duplicate: every failure card kept --> plan now says so, with a QA step

#### Iteration 17
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings.

#### Iteration 18 (after rebasing onto main)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (+1 duplicate), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] render-device-signed-out-401-718.js:127 -- the projects list's Sign in is never clicked --> FIXED (779fb655c, rebased): click must cause a reload; passes
- [WARNING] web/index.html:19892 -- paintAgentList repaints #alist outside the keep, so opening a project moves focus --> DEFERRED with the plan narrowed: the keep is the poll's; a paint the person caused may move focus
- duplicate: two pollers, last writer wins (documented at the flag's declaration)

#### Iteration 19
**Reviewer model:** sonnet
**New findings:** 1 process BLOCKER, 0 code findings, 1 CONVENTION duplicate, 1 NIT
**Self-generated:** 0
- [BLOCKER] the committed proof predated iteration 18's commit --> DEFERRED: correct at that moment and expected mid-run; this regenerated proof is the answer
**Converged** -- no new actionable code findings.

### Final Ledger (iterations 7-19)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 7 | CONVENTION | web/index.html:28662 | BRANCH | sentence restated as a literal | FIXED | 6e8f3f1d |
| 2 | 8 | WARNING | web/index.html:28657 | BRANCH | Mac wording skips Windows copy | DEFERRED | remote access is Mac-only; plan |
| 3 | 8 | WARNING | web/index.html retry | BRANCH | stale-sounding retry comment | DEFERRED | pre-existing, still true |
| 4 | 9 | WARNING | web/index.html:20533 | BRANCH | keep guard not unit-tested | FIXED | 96d47edf |
| 5 | 10 | WARNING | web/sw.js | BRANCH | offline shell caches relay page | DEFERRED | #4103 |
| 6 | 11 | BLOCKER (synthetic) | final validation | BRANCH | browser-check surface gate | FIXED | 4dd114d6 trailer |
| 7 | 12 | WARNING | web/index.html retry | BRANCH | comment names one flag | FIXED | f5167dfa |
| 8 | 12 | WARNING | render-device-signed-out-401-718.js | BRANCH | focus not asserted | FIXED | f5167dfa |
| 9 | 12 | WARNING | web/index.html:20550 | BRANCH | every failure card now kept | DEFERRED | dup of 3; plan + PR body |
| 10 | 12 | WARNING | web/index.html:28680 | BRANCH | relay body contract one-sided | DEFERRED | plan's weakest part |
| 11 | 13 | CONVENTION | web/index.html:20591 | BRANCH | button markup twice | FIXED | b7121aa7 |
| 12 | 14 | CONVENTION | .claude/plans | BRANCH | plan name has no timestamp | DEFERRED | main precedent |
| 13 | 14 | CONVENTION | git log | BRANCH | subject punctuation | DEFERRED | main precedent |
| 14 | 14 | CONVENTION | web/index.html:28678 | BRANCH | shared wording unpinned | FIXED | 319db967 |
| 15 | 15 | WARNING | web/index.html loadProjects | BRANCH | projects button unasserted | FIXED | 544886f3 |
| 16 | 16 | WARNING | web/index.html loadProjects | BRANCH | no fast anti-latch test | FIXED | 2af6df64 |
| 17 | 16 | WARNING | render-device-signed-out-401-718.js | BRANCH | focus takes #grid only | FIXED | 2af6df64 |
| 18 | 18 | WARNING | render-device-signed-out-401-718.js:127 | BRANCH | projects Sign in not clicked | FIXED | 779fb655 |
| 19 | 18 | WARNING | web/index.html:19892 | BRANCH | second #alist writer | DEFERRED | plan narrowed to the poll |
| 20 | 19 | BLOCKER (process) | proof file | BRANCH | proof predated a commit | DEFERRED | proof regenerated |

(Shas are the rebased commits where the loop rebased onto main mid-run.)

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across iterations 7-19)
- stub() in the browser check keys on object identity with RELAY_401 (iterations 8, 9, 17)
- the keep-loop test cuts the page by text pattern (10, 12, 16; the endsWith check now fails a short cut)
- the picker's "needs to sign in again" wording is a third, shorter copy (10, 12, 17)
- the org note and the cards use two different keep mechanisms (13, 15)
- the check's top-level .catch prints no FAIL token (8)
- the new check is not on the CI allowlist, deliberately (7)
- SIGNED_OUT_SENTENCE is interpolated without esc(), like SIGNIN_SENTENCE; both are fixed literals (16, 19)
- the org-note querySelector guard exists for test stubs (16, 18)

### Strengths (across iterations)
- The state is keyed on the relay's explicit `signed_out: true`, never a bare 401, with controls for a bare 401, the board's 403, a 500 and a normal board.
- The flag is cleared by exactly the events that clear BOARD_NEEDS_SIGNIN, and fast tests drive the real tick and the real loadProjects through signed-out, 500, network failure and a good read.
- The plan names its rejected alternative, its out-of-scope items (#4103 filed) and its weakest part.
