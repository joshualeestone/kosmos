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
