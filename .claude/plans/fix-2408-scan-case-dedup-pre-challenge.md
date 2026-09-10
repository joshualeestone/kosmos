---
pre_challenge: true
method: challenge-loop
branch: fix-2408-scan-case-dedup
diff_hash: 8772c076c5ea92d2b5921e882d1edc31d307863db821ca8c6a7161149021a5ec
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T15:14:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found no issues)
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 1 NIT, many STRENGTHs
**Fixed:** 1 real fix + 3 WARNINGs (2 by revert, 1 by revert) + 1 CONVENTION + 1 NIT | **Deferred:** 0 | **Asked:** 0

Card: joshualeestone/kosmos#2408. The disk scan (`engine/discover.js` `scan()`) double-counted
case-variant roots (`projects`/`Projects`, `Kosmos`/`kosmos` in SCAN_DEEP_NAMES) on a
case-insensitive volume, because the `seenDirs` de-dup was keyed on `fs.realpathSync`, which on
macOS preserves the input path's case. Full suite 5063/5063/0 on the final HEAD.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs
- [WARNING] discover.js -- byFile declaration comment still said "keyed by canonical realpath" (the first commit had also switched the loose-file key to dev+ino) --> FIXED by REVERTING the loose-file change
- [WARNING] discover.js -- the TCC-hatch-merge comment asserted byFile is realpath-keyed --> FIXED by the same revert (comment true again)
- [WARNING] test -- the loose-file change shipped with no test; PROVEN unnecessary: reverting the loose key reds no test, because seenDirs (dev+ino) skips the re-walk of a case-variant root, so a loose file under it is never re-collected --> reverted the loose change (seenFiles stays realpath, load-bearing for symlinked loose files), removed the vacuous loose test, added a NOTE

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION
- [CONVENTION] plan -- the plan's Fix section still described applying the key to BOTH seenDirs and the loose-file path ("fix the class") after iteration 1 reverted the loose change --> FIXED (plan corrected to seenDirs=dev+ino, seenFiles=realpath-unchanged, with the reasoning); also tightened the byFile NOTE to state realpath is load-bearing for symlinked loose files

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] discover.js -- the (dev,ino) key used numeric fs.statSync, so a 64-bit inode past 2^53 could lose precision and mis-collapse two distinct dirs (an edge the realpath string key did not have) --> FIXED with fs.statSync(dir,{bigint:true}) + dev/ino .toString(), an exact 64-bit key. (A NIT does not block convergence, but a de-dup key that can mis-collapse is the exact class this card removes, so it was worth the one-line exact fix.)

#### Iteration 4
**New findings:** 0. **Converged** -- no issues found. Five STRENGTHs confirmed the bigint key
stringifies stably (no `n` suffix, no 2^53 loss), bigint statSync is available on the target Node
26.8.1, no stale consumer of the old numeric/path semantics, TOCTOU cleaner, symlink handling
intact, and the regression test valid.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | discover.js | byFile comment stale ("canonical realpath") | FIXED (revert loose change) |
| 2 | 1 | WARNING | discover.js | hatch-merge comment asserted byFile realpath-keyed | FIXED (same revert) |
| 3 | 1 | WARNING | test | loose-file change untested (proven unnecessary) | FIXED (reverted loose change + NOTE) |
| 4 | 2 | CONVENTION | plan | plan drift (claimed loose change applied) | FIXED |
| 5 | 3 | NIT | discover.js | numeric inode key could lose precision > 2^53 | FIXED (bigint) |

### Outstanding questions (ASKED)
None.

### The fix (final)
`scan()`'s directory-visit de-dup `seenDirs` is keyed on the physical-directory identity
`(st.dev, st.ino)` via `fs.statSync(dir, {bigint:true})` + `.toString()`, not on
`fs.realpathSync(path)`. That collapses case-variant roots AND symlink aliases on a
case-insensitive fs, keeps genuinely-distinct dirs distinct on a case-sensitive fs, and cannot
lose precision. The false "realpathSync collapses [case variants]" comment is corrected. The
loose-file de-dup (`seenFiles`/`byFile`) is intentionally unchanged from #1652 on realpath
(seenDirs guards its case-variant upstream; realpath is load-bearing for symlinked loose files).

### Scope
Fixes the OVERcount (an agent under a case-variant root offered twice). Josh's 0.6.45 "2 of 7"
UNDERcount is a separate, larger diagnosis tracked in #2410 (Gemini `.gemini/agents/` + Work1
`.claude-work1` dotdir skip + YAML name parsing) and the non-dotdir location-coverage work; this
fix removes the case-variant-via-budget variable, narrowing that.

### Strengths (across all iterations)
- `(dev,ino)` is the correct physical identity; strictly stronger than the realpath it replaces.
- The class-vs-instance decision was reasoned, not reflexive: the loose-file change was reverted
  on evidence (seenDirs guards the case variant; realpath is load-bearing for symlinks).
- The regression test is perturbation-valid and case-insensitivity-detecting; the absent
  loose-file test is honestly explained (vacuous, because seenDirs catches the case variant first).
- No web/ surface, so no #1720 browser-check concern.
