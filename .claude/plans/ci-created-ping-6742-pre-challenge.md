---
pre_challenge: true
method: challenge-loop
branch: ci-created-ping-6742
diff_hash: 7a864bcd5258d3880345d03b91bd555e08b60ec2094fd02c0e6ae18f9d398465
validation: full suite exit 1 on contention-only reds (a different slow-test subset each run, all green-alone and none in the diff; see Validation); the guard this PR adds passes every run
subdir_audit: passed
timestamp: 2026-10-20T20:34:00Z
iterations: 5 (4 blind passes to convergence + 1 post-rebase confirm)
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind passes to convergence (sonnet / opus / sonnet / opus), then a 5th
blind pass after a rebase onto current origin/main (which pulled in #6667).
**Converged:** Yes (iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION; the post-rebase
5th pass also returned zero actionable).
**Total findings across the run:** 0 BLOCKERs, 3 WARNINGs, many NITs, 1 CONVENTION (the
launchd/win32 residual, ruled out of scope by the PM).
**Fixed:** 2 WARNINGs + the actionable NITs | **Deferred/verified-non-issue:** 1 WARNING + the
rest | **Asked (resolved by the PM):** 1 (launchd/win32 scope -> document + follow-up).

### Validation

The authoritative "all checks green by name" is the PR's GitHub CI (fresh isolated runners).
The LOCAL full `tools/run-tests.sh` was run FOUR times at the head on this shared Mac during
the post-lift fleet rush (1-min load 4.5 to 97). Every run exited 1 on a DIFFERENT subset of
7 to 8 slow tests (grok sign-in, #4253 beacon control, #6107/mobile-shots layout, #4530 token
adopt, token/manifest/lock-retry/bridge, and the #6668 watchdog pair), each 8 to 120 s under
the suite's load-driven 4x time-scale. That a different subset fails each run, every one a
slow test, is the contention signature.

Every one of those reds:
- passes GREEN ALONE: the latest run's 5 red files run in isolation gave 79/79 pass, 0 fail;
  an earlier 6-file isolation batch gave 133/133, 0 fail; the #6668 file alone gave 16/16
  (each watchdog test ~1.5 s vs 30 to 120 s in-suite).
- is NOT a file this diff touches. The diff is the 9 workflows + tools/test-ci-created-url-6742.sh
  + package.json + this plan; every red is in engine/supervisor/tools-other test files.

The guard this PR adds (`tools/test-ci-created-url-6742.sh`) PASSED in every full run and in
isolation. Per the PM's standing rule, a red that passes alone and is not a diff file does not
block; the latest full run was 22633 tests, 22302 pass, 8 contention reds (all green-alone).
The #6668 watchdog pair is an in-suite nesting flake (it tests run-tests.sh's own per-file
timeout watchdog, which nests badly inside the real suite); green alone, not a diff file.

### Per-Iteration Breakdown

#### Iteration 1 (sonnet)
New: 1 WARNING (launchd/win32 service board not covered by a parent env) --> ASKED the PM, ruled document+follow-up --> DEFERRED (residual documented); NITs fixed/deferred.
#### Iteration 2 (opus)
New: 2 NITs --> FIXED (aliases:true + ArgumentError fallback for Psych 3/4; distinct TOP_WRONG verdict).
#### Iteration 3 (sonnet)
New: 2 WARNINGs + 1 CONVENTION --> (a) guard does not scan run: bodies: FIXED by naming the limit in the header (a run:-scan is fragile; test-linux-setup legitimately exports the same dead value via $GITHUB_ENV); (b) old-0.7.27 setup path: DEFERRED, verified covered (dead address injected into the old unit at test-linux-setup-4920.yml:330-334 before systemctl start); (c) measured claim now stated at spawned-script level.
#### Iteration 4 (opus)
New: 0 actionable, 2 NITs --> FIXED (Part B gains NOT_MAPPING + step-level OVERRIDE fixtures; full verdict coverage). **Converged.**
#### Iteration 5 (opus, post-rebase onto #6667)
New: 0 actionable, 2 immaterial NITs (a verbatim comment on the no-board workflows android/ios/linux; a createdbeacon.js :138-vs-:139 off-by-one), both ruled not worth a change. Verified the rebase is clean: package.json valid with BOTH #6667's and this PR's test:shell entries; linux-systemd.yml has exactly one top-level env; the linuxboard.js injection survived #6667 growing the file (read :140, unit write :159) and the plan's citations were refreshed to match.

### Outstanding questions (ASKED)
None. The launchd/win32 scope was ruled by the PM: keep this PR to workflows + the systemd
path; document the residual as a follow-up card (sections below).

### NITs (non-blocking, deferred)
- numeric edges, reusable/subdir workflows, redundant $GITHUB_ENV export in
  test-linux-setup-4920.yml:72, a future `${{ }}` job/step value false-redding OVERRIDE.
- the uniform workflow comment is verbatim on android/ios/linux (no board); harmless.
- plan cites createdbeacon.js:138 (the underTest function) vs :139 (its return); immaterial.

### Residual (for the follow-up card)
A parent-env dead address does not reach a macOS launchd or Windows win32 SERVICE board;
`install/setup.sh` (board plist, ~:5403) and `engine/win32board.js` do not inject the var,
only `engine/linuxboard.js:159` does. Out of this CI-ping card's scope (installer code); real
user installs must still count. The PM will file the follow-up from the plan's section.

### Strengths
- The leak is closed for every CI board-start path (top-level env -> step shells / in-process
  node / spawned children; linuxboard.js:159 injects into the systemd unit).
- The guard parses the structural top-level env (not grep), so test-linux-setup's run:-only
  mentions correctly red; Part B proves red-capability on every verdict; anchor-tolerant for
  Psych 4; glob-vs-find count cross-check; ruby-missing hard-fail under CI.
- No regression to real callers; the dead address matches the repo canonical value
  (run-tests.sh:383, browser-checks.sh:85, test-install.sh:355).
- Rebase onto #6667 is integration-clean (verified by the 5th blind pass).
