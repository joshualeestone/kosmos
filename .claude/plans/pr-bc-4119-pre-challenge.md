---
pre_challenge: true
method: challenge-loop
branch: pr-bc-4119
diff_hash: 2eade7e194183e6708f223e4ba3061d78a121a10b5d66ab27584e0b493a1901b
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T10:28:14Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (1-2 in the session before the 03:50 restart; 3-13 in this session)
**Converged:** Yes, at iteration 12 (HEAD faccde7); code was added after that for a third real
escape (#4131), so iteration 13 reviewed the new HEAD 1c089f2 and also returned zero new
actionable findings. Final validation (6j) passed on 1c089f2: 10779 tests, 0 fail.
**Total findings (iterations 3-13):** 21 (0 BLOCKERs, 17 WARNINGs, 4 CONVENTIONs), NITs listed below
**Fixed:** 15 | **Deferred:** 6 | **Asked (awaiting user):** 0

**Ledger gap, stated plainly:** the session restarted at about 03:50 UTC and the ledger for
iterations 1-2 was lost. Their fixes are commits a1bced7 (iteration 1) and e7bedde (iteration 2:
only plain check names are emitted, KNOWN_RED documented). Every iteration after that was a fresh
blind review of the whole diff, so any iteration-2 finding left unfixed was open to be re-found.

### Per-Iteration Breakdown

#### Iterations 1-2
**Reviewer model:** unknown (prior session)
**Findings:** ledger lost in the restart; fixes in a1bced7 and e7bedde.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 (classified BRANCH: the flag dates from 0c54544)
- [WARNING] tools/bc-pr-select.js:6 — `--names` flag untested and unused --> FIXED (e5eafdf, flag removed)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the KNOWN_RED "allowlist still runs it" sentences, written by a1bced7/e7bedde)
- [WARNING] tools/bc-pr-select.js:74 — KNOWN_RED may miss other runner-red checks --> DEFERRED: #3973 shows #4076/#4074 fixed five of the six 09-26 nightly reds; the combobox is the only one still unexplained, and it is the one listed. mobile-shots' FAIL lines are its leak controls passing. Evidence in the plan.
- [WARNING] tools/bc-pr-select.js:145 — runnable() may name checks that do not run on the runner --> DEFERRED: every runnable name that existed at the nightly's commit ran there; the 13 others were added later. The driver's never-ran guard fails loudly. Evidence in the plan.
- [WARNING] tools/bc-pr-select.js:73, README:83 — "the allowlist still runs a known-red check" is false --> FIXED (99e5cc5, SELF prose: claim deleted)
- [CONVENTION] browser-checks.yml:163,200 — stale cost numbers --> FIXED (99e5cc5, now point at the #4119 card)
- [CONVENTION] README:72 — route list incomplete --> FIXED (99e5cc5, points at the tool header)
- Also fixed in 99e5cc5: the "No tmux install" workflow comment this branch made false.

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] tools/bc-pr-select.js:145 — runnable() cannot see a run_one label built at run time --> FIXED (a824040, a test pins the two known built labels; negative control shows a new one is caught)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs (plus 1 duplicate of iteration 4's KNOWN_RED concern), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (the stale header/driver text predates this branch)
**Duplicates of prior findings:** 1 (KNOWN_RED rests on one nightly: deferral stands)
- [WARNING] browser-checks.yml:24-38 — header says a green is DOM-state only --> FIXED (4aa7a35)
- [WARNING] tools/browser-checks.sh:704,1711 — driver comment and log line misdescribe the PR job --> FIXED (4aa7a35)
- [WARNING] tools/bc-pr-select.js:178 — a PR fixing a known-red check can never show it green --> FIXED (4aa7a35, the changed route overrides KNOWN_RED; test with negative control)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] browser-checks.yml:194 — tmux install has no step timeout --> FIXED (7e612a8, 10 min as browser-checks-full.yml)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not classified per finding; all three were code or scope findings, none fixed by deleting prose
- [WARNING] browser-checks.yml:205 — base.sha may include main's later commits --> DEFERRED: HEAD^1 is exact only on a merge-ref checkout and would under-select on a head-ref checkout; base.sha can only over-select. Reasoning in the plan.
- [WARNING] tools/bc-pr-select.js:215 — a changed fixture selects nothing --> FIXED (39602b4, fixtures select the checks whose code names them; test with negative control)
- [WARNING] tools/bc-pr-select.js:106 — quote pairing across regex literals --> DEFERRED as measured: 0 selectors lost across all 247 checks (106 such literals; positive control run). Named in the plan's Weakest part.

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 0
- [CONVENTION] .claude/plans/ — plan lacks the <branch>-<timestamp> name --> FIXED (dba1408, renamed)
- [WARNING] tools/bc-pr-select.js — a trailing // after a quote is not stripped --> DEFERRED: the comment ends its line and a string cannot cross a newline, so it can only over-select. Noted in the plan.
- [WARNING] test file — a shallow clone fails the replays confusingly --> FIXED (dba1408, message names `git fetch --unshallow`)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] tools/bc-pr-select.js:183 — a non-lib helper (thread-server.js) selects nothing --> FIXED (27ac25b, helpers select the checks that require or name them; test with negative control)
- [WARNING] browser-checks.yml / bc-pr-select.js — test-support/, the driver and other web/ files are not read --> DEFERRED as scope: routing fleet.js means the ~37 min full set; stated in the tool header, README and plan.
- [WARNING] tools/bc-pr-select.js:203 — `head` reads today's checks --> FIXED (27ac25b, header says head picks the diff only)
- NIT fixed: the README arm now also tests a file no check names.

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [CONVENTION] CLAUDE.md — Where to Find Things has no row for the selector --> FIXED (faccde7)

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
**Converged** — no new actionable findings.

#### After convergence: a third real escape (Liu Kang, m1412)
#4131 (a936fb83f..d586f361a) broke render-room-msgbox-2806 on main after its PR job passed. The
selector picks it by `pj-post`; the #2518 surface map alone does not. Added as a replay test in
1c089f2.

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** — no new actionable findings on 1c089f2.

### Final Ledger (iterations 3-13)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 3 | WARNING | tools/bc-pr-select.js:6 | BRANCH | unused --names flag | FIXED | e5eafdf |
| 2 | 4 | WARNING | tools/bc-pr-select.js:74 | BRANCH | KNOWN_RED may be incomplete | DEFERRED | #3973 evidence in plan |
| 3 | 4 | WARNING | tools/bc-pr-select.js:145 | BRANCH | runnable() vs runner ran-set | DEFERRED | measured, in plan |
| 4 | 4 | WARNING | tools/bc-pr-select.js:73 | SELF | false "allowlist still runs it" | FIXED | 99e5cc5 (deleted) |
| 5 | 4 | CONVENTION | browser-checks.yml:163 | BRANCH | stale cost numbers | FIXED | 99e5cc5 |
| 6 | 4 | CONVENTION | README.md:72 | BRANCH | route list incomplete | FIXED | 99e5cc5 |
| 7 | 5 | WARNING | tools/bc-pr-select.js:145 | BRANCH | built run_one labels invisible | FIXED | a824040 |
| 8 | 6 | WARNING | browser-checks.yml:24 | BRANCH | header: DOM-state only | FIXED | 4aa7a35 |
| 9 | 6 | WARNING | tools/browser-checks.sh:1711 | BRANCH | driver log line stale | FIXED | 4aa7a35 |
| 10 | 6 | WARNING | tools/bc-pr-select.js:178 | BRANCH | known-red fix unprovable | FIXED | 4aa7a35 |
| 11 | 7 | WARNING | browser-checks.yml:194 | BRANCH | tmux step has no timeout | FIXED | 7e612a8 |
| 12 | 8 | WARNING | browser-checks.yml:205 | BRANCH | base.sha vs HEAD^1 | DEFERRED | reasoning in plan |
| 13 | 8 | WARNING | tools/bc-pr-select.js:215 | BRANCH | fixture change selects nothing | FIXED | 39602b4 |
| 14 | 8 | WARNING | tools/bc-pr-select.js:106 | BRANCH | regex-literal quote pairing | DEFERRED | measured 0 lost, in plan |
| 15 | 9 | CONVENTION | .claude/plans/ | BRANCH | plan name lacks timestamp | FIXED | dba1408 |
| 16 | 9 | WARNING | tools/bc-pr-select.js | BRANCH | trailing // after a quote | DEFERRED | over-select only, in plan |
| 17 | 9 | WARNING | browser-checks-pr-select-4119.test.js:35 | BRANCH | shallow clone message | FIXED | dba1408 |
| 18 | 10 | WARNING | tools/bc-pr-select.js:183 | BRANCH | non-lib helper selects nothing | FIXED | 27ac25b |
| 19 | 10 | WARNING | browser-checks.yml:120 | BRANCH | unread trigger paths | DEFERRED | scope, stated in header/README/plan |
| 20 | 10 | WARNING | tools/bc-pr-select.js:203 | BRANCH | head reads today's checks | FIXED | 27ac25b |
| 21 | 11 | CONVENTION | CLAUDE.md | BRANCH | no map row for the selector | FIXED | faccde7 |

### Outstanding questions
None.

### NITs (non-blocking, across iterations 3-13)
- `\bid=` in pageIndex also matches `data-id=` (over-selection only) (iterations 4, 7, 12)
- `brew install tmux` without HOMEBREW_NO_AUTO_UPDATE (iterations 6, 12)
- `fetch-depth: 0` costs a full clone per run; matches test.yml (iterations 12, 13)
- referrersOf matches a fixture basename as a substring (over-selection only) (iteration 12)
- a checks-step failure under `bash -e` hides the "selection failed" note (iterations 4, 5)
- generic classes (`.hidden`, `.open`) over-select; a stoplist could trim it (iteration 6)
- header hardcodes a count of unannotated checks (iteration 6)
- replay controls depend on today's check sources (iterations 4, 12)
- run() discards stderr in tests; dense QUERY/STRING regexes want a worked example (iteration 10)
- add() drops rejected names silently; PAGE_SCOPE/stripComments exported without a consumer (iterations 11, 13)

### Strengths (across iterations)
- Three real escapes (#3985, #4095, #4131) replayed against their real commits; a missing commit fails rather than skips.
- Fail-safe selection: a selector failure still runs the allowlist, then fails the job.
- Only `^[\w-]+$` names that the driver can run are emitted, with a test; BASE_SHA goes through env.
- Reachability and built-label tests make the heuristic's blind spots fail loudly.
- Every new behaviour in iterations 5-10 was shown able to fail by a negative control.
