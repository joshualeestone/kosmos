---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0790
diff_hash: 3a66236f7f08e34492eeb42179398b7edb2af34af5a058c4f06f65451c721ef7
validation: passed (Mortals, full suite: 27090 tests, 0 failed, entry status clean, on head cb37f375b; after it one pool line and the built list changed, and the pool, release-notes and whatsnew tests ran on them. PR CI runs the suite on this head.)
subdir_audit: passed
timestamp: 2026-11-04T23:37:22Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Iteration 1's two copy WARNINGs and its NIT were taken as the reviewer wrote them; words only, so no further round.
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 1 NIT

One new pool item for #7968 and the list rebuilt for 0.7.90.

### Iteration 1
- [WARNING] the pool line implied the offer comes at the rename; driven through Save on a sandbox board, the offer is off-screen and the page moves away --> FIXED: "After you rename a project, its settings offer...". The behaviour is PigeonPete's, on #7968, branch renameoffer-7968; the line stays true either way.
- [WARNING] the release entry's "finishes the update and brings the board back" claims an end-to-end result nobody has seen --> FIXED in ~/.release-entry-0790.html on Mortals: it names only the tmux link error the fix was measured on.
- [NIT] "Many smaller fixes" overstates the range --> FIXED: "A few".
- [STRENGTH] a rebuild into scratch copies is byte-identical for the pool and the list; a build as 0.7.89 differs, so the comparison can fail.
- [STRENGTH] whats-new-check 0.7.90 passes rc 0 for mac (5) and windows (4); 0.7.91 refuses with rc 3.
- [STRENGTH] prod-check passes rc 0: the pool and prod both read 0.7.86.
- [STRENGTH] Windows has not used 0.7.90: both pointers read 0.7.86, and the 0.7.90 zip is 404 where the 0.7.86 control is 200.
- [STRENGTH] the item reaches mac, linux and windows notes.

### Measured by the author
- The rerun on the final head was REFUSED while the older head's run was going (rc 2); I read the log, because my wrapper's exit was 0 either way. So the full suite is on cb37f375b, and the final head differs by one pool line and the built list, covered by those three test files and by PR CI.

### Weakest premise
That #7985 fixes the verb end to end. The entry claims only the tmux link; PigeonPete's real 0.7.89 to 0.7.90 board check runs after this cut, and it is what gates a promote.
