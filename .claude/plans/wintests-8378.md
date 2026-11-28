# wintests-8378: cluster 1's cli files skip their Mac CLI arms on Windows (kosmos#8378)

## Finished looks like
On GitHub's Windows runner, each of the 25 cli.* files below has 0 failing tests, every skip says why, and every file still
passes in full on the Mac (no skip there). engine/windows-tests-1777 (the coupling audit) is green.

## Where the list came from (measured)
- 454 candidate test files (no Windows guard, a Mac/Linux-only mechanism), run on GitHub's Windows runner at main
  91943d22cd (run 46114804176): 233 fail. Split into four clusters on #8378; cluster 1's first half (files 1 to 25, the
  cli.* ones) is this branch; Baron has the other half.
- Every failing test name per file from run 46116390634 (WINCAND_ALL_NAMES).

## The change
- Each file that skips gains `SKIP_POSIX_SHELL = skipOnWin32(<reason>)` and `{ skip: SKIP_POSIX_SHELL }` on exactly the
  tests that failed on Windows, by name (a loop-built name by its line); the exceptions are the fixes below and the
  both-CLI files, where only the Mac calls are guarded.
- A test that drives both CLIs keeps its Windows CLI half running on Windows: only the Mac calls are guarded, a count that
  adds both CLIs' requests expects one run there (a RUNS constant in agent-model and delete-leftovers), a control that needs one
  CLI uses the one the host runs, and task-who's fixtures that came from Mac-only tests are made with the Windows CLI on
  Windows so its list checks still see both kinds of row.
- Four reasons for a Mac-only mechanism (the card's rule), as the code now reads, and a fifth below:
  1. it runs install/kosmos directly by its shebang line, which Windows cannot do (19 files; sandbox and
     community-exit-reason also name /bin/sh and /bin/bash by an absolute path, which some of their tests use);
  2. it runs install/kosmos through /bin/bash by an absolute POSIX path (community-quiet-stdin);
  3. it runs /bin/sh by an absolute POSIX path (exit-code-mapping, whose tests exercise its harness, not the CLI);
  4. it runs install/kosmos with a bare bash, which reaches Git Bash, where the Mac and Linux CLI's check for a running
     board does not read the test board as Kosmos (observed; the cause inside Git Bash was not found); and a Windows computer never runs that CLI (it runs
     tools/windows/kosmos-cli.js) (unknown-flag, open-1957).
- Two are fixes, not skips, measured on the runner: feedback-note's control matched /feedback/ with forward slashes only
  (path.join on Windows gives backslashes), and version's warning names the installed command as KOSMOS_HOME +
  "/bin/kosmos" (mixed slashes on Windows); both run on Windows now and need no Windows branch.
- A fifth reason, update-ifnewer's engine test ("the look never starts the board's own install"): what it checks exists
  on Windows, but its fixture builds the Mac installed layout and Windows reads the portable zip's (measured: the look
  answers "source" there), so it skips with that said and its Windows arm owed on kosmos#9280. Its file URL is built
  with pathToFileURL either way.
- The seven both-CLI files are in ALSO_ROOT, so the Windows CI job runs their Windows halves; Mac-only setup at
  load (the runtime symlink, the Mac CLI's home) is guarded so a Windows account without the symlink privilege can load
  them.

## Rejected
- Skipping whole files: most have tests that already pass on Windows, and the both-CLI tests' Windows halves are the
  coverage Windows has.
- Calling a bare bash a reason: it reaches Git Bash (the card, cluster 1 of 11-11); reason 4 says what actually fails.

## Weakest premise
GitHub's runner is a Windows Server image run as admin, not Homer's box; the box's inventory agrees on all 25 files
(each fails there too). Reason 4 records an observed symptom without the root cause inside Git Bash; its defence is that
the subject (the bash CLI) does not run on Windows at all.

## Measured on GitHub's Windows runner at this branch (an admin account, so symlinks work there)
- Run 46119977052 (all 25, 8 shards): 24 with 0 failing; version-4892 fixed and rerun alone (run 46120197214): 4 of 4.
- Run 46120662018 (all 25 at edf5373387, after the symlink guards in the both-CLI files and the ALSO_ROOT move): 24 with
  0 failing; update-ifnewer's engine test answered "source", hence the fifth reason and kosmos#9280.
- Every file passes in full on the Mac; engine/windows-tests-1777 24/24. The seven ALSO_ROOT files are first judged by
  tools/windows-tests.js itself in this PR's own Windows job.

## Left as it is, deliberately
- version-4892 and feedback-note run on Windows now (fixes), and like unknown-flag and open-1957 they run install/kosmos
  with a bare bash; the difference is what fails: theirs was a test assumption about a path (fixed), the other two hit
  the bash CLI's own check for a running board under Git Bash (skipped: that CLI never runs on a Windows computer).
  They still make the Mac CLI's runtime symlink when they load, which the bash CLI needs, so on a Windows account
  without the symlink privilege they fail at load; the measured claim is for an account that can make symlinks.
- Test titles that say "both CLIs" still read so on Windows, where only the Windows half runs; the comments say so.
