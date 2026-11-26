---
pre_challenge: true
method: challenge-loop
branch: occurrences-9142
diff_hash: 3fbb61b8903d814dbd99c443ce798056d5ac80fc57fd967c4a3f52b40f73360f
validation: passed
subdir_audit: passed
timestamp: 2026-11-26T18:40:43Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind review rounds. Each was a fresh agent given the diff, the card and the plan, and asked to judge the code itself. Rounds 5 and 6 reviewed the whole branch with nothing pre-cleared.
**Converged:** Yes. Round 6 found 0 BLOCKERs and 0 SHOULDs. Its NITs match what missedRuns already says, and are recorded in the plan.
**Change:** a repeating task's recent occurrences, one row per scheduled slot: delivered (on time or late, by whom) or missed, plus what the review did with a miss when a record names that slot. Built in engine/taskrepeat.js (occurrences, occurrenceWords), served by the task activity route, printed by both CLIs (`kosmos task activity`), and shown on the task page ("Recent runs"). Details and every round: .claude/plans/occurrences-9142.md.

## Validation
- Full validation on this Mac (validation_log_run_or_skip), head c8f4dd9cad: node suite 0 fail; test:shell 4 shards all green; "validation PASSED for stack=typescript hash=3fbb61b8903d", status clean.
- The run before it (ac392b2b88) failed only on 3 guards, all fixed in c8f4dd9cad:
  - the CLI test's Windows exclusion (its skipOnWin32 reason, word for word);
  - fixture-discipline (no hand-built roster row in the page test);
  - the web/ browser-check gate (a real check now).
- docs/browser-checks/render-occurrences-9142.js (gated, with a README row) RUN HEADLESS here: all pass in light 1400 and dark 390. Its control (the painter call removed) fails O1 and O2.
- Branch tests: engine 15, server 3, cli 3, page 6. Each part is shown red by a perturbation or by main's file. Nearby: 31 files, 329 tests; browser-check guards: 72 files, 1362 tests. All pass.
- Subdir audit: the branch changes no subdirectory CLAUDE.md.

### Per-Iteration Breakdown
#### Iteration 1
- SHOULD: an open-miss row double-counted a recorded stretch and could say "not told yet" for ever --> FIXED
- SHOULD: recovered misses vanished --> FIXED
- SHOULD: a failed read left the previous task's list --> FIXED
- NIT: a projects read on every poll --> FIXED (repeat-set gate)
- NITs left: the CLIs' "Nothing recorded" exit; recordRun's `at` not stored
#### Iteration 2
- 4 SHOULD, one root: rows built from stretch counts double-counted (A, B), hid misses (C), and gave a run a made-up due time (D) --> REDESIGNED: one row per scheduled slot from the schedule and the runs; a record annotates only its own slot
- NIT E (missed then delivered late was two rows) and NIT F (two runs for one slot) --> fixed by the same design
#### Iteration 3
- SHOULD: an early run was hidden until its slot --> FIXED
- SHOULD: a slot calculation for every run cost about 100 ms per poll on a long history --> FIXED (floor; a ratio test against a plain scan, not a deadline)
- NIT: the late mark is now computed from the slot --> FIXED
- NIT: a stale comment --> FIXED
#### Iteration 4
- SHOULD: a future-stamped run made a false row --> FIXED
- SHOULD: a closed task kept growing missed rows --> FIXED
- NIT: two cutoffs --> LEFT (harmless)
#### Iteration 5
- SHOULD: opening a task left the previous task's runs showing while the new read loaded --> FIXED (guarded)
- SHOULD: misses were claimed beside a run stamped ahead --> FIXED (no missed rows claimed then)
- NIT: an undefined reviewer name --> FIXED
- NIT: the closed-task path is unreachable in production --> kept as a guard
#### Iteration 6: CONVERGED
- 0 BLOCKER, 0 SHOULD. NITs left, each matching missedRuns: a reopened task's closed-period slots; a fallback to createdAt; a run stamped ahead hides misses.

## Weakest premise
That "review status" in the feedback means the miss review. A per-run review mark would be a product decision (a separate card).
