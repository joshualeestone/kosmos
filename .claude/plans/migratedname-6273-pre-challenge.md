---
pre_challenge: true
method: challenge-loop
branch: migratedname-6273
diff_hash: f6eefe17c7489610f7b8c75292f988b50289044bf8112855d323b031fb832a35
validation: passed
subdir_audit: passed
timestamp: 2026-10-16T05:50:10Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus odd, sonnet even)
**Converged:** Yes. Iteration 8 was NO FINDINGS.
**Validation:** full suite at 4f8749411 PASSED on the third run: 20835 pass, 0 fail, hash f6eefe17c748. Runs 1 and 2 each failed exactly one test, both in cli.busy-health-4466.test.js (load timing; the file passed 54/54 alone both times; evidence on #5727). This branch touches engine/policy.js and its tests only.
**Focused:** 364/364 across the 13 test files that touch the policy name, read or re-read. Mutants are red for every guard: the rename on read, the id check, the clash check, the version guard, the version-4 case, the pending save, and the rename of the clashing entry. Two mutants are equivalent and explained in the plan.

kosmos#6273: a policy record saved before #685 migrated under "Company AI policy", which heads the person's own policy as a company's once policies stack. It is now named "AI policy". DEFAULT_NAME stays the company policy's fallback name.

## Iterations

### Iteration 1 (opus)
- [WARNING] A rename BACK to "Company AI policy" was reverted on every read while the page said "Renamed". Fixed: persist() writes version 3, and only a pre-#6273 record is renamed.
- [NIT] Two stale comments and one stale test title. Fixed.

### Iteration 2 (sonnet)
- [NIT] `!==` treated a future version 4 as old. Fixed: "older than 3", with an arm.
- [NIT] A downgrade then upgrade renames once more. Accepted; in the plan.

### Iteration 3 (opus)
- [WARNING] A company policy NAMED "AI policy" beside the renamed one. Decided: two near-equal headings, each with a true provenance line, pinned by a test. Rejected skipping the rename, because the next save would keep the false name for good.
- [NIT] A non-number version. Fixed: only a real number counts.

### Iteration 4 (sonnet)
- [NIT] The DEFAULT_NAME comment told the old story. Rewritten.
- [NIT] Review-round labels in comments. Dropped.

### Iteration 5 (opus)
- [WARNING] A save during a name clash wrote version 3 and froze "Company AI policy" for good. Fixed: read() reports renamePending, and saves stay at version 2 until the rename applies. 2 mutants red.

### Iteration 6 (sonnet)
- [NIT] A re-ingest of p1 during a clash was untested. Arm added.
- [NIT] A test message read as inverted. Kept: messages describe the failure.

### Iteration 7 (opus)
- [WARNING] Renaming the clashing entry away was untested; a mutant that saves v3 there survived. Arm added; mutant red.
- [NIT] Comment wording. Fixed.
- [NIT] A same-name rename could settle the old name. Fixed: it saves nothing. This removed a dead branch for p1; the no-op is an equivalent mutant for the version and stays to skip a pointless write.

### Iteration 8 (sonnet)
- NO FINDINGS.
