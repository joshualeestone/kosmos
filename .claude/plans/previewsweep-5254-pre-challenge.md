---
pre_challenge: true
method: challenge-loop
branch: previewsweep-5254
diff_hash: 171cbd664e43b3ac727ff4f0b3d178b6ec87532542c34d9b795acdd3da49d65e
validation: rebased onto main (past the merged #5119, then current main); 55 files (every board-booting test, the preview, download and gate tests, the file-scanning and Windows guards) 1257 pass 0 fail at b2a91b3d9; both browser-check gates rc 0; controls: the symlink and crashed-render arms fail on the previous filepreview.js, the liveness arms fail when other processes are read as dead
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-06T13:07:56Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3. Round 1 (10-04): the first-render race (BLOCKER), fixed. Round 2 (10-06, a second, independent
reviewer after the rebase): 0 BLOCKER, 3 WARNING, 3 NIT. Round 3 (the round-2 fixes only): 0 BLOCKER, 2 WARNING, 4 NIT.

### Iteration 1 (10-04)

- [BLOCKER] A sweep during a first render took its folder. Fixed: a folder with a render in progress is skipped, and a
  folder with no record is left until it is YOUNG_MS old.
- [STRENGTH] The record is mode 0600, written to a temp file and renamed, only beside a page that exists.

### Iteration 2 (10-06)

- [WARNING] filepreview.js sweep: a symlinked cache folder let the sweep remove old record-less folders outside the
  data folder (reproduced). Fixed: sweep runs only when lstat says the cache folder is a real folder.
- [WARNING] A render folder left by a crash shielded its folder, and its full PDF copy, forever (reproduced). Fixed: a
  render folder protects only while its process is alive and it is younger than YOUNG_MS by the real clock.
- [WARNING] No test for an unreadable projects list. Added, with a control (an empty list sweeps).
- [NIT] The unreadable removed-agents test could not fail. Fixed: it names the agent.
- [NIT] A PDF reachable by two owners keeps the last viewer. Decided, kept: no leak, the other owner still lists it.
- [NIT] A removed agent with its folder on disk sees "could not draw" for a page swept right after. Decided, kept.
- [STRENGTH] Board start is not slowed (no cache folder: first readdir returns); the hourly timer is unref'd; two
  sweeps cannot interleave inside the board; archived projects and stopped agents keep their pages.

### Iteration 3 (10-06)

- [STRENGTH] The lstat guard is the first read; a symlink, a file or a missing path all return { removed: 0 }.
- [STRENGTH] The liveness rule uses the real clock, which keeps the round-1 race test honest under an injected now.
- [WARNING] A render folder whose removal failed still shielded the folder. Fixed: it is judged and removed whole.
- [WARNING] Tests never exercised another live process or EPERM. Added both, plus pid reuse (alive and old: removed);
  control: reading every other process as dead fails them.
- [NIT] An emptied crashed folder survives one more sweep (its mtime moved). Decided, kept: the PDF copy is gone.
- [NIT] The plan overclaimed that every new arm fails on the old code. Fixed.
- [NIT] Two test cleanups are not in finally blocks. Decided, kept: both inside the sandbox, nothing leaks.
- [NIT] One comment line was long. Fixed.

## Final ledger

0 BLOCKER; every WARNING fixed with a test and a control; NITs fixed or decided. Converged at iteration 3.
