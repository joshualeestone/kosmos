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
- Four reasons, each naming the mechanism (the card's rule), as the code now reads:
  1. it runs install/kosmos directly by its shebang line, which Windows cannot do (19 files; sandbox and
     community-exit-reason also name /bin/sh and /bin/bash by an absolute path, which some of their tests use);
  2. it runs install/kosmos through /bin/bash by an absolute POSIX path (community-quiet-stdin);
  3. it runs /bin/sh by an absolute POSIX path (exit-code-mapping, whose tests exercise its harness, not the CLI);
  4. it runs install/kosmos with a bare bash, which reaches Git Bash, where the Mac and Linux CLI's check for a running
     board does not read the test board as Kosmos; and a Windows computer never runs that CLI (it runs
     tools/windows/kosmos-cli.js) (unknown-flag, open-1957).
- Fixes, not skips: update-ifnewer's engine test (this node, not the runtime's symlink; a file URL from pathToFileURL;
  not yet measured on Windows at the time of writing), and two measured on the runner: feedback-note's control matched /feedback/ with forward slashes only
  (path.join on Windows gives backslashes), and version's warning names the installed command as KOSMOS_HOME +
  "/bin/kosmos" (mixed slashes on Windows); both run on Windows now and need no Windows branch.
- Each file that skips has its HOST_BRANCH_EXCLUDED entry in tools/windows-tests.js carrying that reason (23 files).

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

## Measured on GitHub's Windows runner at this branch
Run 46119977052 (8 shards, all 25 files): 24 with 0 failing; version-4892 then fixed and rerun alone (run 46120197214): 4 of 4 pass. Every file passes in full on the Mac; engine/windows-tests-1777 24/24.
