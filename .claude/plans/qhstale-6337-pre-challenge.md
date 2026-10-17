---
pre_challenge: true
method: challenge-loop
branch: qhstale-6337
diff_hash: 537cb679f25818580b69126a4fa84f497de723fe1fb83f4d296b8b174593ee5a
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T00:42:54Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 14 (1 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 11 NITs)
**Fixed:** 6 | **Deferred:** 6 | **Duplicates:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the write-after-read NIT is about the R1 fix's comment)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (the comment wording and the plan's limit list came from R1/R2 fixes)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 after deduplication (3 NITs raised: 2 duplicates of R1 WARNING and R2 WARNING, 1 deferred as not an issue)
**Self-generated:** 0

### Ledger

| # | Iter | Sev | Finding | Disposition |
|---|---|---|---|---|
| 1 | 1 | BLOCKER | tools/test-queued-heavy-4977.sh:568: the 60 s bound did not exist; the $QH shim execs its own alarm(QH_DEADLINE), which replaces the pending alarm, so the bound was silently 240 s | FIXED: the arm runs $REAL_QH directly under alarm 60 (as the later arms do). Measured: outer alarm 2 around an inner alarm 6 returned at 6 s; direct alarm 3 on the real wrapper returned at 3 s with rc 142 |
| 2 | 1 | WARNING | a child the wrapper leaves behind after a trip is orphaned, not reaped | FIXED (documented in the comment and plan): the trade is a stray process instead of a hung shard, after the arm has already failed |
| 3 | 1 | NIT | only rc 142 is named in the failure text | superseded by #9 (fixed) |
| 4 | 1 | NIT | line 509 keeps a ps \| tr idiom | DEFERRED: no $? read beside it; the lint does not flag it; out of the card's scope |
| 5 | 2 | WARNING | 60 s could trip on a loaded runner where 240 s would not | DEFERRED: with the test's exported quiet probes and KOSMOS_WAIT_EVERY_S=1 the turn comes in about a second; a trip names itself (TIMED OUT ... kosmos#6337) |
| 6 | 2 | NIT | the comment omits that a leftover child can write to the file after it is read | FIXED in the comment |
| 7 | 2 | NIT | other ps \| tr lines remain (ours(), line 512) | DEFERRED: same as #4 |
| 8 | 3 | NIT | the comment stated the cause as fact; it is inferred | FIXED: "evidently ... inferred from the timing and a standalone reproduction, not seen on the CI run itself" |
| 9 | 3 | NIT | a red should name the exit status for any non-zero rc | FIXED: "(the stale-TMPDIR run exited N)" appended when rc != 0 |
| 10 | 3 | NIT | the stated limit omits that the child can outlive the EXIT trap's rm -rf $S | FIXED in the plan's Known limits |
| 11 | 4 | NIT | orphaned wrapper not reaped by the EXIT trap | DUPLICATE of #2 |
| 12 | 4 | NIT | "the turn is immediate" unverified against the load probe and the fake holder | DUPLICATE of #5 |
| 13 | 4 | NIT | on rc 142 both the TIMED OUT line and the exit-status line print | DEFERRED: both lines are true and the TIMED OUT one is the more specific; folding them adds a branch for no reader benefit |
| 14 | 1 | (pre-loop) | the pre-commit pipe-status lint (#632) refused the first commit on two pre-existing lines | FIXED: reap() strips spaces with ${var// /} instead of ps \| tr (same result); line 512's r=$? marked pipe-status-ok |

### Verification

- `tools/test-queued-heavy-4977.sh` run alone at the converged head 463943bbd2: 142 OK, 0 BAD, exit 0 (also green at f3dac596eb, before the R1 fix).
- The R1 bound proven able to fire on the real wrapper (alarm 3, blocking command: 3 s, rc 142).
- Final validation (validation_log_run_or_skip) rc=0 and the subdir CLAUDE.md audit rc=0 on the clean committed tree at 463943bbd2.

### Disclosures

- No 6.0 baseline validation was run before iteration 1; the first validation is the final one above.
- One full-file run (at 88a139d904) was voided because I committed a comment edit while it was reading the script; it was stopped and the file re-run clean.
- Why the turn did not come on CI run 38973121430 is not established; this change makes the arm unable to hang whatever the cause.
