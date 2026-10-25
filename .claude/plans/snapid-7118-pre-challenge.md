---
method: challenge-loop
branch: snapid-7118
diff_hash: 73060a5ba33057c551f6fc448a96d0912c84162edb61f8654cef3c616ad9a7fa
timestamp: 2026-10-25T15:44:20Z
iterations: 2
converged: true
---

# Challenge-loop proof: snapid-7118 (kosmos#7118, Mac half)

The plan (.claude/plans/snapid-7118.md) records the call and the corrected safety argument.

#### Iteration 1 (blind review of both halves)
No BLOCKER.
[WARNING, corrected on the card] A coordinator holding the id can roll back to an older manifest of the same period;
restore must label by the id's own time, never by granted_at.
[WARNING, fixed] A new Mac against an old coordinator would lose the id silently: the grant must now echo it, and a
grant without the echo is refused before any byte is sent.
[NIT, recorded] The coordinator reads an explicit null as absent; the Mac refuses it and never sends one.
[NIT, recorded] The end-to-end test (a real coordinator record to an opened manifest) waits for restore's driver.

#### Iteration 2 (author, against the fix)
No new finding above NIT. The echo check's arm reds the older-coordinator test.

### Final Ledger
- Converged at iteration 2. 217 of 217 in the three backup files.
- Full validation at c2dfb75a5c: 23904 tests, 0 fail.
- Four mutation arms red, each restored.
