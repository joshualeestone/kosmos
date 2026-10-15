---
pre_challenge: true
method: challenge-loop
branch: winusage-6213
diff_hash: 61e4a7fd14abb47bfb9c15990e13a7ad91c998d99315bf0b4e285dc3559b455a
subdir_audit: passed
timestamp: 2026-10-15T11:05:37Z
converged: true
---

## Final ledger: 7 iterations, alternating Opus and Sonnet, converged at 7

### Iteration 1 to 3
- [BLOCKER] the uninstall left the status line in place -> FIXED (engine/win32uninstall.js unwireStatusLineOne).
- [WARNING] a non-ASCII folder name was written unshortened -> FIXED (refused unless its 8.3 name is safe).
- [WARNING] an unreadable folder was read as gone; a busy lock was reported finished -> FIXED.
- [WARNING] an 8.3 claim real Windows contradicts (apostrophe, & ( ) ! survive) -> FIXED (such folders refused).
- Full list #1 to #15 in the commit messages of iterations 1 to 3.

### Iteration 4 (Sonnet)
- [WARNING] a clean "no short name" was never cached (up to 3 cmd.exe per set-up) -> FIXED.
- [WARNING] a person's my-kosmos-statusline.js could be taken out as gone -> FIXED (token must BE the script).
- [CONVENTION] dead platform parameter on weeklyBlockedOf -> FIXED.
- [CONVENTION] web 'windows' copy now unreachable -> REJECTED: older saved readings may still carry it.

### Iteration 5 (Opus)
- [WARNING] a timed-out lookup read as permanent "Windows has no short name" -> FIXED (undefined + retry message).
- [CONVENTION] stale function name in a doc comment and the plan -> FIXED.
- [NIT] test header misdescribed how CI picks the file; a missing folder's answer could be cached -> FIXED.

### Iteration 6 (Sonnet)
- [WARNING] no test drives unwireStatusLineOne -> FIXED: two end-to-end cases in engine/win32uninstall.unhooks-5999.test.js. My earlier deferral (Windows-only) was wrong; that suite runs the whole Windows uninstall on the Mac.
- [NIT] ~/... or a bare kosmos-statusline.js could be read as gone -> FIXED (drive-qualified token only).
- [NIT] garbled WIN_SAFE comment -> FIXED.

### Iteration 7 (Opus)
- NO NEW FINDINGS at BLOCKER, WARNING or CONVENTION.
- [NIT] two stale comments -> FIXED.

Rejected, with reasons in the plan: quoting for one shell, ~/ paths, powershell -File, removing the web 'windows' copy.

## Evidence
- Mutants M1 to M8, each red on the test meant to catch it (gone-token match, null cache, existence rule, undefined
  propagation, the uninstall call, left vs notes, drive-qualified token).
- Full validation on 37296fb232 (main at that time, after the #6206 reader fix): node 20,845 tests, 0 fail; shell
  239/239. PASSED, hash 61e4a7fd14ab.

## Weakest premise
None of this has run on Windows. engine/allowance.win32-6213.test.js runs the real command in Git Bash, powershell.exe
and pwsh.exe on the Windows CI job, which is the first real evidence. The merge gate is a real Windows computer: the
command runs in both shells, the script receives its stdin, a reading appears on the row, an uninstall takes it out.
