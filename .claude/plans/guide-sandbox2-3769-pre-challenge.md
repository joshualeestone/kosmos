---
pre_challenge: true
method: challenge-loop
branch: guide-sandbox2-3769
diff_hash: 50826529a15d2178902bcf7bb39d01e3135333a54b9dcdad0e399a879d365185
validation: passed
timestamp: 2026-09-25T20:06:39Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 surfaced no BLOCKER or SHOULD-FIX)
**Model rotation:** opus, sonnet, opus, sonnet.
**Validation:** tools/run-tests.sh rc=0 and validation_log_run_or_skip PASSED (hash 50826529a15d) at 74919bcb4,
after merging origin/main (which carries #3797, the fix for the win32 runner test that left backslash-named
files in the worktree and failed the first helper run on a dirty tree).

Built as guide-sandbox-3769 on the pre-merge #3769 branch and replayed onto main after #3777 merged; the four
rounds ran on that code and the two new modules are byte-identical. Full detail per round is in
.claude/plans/guide-sandbox2-3769.md.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] setup-assistant sandbox: allowUnsandboxedCommands false was missing, so a refused command re-run
  with dangerouslyDisableSandbox read the denied file (measured, canary printed) --> FIXED, measured again, tested
- [SHOULD-FIX] a shape-only split key withheld the whole message --> FIXED: masked where its pieces are
- [SHOULD-FIX] held keys missed as upper-case hex, spaced byte pairs, across one blank line --> FIXED
- [SHOULD-FIX] cost at 20,000 held values (545 ms per reply) --> FIXED: capped at 2000
- [NIT] sandbox blocks the guide's internet and writes outside its folder --> DEFERRED (guide is hands-off)

#### Iteration 2
**Reviewer model:** sonnet
- [SHOULD-FIX] lists and tables triggered the second scan --> FIXED with a line-join gate (anchored after my
  first version backtracked quadratically, caught by the CPU test)

#### Iteration 3
**Reviewer model:** opus
- [BLOCKER] my iteration-2 gate left split keys readable (all-letter values, splits near either end) -->
  FIXED: gate removed, every break between key characters joined; cost paid by an 8-character index and a
  shape hint. 0 of 820 split probes leak; permanent tests at every offset with five separators
- [NIT] three or more blank lines, or a list dash after the break --> DEFERRED

#### Iteration 4
**Reviewer model:** sonnet
- No BLOCKER or SHOULD-FIX. [NIT] a numbered-list marker after a break; shapeHint fires on words like
  "risk-free" (one bounded scan, text unchanged) --> DEFERRED, noted in the plan
