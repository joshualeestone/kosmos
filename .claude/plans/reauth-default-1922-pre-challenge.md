---
method: challenge-loop
branch: reauth-default-1922
diff_hash: 6237119ecf3464c545cb79ae4861f5de1f41f4a0d2bd68f6fc03e84837acddfc
iterations: 39
converged: 2026-09-06
---

# Pre-PR review proof, kosmos#1922

**Converged after 39 iterations**, each a fresh blind reviewer with no memory of the previous rounds.
Convergence was taken on TWO consecutive clean rounds, not one, because round 38 ran on a prompt whose
weighting I had changed and **a clean result from an instrument just adjusted is a property of the
instrument until a second one agrees** (round 31 proved that: a clean round on an adjusted prompt was
hiding a real MEDIUM, found by a neutral control round).

- **Round 38**: clean on code, tests and PR body. Asked to construct a mutation the suite does NOT
  catch, and could not.
- **Round 39**: clean on a fully NEUTRAL prompt, full scope, self-chosen priorities.

## What is mutation-proven, reproduced independently by multiple reviewers

| mutation | result |
|---|---|
| route -> `configDir: known.dir` (pre-fix) | default route arm RED, control green |
| route -> `configDir: null` for all accounts | route CONTROL red, default arm green |
| drop `cmd.push('-u', 'CLAUDE_CONFIG_DIR')` | default launch arm RED, control green |
| push `-u` unconditionally | launch CONTROL red, default arm green |
| **`-u` moved AFTER the binary** (exit 0, silent leak) | **RED at the grammar walk** |

The two halves fail in opposite directions: the first pair proves each production edit is guarded, the
second proves those guards are not vacuous by reddening on the over-broad fix that would satisfy the
first pair. **The fifth is the one that matters**: that argv passes the presence, no-re-assignment and
ordering assertions by construction and still leaks, and only the operand walk rejects it.

## Verified on the rebased head

Rebased onto current main (49 commits replayed, 0 conflicts), both shipped edits confirmed BY CONTENT
after the replay, and the `-u` verified to still precede the binary operand, which is the property a
replay could silently break. Full validation: ran (not skipped), **4890 pass / 0 fail / 0 skipped**,
zero FAIL-shaped lines, hash matching this file's `diff_hash`.

## Known gaps, disclosed rather than implied

- Nothing composes the route ternary through to the launch argv; both halves are covered separately.
- The automated suite does not exercise the `-u` arm against a real tmux. **It has been measured by
  hand** (tmux 3.6a, cold and warm servers, each arm on equal footing, control returning the leaked
  value in both states) and that measurement is recorded in the PR body as manual, not as coverage.

### Final Ledger

Condensed from the per-iteration records in `.claude/plans/reauth-default-1922.md`, which carries the
full text for rounds 1 to 37. Severity is as the reviewing agent reported it.

#### Iteration 1-11 (code defects)
- [BLOCKER] The fix alone opened a gate onto a flow that cannot repair a dead credential; bypass removed.
- [BLOCKER] `env FOO=1 -u X` exits 127, so an assertion loosened on a "order-independent" rationale
  passed on an argv that cannot launch at all.
- [BLOCKER] `env <bin> -u X` exits 0, hands the CLI junk flags and NEVER strips the variable. The
  silent form of the defect, passing green. Operand walk added; this is the assertion that still
  catches the fifth mutation today.
- [WARNING] Route arm and launch arm each needed a CONTROL to prove the guard was not vacuous.

#### Iteration 12-20 (claim defects in shipped source)
- [BLOCKER] The PR body shipped verbatim an absolute that iteration 15 had already retracted.
- [BLOCKER] A false post-fix universal ("the gate holds shut on every default-account machine") that
  this branch's own passing test refutes.
- [WARNING] Five separate absolutes whose citation measured something narrower than the sentence.
- [CONVENTION] Retraction archaeology in shipped source; deferred after measuring that 13 of 22 sites
  were pre-existing house style.

#### Iteration 21-29 (documentation accuracy)
- [WARNING] Three `grep -n` citations that never reproduced, one because the anchor phrase spans a
  hard wrap. A commit message had asserted they were "verified empty".
- [BLOCKER] A recorded command was not the command executed: a pathspec dropped in transcription.
- [BLOCKER] The PR body credited this branch with a test pre-existing on `origin/main`.
- [BLOCKER] A stated remedy ("pin every figure to an immutable sha") falsified by its own prediction;
  figures deleted rather than pinned again.
- [WARNING] A repo-wide absolute sourced from a grep of one file.

#### Iteration 30-37 (citations and bookkeeping)
- [MEDIUM] A "reproducible command" that was itself case- and lexically narrow, undercounting ~7x.
- [LOW] Citations pinned to commits reachable from no ref; disclaimer scoped to the sections above it.
- [LOW] Live-tense claims ("the current hash") inside a permanent record.
- [LOW] Two counts obtained by reading a printed list rather than running `grep -c`.
- [STRENGTH] Reviewers independently reproduced all five mutation arms in every round from 30 onward.
- [STRENGTH] One reviewer built the missing real-tmux experiment; a later round found its three arms
  sat on different server states, and the like-for-like re-run closed the gap properly.

#### Iteration 38
No issues found in the code, tests or PR body. Asked to construct a mutation the suite does not catch,
and could not. [STRENGTH] Every shape tried either reddens an arm or is behaviourally identical.

#### Iteration 39
No issues found. Neutral prompt, full scope, self-chosen priorities. [NIT] noted only that the proof
file did not yet exist, which is expected process state and is this file.
