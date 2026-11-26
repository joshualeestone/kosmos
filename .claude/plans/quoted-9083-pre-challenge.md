---
pre_challenge: true
method: challenge-loop
branch: quoted-9083
diff_hash: 0d46cde845725eea24ab79a48b34ccc31629bd7107787a24376a11d32e39337f
validation: passed
subdir_audit: passed
timestamp: 2026-11-26T01:09:11Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2: no blocker, no behaviour above a minor; its two test gaps and the minors fixed)
**Fixed:** every finding but kept prose shapes | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full run on this Mac at 95ccf6d501, validation_rc=0 audit_rc=0, rc=0 (19:08 CST 11-25): 31,308 tests, 0 failed, four of four
shell shards. 17 mutations, all red. The rule was tightened once more after iteration 2 (only Bash, Monitor and MCP heads; the notice in
any cut form); no reviewer has seen that last change.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 MAJORs, 4 MINORs, 1 NIT --> FIXED by a rewrite
The head search skipped rows it did not list and any parenthesis made a head, so real refusals were dropped under other heads and after
other rows; the notice test missed its other forms. Rewritten strict: only the first unbroken block of a command or tool, and no notice
in any form.

#### Iteration 2
**New findings:** 0 in behaviour, 2 test gaps, 4 MINORs, NITs --> FIXED, prose shapes kept
Tests for a quoted row above a real one and for a prompt holding a "!"; the notice cut short; tools that may draw no result (Agent,
SendMessage) no longer count as a head. The reviewer found no likely screen that drops a real refusal.

**What the reviews checked and found sound:** wrapped prompts, a second block, and a head above the last 25 rows stay refusals; the
fixtures match how agents are started (no alternate screen); only authFailed and classify read the change.
