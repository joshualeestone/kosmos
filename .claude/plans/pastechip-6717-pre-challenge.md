---
pre_challenge: true
method: challenge-loop
branch: pastechip-6717
diff_hash: caf6713499f824b31fe90905fe03047501e5ac5dccf112b59f819f432b45c612
validation: failed 2 of 22647, both tools.run-tests-file-timeout-6668 (the arms #6768 fixes on main; this branch does not touch run-tests.sh)
subdir_audit: passed
timestamp: 2026-10-21T00:06:29Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: both warnings duplicated residuals the plan names; nits only)
**Total findings:** 13 actionable (0 BLOCKERs, 12 WARNINGs, 1 CONVENTION), plus NITs
**Fixed:** 10 | **Deferred:** 3 (named residuals) | **Asked:** 0

Validation at head 87797786a9 (rebased on main):
- run 1 at load 24 on 12 cores: 10 of 22647 failed in cli.busy-health-4466, engine/create, engine/musesignin,
  engine/orgchartfile, tools.release-gate and tools.run-tests-file-timeout-6668. Each run alone at this head: green
  (release-gate 1 red of 3 alone, under load; it does not load engine/chat.js).
- run 2 in a quiet window (load 3.6): 22647 tests, **2 failed**, both tools.run-tests-file-timeout-6668 (the TERM and
  Ctrl-C watchdog arms, which fail on main on this box and which #6768 fixes). This branch changes only engine/chat.js,
  its test, the plan and CLAUDE.md.

Mutants run by hand (each red on its own arm, code restored after each): chips never ours (4 red); every chip ours (gap
control and unit red); no empty-box tie; no 800-character floor; no process tie; any chip accepted after our Enter
(sync and async arms red, after the sync arm was tightened to a chip that stays).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the tie held for the whole watch after our Enter, so a person's chip arriving then could be pressed or kept --> FIXED (pinned chip)
- [WARNING] "box read empty before the paste" was not enforced when that read failed --> FIXED (emptyBefore)
- [WARNING] a short line can never fold, yet a chip after it counted as ours --> FIXED (CHIP_MIN_CHARS, measured)
- [WARNING] a kept chip number could repeat after a restart --> FIXED (pane pid kept; restart measured to reset numbers)
- [WARNING] the field jam was not reproduced --> FIXED in the plan (stated as not reproduced; measured that chunks do not fold here and a fold covers the whole paste)
- NITs: missing one-line control in the gap, readability --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] a chip first seen after our Enter could still be pinned as ours --> FIXED (only a chip seen before our Enter is ours)
- [WARNING] pane_pid may not be Claude's process --> FIXED in the plan (measured: the supervisor's entry ends in exec, so it is; hand-launched claude named as a residual)
- [WARNING] the named weakest point --> DEFERRED (residual, named)
- [CONVENTION] plan residuals --> FIXED; NITs --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] input arriving in the same instant could merge into our chip --> FIXED by measurement (it shows next to the chip, never inside; such a box is never ours)
- [WARNING] /clear might reset numbering --> FIXED by measurement (#3, /clear, #4); /compact and /resume named as not measured
- [WARNING] the 800 threshold was measured bracketed --> FIXED in the plan (safe direction stated)
- [WARNING] our own chip not seen before the Enter still jams --> FIXED in the plan (residual)
- [CONVENTION] CLAUDE.md row --> FIXED; NITs: dead `true` branch removed, chip box decided only by the kept chip, unread-pid test added

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] the pre-Enter window --> DEFERRED (duplicate of the named weakest point)
- [WARNING] hand-relaunched claude shares the pid --> DEFERRED (duplicate of a named residual)
- NITs only otherwise; plan wording on where the mutants are recorded --> FIXED

### Final Ledger

| # | Finding | Status |
|---|---|---|
| 1 | tie held after our Enter | FIXED |
| 2 | empty-before not enforced | FIXED |
| 3 | short line tied a chip | FIXED |
| 4 | number reuse after restart | FIXED |
| 5 | field jam not reproduced | FIXED (stated) |
| 6 | chip first seen after Enter pinned | FIXED |
| 7 | pane_pid identity | FIXED (measured) |
| 8 | pre-Enter window | DEFERRED (named) |
| 9 | merging input | FIXED (measured) |
| 10 | /clear numbering | FIXED (measured) |
| 11 | threshold measured bracketed | FIXED (stated) |
| 12 | our chip not seen before Enter | FIXED (stated) |
| 13 | hand-relaunched claude | DEFERRED (named) |

### Outstanding questions (ASKED, still unresolved when the run ended)

None.

### Strengths (across all iterations)

- Every Enter is gated on a conjunction, each condition with a test where it is false; anything uncertain refuses.
- Our own chip is pressed by delivery, by a retry and after a board restart; a person's chip in every tested shape is not.
- Claude Code's behaviour was measured, not assumed, and the plan says what was not measured.
