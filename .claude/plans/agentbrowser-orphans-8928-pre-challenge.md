---
pre_challenge: true
method: challenge-loop
branch: agentbrowser-orphans-8928
diff_hash: ca4d7b0c96269c009d45e951a5c9a78ee68930b96f4fe436a0eeec021ba58774
validation: passed
subdir_audit: passed
timestamp: 2026-11-23T15:21:30Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16 (Sonnet and Opus alternating)
**Converged:** Yes (iteration 16: zero NEW findings after deduplication and checked deferral, no ASKED findings)
**Total findings:** 2 BLOCKERs (both fixed); the warnings, conventions and nits of each iteration are listed below
**Deferred, with reasons:** see iterations 1, 3, 7, 8, 9 and 16 | **Asked (awaiting user):** 0

Initial validation (6.0): all commands passed, recorded superseded because iteration 1 committed while it ran (kosmos#6126). Each iteration ran agentbrowser.test.js and win32supervisor.test.js (plus fixture-discipline and engine.reachable) under tools/run-tests.sh --only, and tools/test-supervisor-agentbrowser-3633.sh. Every new safety rule has a mutation that turned its own test red. Closing validation (6j) passed on 304e8a6dd0 (node part 30,695 tests, 0 fail; shell part green; build).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 7 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js: SIGTERM only; a hung server ignores it --> FIXED (fb9f198cef, SIGKILL, children first)
- [WARNING] engine/agentbrowser.js: pid reuse between listing and kill --> FIXED (each pid re-read just before it is ended)
- [WARNING] engine/agentbrowser.js: Windows listing blocks the launch --> FIXED
- [WARNING] engine/agentbrowser.js: live-execution gate not used --> DEFERRED, decided (process-wide switch not opened in those processes; feature-only opt-in, documented in CLAUDE.md rule 3)
- [WARNING] engine/agentbrowser.js: ps width --> FIXED (-ww)
- [WARNING] engine/agentbrowser.js: Mac browser left when node dies hard --> FIXED (descendants ended)
- [WARNING] engine/agentbrowser.test.js: cleanup could signal a reused pid --> FIXED (recorded, verified pids only; found it had killed the author's own shell by marker)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/agentbrowser.js: Windows taskkill /T reaches processes under a reused parent pid --> FIXED (518cafb340, creation-time rule, each pid alone)
- [WARNING] engine/agentbrowser.js: Windows run blocks the supervisor --> FIXED (async)
- [WARNING] engine/agentbrowser.test.js: nothing tests launchConfig calls the sweep --> FIXED
- [WARNING] engine/agentbrowser.test.js: no Windows arm --> FIXED
- [WARNING] engine/agentbrowser.js: nothing logged --> FIXED (ended-servers.log)
- [CONVENTION] CLAUDE.md rule 3 --> FIXED (exception recorded)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (a plan claim of a test-process check)
- [WARNING] test-process check claimed but absent --> FIXED (5bf79fb54a)
- [WARNING] Windows listing shape untested, failures silent --> FIXED
- [WARNING] Mac sweep unbounded --> FIXED (2 s budget)
- [WARNING] Windows re-read claim overstated --> FIXED (comment)
- [WARNING] browsers whose server already died --> DEFERRED (safe direction)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/agentbrowser.js: Windows kill acted on a listing up to 15 s old --> FIXED (62cc91966a, WIN_END re-reads creation time and command line in one PowerShell)
- [WARNING] test guard keyed on --test only --> FIXED (store.isTestProcess)
- [WARNING] Mac shim wiring untested --> FIXED (shim spawned as a program in the e2e)
- [WARNING] Mac budget bound not strict --> FIXED

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] WIN_END quoting untested --> FIXED (7cde5b0d26, -EncodedCommand, round trip tested)
- [WARNING] plan in an env var (32K limit) --> FIXED (stdin)
- [WARNING] console code page --> FIXED (UTF-8)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/win32supervisor.js: the Windows half never ran in production (boot shim calls main(args) with no deps) --> FIXED (0d00a3b237), later superseded by iteration 8's decision
- [WARNING] UTF-8 split across chunks --> FIXED
- [WARNING] byte-order mark --> FIXED
- [WARNING] cli.js matched anywhere on the line --> FIXED

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] PowerShell by bare name --> FIXED (7d887251af, full path)
- [WARNING] encoding setters unguarded --> FIXED
- [WARNING] interpreter with a space on a Mac --> FIXED
- [WARNING] plan not logged before ending --> FIXED
- [WARNING] a PowerShell on every Windows launch --> FIXED (first launch skips)
- [WARNING] Windows parent-chain premise --> DEFERRED (needs Windows)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] the Windows half is on but has never run on Windows, and one premise fails unsafe --> DECIDED (4265217c92): Windows ships OFF until measured; card comment 7104045089 lists the two measurements
- [NIT] interpreter not exact --> taken (exact node binary)

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] child re-check by parent only --> FIXED (347c1a2789, command too)
- [WARNING] shim live on any platform --> FIXED (darwin only)
- [WARNING] node-change case undocumented --> FIXED
- [WARNING] launch latency early exit --> DEFERRED (2 s cap)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (a header sentence from iteration 6)
- [WARNING] header still said a real Windows start turns it on --> FIXED (6dfdf4f692)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after deduplication, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [CONVENTION] plan match rule 1 still said "contains" --> FIXED (bec847f2a9)

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (CLAUDE.md sentence, iteration 10 comment)
- [WARNING] CLAUDE.md said it never acts in a test run --> FIXED (666846732a)
- [WARNING] comment overstated the sandbox guarantee --> FIXED (deleted)

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the first-launch comment)
- [WARNING] sweep setup outside its own try --> FIXED (85a340d4d2)
- [WARNING] "most Windows launches" claim --> FIXED
- [NIT] pid guard in the ender --> taken (endablePid, tested by value; near miss disclosed)

#### Iteration 14
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] budget zero became 2 s --> FIXED (c25d6f961b)
- [WARNING] shim arm child unasserted --> FIXED
- [CONVENTION] plan "Where" on injected enders --> FIXED

#### Iteration 15
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (+1 duplicate), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] nothing pins who may pass live --> FIXED (588e6b2827, source-asserted test)
- [WARNING] e2e safety rests on one env var --> FIXED (asserted before the shim runs)

#### Iteration 16
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs after checked deferral, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] Chrome may respawn a helper mid-sweep --> DEFERRED (reasoned only; safe direction; reversing the order would orphan listed children)
- [WARNING] direct test run touches real temp --> DEFERRED (duplicate; only empty folders removed)
**Converged**: no new actionable findings.

### Final Ledger (summary)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 4 | BLOCKER | engine/agentbrowser.js | BRANCH | Windows kill on a stale listing | FIXED | 62cc91966a |
| 2 | 6 | BLOCKER | engine/win32supervisor.js | BRANCH | Windows half never ran | FIXED | 0d00a3b237 |
| 3 | 8 | WARNING | engine/win32supervisor.js | BRANCH | Windows on but unmeasured | DEFERRED | shipped OFF, decided |
| 4 | 1 | WARNING | engine/agentbrowser.js | BRANCH | live-execution gate | DEFERRED | feature-only opt-in, CLAUDE.md |
| 5 | 2 | WARNING | engine/agentbrowser.js | BRANCH | taskkill /T on reused pids | FIXED | 518cafb340 |
| 6 | 3 | WARNING | .claude/plans | SELF | claimed test-process check | FIXED | 5bf79fb54a |
| 7 | 9 | WARNING | engine/agentbrowser.js | BRANCH | child re-check by parent only | FIXED | 347c1a2789 |
| 8 | 12 | WARNING | CLAUDE.md | SELF | "never acts in a test run" | FIXED | 666846732a |
| 9 | 13 | WARNING | engine/agentbrowser.js | BRANCH | sweep outside its own try | FIXED | 85a340d4d2 |
| 10 | 15 | WARNING | engine/agentbrowser.test.js | BRANCH | live callers not pinned | FIXED | 588e6b2827 |
| 11 | 16 | WARNING | engine/agentbrowser.js | BRANCH | Chrome helper respawn | DEFERRED | reasoned, safe direction |

(Every finding, with its resolution, is in the plan file's iteration sections.)

### NITs (non-blocking, across all iterations)
- [NIT] interpreter/cli.js match case-insensitive while --output-dir is exact (safe: the folder decides)
- [NIT] Windows listing parsed by lines rather than JSON (WIN_END's exact re-check makes a forged row harmless)
- [NIT] the first slice-2 test is long and leans on earlier fixtures, asserted
- [NIT] a direct node --test run touches the real temp folder (only empty folders removed)

### Strengths (across all iterations)
- An exact match on four counts (interpreter, script, whole --output-dir argument, parent gone) with a table of near misses, each with a control
- Every pid re-read just before it is ended; no tree kill; pid 1, 0 and negatives refused; doubt counts as alive
- Fail-closed in three layers (live flag only from two pinned places, never in a test run, Windows off until measured)
- A launch can never lose its config to the sweep; bounded time on a Mac, nothing waits on Windows
