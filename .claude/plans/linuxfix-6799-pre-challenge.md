---
pre_challenge: true
method: challenge-loop
branch: linuxfix-6799
diff_hash: 49ca01ffffa91ae958e22ee78979feaa393660b28d380d094c8705f50f3798b2
validation: passed (Mortals, full suite: node 22816 tests 0 fail, shell all 264 passed)
subdir_audit: passed
timestamp: 2026-10-21T09:03:00Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11
**Converged:** Yes (iteration 11 raised only NITs)
**Total findings:** 26 (0 BLOCKERs, 15 WARNINGs, 3 CONVENTIONs, 8 NITs acted on or recorded; NITs listed below)
**Fixed:** 10 | **Deferred:** 8 | **Asked (awaiting user):** 0

Scope: the whole branch vs origin/main (2448d08597), which includes #6795's (#6791) commits because this branch is
stacked on shelllinux-6791. The 6.0 initial validation ran on Mortals in parallel with iteration 1 (the reviewer only
reads code); its red was two #6668 watchdog failures that main had already fixed (81cb1b84a5), cleared by rebasing.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (no loop commit yet)
- [WARNING] tools/lib/cut-guard.sh:_kosmos_pgrep_cmdlines: procps pgrep lists the caller's ancestors (its `$( )` subshells), so on Linux kosmos_refuse_if_cut_live's single-pid exclusion would see release.sh as a second cut --> FIXED (caa9c7ac21, rebased from 247ffe62b1): the helper drops the caller's ancestor chain on Linux; arm with control and raw-lineage count
- [WARNING] tools/lib/test-time-scale.sh: the time scale went live on Linux with cores still hw.ncpu-or-4 --> FIXED (caa9c7ac21): cores from kosmos_cpu_count; arm with a control on the old lib
- [NIT] cut-guard.sh: uname fork --> taken ($OSTYPE)
- [NIT] test.yml: stale counts --> taken
- [NIT] ci-runner-setup.sh: stale pgrep comment --> taken
- [NIT] run-tests.sh banner omits the platform --> left

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the BASHPID start point, a code line from caa9c7ac21)
- [WARNING] .github/workflows/test.yml: apt-get with no retry --> DEFERRED (repo precedent), later FIXED in iteration 3
- [WARNING] tools/lib/cut-guard.sh: `${BASHPID:-$$}` misses the subshell on bash 3.2 --> FIXED (28381c639b): `exec sh` PPID fallback; running the Linux branch on bash 3.2 also found a bare-`)` case pattern inside `$( )` that fails to parse at run time (`bash -n` passes) --> FIXED, with host-bash arms and a control
- [NIT] x3 --> left (ps per hop, Linux sysctl stdout, header count)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/shell-macos-only.txt / test.yml: product shell code's GNU-only forms are no longer seen by PR CI on macOS --> FIXED as recorded: list header names the gap; lint filed as #6808
- [WARNING] tools.shell-shard-4317.test.js: the platform-forward test waited on another suite's machine claim (120 s timeout) --> FIXED (8769842590): the same three overrides test-runner-scale-export-5727 uses
- [WARNING] test.yml: apt retry (re-raised with a new reason) --> FIXED (8769842590)
- [NIT] x5 --> 3 taken (pgrep `$( )` assumption comment, time-scale arm at 1 core, test.yml wording), 2 left

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above (the `$$` last resort, a code line from 28381c639b; deferred)
- [WARNING] tools/shell-macos-only.txt: header counts unasserted --> FIXED (e2dd41f94a): asserted against the parsed list with an off-by-one control
- [WARNING] tools/lib/cut-guard.sh: `$$` last resort --> DEFERRED: needs no BASHPID and no runnable sh
- [CONVENTION] launchagent-leak-guard.sh: does GNU `stat -f FMT file` exit 0 --> DEFERRED: no (missing second operand), measured in slice 1
- [NIT] x3 --> 2 taken, 1 left

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (the iteration-2 host-bash arm, test code)
- [WARNING] tools/test-running-anchor-5470.sh: the host-bash arm could not see a walk started at `$$` --> FIXED (a151c6b49e): the stub lists the calling subshell; mutant (start forced to `$$`) fails the arm
- [NIT] x6 --> 4 taken (linux.yml header, test.yml runner count, twin-reader comment, count-comment wording), 2 left

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] test.yml: renamed job `suite (shell macOS)` --> DEFERRED on measurement: ruleset 25277985 requires only test, windows, scope; no reference to the old name
- [WARNING] shell-shard.js: macOS share size unasserted --> DEFERRED on measurement: 110 syntax checks took 0.2 s in all (run 39551114754)
- [NIT] x2 --> left

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the iteration-3 header line, prose)
- [WARNING] tools/shell-macos-only.txt: the unguarded direction also covers bash 4+ syntax under bash 3.2 --> FIXED (13528a1104): header names both classes; constructs added to #6808; measured none in install/ or bin/
- [NIT] cut-guard.sh: an inherited non-darwin OSTYPE sends a Mac to `pgrep -fa` (fails open) --> taken (13528a1104): uname decides; arm with control
- [NIT] x3 --> 2 taken, 1 left

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs (1 duplicate), 2 NITs (duplicates)
**Self-generated:** 1 of the above (the iteration-1 helper; deferred)
- [WARNING] cut-guard.sh: dropping the whole ancestor chain could hide a parent run --> DEFERRED: a run that is an ancestor of the caller is the caller's own run (#1391 self-subtree), matching macOS pgrep

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/shell-macos-only.txt: slice 4 left PR CI with no real macOS pgrep run (the branch the release guards use) --> FIXED (f9f14ad873): `both:` lines; test-running-anchor-5470 runs on both platforms; marker pinned with a control
- [NIT] x3 --> 2 taken, 1 left

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [CONVENTION]: reviewer skimmed two test bodies, no defect reported --> DEFERRED (not a finding)
- [NIT] test-time-scale.sh: the fallback lost `|| echo 4`, so set -e callers ended on a failed sysctl --> taken (0c041722c1): errexit-safe; arm with a control on the previous lib

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/cut-guard.sh | BRANCH | Linux pgrep lists the caller's ancestors | FIXED | caa9c7ac21 |
| 2 | 1 | WARNING | tools/lib/test-time-scale.sh | BRANCH | Linux time scale with cores hardcoded | FIXED | caa9c7ac21 |
| 3 | 2 | WARNING | .github/workflows/test.yml | BRANCH | apt-get with no retry | FIXED | 8769842590 |
| 4 | 2 | WARNING | tools/lib/cut-guard.sh | SELF | BASHPID start point on bash 3.2 (+ case parse) | FIXED | 28381c639b |
| 5 | 3 | WARNING | tools/shell-macos-only.txt | BRANCH | GNU-only product code unguarded in PR CI | FIXED | 8769842590, #6808 |
| 6 | 3 | WARNING | tools.shell-shard-4317.test.js | BRANCH | forward test waits on a machine claim | FIXED | 8769842590 |
| 7 | 4 | WARNING | tools/shell-macos-only.txt | BRANCH | header counts unasserted | FIXED | e2dd41f94a |
| 8 | 4 | WARNING | tools/lib/cut-guard.sh | SELF | `$$` last resort | DEFERRED | needs no sh at all |
| 9 | 4 | CONVENTION | tools/lib/launchagent-leak-guard.sh | BRANCH | GNU stat -f exit status | DEFERRED | measured nonzero |
| 10 | 5 | WARNING | tools/test-running-anchor-5470.sh | SELF | host-bash arm blind to the start point | FIXED | a151c6b49e |
| 11 | 6 | WARNING | .github/workflows/test.yml | BRANCH | renamed macOS job | DEFERRED | ruleset measured |
| 12 | 6 | WARNING | tools/shell-shard.js | BRANCH | macOS share size | DEFERRED | 0.2 s measured |
| 13 | 7 | WARNING | tools/shell-macos-only.txt | SELF | bash 4+ syntax also unguarded | FIXED | 13528a1104 |
| 14 | 8 | WARNING | tools/lib/cut-guard.sh | SELF | ancestor drop could hide a parent | DEFERRED | by design, #1391 |
| 15 | 9 | WARNING | tools/shell-macos-only.txt | BRANCH | no real macOS pgrep run in PR CI | FIXED | f9f14ad873 |
| 16 | 10 | CONVENTION | tools/test-running-anchor-5470.sh | BRANCH | skimmed, no defect | DEFERRED | not a finding |
| 17 | 10 | NIT* | tools/lib/test-time-scale.sh | SELF | errexit regression | FIXED | 0c041722c1 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations, left)
- [NIT] run-tests.sh banner omits the platform (iteration 1)
- [NIT] one `ps` per ancestor hop on Linux (iterations 2, 5, 6, 8, 10)
- [NIT] a Linux sysctl printing to stdout with rc 0 (iterations 2, 8)
- [NIT] forPlatform's `mac` seam caller list undocumented (iteration 4)
- [NIT] `--only` refusal does not name KOSMOS_SHELL_PLATFORM (iteration 5)
- [NIT] kosmos_test_time_scale load fallback without the guard sourced (iteration 7)
- [NIT] test-browser-run-guard chmod after a failed sed (iteration 9)
- [NIT] header narrative omits the both: return; forPlatform mac-without-both seam; exported darwin OSTYPE on Linux; the `$( )` no-extra-shell premise under a caller's EXIT/ERR trap (evidenced by green Linux shards, not pinned) (iteration 11)

### Strengths (across all iterations)
- One helper owns the macOS/Linux pgrep difference; no armed release guard changed (iterations 1-11)
- Every move to Linux is backed by a named ubuntu-latest probe run, alone and through run-tests.sh (iterations 1, 3, 5, 9)
- The macOS-only list fails loudly on a stale line and its header counts are asserted (iterations 1, 6, 9)
- Tests carry controls and mutants that show each new arm can fail (iterations 5, 7, 9, 11)
