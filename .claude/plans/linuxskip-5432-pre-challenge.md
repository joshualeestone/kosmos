---
pre_challenge: true
method: challenge-loop
branch: linuxskip-5432
diff_hash: 5bf94e70a98b0eab3cc8faae387ca9b9135fd1e7ff5dd8c1edb29ac590994162
validation: rebased on origin/main 2026-10-07T18:49:03Z; the 54 changed test files: macOS 1429 pass, 0 fail, 0 skipped; forced Linux (process.platform preload, child boards included) 1311 pass, 5 fail, 113 skipped, the 5 all in linux.yml's expected list (#5419: connect.hookwiring-1569, server.runners); file-scanning and Windows guards 70/0. Real Linux lane (linux.yml, run 37661055583 at 001cdd25b): 9 files / 114 tests failing, all in the expected list; re-run on the final head in flight. Full suite on CI.
subdir_audit: not run (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-07T18:49:03Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11 (alternating opus and sonnet)
**Converged:** Yes (iteration 11: NITs only)
**Total findings:** 0 BLOCKERs, about 30 WARNINGs, plus NITs
**Fixed:** all WARNINGs (some by stating a limit plainly and filing #5500) | **Asked:** 0

Card #5432: Linux port B (#4918) gave agents a systemd unit, so ~446 tests failed on a Linux host. Sandboxes get a unit
folder, a shared fixture writes the platform's own job, launchd tests skip on Linux only, many are ported, one product
fix (undoing an add on Linux removes the unit). Follow-up #5500 lists every behaviour not yet tested on Linux.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] six fixture-only tests skipped (adopt controls, name guards) --> FIXED: ported (readJob; notARead)
- [WARNING] undo fix swallowed the live-execution refusal; no test on Mac --> FIXED: rethrow; test on every platform, measured red without the fix
- [WARNING] SYSTEMD_DIR lifts linuxjob's sandbox refusal --> STATED in the plan

#### Iteration 2 (sonnet)
- [WARNING] skip reasons over-claimed Linux cover --> FIXED: 104 skips classified; 73 fixture-only say not tested on Linux yet, FILED #5500
- [WARNING] -discord guard skipped with the leftover-plist half --> FIXED: split, runs on Linux
- also: cli.sandbox-4636 listener test (the one unexpected lane red) fixed test-side

#### Iteration 3 (opus)
- [WARNING] eight launchd-subject reasons named non-existent Linux cover --> FIXED: say NOT tested on Linux yet; #5500 updated

#### Iteration 4 (sonnet)
- [WARNING] more over-claimed covers --> FIXED the class: reasons claim specific cover only where checked; #4279 = no Linux equivalent

#### Iteration 5 (opus)
- [WARNING] "tested on macOS and Windows" false (most skip on Windows) --> FIXED: "tested on macOS"; copied headers corrected

#### Iteration 6 (sonnet)
- [WARNING] child boards and real systemctl --> checked; plan states it

#### Iteration 7 (opus)
- [WARNING] two shared reasons still implied cover --> FIXED; my iteration-6 plan claim about child processes was wrong, corrected from the code

#### Iteration 8 (sonnet)
- [WARNING] stale plan items --> FIXED

#### Iteration 9 (opus)
- [WARNING] switch helpers read plist-only, vacuous on Linux --> FIXED via create.readJob; 5 tests un-skipped

#### Iteration 10 (sonnet)
- [WARNING] two files check the macOS plist path on Linux --> FIXED; then a repo-wide sweep (331 hits) fixed 5 more

#### Iteration 11 (opus)
**New findings:** NITs only. **Converged.**

### NITs (non-blocking, iteration 11)
- create.test.js "a folder left behind" checks for 'bootstrap', which a Linux start never sends (its other assertions still guard it)
- one #4279 test's skip reason is overwritten by NO_SECOND_SPELLING on Linux (still skips, truthfully)
- server.test.js route-foreign fixture writes a plist nothing reads on Linux (no note, unlike its twin)
- jobPathIn assumes the child has no SYSTEMD_DIR, unchecked
- the disconnect test's refusal arm leaves its profile half-cleared (last test in the file)

### Strengths
- Over-skip check: with every #5432/#5500 skip removed under forced Linux, 61 of 72 create.test.js skips fail and none pass
- macOS byte-identical: jobPath/jobFor delegate to plistPath/plistFor; no new skip fires off Linux
