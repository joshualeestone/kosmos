---
pre_challenge: true
method: challenge-loop
branch: runnerrestart-8598
diff_hash: fe1242a98223c683df21160adca0689a9f172ea2ac3e117c277836d48a57a6f2
validation: targeted (178 test files, 4164 tests, 0 fail at 3ac417ca3f); local full suite held on Mortals by the PM, CI runs it
subdir_audit: not run (the helper runs inside the held validation sequence; no subdir CLAUDE.md is changed)
timestamp: 2026-11-17T06:59:03Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8: its three WARNINGs were each judged safe by the reviewer and on reading the code, so DEFERRED; no NEW finding left). Iteration 8 is also the fleet's review cap.
**Total findings:** 2 BLOCKERs, 22 WARNINGs, 3 CONVENTIONs, 24 NITs (plan-file CONVENTION before iteration 1 included)
**Fixed:** 24 | **Deferred:** 6 | **Asked (awaiting user):** 0

Validation note: the canonical validation helper runs the full local suite, which is on hold on this machine (Liu Kang). It was started once by mistake and stopped within ten minutes (reported). Each iteration was validated instead with a targeted list: every test that reads server.js or runners.js as text, every test that walks engine/, the fixture, reachability and Windows-list guards, the runners tests and the two new files. Each deliberate mutant of a fixed behaviour turned that list red. The full suite runs in CI on the PR.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/runnerrestart.js:175 - any code-mode host counted as safe; one started after the swap is the new tree's --> FIXED (69d96b39ca)
- [BLOCKER] server.js:29274 - restartAsync does not refuse an agent an account move holds --> FIXED (69d96b39ca, heldByMove)
- [WARNING] server.js:29268 - pkg ctime moves on any reinstall --> FIXED (69d96b39ca, upgraded.json record)
- [WARNING] server.js:29251 - tmux failure silent --> FIXED (69d96b39ca)
- [WARNING] server.js:29237 - seenIdle not cleared on early returns --> FIXED (69d96b39ca)
- [WARNING] server.js wiring untested --> FIXED (69d96b39ca, managedState tested; tick itself in iteration 7)
- [CONVENTION] plan drift (cause word, tries) --> FIXED (69d96b39ca)
- [NIT] fresh roster read adds little --> recorded
- [NIT] tick cost when nothing to do --> FIXED (early return on no record)
- [NIT] recycled-pid test does not assert job --> FIXED
- [NIT] tried doc disagrees --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/runnerrestart.js:84 - argv0 split breaks on a space in the path --> FIXED (1a22daa122)
- [WARNING] engine/runnerrestart.js:165 - board restart resets tried --> FIXED (comment)
- [WARNING] server.js:29253 - pane pids can go stale before restart --> DEFERRED then FIXED in iteration 6 (re-read before restart)
- [NIT] host slack asymmetric --> FIXED (ambiguous host counts as new)
- [NIT] stamp coupling comment --> FIXED
- [NIT] double gate comment --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/runnerrestart.js:180 - pane looked up by board name, not tmux session (legacy and named-world agents never seen) --> FIXED (20045f2971, by target)
- [WARNING] test fixture keyed by the same wrong name --> FIXED (target-keyed, with a control)
- [WARNING] engine/runners.js:1813 - a repair deleted the record --> FIXED (kept when to = installed)
- [WARNING] engine/runnerrestart.js:117 - any non-host descendant counted as a job (tool servers block forever) --> FIXED (direct shell children only; logged)
- [NIT] pane choice in multi-window session --> FIXED (target)
- [NIT] tmux path read by hand --> DEFERRED (status.tmuxBin is not exported; same expression)
- [NIT] isCodeModeHost computed twice --> FIXED
- [NIT] now taken after ps --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js:29270 - process snapshot not re-read before restart --> FIXED (comment; real re-read in iteration 6)
- [NIT] maps grow per pin --> FIXED (comment)
- [NIT] nested managed codex untested --> FIXED (test)
- [NIT] stamp delete on failed rm --> DEFERRED (cannot fire: ready needs installed = to)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/runnerrestart.js:152 - a long-lived shell child would hold for good, silently --> FIXED (7107642da1, logged hourly; plan names it unmeasured)
- [WARNING] server.js tick untested, ps shape unchecked --> FIXED (real ps test with shared PS_ARGS)
- [WARNING] argv0 prefix dependency silent --> FIXED (no-managed-codex logged)
- [NIT] ps -ww --> FIXED
- [NIT] ps failure not warned --> FIXED
- [NIT] sessionName fallback --> FIXED (dropped)
- [NIT] twin session not examined --> DEFERRED (a twin is already flagged as a fault, kosmos#8321)
- [NIT] card says only "restart" --> DEFERRED (needs a disruption cause and page text; follow-up)
- [NIT] stamp never retired --> DEFERRED (cost is one ps a minute while a Codex card exists)
- Also: windows-tests guard red on the new ps test --> FIXED (d3ecdce8f5)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] seenIdle across a non-ready pass --> DEFERRED (it is refilled at every pass before any early exit, so it always holds the previous pass)
- [WARNING] tables not re-read before restart (third time raised) --> FIXED (a4ba69967e, re-read and same-process check, tested)
- [NIT] said map grows --> already commented
- [NIT] swappedAt before prove --> FIXED (comment)
- [NIT] act precedence table test --> recorded

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js tick wiring untested --> FIXED (8da46e5fd8, makeTick moved into the module and tested; 5291bce6e1 pins tmux-then-ps)
- [WARNING] host under a symlinked folder's resolved path missed --> FIXED (both prefixes)
- [WARNING] one warn flag for two sources --> FIXED (per source)
- [CONVENTION] plan bullet on jobs drifted --> FIXED
- [CONVENTION] test did not sandbox roots --> FIXED
- [NIT] stamp write not atomic --> FIXED (tmp + rename)
- [NIT] at/now duplicate --> FIXED
- [NIT] clock step --> FIXED (named in plan)
- [NIT] card cause --> DEFERRED (duplicate of iteration 5)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (each judged safe), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] process started between swap and failed prove --> DEFERRED (a failed prove writes no record, so nothing fires)
- [WARNING] repair keeps the record --> DEFERRED (correct by design; restarted agents read already-new)
- [WARNING] tried set to the cap after a restart --> DEFERRED (a relaunched agent starts after the swap)
- [NIT] session fallback picks the first pane --> recorded (cards carry target)
- [NIT] silent break on gate --> recorded
- [NIT] ps timeout warned once --> recorded
- [NIT] stacked doc comment --> FIXED (3ac417ca3f)
**Converged** - no new actionable findings.

### Final Ledger (actionable findings)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 0 | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | 6d5650d959 |
| 2 | 1 | BLOCKER | engine/runnerrestart.js:175 | BRANCH | post-swap host treated as safe | FIXED | 69d96b39ca |
| 3 | 1 | BLOCKER | server.js:29274 | BRANCH | held-by-move not refused | FIXED | 69d96b39ca |
| 4 | 1 | WARNING | server.js:29268 | BRANCH | ctime proxy | FIXED | 69d96b39ca |
| 5 | 1 | WARNING | server.js:29251 | BRANCH | silent tmux failure | FIXED | 69d96b39ca |
| 6 | 1 | WARNING | server.js:29237 | BRANCH | seenIdle not cleared | FIXED | 69d96b39ca |
| 7 | 1 | WARNING | server.js wiring | BRANCH | untested | FIXED | 69d96b39ca, 8da46e5fd8 |
| 8 | 1 | CONVENTION | plan | BRANCH | drift | FIXED | 69d96b39ca |
| 9 | 2 | WARNING | engine/runnerrestart.js:84 | BRANCH | space in path | FIXED | 1a22daa122 |
| 10 | 2 | WARNING | engine/runnerrestart.js:165 | BRANCH | board restart resets tried | FIXED | 1a22daa122 |
| 11 | 2 | WARNING | server.js:29253 | BRANCH | stale snapshot | FIXED | a4ba69967e |
| 12 | 3 | WARNING | engine/runnerrestart.js:180 | BRANCH | board name vs tmux session | FIXED | 20045f2971 |
| 13 | 3 | WARNING | test fixture | BRANCH | same wrong keying | FIXED | 20045f2971 |
| 14 | 3 | WARNING | engine/runners.js:1813 | BRANCH | repair deletes record | FIXED | 20045f2971 |
| 15 | 3 | WARNING | engine/runnerrestart.js:117 | BRANCH | tool server read as job | FIXED | 20045f2971 |
| 16 | 4 | WARNING | server.js:29270 | BRANCH | snapshot not re-read | FIXED | a9ae6624a5, a4ba69967e |
| 17 | 5 | WARNING | engine/runnerrestart.js:152 | BRANCH | long-lived shell silent | FIXED | 7107642da1 |
| 18 | 5 | WARNING | server.js tick / ps shape | BRANCH | untested | FIXED | 7107642da1 |
| 19 | 5 | WARNING | prefix dependency silent | BRANCH | no log | FIXED | 7107642da1 |
| 20 | 6 | WARNING | engine/runnerrestart.js:205 | BRANCH | seenIdle across non-ready pass | DEFERRED | refilled every pass |
| 21 | 6 | WARNING | server.js:29255 | BRANCH | tables not re-read | FIXED | a4ba69967e |
| 22 | 7 | WARNING | server.js tick | BRANCH | untested | FIXED | 8da46e5fd8, 5291bce6e1 |
| 23 | 7 | WARNING | engine/runnerrestart.js:126 | BRANCH | symlinked folder | FIXED | 8da46e5fd8 |
| 24 | 7 | WARNING | server.js:29261 | BRANCH | one warn flag | FIXED | 8da46e5fd8 |
| 25 | 7 | CONVENTION | plan | BRANCH | job rule drift | FIXED | 8da46e5fd8 |
| 26 | 7 | CONVENTION | test roots | BRANCH | not sandboxed | FIXED | 8da46e5fd8 |
| 27 | 8 | WARNING | engine/runnerrestart.js:226 | BRANCH | failed-prove window | DEFERRED | no record written |
| 28 | 8 | WARNING | engine/runnerrestart.js:286 | BRANCH | repair keeps record | DEFERRED | by design |
| 29 | 8 | WARNING | engine/runnerrestart.js:233 | BRANCH | tried capped after restart | DEFERRED | relaunch reads new |

### NITs (non-blocking, across all iterations)
- Fresh roster read adds little on its own (1); act precedence table test (6); session fallback first pane (8); silent gate break (8); ps timeout warned once (8)
- Deferred: tmux path by hand (3), twin session (5), card cause word (5, 7), stamp retirement (5)

### Strengths (across all iterations)
- Everything passOnce and makeTick read is injected; tests use real fleet cards and real ps output (1, 5, 7)
- Every uncertain case fails toward no restart, except the near-swap host, which fails toward a restart and says why (2, 4, 6)
- The upgrade record is written only after a proved upgrade, whole or not at all, and cross-checked against the installed version (3, 7, 8)
