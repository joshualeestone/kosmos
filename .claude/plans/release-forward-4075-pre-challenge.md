---
pre_challenge: true
method: challenge-loop
branch: release-forward-4075
diff_hash: acc40545f20f308ad8de20d2cb2f0137307e3fc802f4654771ed5512e2da6ba7
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T04:42:11Z
iterations: 4
converged: true
---

# Challenge loop proof: release-forward-4075 (#4075, release.sh refuses a version that does not move forward)

Four blind reviews, alternating Opus and Sonnet. The ledger is in the plan `.claude/plans/release-forward-4075-*.md`.
Validation rc=0 and subdir audit rc=0 at a64413e25 (run 2). Run 1 was red only on server.phonenotify-718, which the
branch does not touch and which passed 14/14 alone three times; it was not counted. Coarse browser-check gate rc=0
(no web/ change).

## Per-iteration findings
- Iteration 1 (Opus): 4 NEW.
  - [BLOCKER] The override was unusable, because step 3's suite inherited it and refused the cut. FIXED: the script
    unsets it, and the sandbox strips it. The regression test runs with it exported.
  - [WARNING] The check failed open, and node read "--version" as its own option. FIXED: the bash format check runs
    first, then "--", then a fail-closed case.
  - [WARNING] The override also waived the three-numbers check. FIXED.
  - [NIT] A behind-origin comment.
- Iteration 2 (Sonnet): 2 NEW.
  - [WARNING] The skip message hardcoded major 0. FIXED.
  - [NIT] An unparseable current version was skipped silently. FIXED (fails closed).
  - [NIT] x2, left.
- Iteration 3 (Opus): 3 NEW.
  - [WARNING] Leading zeros were a second spelling (0.07.00). FIXED with a strict pattern.
  - [WARNING] An octal-looking minor could drop the refusal's exit. FIXED (10#, and the strict pattern).
  - [CONVENTION] A false comment about a behind checkout. FIXED, with a pull-first hint.
  - [NIT] x2. FIXED or noted.
- Iteration 4 (Sonnet): 0 NEW BLOCKER, WARNING or CONVENTION. CONVERGED.
  - The reviewer replayed the repo's whole package.json version history under the guard and found nothing it would
    wrongly refuse.

## Evidence
- tools.release-gate.test.js 49/49, sandbox copies only. Disabling the check makes 8 fail. Removing the format check
  makes 2 fail. Removing the env strip (with the override exported) makes 8 fail.
- The other release tests: node 58/58, and 15 cut/release shell tests.
