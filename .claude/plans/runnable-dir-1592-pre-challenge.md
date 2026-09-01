---
pre_challenge: true
method: challenge-loop
branch: runnable-dir-1592
diff_hash: 197f3e185d1d29fbccd1c6d7718501f82db0c7e1cb30cec506cfa28ca5600fb4
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T07:37:17Z
iterations: 45
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 45
**Converged:** No. Stopped at user request after iteration 45, on a bound I set and
stated in advance. The loop was still producing findings when it stopped.
**Total findings:** 100+ across 45 passes (0 BLOCKERs, and the per-pass detail for
early iterations is in the ledger rather than restated here)
**Fixed:** all but two | **Deferred:** 2 (kosmos#1730, kosmos#1732) | **Asked:** 0

🛑 **READ THIS BEFORE THE BREAKDOWN. THE HEADLINE NUMBER IS MISLEADING ON ITS OWN.**
For nine consecutive passes the largest source of findings was my own previous
commit: prose damage introduced by the previous pass's correction. That made the
record look like a converging loop. **It was not converging, it was recycling.**
Iteration 44 broke the trend with three real branch defects, and **iteration 45
found a live production defect that forty-four passes could not have caught.**

## Per-Iteration Breakdown

#### Iterations 2 to 34 (full detail in the ledger)
Findings in the production change, then in the guard, then in the plan. Every
production finding was fixed and mutation-verified. Ice Cream Kitty ran 8 further
iterations before the handover, recorded in her own ledger; this proof covers the
passes run after the rebase, numbered 2 to 45.

#### Iterations 35 to 42
**New findings:** 4 to 8 per pass, 0 BLOCKERs.
- [WARNING] plan and source comments - prose damage from the previous pass's own
  correction --> FIXED each pass
- The rate did not fall as the totals fell, which is the measurement that led to
  freezing the plan's history sections rather than continuing to patch them.

#### Iteration 43
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION.
- [WARNING] plan - a rewrite dropped "review, and", leaving an unterminated
  possessive --> FIXED (c7a8a972)
- [WARNING] plan - an edit deleted a run and produced "prose reworded stays RED",
  the opposite of the truth, inside the very line whose retraction four lines below
  describes that defect --> FIXED (c7a8a972)
- [CONVENTION] plan - two paragraphs left ragged by earlier splices --> FIXED
- Action taken: the plan's history sections were FROZEN, with the rationale that
  every correction is itself an edit and my edits to that file have a measured
  defect rate.

#### Iteration 44
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 CONVENTIONs. First pass in many whose
largest source was the branch rather than my previous commit.
- [WARNING] engine/connect.install-997.test.js:445 - a comment cited "the three
  fail() calls in installClaudeCode" as the sole evidence for deleting an assertion
  arm; this branch took that function from 3 to 5. Verified at both revisions
  (origin/main 3, HEAD 5) --> FIXED (afae5dcd), restated as a mechanism not a count
- [WARNING] engine/connect.install-997.test.js:192 - the assertion pinned
  AGENT_WORKFORCE_* while its message claimed the whole class, and HOME is named in
  the live copy --> FIXED (afae5dcd) by pinning the ADVICE form and permitting the
  DIAGNOSIS, both arms measured first
- [WARNING] engine.runnable-not-directory.test.js:420 - the guard's own failure
  message told maintainers to use line.match(...)[0] while the code uses matchAll;
  measured, [0] keeps only the first match and throws on a non-matching line
  --> FIXED (afae5dcd)
- [CONVENTION] engine.runnable-not-directory.test.js:120 - unused require --> FIXED
- [CONVENTION] engine/connect.install-997.test.js:140 - two new tests sat under a
  header describing different tests --> FIXED by moving the one-line header rather
  than 90 lines of test bodies
- [CONVENTION] engine/*.js - 94% of the diff is comment, +37 code against +548 raw
  --> DEFERRED to kosmos#1730. Reproduced independently before filing. Deferred
  because moving ~190 comment lines is the splicing operation with the measured
  defect rate.

#### Iteration 45
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION.
- [WARNING] engine/github.js:51 - **A PRODUCTION DEFECT, and the first found in 45
  passes.** ghCandidateList split AGENT_WORKFORCE_GH_CANDIDATES, a new production
  env var this branch adds, on a hardcoded ':'. On Windows an override reads
  `C:\tools\gh.exe;D:\alt\gh.exe`, which splits into three fragments that all fail
  isRunnable, so the gh door and ghPresent both report gh missing with no
  diagnostic --> FIXED (0835830f) with path.delimiter
- [CONVENTION] the plan is long relative to 4 repointed call sites --> DEDUPLICATED
  against the iteration-43 freeze decision and kosmos#1730; the reviewer marked it
  non-blocking

## Why iteration 45's finding matters more than its severity suggests

**No test on this fleet could have caught it.** path.delimiter IS ':' on POSIX, so
the defect is invisible to every behavioural arm on every machine here. Measured
with one mutation reverting the fix:

    engine.runnable-not-directory.test.js   19 pass 1 fail   RED
    engine/github.test.js                    4 pass 0 fail   GREEN

That is why the fix ships with a SOURCE pin rather than a behavioural arm, and why
the comment states it is the only arm that can fail. The natural later reasoning is
"the behaviour is covered, this pin is redundant", and on this machine that is
provably false.

**The guard carried the same blindness as the code.** It asserted
ghCandidateList(':'), hardcoding the POSIX separator inside the file whose job is
protecting the platform this branch exists for. Both now use path.delimiter. A
guard blind on the same axis as the code is not a guard. Filed as kosmos#1732.

## Verification

- Full canonical suite via tools/run-tests.sh: **EXIT_CODE=0, 3276 tests, 3276 pass,
  0 fail**, read from the log rather than from a harness line or a tally.
- Iteration 40 audited the guard itself rather than re-running it: 61 of 61
  assertions execute (method validated with a negative arm that dropped it to 60),
  all 20 arms redden under 19 mutations each asserting its substitution applied
  first, and a JS lexer found 0 unterminated comment spans.
- Iteration 45 independently mutation-verified 8 arms, found no decorative arms, and
  confirmed no site that should have been repointed was missed.
- No require cycle: githubdevice to github to devicedoor to runners.

## Honest limits of this proof

1. **converged is false and that is not a formality.** Iteration 45 found a
   production defect. A loop that finds a production defect on its last pass has not
   demonstrated convergence, and this proof should not be read as claiming it.
2. **The zero-BLOCKER record across 45 passes was consistent with a shared blind
   spot, and in one axis it was one.** Every pass ran on macOS. For anything
   touching path separators, line endings, executable extensions, or case
   sensitivity, a green suite here is not evidence about Windows.
3. **Two findings are deferred, not resolved**: kosmos#1730 and kosmos#1732.
