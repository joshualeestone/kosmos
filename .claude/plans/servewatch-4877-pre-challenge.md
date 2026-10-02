---
pre_challenge: true
method: challenge-loop
branch: servewatch-4877
diff_hash: 053f4289420da93f8631826faecff10f1b477c81cd0b78926b917e4a1d9e2f26
validation: focused at head 7cc6c09eb on origin/main 2f6a91e06: tools.serve-watch.test.js (49) and tools.gap-alarm.test.js, plus fixture-discipline, cli.sandbox-data-4796, no-brand-refs-1881, no-name-refs-3071, tool-guard-4326, all-node-tests-considered-1934, every-test-runs, no-phone-home-4253: 132 run, 0 failed. No other test reads tools/serve-watch.js. Every fix from rounds 9 to 16 was reverted once and failed a test (measured). A read-only --check against the live sites at this head: healthy, 10 files, exit 0. A full run of this head is to follow on Agent1s.
subdir_audit: passed
timestamp: 2026-10-01T20:30:11Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16
**Converged:** Yes (iteration 16: nothing above NIT)
**Fixed:** every BLOCKER and WARNING below | **Deferred:** 1 (relay canary name reservation, a kosmos-relay change) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iterations 1 to 8 (before the 10:00 outage; commits 5bfc5c959 to 8cdf0b54f)
- 1: a Windows staging false alarm (BLOCKER) -> FIXED (the fixed-name zip held only to latest-win.json)
- 2 to 3: relay canary moved from a real computer (sleeps) to a name that never exists; the no-state guard runs first; a mismatch needs two sightings (a promote writes parts one by one) -> FIXED
- 4 to 6: a lasting mismatch stays an alarm; what a run did not compare is carried; records for unnamed files pruned; a first sighting exits 2 in both modes -> FIXED
- 7: a second negative control on R2 for the Windows files; records kept while a pointer fails; files with no etag/length re-hashed every run -> FIXED
- 8: the feed judged by status (it outgrows the body cap; HEAD answers 405) -> FIXED

#### Iteration 9 (opus)
- [WARNING] a catch-all download site hid real failures behind "could not tell" -> FIXED (failures still alarm)
- [WARNING] a second problem flapping beside a standing one posted every run -> FIXED (later superseded, iteration 11)
- [WARNING] a pending key for a file named but no longer compared was carried forever -> FIXED (carried only while a comparison is owed)
- [NIT] x2 -> FIXED

#### Iteration 10 (opus)
- [WARNING] under a catch-all, this run's hashes and first sightings were dropped (re-download every run; a mismatch never confirmed) -> FIXED
- [WARNING] one problem replaced by another posted the same text twice -> FIXED
- [NIT] x2 (hold lost across an unknown run; no-state mode untested) -> FIXED

#### Iteration 11 (opus)
- [WARNING] a problem down one run in three still posted about 64 times a day -> FIXED (the hold is now an hour of clock time, not a run count; posts only on a new problem or the 6-hour repost)
- [WARNING] a throw in the checks silenced the watch -> FIXED (it is "could not tell", posted after the grace; verified with a planted fault)
- [NIT] x3 (a second sighting reused the first read; double retry; false log line) -> FIXED. My first re-read fix copied the reviewer's inverted condition; its new test failed and caught it.

#### Iteration 12 (opus)
- [WARNING] the live feed's GET had no retry (my iteration-11 NIT fix removed it) -> FIXED
- [WARNING] a failed first post lost its retry when the problem came and went -> FIXED
- [NIT] x2 (no-state window as long as the interval; a stale comment) -> FIXED

#### Iteration 13 (opus)
- [WARNING] an all-clear on a run with an unconfirmed mismatch -> FIXED (also the weekly line)
- [WARNING] claude-msg exit 8 (a possible loss) counted as told -> FIXED (8 is a failure, retried; 7 stays told). gap-alarm had the same: #4898, PR #4900.
- [NIT] x3 -> FIXED

#### Iteration 14 (opus)
- [WARNING] a stale Mac fallback tarball (kosmos-arm64.tar.gz, the #1669 shape) read as healthy -> FIXED (held to latest.json through the two-sighting rule)
- [NIT] x2 -> FIXED

#### Iteration 15 (opus)
- [WARNING] Kosmos.pkg, the home page's Mac download button, was not watched -> FIXED
- [NIT] shas compared case-insensitively where the installers do not -> FIXED
- [NIT] relay canary name not reserved in kosmos-relay -> DEFERRED (a kosmos-relay change; named as the plan's weakest premise)
- [NIT] relay source paths not in this repo -> FIXED
- Disclosure: the commit for this round broke the test file (a regex closed by a sed edit); the next commit fixed it, and the mutant runs were repeated with the test count printed.

#### Iteration 16 (sonnet)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] latest-win.json without the fixed-name zip would leave the home page's Windows download unwatched -> FIXED (refused as a pointer-shape problem; staging may still omit it)
- [NIT] a server's sidecar text in the pane message -> accepted (sanitised, capped)
- [NIT] a partly offline computer posts dist-down -> accepted (the plan's stated behaviour)
**Converged** - no new actionable findings.
