# kosmos#8378 group 5, the rest: 81 engine/ and other files on GitHub's Windows runner (branch wing5rest-8378)

The list is #8378 comment 7235424591, every line that is not server.* (that part was #9297). Owner: Renet Tilley
(Splinter 06:02 11-28). Method as #9297: a never-merged measuring branch, wing5rest-8378-never-merge, runs only
tools/wincand-8378.js over the 81 files on windows-latest (full history, a 1200 s per-file cap as the Windows job has).

## Measured
- Baseline on main c9f30bf57c (run 46142994834): 9 pass, 70 fail, 2 cut at the sweep's own 240 s cap.
- Round 1 (part B, 25 files): all 25 pass. Round 2 (parts A and C): 79 of 81 pass; remote.test.js had one PATH arm
  red, and ios.uibuild's whole-file red was the measuring branch deleting .github/workflows/ios.yml, which it reads.
- Round 3: see the PR body.

## What changed, by cause
- Fixture POSIX-shaped, product right: USERPROFILE beside HOME, TEMP and TMP beside TMPDIR, path.join / path.resolve /
  path.sep in expectations, pathToFileURL for file:// pointers, process.execPath for a /bin/echo stand-in, platform
  darwin pinned through existing seams where an arm checks the Mac shape, a NODE_OPTIONS preload path with its
  backslashes doubled, MSYS=noglob for an MSYS grep started from node, a stand-in job tool where a test refuses the real
  Task Scheduler, the Windows spelling Path in a copy of process.env.
- Skipped on Windows with their reasons (skipOnWin32 + a HOST_BRANCH_EXCLUDED entry carrying the reason): POSIX modes,
  signals and SIGKILL, fd numbering, ps -o, /bin/sh and install/kosmos, sh stand-ins run by shebang, systemd, the
  Mac-only iOS steps; three unreadable-record arms on kosmos#9279 (a real bug, skip goes when fixed).
- Product fix: engine/selfreport.js readTail refuses anything but a regular file. On Windows a folder in the report
  place opened at size 0 and read as never reported, so idle retire could retire an agent whose report it could not
  read (found by idleretire-8720's arm, measured green on the Windows runner; that file is outside the Windows job, kosmos#9286).
  Pinned on the Mac by a selfreport.test arm: a link to /dev/null opens and is not a regular file (reds without the check, measured).
- tools/windows-tests.js: 26 new HOST_BRANCH_EXCLUDED entries, 9 refreshed. Not added to the Windows CI selection:
  kosmos#9286 decides that, as for #9297.

## Decided, not missed
- communityblock's 4000 ratchet counts the block in its Mac form, as create.brief-size-8735 already counts briefs; the
  Windows quoting rule is longer by design. Weakest premise: a Windows brief is then not measured against 40k itself.
- browser-checks-pr-select-4119 is unchanged: its replay arms need full history, which the Windows job has
  (fetch-depth 0); the shallow measuring checkout was the cause.
- codexmigration skips 14 arms: its stand-in codex is a sh script and the step it covers is the Mac and Linux
  supervisor one; no Windows code calls pinModelMigration (grep).
- A green here means the arms are right on a Windows host; files outside the selection are measured once, not kept
  green (kosmos#9286).

## Review 1 (no BLOCKER)
- W1: the selfreport check had no failing test on a Mac; a /dev/null link arm pins it (reds without it, measured).
- W2: two codexmigration arms ran the sh stand-in and only asserted a decline, so they would pass on Windows without
  starting it; skipped with the same reason (16 arms now).
- W3: securewrite's inode arm and chmod-retry arm now run on Windows; only their mode lines are POSIX-gated.
- W4: six HOST_BRANCH_EXCLUDED reasons refreshed to what the files now do.
- W5: status.heldq's comment says the fixture pane list changes the Mac arm too (it no longer reads the live fleet).

## Review 2 (one BLOCKER, fixed)
- BLOCKER: two agykeep arms sent a Mac-shaped event, which the Windows bridge refuses before it posts, so their bounds
  timed an early exit; both send this computer's path shape and assert the keep was asked for.
- W: tmpscope's seven #6061 arms run on Windows (a self-SIGKILL there is exit 1, no signal, no exit sweep);
  cli.task-files' pure filesLines checks are their own arm on every host; codexhooks' install arm runs on Windows with
  only its 0600 lines gated; setup-assistant's held-name arm runs the Mac sequence through the platform seam.
- W: the four skips whose subject exists on Windows (phonenotify ENOTDIR, limitmsg x2, setup-assistant marker) say so
  and name kosmos#9313, which owes their Windows arms.
- N: render-talk installs its fleet inside the try, so a throw cannot leave the job runner stub set; an entry reworded.

## Review 3 (one BLOCKER, fixed)
- BLOCKER: two #6061 arms would fail on Windows: review 1 set only HOME (a Windows home is USERPROFILE) and expected '/'
  after ~ (the host separator there); review 2 removes the child's own cwd, which Windows refuses (EBUSY). Review 1
  sets USERPROFILE and expects path.sep; review 2 skips on Windows with that reason.
- W: killedHard on Windows also needs an empty stderr, so a crash (exit 1, no signal) cannot pass as the kill; the
  outside-cwd arm sets USERPROFILE beside HOME; selfreport.history refuses a non-regular file as readTail does
  (pinned on the Mac by the /dev/null arm, reds without it, measured).
