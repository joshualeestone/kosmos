---
pre_challenge: true
method: challenge-loop
branch: restoreguard-win32-7593
diff_hash: 378c00673a00930437e049206909a269b08e00645c2a39e8eb1a78be0f0365d5
validation: local only, substituted (npm is not on this box): engine/win32launch.restoreguard-7593.test.js 8/8, engine/win32launch.restoreguard-wiring-7593.test.js 6/6, win32launch 42/42, win32codexsup 11/11, win32signin 32/32, win32supervisor 64/64, policy tests (engine.reachable 8/8, windows-coupling-audit-1732 8/8, win32-separator-guard 4/4, fixture-discipline 20/20, no-name-refs-3071 4/4, windows-tests-1777 24/24), all through the no-schtasks preload on dac09799ad; earlier on this branch also win32agy, win32keyed, codexhooks.win32-8348, create.win32-job-read, restoreworld-5536, win32codexsup idle and integration; the full suite runs on the PR's CI
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-11T19:21:13Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes. Iteration 4 raised NITs only (no BLOCKER, WARNING or CONVENTION).
**Total actionable findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs (plus NITs)
**Fixed:** 1 BLOCKER, 4 WARNINGs | **Deferred:** 0 | **Asked:** 0

The last suite ran on dac09799ad (the head this proof covers).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [BLOCKER] engine/win32codexsup.js the per-turn supervisor (codex, gemini, grok, antigravity) builds its env with childEnv and no opts, so those agents never got the guard --> FIXED (f39fe4aa2e), with wiring tests through the real code; removing the argument fails three arms (control run)
- [WARNING] no test that the spawn sites pass restoredLaunch --> FIXED (f39fe4aa2e): engine/win32launch.restoreguard-wiring-7593.test.js
- [WARNING] tests did not clear an inherited KOSMOS_WORLD / KOSMOS_PRE_WORLD_ROOTS --> FIXED (f39fe4aa2e)
- [NIT] ordinary agent losing inherited GIT_CONFIG_* differs from the Mac --> FIXED (comment and plan)
- [NIT] GIT_CONFIG_PARAMETERS precedence --> FIXED (comment: documented, left as the person set it)
- [NIT] GIT_GUARD_KEYS declared after use --> FIXED

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] rule 1 never tested with the world already applied to the env, the state a real launch is in (the Mac half's first bug) --> FIXED (8c7196eb38); reading the base without preWorldEnv fails the new arm (control run)
- [NIT] a doubtful lstat reads restored with no log line --> KEPT, decided in the plan
- [NIT] NUL relies on Git for Windows --> noted in the plan
- [NIT] the sign-in child also drops inherited GIT_CONFIG_* --> noted in the plan

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] a module that failed to load made every ordinary (default-world) agent fail closed --> FIXED (dac09799ad): the world name read from the env, the mark name a constant pinned by a test; only a named world fails closed, as on the Mac
- [NIT] plan test count --> FIXED
- [NIT] grok named but not tested --> FIXED (in the wiring loop)
- [NIT] rule-1 tests skipped off Windows --> FIXED (they run on every host)
- [NIT] long comment block --> KEPT

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs (all left unapplied, so this proof covers the reviewed code)
- [NIT] GIT_GUARD_KEYS is an exported mutable array; freeze it
- [NIT] remove an inherited GIT_CONFIG_PARAMETERS when restored (documented choice to leave it)
- [NIT] the per-turn supervisor's `o.env` test seam skips the guard (no production caller passes it)
- [NIT] the real-git test reads the host's global gitconfig (commit.gpgsign=true on a dev box would fail it; CI runners unaffected)
