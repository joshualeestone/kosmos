---
pre_challenge: true
method: challenge-loop
branch: taskowner-9201
diff_hash: 03100db10d89e845b9156bdab0f311e822de0e2cff709a658e5135695c3fcaf6
validation: local (cli.task-ownername-9201, cli.task-listmarks-9188, engine/projects.markwords-9179, server.task-built-3951, fixture-discipline: 43/43 on the rebased head); every task-list test file (80 files, tools/run-tests.sh --only, heavy queue turn) 1520 tests 0 failed on bb0bfb9551, the same change before the rebase onto main; the full suite runs on the PR's CI
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-27T08:52:35Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes. Round 2 (whole branch, fresh blind reviewer) found nits only, all fixed.
**Findings:** round 1: 2 SHOULDs (a trailing blank-looking character the fold keeps hid the bracket; U+FD3F is an opening bracket), 2 NITs; round 2: 3 NITs (comments, residual not stated, reach of the quoting) and 1 red in the PARENT branch (#9188's server.task-built-3951 fixture), measured with this rule removed and reported to its owner, who fixed it.
**Fixed:** all. **Residual, stated in the code:** a bracket-shaped character that is not a bracket (U+23A0, U+A4B1), or a modifier letter after the bracket (U+02D1, U+0640), prints unquoted.

### Per-Iteration Breakdown

#### Iteration 1 (blind reviewer, commit 09fdeadb20)

- [WARNING] engine/markwords.js ENDS_IN_BRACKET: `"fix (otto)"` and `"fix (otto)\u{1D159}"` returned false. The fold keeps private-use and some blank-looking characters, so a last-character test missed the bracket (measured). Fixed: the last bracket followed only by non-letters and non-digits.
- [WARNING] same line: U+FD3F reads as a right parenthesis but has been Ps since Unicode 14, so `"fix (otto﴿"` printed bare (measured). Fixed: Ps and Pe both count.
- [NIT] titles like `foo()` are quoted too. Accepted and stated as the cost.
- [NIT] an unused MAC_HOME_OLD in the test. Removed.
- [STRENGTH] checked clean: both printers hand the title to usesListMarkWord the same way; marks after the words all begin with a space and a bracket; webhook rows are already quoted; the test fails with the rule removed.

#### Iteration 2 (fresh blind reviewer, whole branch, 945992aab4)

- [NIT] the comments said "last character" after round 1 changed the rule. Fixed.
- [NIT] a bracket-shaped character that is not a bracket (U+23A0, U+A4B1), or a modifier letter after the bracket, prints unquoted. Stated in the code as a residual.
- [NIT] usesListMarkWord also reaches titleOf (the compact list, the across list, task show), where quoting protects nothing. Stated in the comment.
- [WARNING] parent branch: server.task-built-3951.test.js failed on #9188's branch ("Listed as built" is now quoted). Measured with this rule removed, the same failure, so it is #9188's. Reported to Mona Lisa, who fixed it in 756ead4292; this branch is rebased onto that fix.
- [STRENGTH] regex cost: quadratic only on an adversarial 20k-character title; titles are capped at 200 (SENTENCE_MAX), about 1 ms. Not a finding.
