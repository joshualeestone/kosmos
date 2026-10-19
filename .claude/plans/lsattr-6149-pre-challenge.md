---
pre_challenge: true
method: challenge-loop
branch: lsattr-6149
diff_hash: dc60026fb7a83b3cfaecb18bfcf08765513db5129b927dae2f273e6529818e5f
validation: passed (full validation at head 167c5f5f6, 12:09 to 13:40 CDT 2026-10-14, queue included: node 20616 tests, 20373 pass, 0 fail; shell 236 of 236; the helper recorded clean under dc60026fb7a8, this diff)
subdir_audit: passed
timestamp: 2026-10-14T18:41:05Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 4 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION), plus NITs listed below
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0

Origin: every finding is recorded BRANCH by the fail-safe; no blame lookups were run.

REALIMMUTABLE (a real `chattr +i` dot-file) has not run yet: only the pull request's Linux job can set the flag. Its result is read before merge; a SKIP there would also print a clean tally, so the job log is checked for `ok   REALIMMUTABLE`.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above (nothing committed by the loop yet)
- [WARNING] install/setup.sh:1401: `lsattr -R` lists a folder's contents, never the folder itself; an immutable part folder read as a permissions problem, with advice that cannot clear it --> FIXED (6a5dfdb6: `lsattr -d` on the part folder too; SELF arm, whose mutant is dropping -d)
- [WARNING] install/setup.sh:1401: without `-a` lsattr skips dot-files --> FIXED (6a5dfdb6: `-Ra`, skipping each folder's . and .. entries; the real Linux arm now uses a dot-file)
- [WARNING] tools/test-update-locked-app-4455.sh:260: the CONTROL could not catch a case-insensitive filter --> FIXED (6a5dfdb6: the control prints uppercase I and A and a flagged ..; mutants for a case-insensitive match and for not skipping . and .. both turn it red)
- [CONVENTION] install/setup.sh:1396: the lowercase-only match was not explained --> FIXED (6a5dfdb6: said at the code)
- NITs taken in 6a5dfdb6: the dead stub write removed, the record's part asserted, the paths line hoisted in the page.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged**: no new actionable findings. Two NITs taken after convergence in 167c5f5f (the board says "immutable or append-only", as the installer does; the comment says lsattr opens each file).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/setup.sh:1401 | BRANCH | The part folder itself not searched | FIXED | 6a5dfdb6 |
| 2 | 1 | WARNING | install/setup.sh:1401 | BRANCH | Dot-files skipped | FIXED | 6a5dfdb6 |
| 3 | 1 | WARNING | tools/test-update-locked-app-4455.sh:260 | BRANCH | Control blind to a case-insensitive filter | FIXED | 6a5dfdb6 |
| 4 | 1 | CONVENTION | install/setup.sh:1396 | BRANCH | Lowercase-only match unexplained | FIXED | 6a5dfdb6 |

### NITs (non-blocking, not taken)
- The stubs alone cannot prove `-a` against a real lsattr; REALIMMUTABLE does, on the Linux job (iteration 2)

### Strengths (across all iterations)
- One reason vocabulary end to end: setup.sh writes `why=immutable`, the engine accepts it, the board says it, each with a test.
- Every rule in the Linux search has a mutant that turns a check red.
