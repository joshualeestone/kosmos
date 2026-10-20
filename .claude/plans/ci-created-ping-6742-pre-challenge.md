---
pre_challenge: true
method: challenge-loop
branch: ci-created-ping-6742
diff_hash: 438006a499ad986a692f6cfae0c8b95aef499acdfd251d670c65986cfbb8ed00
validation: passed (full suite green except 2 contention-only #6668 watchdog reds, both green-alone 16/16 and not in the diff; see Validation)
subdir_audit: passed
timestamp: 2026-10-20T19:58:24Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind passes (reviewer models sonnet / opus / sonnet / opus)
**Converged:** Yes (iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 11 NITs, 1 CONVENTION (the launchd/win32 residual, ruled out of scope)
**Fixed:** 2 WARNINGs + 6 NITs | **Deferred:** 1 WARNING (verified non-issue) + 5 NITs + 1 CONVENTION | **Asked (resolved):** 1 (launchd/win32 scope, ruled by the PM: document + follow-up)

### Validation

Full `tools/run-tests.sh` at the head (eda56276) under a heavily contended box (the
post-lift fleet rush, 1-min load 9 to 97 across attempts): exit 1, **22566 tests, 22241
pass, 2 fail**. Both failures are the #6668 watchdog pair in
`tools.run-tests-file-timeout-6668.test.js`:
- `#6668 a runner sent TERM leaves no watchdog`
- `#6668 a runner stopped by Ctrl-C (INT to its group) leaves no watchdog`

Both are CONTENTION / in-suite-nesting flakes, not defects, and NOT in this diff:
- Run ALONE they pass fast: the file gives 16/16 pass, 0 fail, each watchdog test ~1.5 s
  (vs timing out at 30 to 120 s inside the full suite). The file tests run-tests.sh's OWN
  per-file timeout watchdog, which nests badly inside the real suite's watchdog.
- `tools.run-tests-file-timeout-6668.test.js` is not a file this diff touches (the diff is
  the 9 workflows + tools/test-ci-created-url-6742.sh + package.json + this plan).
- Earlier higher-load attempts produced MORE reds (7 each), a DIFFERENT set each run
  (grok/layout/#4253/token/manifest/lock-retry/bridge/watchdog), all confirmed green-alone
  (133-test isolation batch: 0 fail) and none in the diff; the set shrinking to only the
  #6668 pair as load dropped is the contention signature.

The guard this PR adds (`tools/test-ci-created-url-6742.sh`) passed every run and in
isolation. Per the PM's standing rule, a red that passes alone and is not a diff file does
not block, and the GitHub CI run on the PR (fresh isolated runners) is the authoritative
"all checks green by name".

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
**Self-generated:** 0 (first reviewer pass; ITER_COMMITS empty of guard/workflow commits)
- [WARNING] setup.sh/launchd + win32 — a top-level env does not reach a launchd/win32 SERVICE board; only linuxboard injects --> ASKED the PM (scope), ruled: document + follow-up --> DEFERRED (out of scope, residual documented)
- [NIT] guard number-of-digits / step sentinel + empty-string coverage --> FIXED (6e3de97-era hardening and tests)
- [NIT] numeric edge cases --> DEFERRED (pre-existing, out of scope)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs
**Self-generated:** 0 acted on as SELF
- [NIT] Psych 4 safe_load rejects YAML anchors --> FIXED (dfb27ae: aliases:true + rescue ArgumentError fallback; Part B anchor fixture)
- [NIT] wrong top-level value folded into TOP_MISSING message --> FIXED (dfb27ae: distinct TOP_WRONG verdict)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** some NITs concerned guard lines earlier iterations wrote; handled as ordinary (test) fixes, not prose deletions
- [WARNING] guard does not scan run: bodies (a runtime re-set/unset of the var passes) --> FIXED (63f7d0d: header names the limit; a run:-scan would be fragile and test-linux-setup legitimately exports the same dead value via $GITHUB_ENV)
- [WARNING] test-linux-setup old-0.7.27 update path might start a board without the var --> DEFERRED (verified non-issue: the step injects the dead address into the old unit before systemctl start, :330-334; old kosmos knows no systemd)
- [CONVENTION] measured claim verified at workflow-text level, not spawned-script level --> FIXED (63f7d0d: plan states the spawned-script search explicitly)
- [NIT] reusable/subdir workflows out of scope / top compared as object / redundant GITHUB_ENV export --> DEFERRED (no current trigger / harmless)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [NIT] Part B missing NOT_MAPPING + step-level-OVERRIDE fixtures --> FIXED (eda5627: both added; full verdict coverage)
- [NIT] a future ${{ }} job/step value would false-red OVERRIDE --> DEFERRED (forward-looking, no current workflow; a job/step override of this var is suspect anyway)
**Converged** — no new actionable findings, witnessed by both models across 4 passes.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | setup.sh/win32 service boards | BRANCH | top-level env does not reach launchd/win32 service board | DEFERRED | PM ruled out of scope; residual documented + follow-up |
| 2 | 1 | NIT | guard + test | BRANCH | digit class / sentinel / empty-string coverage | FIXED | guard hardened + tests |
| 3 | 1 | NIT | guard | BRANCH | numeric edges | DEFERRED | pre-existing, out of scope |
| 4 | 2 | NIT | guard | SELF | Psych 4 rejects YAML anchors | FIXED | dfb27ae aliases:true + fallback |
| 5 | 2 | NIT | guard | SELF | wrong value folded into TOP_MISSING | FIXED | dfb27ae TOP_WRONG verdict |
| 6 | 3 | WARNING | guard header | BRANCH | does not scan run: bodies | FIXED | 63f7d0d header names the limit |
| 7 | 3 | WARNING | test-linux-setup-4920.yml:303-331 | BRANCH | old-setup path might start a board without the var | DEFERRED | verified covered (sed inject :331 before start) |
| 8 | 3 | CONVENTION | plan measured section | BRANCH | claim not at spawned-script level | FIXED | 63f7d0d explicit spawned-script search |
| 9 | 3 | NIT | guard / workflow | BRANCH | subdir workflows / object compare / redundant export | DEFERRED | no trigger / harmless |
| 10 | 4 | NIT | guard Part B | SELF | missing NOT_MAPPING + step-override fixtures | FIXED | eda5627 both added |
| 11 | 4 | NIT | guard OVERRIDE | BRANCH | future ${{ }} value false-reds | DEFERRED | forward-looking, no trigger |

### Outstanding questions (ASKED, still unresolved when the run ended)
None. The one ASKED finding (launchd/win32 scope) was ruled by the PM: keep this PR to
workflows + the systemd path, document the residual as a follow-up.

### NITs (non-blocking, deferred)
- numeric edges (0 / leading-zero / huge count) behave as before the change (pre-existing).
- reusable/subdir workflows under .github/actions are out of scope (none exist today).
- the redundant `$GITHUB_ENV` export in test-linux-setup-4920.yml:72 (the systemd model's proven path; harmless with the new top-level env).
- a future `${{ }}` job/step value for this var would false-red OVERRIDE (no current workflow; such an override is suspect anyway).

### Residual (follow-up card)
A parent-env dead address does not reach a macOS launchd or Windows win32 SERVICE board;
`install/setup.sh` (board plist, ~:5403) and `engine/win32board.js` do not inject the var,
only `engine/linuxboard.js:107` does. Out of this CI-ping card's scope (installer code);
real user installs must still count. The PM will file the follow-up from the plan's section.

### Strengths (across all iterations)
- The leak is closed for every CI board-start path: top-level env reaches step shells,
  in-process node and spawned children; linuxboard injects into the systemd unit.
- The guard parses the structural top-level env (not grep), so test-linux-setup's run:-only
  mentions correctly red; Part B proves red-capability on every verdict.
- Anti-vacuity: glob-vs-find count cross-check, >=1 floor, ruby-missing hard-fail under CI.
- No regression to real callers (night-shift.sh:1248 passes the numeric $POOL); the dead
  address matches the repo's canonical value (run-tests.sh:383, browser-checks.sh:85).
