---
pre_challenge: true
method: challenge-loop
branch: agy-status-4043
diff_hash: 15f16b8bb15a5688d170d8e4ef3d8f611dd2347d77ac637da7abdc1ac029b4ce
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T04:49:45Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes. Iteration 2 (sonnet) converged the first scope. The ask_question scope was added after that (Splinter, from Gemini-Sub's spec) and reviewed again from iteration 3. Final: iteration 9 (opus) had no new findings, and iteration 10 (sonnet) had no new findings.
**Findings (from the plan's iteration sections):** 1 BLOCKER, about 20 WARNINGs, 2 CONVENTIONs, about 12 NITs
**Fixed:** all BLOCKER and WARNING findings. **Decided and documented:** auto:true renders as "Issue" (the siblings match, and class-1 is kept off by #4006's runner check, pinned); the marker is written before the POST; agents in a git project keep "Can't tell". **Deferred to release checks:** #1-#5 in the plan (live behaviour under the supervisor). **Asked:** 0

Validation PASSED (hash 15f16b8bb15a at 3b1307dde, rebased on main after #4071). Earlier runs at 00c3d8f1c: one PASSED (1eaea3d9daae), and one failed only on create.test.js #323. That failure is #4084, measured: Node rounds stat.mtime, not load. The plan's stale premise was then retracted, and validation was rerun on the new hash. Subdir CLAUDE.md audit rc 0.
Reviewer models: opus 1, sonnet 2, opus 3, sonnet 4, opus 5-9, sonnet 10.

### Per-Iteration Breakdown
(full notes: `.claude/plans/agy-status-4043.md`)

#### Iteration 1 (opus)
- [BLOCKER] the bridge missing from install-board.sh, test-install.sh and the 2870 fixture --> FIXED
- [WARNING] no throttle; PostToolUse per step inside agy's blocking loop --> FIXED (60s throttle; PostToolUse dropped)
- [WARNING] an open stdin could hold the bridge --> FIXED (released, explicit exit)
- [WARNING] supervisor order and timeouts untested --> FIXED (source pin, silent-board test)
- [CONVENTION] symlink/mode on the hooks write --> DEFERRED then, FIXED in iteration 7 (premise retracted)

#### Iteration 2 (sonnet)
- No issues found (first scope converged).

#### Iteration 3 (opus), after the ask_question scope was added
- [WARNING] the question read from a guessed args key --> FIXED (args.questions[].question, agy's schema)
- [WARNING] PreToolUse answered an unmeasured `allow` --> FIXED (`{}`, no decision)
- [NIT] header/plan contradictions; the stdout test's pane --> FIXED

#### Iteration 4 (sonnet)
- [WARNING] a bare 'nopane' throttle key merged agents --> FIXED (pane, token hash, ppid chain)

#### Iteration 5 (opus)
- [WARNING] an auto needs_you renders as "Issue" --> DECIDED keep auto (siblings match; class-1 runner check pinned); reasoning on #4043
- [WARNING] nothing tested the real POST --> FIXED (fake-board test)
- [CONVENTION] spawned tests left throttle markers --> FIXED
- [NIT] x4 --> FIXED

#### Iteration 6 (opus)
- [WARNING] no minimum agy version --> FIXED (tool hooks only for 1.1.9+)
- [WARNING] pane keys collide across two worlds --> FIXED (port in the key)
- [NIT] marker before POST --> ACCEPTED, stated; [NIT] subagent Stop --> release check #5

#### Iteration 7 (opus)
- [WARNING] the person's `enabled` overwritten --> FIXED
- [WARNING] this Mac's paths written into a person's project --> FIXED (refuse git projects)
- [WARNING] symlink and mode not kept --> FIXED
- [NIT] x.y versions --> FIXED

#### Iteration 8 (opus)
- [WARNING] a link target inside a repo --> FIXED
- [WARNING] a home-level repo blanked every agent --> FIXED (workers-folder ceiling; not-yet-made paths resolved)
- [NIT] key order forced rewrites --> FIXED

#### Iteration 9 (opus)
- No new findings. [NIT] native realpath; [NIT] which key survives --> FIXED

#### Iteration 10 (sonnet)
- No new findings.

Every fix since iteration 5 was mutation-checked: disabling it reds its named test.
