---
pre_challenge: true
method: challenge-loop
branch: rereaddiff-7149
diff_hash: c648d6a3cd333f443a953c338d4dfd70e02c00fc90e26a354da7d9499e0a72ba
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-10-25T23:44:55Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (opus and sonnet alternating)
**Converged:** Yes. Iteration 18 found no BLOCKER. Of its three WARNINGs, two repeat earlier findings already answered in the plan (the repo exposure; the missing file after a start mid-send). The third, no log line on a skipped pointer, is a diagnostic gap with a safe fallback, deferred in the plan.
**Total findings:** 1 BLOCKER and about 40 WARNINGs, plus NITs
**Fixed:** most | **Deferred:** the repeats above, the loop valve's counting (not in this change), runners without a start report (they show more, never less) | **Asked (awaiting user):** 0

Validation:
- Full suite on Mortals at 86f9f1a17f (hash c648d6a3cd33) is clean: 23984 tests, 23650 pass, 0 fail.
- 6j skipped on the clean entry.
- Mutants, each committed first and restored with git checkout; every one went red:
  - the no-remember, clause, order, start-copy and unsafe-name guards;
  - the byte cap and the held-section drop;
  - the start that keeps its changes file, case-shared copies, the trailing newline;
  - pairing, the run split, the route hook, the recorded-start gate;
  - the fence, the real-chain remember, create.js forget.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] engine/instructionreread.js prepareChanges/remember — a write followed a planted link at a predictable temp name --> FIXED (securewrite, 0600; test plants a link)
- [WARNING] modes 0644 --> FIXED; held sections advanced the copy --> FIXED; prepared before the skip checks --> FIXED; stale changes file --> FIXED; plan said "does not land" too widely --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] lines cut at 400 chars hid an edit --> FIXED (whole lines, byte cap); removed text in the folder --> FIXED (dropped at the next start; plan); copies outlived agents --> FIXED (forget in delete-leftover); case-shared copy and shared folder --> FIXED (hash, per-session name); start-time window --> plan (not widened)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] old changes file left on the held path, gone, expired --> FIXED; nothing fits names a cut-only file --> FIXED (null); byte cap untested --> FIXED; plan contradictions --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] a failed start renewal kept an old copy --> FIXED (dropped); caps stated for the file --> FIXED (for the diff); runners without a start report --> plan (shows more)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] a cut kept only removed lines --> FIXED (paired); NITs: emptied file, ambiguous "it", missing drop tests --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] "only if you need it" made the sections optional --> FIXED (pointer only, still read them); removed text --> plan; kept verdict file --> FIXED

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the start copy moved on an unrecorded report --> FIXED (kept.recorded); route only source-tested --> FIXED (HTTP test)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] an added heading labelled by the section before --> FIXED (later replaced in iteration 9); start during send --> plan

#### Iteration 9
**Reviewer model:** opus
- [WARNING] iteration 8's label heuristic took a # in an added fence and misfiled lines above a new heading --> FIXED (each line labelled by headsOf at its position; a new label starts a run); start mid-send removes the file --> plan

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] two baselines in the line --> FIXED; UNCONFIRMED --> plan; repo exposure --> repeat

#### Iteration 11
**Reviewer model:** opus
- [WARNING] a refused start untested --> FIXED (stubbed HTTP arm); bare -/+ read as live bullets --> FIXED (each run in a diff fence)

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] the plan overstated when a person's edit is announced --> FIXED; repo exposure --> repeat

#### Iteration 13
**Reviewer model:** opus
- [WARNING] the real chain never ran end to end --> FIXED (start copy, landed line, only the newer change next time; UNCONFIRMED keeps its file)

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] the header did not say the file is a pointer --> FIXED; the rest repeat earlier findings

#### Iteration 15
**Reviewer model:** opus
- [WARNING] create.js did not forget on a reused name --> FIXED; the header ranked changes --> FIXED

#### Iteration 16
**Reviewer model:** sonnet
- [WARNING] the forget calls were source-tested only --> FIXED (behaviour tests in delete-leftover.test.js); the line could read as ignore the rest --> FIXED

#### Iteration 17
**Reviewer model:** opus
- [WARNING] iteration 16's wording called removed lines current --> FIXED (+ is current, - no longer applies); the header claimed completeness for a cut file --> FIXED

#### Iteration 18
**Reviewer model:** sonnet
- [WARNING] repo exposure --> DEFERRED (repeat; accepted in the plan); file named but removed mid-send --> DEFERRED (repeat; plan); no skip log line --> DEFERRED (diagnostic; plan)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/instructionreread.js | BRANCH | write followed a planted link | FIXED | securewrite |
| 2 | 2 | WARNING | engine/instructionreread.js | BRANCH | a cut line hid an edit | FIXED | byte cap |
| 3 | 5 | WARNING | engine/instructionreread.js | BRANCH | a cut kept only removed lines | FIXED | pairing |
| 4 | 6 | WARNING | engine/instructionreread.js | BRANCH | sections made optional | FIXED | pointer only |
| 5 | 7 | WARNING | server.js | BRANCH | copy on an unrecorded start | FIXED | kept.recorded |
| 6 | 9 | WARNING | engine/instructionreread.js | SELF | iteration 8's labels | FIXED | headsOf per line |
| 7 | 11 | WARNING | engine/instructionreread.js | BRANCH | -/+ as live bullets | FIXED | diff fences |
| 8 | 15 | WARNING | engine/create.js | BRANCH | reused name kept a copy | FIXED | forget |
| 9 | 17 | WARNING | engine/instructionreread.js | SELF | removed lines called current | FIXED | wording |
| 10 | 18 | WARNING | engine/instructionreread.js | BRANCH | no skip log line | DEFERRED | plan |

### Strengths (across all iterations)
- every failure falls back to the line exactly as before, and every race leaves the copy older (the diff shows more, never less)
- both files go through securewrite (0600, no link followed), names are allow-listed and hashed, and a path that could be misread is never named
- changedLines matched a reference LCS across tens of thousands of fuzz cases, with balanced output fences
