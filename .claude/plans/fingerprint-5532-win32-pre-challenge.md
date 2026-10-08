---
pre_challenge: true
method: challenge-loop
branch: fingerprint-5532-win32
diff_hash: 65e32402f8ccf8ebed5d4417774a647b95449c9b8cd32b277b63a14fb65a61de
validation: passed (targeted, with the no-schtasks preload: engine/computerprint-5532.test.js 8 pass + 1 Mac skip, engine/windows-tests-1777 23/23, engine.reachable, comment-deferral, fixture-discipline, no-brand-refs-1881, no-name-refs-3071, tools.no-phone-home-4253, bundle.execbit-4134, all green; worktree clean. NOT the whole suite: on this Windows box it makes real scheduled-task calls. install.reachable-1662 excluded: it fails 39/46 identically on the untouched base branch here, a shell syntax error from this box's sh, unrelated to this diff)
subdir_audit: passed
timestamp: 2026-10-08T03:43:25Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (each a fresh blind reviewer; diff reviewed = origin/fingerprint-5532...HEAD, the branch is stacked on the Mac half)
**Converged:** Yes (iteration 5: no BLOCKER, WARNING or CONVENTION; 3 NITs, 1 taken)
**Total findings:** 13 actionable (1 BLOCKER, 6 WARNINGs, 3 CONVENTIONs, plus 3 MINOR test findings counted with the WARNINGs below as test gaps) and 9 NITs
**Fixed:** 12 | **Deferred:** 1 (then fixed in iteration 2) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (blind review of the first draft, plus the orchestrator's posture check)
**New findings:** 1 BLOCKER, 2 WARNINGs (reported as MINOR), 1 CONVENTION, 2 NITs
- [BLOCKER] engine/computerprint-5532.test.js:56 — the new win32 host branch was in neither ALSO nor HOST_BRANCH_EXCLUDED, so the #1777 audit (engine/windows-tests-1777.test.js) went red on every platform and the real-registry arm would never run on Windows CI --> FIXED (102d4c837: tools/windows-tests.js ALSO)
- [WARNING] engine/computerprint-5532.test.js:57-58 — assert.equal on the real id would print the raw MachineGuid on failure --> FIXED (102d4c837: assert.ok)
- [WARNING] engine/computerprint.js:62 — the real reg.exe path and arguments were never asserted; a dropped /reg:64 or a bare 'reg' would pass every fixture test --> FIXED (102d4c837: REG_ARGS + regExe() exported and pinned)
- [CONVENTION] .claude/plans/fingerprint-5532-win32.md — no **Posture:** stamp; pre-challenge-gate would block --> FIXED (f25cc5dd0)
- [NIT] engine/computerprint-5532.test.js:3 — stale header --> FIXED (102d4c837)
- [NIT] engine/computerprint.js — one timeout caches null for the run --> DEFERRED (matched the Mac arm and the spec), REOPENED and FIXED in iteration 2

#### Iteration 2
**New findings:** 1 WARNING, 1 CONVENTION, 3 NITs
- [WARNING] engine/computerprint.js:63-70 — a failed read cached as null until restart; at logon (Defender scans) a single reg.exe timeout would leave the board with no print for the whole run --> FIXED (ed1ca8852: keep only a success)
- [CONVENTION] engine/computerprint.js:42 — path.join where every other System32 resolver uses path.win32.join (+ windir fallback) --> FIXED (ed1ca8852)
- [NIT] engine/computerprint-5532.test.js:62 — the stability assert read the cache, so it proved nothing --> FIXED (ed1ca8852: two fresh reads)
- [NIT] engine/computerprint.js:47 — ^\s* under /m can start on a blank line --> FIXED (ed1ca8852: [ \t]*)
- [NIT] plan — test counts differ by host --> FIXED (ed1ca8852)

#### Iteration 3
**New findings:** 2 WARNINGs, 2 NITs (+1 validation finding)
- [WARNING] engine/computerprint.js:68-73 — reg.exe is refused under the DisableRegistryTools policy and common AppLocker rules, exactly on the managed PCs Enterprise targets; null forever with no fallback --> FIXED (8bafcba37: PowerShell Get-ItemPropertyValue fallback, Sysnative for 32-bit, pinned + real test)
- [WARNING] engine/computerprint.js:31-34,75 — without a negative cache every failed call re-spawns synchronously (up to 5s each) --> FIXED (8bafcba37: retry no sooner than a window)
- [NIT] engine/computerprint.js:42-45 — "never off PATH" overstated as a security control --> FIXED (8bafcba37: determinism, not a boundary)
- [NIT] engine/computerprint-5532.test.js:31 — redundant win32 assert with ioreg text --> kept, harmless (it now guards cross-platform parsing)
- [BLOCKER] validation: engine.reachable.test.js — _resetCache tested, exported, reachable from nowhere --> FIXED (47d9778fa: excused by name with a reason, the repo's sanctioned path for test seams)

#### Iteration 4
**New findings:** 2 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] engine/computerprint.js:110-114,39 — a permanently blocked PC retried a synchronous 1-15s read every 5 minutes forever --> FIXED (cff33a1a7: 5, 15, 60 min then stop for the run)
- [WARNING] engine/computerprint.js:84,87,113 — retry window on Date.now() (wall clock); a logon-time clock correction could stretch it for hours --> FIXED (cff33a1a7: performance.now(), opts.now kept as the seam)
- [CONVENTION] .claude/plans/fingerprint-5532-win32.md — plan drifted (exports, tests, stale counts) --> FIXED (cff33a1a7: rewritten to match)
- [NIT] engine/computerprint-5532.test.js:59-69 — real arm built its own closures, so production's fallback options were never run end to end --> FIXED (cff33a1a7: readRegistry / readPowerShell exported and used)
- [NIT] engine/computerprint.js:18-20 — overstated what AppLocker leaves alone --> FIXED (cff33a1a7)
- [NIT] engine/computerprint.js:90-96 — the shared cache change alters the Mac arm's behaviour --> taken: called out in the plan and the PR for the Mac owner's sign-off
- [NIT] no production caller yet --> noted (base-branch design; flagged for when the caller lands)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings.
- [NIT] engine.reachable.test.js:23 — excuse text still said "after 5 minutes" --> FIXED (8d0c54dff: names the 5/15/60 then stop schedule)
- [NIT] engine/computerprint.js:106-110 — cache not keyed by platform; only a caller passing opts.platform without run could see it (no production caller does)
- [NIT] engine/computerprint.js:123-125 — unsupported platforms count a "failure" (no spawn, no cost)

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/computerprint-5532.test.js:56 | #1777 audit: win32 host branch not run on Windows | FIXED | 102d4c837 |
| 2 | 1 | WARNING | engine/computerprint-5532.test.js:57 | assert could print the raw id | FIXED | 102d4c837 |
| 3 | 1 | WARNING | engine/computerprint.js:62 | reg command not pinned | FIXED | 102d4c837 |
| 4 | 1 | CONVENTION | plan | no Posture stamp | FIXED | f25cc5dd0 |
| 5 | 2 | WARNING | engine/computerprint.js:63 | failed read cached for the run | FIXED | ed1ca8852 |
| 6 | 2 | CONVENTION | engine/computerprint.js:42 | path.join vs path.win32.join | FIXED | ed1ca8852 |
| 7 | 3 | WARNING | engine/computerprint.js:68 | reg.exe blocked by policy, no fallback | FIXED | 8bafcba37 |
| 8 | 3 | WARNING | engine/computerprint.js:31 | failed reads re-spawn on every call | FIXED | 8bafcba37 |
| 9 | 3 | BLOCKER | engine.reachable.test.js | _resetCache unexcused test seam | FIXED | 47d9778fa |
| 10 | 4 | WARNING | engine/computerprint.js:110 | uncapped retries of a sync spawn | FIXED | cff33a1a7 |
| 11 | 4 | WARNING | engine/computerprint.js:84 | wall-clock retry window | FIXED | cff33a1a7 |
| 12 | 4 | CONVENTION | plan | plan drift | FIXED | cff33a1a7 |

### NITs (non-blocking, across all iterations)
- [NIT] engine/computerprint-5532.test.js:31 — redundant cross-platform assert, kept (iteration 3)
- [NIT] engine/computerprint.js:90-96 — Mac arm behaviour change, flagged for its owner (iteration 4)
- [NIT] no production caller yet; check its placement when it lands (iteration 4)
- [NIT] engine/computerprint.js:106-110 — cache not keyed by platform, test-only reach (iteration 5)
- [NIT] engine/computerprint.js:123-125 — unsupported platforms count a failure, no cost (iteration 5)

### Strengths (across all iterations)
- /reg:64 and Sysnative close the WOW6432Node trap for a 32-bit node, both pinned by host-independent tests (iterations 2-5)
- Strict parsers: only a REG_SZ / single value in plain GUID shape; braced, wrong-type, error text and two values give null (iterations 2-5)
- Real-registry arm uses production's own readers and assert.ok only, so a failure never prints the MachineGuid; it proves the PowerShell fallback reads the same value (iterations 4-5)
- Capped, monotonic retry policy with tests for no-spawn inside a window, recovery and exhaustion (iteration 5)
