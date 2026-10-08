---
pre_challenge: true
method: challenge-loop
branch: installgate-5359
diff_hash: 5aa3932df5d98055030fbfbb4577970c415115e12bf7b3ced9ddf53fd29da6bc
validation: deferred to the re-cut's step 4b (Splinter 05:31; the gate could not run before merge, see Summary)
subdir_audit: passed
timestamp: 2026-10-08T10:31:59Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned no BLOCKER, WARNING or CONVENTION)
**Total findings:** 1 actionable (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs) plus NITs
**Fixed:** 0 | **Deferred:** 1 | **Asked (awaiting user):** 0
**Validation:** by Splinter's decision (05:31 CDT): this one-entry change to tools/test-install.sh EXPECTED_ADDS is a 0.7.28 cut blocker, and the full queued suite on Mortals was hours away. I tried to run tools/test-install.sh itself (the exact gate that failed) on the fix on Mortals: the bundles built (ad-hoc signed, the keychain is locked over ssh), but the install harness refused to start beside other agents' running suites and gave up after its 1200 s wait, so it did NOT run. So the measurements are the PR's GitHub CI and the re-cut, which claims the machine with release priority and runs the whole suite and this exact gate (step 4b) on the shipped tree before anything is served. The re-cut's 4b added-files line is checked explicitly.
**Reviewer models:** opus (1), sonnet (2).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] .claude/plans/installgate-5359.md - the only real measurement is the next cut's step 4b, not bash -n --> DEFERRED: inherent (the gate boots a real board from a built bundle); acted on by running the gate on the fix before merge and by checking the re-cut's 4b added-files line, not just its exit code
- [NIT] tools/test-install.sh:213 - the comment's reason could say the file is written before the board listens
- [NIT] tools/test-install.sh:216 - the sort-order paragraph names only the older entries
- [NIT] tools/test-install.sh:492 - an older comment calls EXPECTED_ADDS not the place for boot writes (pre-existing)
- [NIT] engine/restartnote.js:41 - a beat's tmp file could in theory appear in the snapshot (practically unreachable)
- [STRENGTH] sort order verified under C, en_US.UTF-8 and the ambient locale; the file is always written before the board answers; board-restart-note.json cannot appear on a fresh install; nothing else compares against EXPECTED_ADDS

#### Iteration 2 (sonnet)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | .claude/plans/installgate-5359.md:7 | BRANCH | only the re-cut's 4b measures the fix | DEFERRED | gate run on the fix before merge; re-cut 4b line checked |

### NITs (non-blocking)
- comment wording at tools/test-install.sh:213 and :216 (iterations 1, 2); a pre-existing contradictory comment at :492 (1); a theoretical tmp-file race (1)

### Strengths
- One minimal entry plus the list's per-file comment; the structural gap (the gate runs only in the cut) is carded separately as #5584.
