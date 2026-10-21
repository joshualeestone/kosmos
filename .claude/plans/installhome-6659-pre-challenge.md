---
pre_challenge: true
method: challenge-loop
branch: installhome-6659
diff_hash: daa9c07f32e24c26a530a76ab7425761963f387a4deecaad156e0190d981d0b4
validation: passed
subdir_audit: passed
timestamp: 2026-10-20T23:01:00Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 9 (1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 1 BLOCKER, 3 WARNINGs, 1 NIT | **Deferred:** 2 WARNINGs (one a duplicate of a stated decision) | **Asked (awaiting user):** 0

Final validation (6j): Mortals (mortals-validate), entry "status":"clean", hash daa9c07f (equals this diff), 22346 tests,
22029 pass, 0 fail (2026-10-20 17:59 CDT). Three earlier full runs were red on DIFFERENT tests each time, every one of
which passed alone: 1 fail at Mortals load 17.6 (server.phonenotify-718), 9 at load 24.4 (8 cli.* plus phonenotify), 1 at
Agent1s load 8.1 (engine/create.test.js #1704, a 20 s spawn timeout; 3 s alone). No test failed twice except
phonenotify-718, which passed alone 3 of 3. Recorded in ~/.cache/claude-handoffs/baron-jobs/ledger-6659.md.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (before a restart; not recorded)
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/update.js: installedRoot() resolves links, but setup.sh tells copies apart by path string --> FIXED (876a19fbe0: KOSMOS_INSTALLED_HOME, asTheInstallerNamesIt)

#### Iteration 2
**Reviewer model:** unknown (before a restart; not recorded)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/update.js: installedHomeAsInstalled was untested --> FIXED (f65a85b497)
- [WARNING] plan: the transition gap was not stated --> FIXED (f65a85b497)

#### Iteration 3
**Reviewer model:** unknown (before a restart; not recorded)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js: agents inherited KOSMOS_INSTALLED_HOME; the first test used the real HOME --> FIXED (8fc37c558b)
- [WARNING] manifest-verify.js: the inherited KOSMOS_HOME of a non-launchd board --> DEFERRED: kept on purpose, stated in the plan (Linux tests and the systemd unit depend on it)

#### Iteration 4
**Reviewer model:** unknown (before a restart; not recorded)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [NIT] the older-launcher case for a linked non-default home --> FIXED (26b70ad397, stated in the plan)

#### Iteration 5
**Reviewer model:** sonnet (orchestrator opus)
**New findings after dedup:** 0
**Self-generated:** 0 of the above
- [WARNING] server.js:71 early require('./engine/update') before dropInheritedTmux --> DEFERRED: update.js at module scope requires only fs/os/path/child_process, ./live-execution, ./platform, ./updating (lazy inside functions) and package.json; nothing reads tmux at load
- [WARNING] manifest-verify.js:164 KOSMOS_HOME leaks to a --force board --> DUPLICATE of iteration 3's stated decision
- [WARNING] manifest-verify.js:128 no test of the "default path missing" arm --> DEFERRED: covered by the first #6659 test (HOME is a fresh empty mkdtemp, so realpathSync of the default throws on every run and the home must pass through unchanged, asserted)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/update.js | BRANCH | link-resolved home vs setup.sh path identity | FIXED | 876a19fbe0 |
| 2 | 2 | WARNING | engine/update.js | BRANCH | installedHomeAsInstalled untested | FIXED | f65a85b497 |
| 3 | 2 | WARNING | plan | BRANCH | transition gap unstated | FIXED | f65a85b497 |
| 4 | 3 | WARNING | server.js | BRANCH | agents inherit KOSMOS_INSTALLED_HOME | FIXED | 8fc37c558b |
| 5 | 3 | WARNING | manifest-verify.js | BRANCH | inherited KOSMOS_HOME, non-launchd | DEFERRED | kept on purpose, in plan |
| 6 | 4 | NIT | engine/update.js | BRANCH | older launcher, linked home | FIXED | 26b70ad397 |
| 7 | 5 | WARNING | server.js:71 | BRANCH | early require before dropInheritedTmux | DEFERRED | nothing reads tmux at load |
| 8 | 5 | WARNING | manifest-verify.js:164 | BRANCH | KOSMOS_HOME to a --force board | DEFERRED | duplicate of #5 |
| 9 | 5 | WARNING | manifest-verify.js:128 | BRANCH | default-path-missing arm untested | DEFERRED | covered by the first test |

### NITs (non-blocking, across all iterations)
- [NIT] install.setup-sig-6468.test.js:171 source-text pins are brittle (iteration 5)
- [NIT] update.js:541 the realpath catch fallback could use a word (iteration 5)

### Strengths (across all iterations)
- A measured red-before fix with both environment arms (iteration 5)
- Path-string identity handled as the installer names it, not as the filesystem resolves it (iteration 5)
- The plan states its weakest premise (iteration 5)
