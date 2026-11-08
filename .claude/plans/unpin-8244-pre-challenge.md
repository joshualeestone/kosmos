---
pre_challenge: true
method: challenge-loop
branch: unpin-8244
diff_hash: d0c7a38007dbb3096d7db77f299b979327e49dadb2c10e5d3eec132cd278a59e
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T20:58:57Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs)
**Fixed:** 0 | **Deferred:** 1 | **Asked (awaiting user):** 0

Validation: full suite on this exact head (28102 tests, 27669 pass, 0 fail, 433 skipped, entry status clean, base eab7dba2af).
By hand, because local validation runs node only: tools/test-ci-runner-route-5488.sh, tools/test-ci-created-url-6742.sh,
tools/test-light-side-4911.sh and tools/test-mktemp-template-4298.sh all exit 0.
Exact restore: `git diff c2690b1bf5 HEAD` on the four restored files is empty.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] .github/workflows/test.yml:167 -- not yet proven on 26.04 --> DEFERRED: by plan, this PR's own CI on ubuntu-latest is the proof. Before merging, read both shard job logs for the runner image.
- [NIT] .claude/plans/unpin-8244.md:1 -- no timestamp in the name; matches the plans directory's practice.
- [NIT] .github/workflows/test.yml:167 -- a floating label brings back the exposure of an image move; the card accepts this.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings.
- [NIT] tools/test-install-sbroot-6275.sh:14 -- dated measurement comments stay true.
- [NIT] .github/workflows/linux-family-install-7281.yml:42 -- other jobs pin ubuntu-24.04 deliberately; out of scope.
- [NIT] .claude/plans/unpin-8244.md -- the proof depends on this PR's CI.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | .github/workflows/test.yml:167 | BRANCH | Not yet proven on 26.04 | DEFERRED | The PR's CI is the proof, by plan |

### Strengths (across all iterations)
- An exact restore, checked by content, of the four files the pin changed.
- The route test pins both the default and the runs-on fallback, and a mutant of either goes red (iteration 1).
- The plan commits to re-pinning and filing a new card if another 26.04-only red appears, rather than widening this PR.
