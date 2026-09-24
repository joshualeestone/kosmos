---
pre_challenge: true
method: challenge-loop
branch: login-expiry-warn-3532
diff_hash: b569f1deb9245a9aad62fc0e4a487f1b32dcd645712d5b3a8d04cd536395e470
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T06:10:03Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (reviewer models: opus, sonnet, opus -- convergence witnessed by both models per kosmos#2032)
**Converged:** Yes -- iteration 3 surfaced no new BLOCKER/WARNING/CONVENTION after deferral.
**Total actionable findings:** 13 (2 BLOCKER, 6 WARNING, 4 CONVENTION, + 1 synthetic 6g validation finding)
**Fixed:** 11 | **Deferred:** 2 | **Asked (awaiting user):** 0
**Self-generated (kosmos#120):** 0 across all iterations -- no finding cited a line written by this loop's own fixes; the loop did not circle its own output.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 2 WARNING, 2 CONVENTION, 3 NIT
**Self-generated:** 0 (findings cite the original build commits, not loop fixes)
- [WARNING] .claude/plans + engine/status.js — plan said "pane_pid is the shell", code (measured) says pane_pid IS the claude process --> FIXED (reconciled the plan to the measured reality)
- [WARNING] engine/status.js — snapshot glue (computeLoginAdvisories/paneCcd/cache) untested --> FIXED (extracted cachedAdvisories + tests; integration test added iter 2)
- [CONVENTION] engine/loginexpiry.js — inline severity literals --> FIXED (URGENT_DAYS/WARN_DAYS/WARN_WITHIN_DAYS constants)
- [CONVENTION] plan filename missing -<timestamp> --> FIXED (renamed to login-expiry-warn-3532-20260923-215700.md, iter 2)
- [NIT] cachedAdvisories retry --> FIXED (no `at` advance on compute throw); [NIT] browser-check missing notice case --> FIXED

#### Iteration 2
**Reviewer model:** sonnet (a different model from iter 1 -- found real issues opus missed)
**New findings:** 2 BLOCKER, 3 WARNING, 2 CONVENTION, 2 NIT
**Self-generated:** 0
**Duplicates of prior findings:** the "snapshot glue untested" WARNING re-raised as a BLOCKER (iter-1 fix was partial) --> completed here
- [BLOCKER] web/index.html — dark-mode cascade: the (0,3,0) dark `.utoast --utone` override painted notice+warn salmon, collapsing the escalation in dark --> FIXED (restated tones under system-dark + regenerated forced-dark twin; added a dark-mode browser-check guard: notice tone != urgent tone)
- [BLOCKER] engine/status.js — integration glue untested --> FIXED (exported computeLoginAdvisories injectable; loginexpiry-snapshot-3532.test.js covers the isNamedOurs filter, grouping, cache, no-ours case)
- [WARNING] engine/loginexpiry.js — `security` call had no timeout: a Keychain consent prompt could freeze the synchronous board --> FIXED (timeout: 5000)
- [WARNING] web/index.html — warn used ad-hoc #c77700, no dark variant --> FIXED (theme-aware --warn-ink token)
- [WARNING] .github/workflows/browser-checks.yml — check missing from KOSMOS_BC_CI_ALLOWLIST (the 4th index), so it ran only at release-cut --> FIXED (added to the allowlist)
- [CONVENTION] CLAUDE.md — new engine module not in the Where-to-Find-Things table --> FIXED (added a row)
- [CONVENTION] commit subjects not in an accepted form --> DEFERRED (commits pushed; squash-merge moots them; the accepted `<branch> -- <msg>` form used from iter 2 on)
- [BLOCKER-synthetic 6g] fixture-discipline: the new integration test hand-typed tab-separated pane lines --> FIXED (rewritten to test-support/fleet.line)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 3 NIT
**Self-generated:** 0
- [WARNING] engine/status.js — serial ps/security work on the synchronous /api/status poll path on the 5-min recompute tick --> DEFERRED (acceptable by design and by the reviewer's own analysis: TTL-cached, 5s-timeout-bounded, fail-soft, last-good, and consistent with snapshot's existing per-pane tmux fan-out)
- **Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | plan/status.js | BRANCH | plan/code pane_pid contradiction | FIXED | 0ef274be |
| 2 | 1 | WARNING | status.js | BRANCH | snapshot glue untested | FIXED | 0ef274be + 0c370370 |
| 3 | 1 | CONVENTION | loginexpiry.js | BRANCH | inline severity literals | FIXED | 0ef274be |
| 4 | 1 | CONVENTION | plans/ | BRANCH | plan filename no timestamp | FIXED | 0c370370 (renamed) |
| 5 | 2 | BLOCKER | web/index.html | BRANCH | dark-mode severity cascade | FIXED | 0c370370 |
| 6 | 2 | BLOCKER | status.js | BRANCH | integration glue untested | FIXED | 0c370370 |
| 7 | 2 | WARNING | loginexpiry.js | BRANCH | security call no timeout (board freeze) | FIXED | 0c370370 |
| 8 | 2 | WARNING | web/index.html | BRANCH | warn ad-hoc hex, no dark variant | FIXED | 0c370370 |
| 9 | 2 | WARNING | browser-checks.yml | BRANCH | missing CI allowlist entry | FIXED | 0c370370 |
| 10 | 2 | CONVENTION | git log | BRANCH | commit subject form | DEFERRED | pushed + squash-merge; corrected form used since |
| 11 | 2 | CONVENTION | CLAUDE.md | BRANCH | module not in find-table | FIXED | 0c370370 |
| 12 | 2 | BLOCKER(6g) | loginexpiry-snapshot test | BRANCH | hand-typed pane lines (fixture-discipline) | FIXED | 0c370370 (fleet.line) |
| 13 | 3 | WARNING | status.js | BRANCH | serial ps/security on poll path | DEFERRED | acceptable by design (TTL + 5s timeout + fail-soft + last-good) |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html grammar "N agents' login expires" (iter 1) --> DEFERRED: "login" is the singular shared subject, so the singular verb is correct.
- [NIT] engine/loginexpiry.js ccdFromPsEnv truncates a config-dir path containing a space (iter 1/2) --> documented (comment; matches runningas.js; ps env is space-separated so unparseable anyway; no fleet dir has spaces).
- [NIT] loginexpiry.js emits ccd/service to the client with no current consumer (iter 3) --> DEFERRED: harmless (local board, path not secret); `service` has test/debug utility.
- [NIT] web/index.html comment "notice >=5d" vs actual 4-5d, same in the browser-check header (iter 3) --> recorded (minor comment imprecision; both convey "not urgent, a few days out").
- [NIT] redundant explicit dark urgent restatement (iter 3) --> DEFERRED: intentional defensive consistency with the notice/warn/stale pattern.

### Strengths (across all iterations)
- Secret discipline verified: refreshExpiryFor returns only the numeric timestamp; the raw credential is never logged/returned/threaded; a dedicated test asserts a number, not the object.
- #2129 set-vs-unset keying correct and defensive: keys on the agent's LIVE process CCD (not the collapsing job.configDir), hashes verbatim, and skips (undefined) vs genuinely-unset (null) so no wrong-account warning can be emitted; byte-exact measured hashes.
- Fail-soft throughout with a well-designed TTL cache (last-good on throw without advancing `at`); all seams injectable; negative controls and a real filter/exclusion control in the integration test.
- Four browser-check indices consistent (runner, README, CI allowlist) with the reason-grep count correctly unchanged (ternary-prefix emit not counted); the dark-mode guard closes the classList/text blind spot.
