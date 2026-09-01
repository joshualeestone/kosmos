---
pre_challenge: true
method: challenge-loop
branch: win-provenance-1749
diff_hash: b98a4386da9f355bac12fe7c6031353606a057992cae8e3491d30209d39d3f9d
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T16:19:50Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 produced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 1 NIT | **Deferred:** 1 NIT (with reasoning) | **Asked:** 0

The change stamps `source_sha` (git rev-parse HEAD) and `source_dirty`
(git status --porcelain) into `tools/build-kosmos-windows.sh`'s manifest.json and
warns loudly on stderr when the source tree is dirty, so a dirty/behind PREVIEW
build is no longer byte-indistinguishable from a reproducible origin/main cut
(#1749; the near-miss was on 2026-09-01). STAMP, not REFUSE: a dirty preview is a
legitimate build, so the dirty branch does not exit. Verified END-TO-END in the
real zip both arms: dirty tree -> manifest source_dirty=true + stderr warning;
clean tree -> source_dirty=false, no warning; source_sha==HEAD in both.
Validation: full suite `bash tools/run-tests.sh` 3530/3530; `bash -n` clean.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** - no actionable findings; 4 STRENGTHs confirmed the provenance pair
is coherent with how the build works (it `cp`s the working tree, so a clean sha
identifies the shipped bytes), the shell is robust under `set -euo pipefail`
(git-absent/no-repo/detached-HEAD degrade to unknown/false without aborting),
`source_dirty` is only ever the literal true/false (valid JSON boolean), the
warning is correctly placed before the download and on stderr, and the test's
STAMP-not-REFUSE guard (no `exit` in the dirty branch) pins the load-bearing
decision.
- [NIT] build-kosmos-windows.sh - `source_dirty: false` is ambiguous between
  "clean" and "could not determine" in the near-impossible git-present-but-
  status-fails case --> FIXED (06cdd3bd): documented that source_dirty is
  meaningful only when source_sha is a real sha (in the realistic git-absent
  case, source_sha=unknown is the honest tell).
- [NIT] build-windows-570.test.js - the `dirtyBlock` static test is positional
  (relies on unique anchor strings) --> DEFERRED: it is the best available under
  the file's static-analysis constraint (a full build downloads a runtime); the
  anchors are unique today and the assertion pins the STAMP-not-REFUSE decision.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | NIT | build-kosmos-windows.sh | source_dirty:false ambiguity | FIXED | 06cdd3bd (doc note) |
| 2 | 1 | NIT | build-windows-570.test.js | positional static assertion | DEFERRED | best available under static-analysis constraint |

### Strengths (iteration 1)
- The provenance pair is coherent with the cp-from-working-tree build: a clean sha
  fully identifies the shipped bytes; a dirty tree is honestly flagged.
- Shell robust under `set -euo pipefail`: git-absent/no-repo/detached-HEAD degrade
  to unknown/false without aborting; source_dirty is always a valid JSON boolean.
- The warning is placed before the ~35MB download and on stderr, reaching the
  builder at the moment they act without polluting stdout.
- The test's STAMP-not-REFUSE guard pins the load-bearing decision, not just the
  presence of the stamp.

Note: local `main` was behind `origin/main` (the branch base is origin/main
b4e32f87), so the diff-hash covers already-merged commits. Benign: the proof and
the pre-challenge-gate hook both compute against local `main`, so they agree, and
GitHub diffs the PR cleanly against `origin/main` (only the three #1749 commits).
The shared main checkout was not fast-forwarded because it holds another agent's
uncommitted work overlapping the fast-forward set.
