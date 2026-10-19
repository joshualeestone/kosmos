---
pre_challenge: true
method: challenge-loop
branch: libdrift-5923
diff_hash: b75352fa47094c967347de9e40264d73d448bd9ef68fae2a7f22a872ea66c34e
validation: passed (local full validation via queued-heavy, validation-log hash b75352fa4709, 2026-10-13 23:33 CDT)
subdir_audit: passed
timestamp: 2026-10-14T04:34:55Z
iterations: 26
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 26, alternating opus (odd) and sonnet (even). **Converged:** Yes, iteration 26 returned NO FINDINGS.
The focused test (tools/test-queued-heavy-4977.sh) reads 142 OK at the rebased head, and a mutant with the reused-pid
comparison inverted reds exactly the gitlive and gitreuse arms. Each iteration's fixes, from its own commit message:

### Iteration 1 (opus)
- [BLOCKER] The live-waiter check counted the run's own pipeline subshell (same argv, ppid = the run), so on the real box the move never happened; rows whose pid or ppid is the run are now skipped, and two arms use the real ps to pin it (one perturbed red). The lib lock takes over a pid-less lock only after 20 consecutive empty reads, as _qh_take does, and waits up to 5 min. The comparison is of the files on disk, not HEAD's blobs.

### Iteration 2 (sonnet)
- [WARNING] A process list that fails or prints nothing no longer reads as nothing live: the move is refused and the line says so (new arm). The not-moved line says DIFFERS (a local edit is not behind). Residuals named in the plan: the ps match is space-split, the lock holds off only queued-heavy joiners, kill -0 reads another user's holder as dead.

### Iteration 3 (opus)
- [WARNING] A move replaces the whole checkout, so a process working inside it (lsof -d cwd) blocks the move, and a failed probe does too. The lib lock records its holder's command line; a reused pid is taken over. The #4977 header no longer says nothing checks the checkout. The plan no longer claims a merge installs the copy agents run: it is installed by hand, after merge, on this card. Three new arms (118).

### Iteration 4 (sonnet)
- [WARNING] Moves only a checkout whose commit is an ancestor of origin/main (one ahead or diverged is never moved back). The checkout runs with hooks off. The lock is released only while it is still this run's. An unwritable marker dir skips the check at once; a lock given up after 5 min says the lib may be mid-move. Arms: dead holder, ahead, exit-3 release.

### Iteration 5 (opus)
- [WARNING] No move when origin/main's cut-guard.sh lacks a function this copy calls (the move would make every later join exit 3 until the installed copy is updated); the list is shared with the post-load check. The working-directory reason names the pid. The real-ps stand-in has a per-run name and ends by itself. Arms: behind with identical files (match, no move), on a branch, a machine claim, a dropped function (125).

### Iteration 6 (sonnet)
- [WARNING] The header no longer says a joiner never loads a half-moved lib: the plan names the lock's takeover race and a holder killed mid-checkout. A takeover re-reads the pid first. Layout and comment nits.

### Iteration 7 (opus)
- [WARNING] A lock is read as a reused pid only when ps answers with a different, non-empty command (an empty answer kept a live holder's lock at risk). The pre-move function check covers the side lane when the lib offers it, and an unreadable target says so. Arms: a live holder's lock is respected and released, a pid-less lock is taken over, a direct-exec waiter blocks (128).

### Iteration 8 (sonnet)
- [WARNING] INT, TERM and HUP wait out the checkout, so only a KILL can leave a half-moved tree. The pid-less takeover counts per lock dir (inode), so a new holder's fresh lock is never taken in its mkdir-to-pid gap. Keep-in-sync note on the marker dir.

### Iteration 9 (opus)
- [WARNING] The checkout comment says signals are dropped, not deferred. The #5446 fallback is skipped when the default folder is a git checkout, so a run reading during a move cannot fall back to another lib. The pid-less takeover re-reads the inode before removing. lsof runs with -b. The live-holder arm asserts the run is still waiting. (Test run for this commit was in flight at commit time.)

### Iteration 10 (sonnet)
- [WARNING] Function checks accept 'function name' and 'name ()' spellings. The lock branch is split over lines. Arm: a default folder that is a git checkout without cut-guard.sh exits 3 and does not fall back (129). The plan names the lib's other reader (heavy-gate.sh tests existence only) and outside readers as a residual.

### Iteration 11 (opus)
- [BLOCKER] git sets its own signal handlers, so ignoring INT in bash did not stop a Ctrl-C aborting the checkout part way (measured by the reviewer: 3,000 files mixed). The checkout now runs as its own process group (measured: group INT, grouped rc 0 at target and clean; plain rc 128 with 3,000 files mixed, twice each), and a failed checkout is put back at the old commit by force; if that fails too the line says FAILED PART WAY with the repair command. Full sha in the back-with command. Arm for the put-back path (seam QH_TEST_MOVE_FAIL); the live-holder arm waits for the wrapper to run first (130). Test run for this commit was in flight at commit time.

### Iteration 12 (sonnet)
- [WARNING] Exit 3 at load now says when the default folder is a git checkout and the #5446 fallback is off for it, with the command to bring it up to date. A comment on the signal-trap reset around the checkout. Plan: lsof sees only this user's processes and runs after the cheaper gates. Test comment fixed. 130/130.

### Iteration 13 (opus)
- [WARNING] Never rm /dev/null when mktemp fails; git checkout runs off the terminal so job control cannot stop it and hang the wait; a failed move that changed nothing is reported unchanged, not MIXED. Five new arms: unchanged vs MIXED (control), no origin/main, unwritable marker dir, side-lane function missing on origin/main. The live-lock arm now waits until the run is inside the lock loop. 135/135.

### Iteration 14 (sonnet)
- [WARNING] The QH_TEST_* seams are ignored when HOME is the user's real home, so a leaked export cannot swap a safety probe or append to the shared lib (both arms checked by hand; no arm, since it would need the real home). A note that git inherits the ignored signals and sets its own handlers. 135/135.

### Iteration 15 (opus)
- [WARNING] QH_TEST_RESTORE_FAIL joins both unset lists; the real-home gate compares resolved paths (a trailing slash or symlinked spelling still matches; three arms checked by hand); a comment on QH_NEED_BASE names the cut-guard.sh-only scan; the plan states that a busy queue (suitewait markers from suites) may keep the move from firing, never silently. A long comment wrapped. 135/135.

### Iteration 16 (sonnet)
- [WARNING] The checkout saves and restores whatever INT/TERM/HUP traps are set (trap -p) instead of relying on none being set; both arms checked by hand. The plan states that any other live queued-heavy.sh, including one spinning on the lib lock, blocks the move, so two overlapping joins move nothing. 135/135.

### Iteration 17 (opus)
- [WARNING] The lib move also checks the INSTALLED copy of queued-heavy.sh: if it has no QH_NEED_BASE (it predates this check) or lacks a function it calls, no move happens until it is reinstalled. The cwd probe names this run or its caller; a missing git is said plainly; lib git calls take no optional locks; header wording. Two new arms. Focused: 137 OK, 0 BAD (expected 137).

### Iteration 18 (sonnet)
- [WARNING] WARNING: a lib folder that lost its .git let git walk up to an enclosing repo, which could then be read and moved as the lib. git is now held inside the folder (GIT_CEILING_DIRECTORIES) and there is no check without its own .git; new arm 'nogit' (an enclosing, detached, behind repo is never moved). Nits: a git that cannot read the checkout says so; the lock loop stops at once if the marker dir is gone; the hand-kept file list and older copies are noted. Focused: 138 OK, 0 BAD (expected 138).

### Iteration 19 (opus)
- [WARNING] WARNING: a wrapper KILLed (or ALRMed) mid-checkout left git writing in its own group, and a joiner could take the lock over and load a half-written lib. The lock now records git's pid, and a dead holder's lock is not taken over while that git lives (arm 'gitlive'). Nits: the checkout back runs like the move (own group, signals ignored until it ends); the git ceiling is the resolved path (arm 'emptygit': a .git that is not a repo, red without the ceiling); a gone marker dir has its own message; the plan's count and KILL residual are corrected. Focused: 140 OK, 0 BAD (expected 140).

### Iteration 20 (sonnet)
- [NIT] The gitpid comment says the pid is the subshell running git ($g is a function), which lives exactly as long as git. Comment only; bash -n clean.

### Iteration 21 (opus)
- [NIT] A joiner also refuses to take over while the lib's index.lock exists: a running checkout always holds it, so the instant before the gitpid is written (and a reused gitpid) is covered (arm 'idxlock'). The gitlive arm now watches the lock and HEAD while the stand-in git lives instead of timing elapsed seconds, which a slow box could pass on its own. Plan residual added for an index.lock left by a killed git. Focused: 141 OK, 0 BAD (expected 141).

### Iteration 22 (sonnet)
- [WARNING] WARNING: the gitlive and idxlock arms checked the lock on a fixed 3 s timer, which a slow box could reach before the joiner had run, so a takeover without the gitpid/index.lock checks could pass them. Both now check while the joiner is IN its lock loop (the live arm's pattern), then release. The plan records that a signal during the move is dropped, not deferred. Focused: 141 OK.

### Iteration 23 (opus)
- [WARNING] The git pid file is removed once git exits and records the git command, so a reused pid is not taken for that git; a gitreuse arm (142 expected); pgrep -o in the in-loop arms; CDPATH-safe cd in _qh_libgit and the cwd probe.

### Iteration 24 (sonnet)
- [WARNING] gitcmd is written before gitpid, so a pid is never on record without its command; the index.lock comment and the plan say what it does not cover.

### Iteration 25 (opus)
- [WARNING] gitlive writes the production shape (matching gitcmd before gitpid); gitreuse must take over within 60 s against a reused pid that outlives the deadline; origin/main read as refs/remotes/origin/main.

### Iteration 26 (sonnet)
NO FINDINGS.

