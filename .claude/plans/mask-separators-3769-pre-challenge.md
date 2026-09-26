---
pre_challenge: true
method: challenge-loop
branch: mask-separators-3769
diff_hash: a96e1a8878ea3b075727990d6c81307103d979bd42d88d8b3a130a28e9139e2a
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T10:49:20Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced no new defect; its WARNING was a documentation scope
finding, documented and filed as #3935).

Validation clean at a96e1a88 (full tools/run-tests.sh stack, 0 failures). engine/secretmask.test.js
21/21; server.guide-secrets-3769.test.js green. Every new rule has a red arm (see the plan).

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] the separator join had no locality bound: a held value two far-apart words spelled
  masked 4065 characters of a table --> FIXED: bound on the span, test with the repro
- [WARNING] (pre-existing, live) normalisedCopy's code-point position map leaked a split key's tail
  after emoji --> FIXED: UTF-16 map, test
- [WARNING] letter-made separators, shuffled chunks, cross-reply splits --> DOCUMENTED as gaps

#### Iteration 2
- [BLOCKER] the bound measured raw distance, so column padding leaked the whole key --> FIXED:
  count non-whitespace only; aligned-table test reds on the old bound

#### Iteration 3
- No new defect. [WARNING] the gap "four or more key characters between pieces" covers most real
  tables (word labels, other columns, bullet text) --> DOCUMENTED precisely, follow-up #3935
- [NIT] a cost test with held values at the cap --> ADDED
- [NIT] nonSpaceIn short-circuit --> DONE

### Final Ledger

| # | Iter | Category | Description | Status |
|---|---|---|---|---|
| 1 | 1 | BLOCKER | unbounded span swallowed text | FIXED |
| 2 | 1 | WARNING | code-point map leaked after emoji | FIXED |
| 3 | 1 | WARNING | letter separators / shuffle / cross-reply | DOCUMENTED |
| 4 | 2 | BLOCKER | raw-distance bound leaked padded tables | FIXED |
| 5 | 3 | WARNING | word-noise gap understated | DOCUMENTED, #3935 |
| 6 | 3 | NIT | cost test at the cap | FIXED |
| 7 | 3 | NIT | nonSpaceIn short-circuit | FIXED |
