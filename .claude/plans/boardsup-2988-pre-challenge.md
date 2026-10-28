---
pre_challenge: true
method: challenge-loop
branch: boardsup-2988
diff_hash: b955450514c61709f1f7e2c17e0406e9fcc3c1b017a20d4fd40bec01b84f5c22
validation: passed: win32boardwatch 95 (+1 Mac-only #4495 guard, skipped on Windows), win32board 49 (+7/7/5/2), win32uninstall 53 (+3/23/15), win32relocate 34, win32handoff 69 (+4), win32apply 114, win32update 133, win32supervisor 64, win32supervisorlog 7, win32orphan 8, tools.win-launcher-native 29, tools.win-installer-native 26, 0 fail; policy fixture-discipline 20, no-name-refs-3071 4, engine.reachable 8, windows-tests-1777 23, win32-separator-guard 4, windows-coupling-audit-1732 8, marker-registry 3; live box check: kill back in 55 s, switched off stays down 150 s, on again back in 58 s; CI fix for Mac paths (test-only)
subdir_audit: passed
timestamp: 2026-10-28T15:52:08Z
iterations: 6
converged: true
---

# Pre-PR review proof: boardsup-2988

**Iterations:** 6
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/boardsup-2988.md

## Rounds

#### Iteration 1
- Round 1: live check passed on the box (kill back in 55 s, disabled stays down, re-enabled back in 58 s). Fixed:
  (1) the signal line was never written in a real board, because engine/remote.js's SIGINT/SIGTERM handler runs first
  and re-raises with process.kill, which on Windows ends the process with no 'exit' event; our handler is now
  prepended, writes the line synchronously, and leaves the exit to any other handler
  (`exited pid=N signal=SIGINT: a console signal (SIGINT)`), exiting itself (`code=128+n`) only when it is alone;
  (2) a crash-loop guard: 3 starts in 15 minutes, then at most one start every 15 minutes with one line quoting the
  first exit, cleared once a board has answered for 10 minutes (state in `board-watchdog.json` beside the log, so
  rotation cannot lose it); (3) the rollback residual above; (4) RestartOnFailure marked unmeasured.

#### Iteration 2
- Round 2: the generated XML registered and ticked on the box (result 0x0). Fixed: (1) the board hold for the two
  deliberate stops the other gates cannot see (the move, the hand-off serving in a window), honoured by the watchdog
  and its shim, every `/End` caller decided above; (2) the SIGHUP/SIGBREAK exit-code change stated; (3) the residual
  corrected (no boot removes the watchdog); (4) the in-window close brings the background board back, intended;
  (5) the task Description names the board task as the only off switch; (6) exports trimmed to production entries plus
  one test seam.

#### Iteration 3
- Round 3: fixed (1) a slow move outliving its hold: the move refreshes it before each top-level entry and after the
  copy, and before anchoring looks once more and ends a board that came up during the copy; (2) one hold file per
  owner, any live one honoured, release removes only the caller's own, dead and expired files tidied when a hold is
  written; (3) a hold that cannot be written is said in the move's notes and the hand-off's holdProblem; (4)
  `boardHeld` no longer exported, tested through `watchdogRun`; (5) the server.js source matches labelled wiring checks.

#### Iteration 4
- Round 4: fixed (1) a refresh that failed after a first write that worked was silent (holdBoard's `held`/`because`
  were fixed at the first write; now read live); (2) the second look ended any answering board: it now ends only a
  board the logon task started and names anything else truly; and the hold plus second look now also cover a move
  with no board at the start when the pointer still names the folder; (3) the per-entry refresh limit stated, with the
  second look as its backstop; (4) sentences: no nested parentheses, "Restart your computer" only when the pointer
  moved, and the hand-off's hold problem also written to board.log (new export `boardLogNote`, used by server.js).

#### Iteration 5
- Round 5: fixed (1) the move's notes reached nobody: each is now also a `board note:` line in board.log, and the plan
  no longer claims the launcher prints them (it reads only the report's first line; no C# change); (2) "Click OK to
  stop Kosmos" located (launcher source and exe only) and left for a launcher card; (3) Settings' sign-in switch also
  turning crash recovery off stated, web/index.html untouched; (4) the update lock read under both the running
  engine's folder and a finished journal's folder; (5) the holds read once more immediately before `/Run`, with the
  remaining instant documented; (6) the hand-off's hold refreshed every minute while its board starts; (7) plain words
  ("Kosmos could not save a note it needed (the system said X)", "this window's Kosmos may not be able to start"),
  and the agent-named-board test now writes through the supervisor's real logger instead of restating the pattern.
  Round 5 W2 ("Click OK to stop Kosmos", launcher only) and W3 (the sign-in switch also turning crash recovery off)
  were carded as #7492 and #7493.

#### Iteration 6
- Round 6: converged, no blockers and no warnings. Nits fixed: (1) a window board that loses the port to the
  background board while it holds the hand-off's hold now says so in board.log, so the round-5 comment is true; (2) the
  hand-off hold refresh stops after ten minutes even if start() never settles; (3) a broken update lock, which holds
  the watchdog off for good, is said once in board.log (a mark in board-watchdog.json, cleared once the lock reads
  normally); (4) the watchdog's quotes say "the last exit of the background board" and "the first exit of the
  background board"; (5) common system codes in words with the code in brackets (EACCES/EPERM "access was denied",
  ENOENT "a file was missing", ENOTDIR/EISDIR/EEXIST "something is in the way", ENOSPC "the disk is full"); (6) the
  round-5 read-count assertion replaced by a behaviour test (a hold that appears while the crash-loop guard runs
  still stops the /Run); (7) the agent named "board" sharing board.log's rotation recorded as a residual.
- CI fix (PR #7495, Mac CI run 40715278893, two test-only failures, no product change): (1) the shim test compared
  its anchor folder with a /var path while the shim saw /private/var (macOS's tmpdir is a link); the test sandbox is
  now realpath'd. (2) the ensureInstalled arms register a Windows board, whose claim folder is a Windows path; off
  Windows that is a relative backslash-named folder, and it was written into the directory the suite started from,
  where win32board.test.js's #4495 guard found it. The file now runs from a temp cwd of its own, as
  win32board.test.js does, and carries the same #4495 guard (skipped on Windows, where the folder is absolute).
  The product's own writes were checked: holdBoard, boardLogNote, the move's and the hand-off's holds all resolve
  their folders with the host's rules (process.platform), so none can write a backslash folder on a Mac or Linux.

### Final Ledger
**Ledger for #2988 (boardsup-2988): blind review loop, rounds 1 to 6, converged at round 6.**

Box measurements (Windows box, 2026-10-28, scratch tasks in \KosmosProbe\, deleted; card comment
https://github.com/joshualeestone/kosmos/issues/2988#issuecomment-6468326726):
- A LogonTrigger with a PT1M repetition never fired without a new logon (3.5 minutes).
- A TimeTrigger with a PT1M repetition and a 2020-01-01 StartBoundary fired on the next minute (registered 11:53:22, started 11:54:02).
- Under IgnoreNew a repetition starts nothing while an instance runs (ticks 11:45, 11:46, 11:47).
- A crash (taskkill /F of node) came back on the next tick (11:47:21 to 11:48:07); a clean exit too (11:48:16 to 11:49:07).
- A repetition keeps firing after /End (11:50:07). /End kills the conhost and leaves its node child running.
- Disabled: no start at 11:51 or 11:52; enabled 11:52:16, started 11:53:07.

Live check (card comment of 2026-10-28 12:48 UTC): the branch's real watchdog (at 7c916e1413) from a scratch task with the
watchdog's trigger, against the live board, task, journal, lock and port:
- board up: every tick "a board answers", nothing done;
- node killed 12:43:13: started by the 12:44:01 tick, answering 12:44:08 (55 s down); board.log said "board was not answering;
  started it. No exit was recorded, so it was killed or crashed hard";
- board task switched off, node killed 12:44:22: stayed down 150 s, each tick "the board task is switched off";
- switched back on 12:47:10: started by the 12:48:01 tick, answering 12:48:08.
- The exact generated watchdogTaskXml registered on the box and ticked (13:17:01, result 0x0, "a board answers") (round 3 report).
Not covered live: the exit-cause line (the installed 0.7.72 board does not have it yet).

| Round | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | SIGINT/SIGTERM exit line never written: engine/remote.js's handler runs first and re-raises with process.kill, which ends the process on Windows with no 'exit' | WARNING | Fixed (3c9b685d64): handler prepended, line written synchronously, exit left to the other handler |
| 1 | No crash-loop guard: a board dying on every boot got a /Run every minute forever | WARNING | Fixed (3c9b685d64): 3 starts in 15 min, then once per 15 min with one line; cleared after 10 min answering |
| 1 | Rollback residual not written down | NIT | Fixed: plan residual |
| 1 | RestartOnFailure claim unmeasured | NIT | Fixed: marked UNMEASURED in the plan |
| 2 | Watchdog could undo a deliberate stop outside the journal/lock (the Downloads move, the hand-off serving in a window) | WARNING | Fixed (cb4989f52f): the board hold; every /End caller decided in the plan |
| 2 | SIGHUP/SIGBREAK exit codes change unstated | NIT | Fixed: plan |
| 2 | Residual sentence wrong (no boot removes the watchdog) | NIT | Fixed: plan |
| 2 | In-window close brings the background board back, unstated | NIT | Fixed: plan (intended) |
| 2 | Task Description should name the board task as the only off switch | NIT | Fixed |
| 2 | Test-only exports | NIT | Fixed: trimmed, one test seam |
| 3 | A slow move outlives its 5-minute hold | WARNING | Fixed (fd7e3143ec): refresh per entry, second look before anchoring |
| 3 | One hold file, last writer wins | NIT | Fixed: one file per owner |
| 3 | A hold that cannot be written is silent | NIT | Fixed: move notes, hand-off holdProblem |
| 3 | boardHeld exported only for tests | NIT | Fixed: dropped, tested through watchdogRun |
| 3 | server.js release test is a source match | NIT | Fixed: labelled WIRING CHECK |
| 4 | A refresh failing after a good first write is silent | WARNING | Fixed (cee40c8beb): live held/because |
| 4 | Second look could end the wrong board; no hold when no board answered at the start | WARNING | Fixed (cee40c8beb): only a task-started board is ended, true note otherwise; hold and second look whenever the pointer names the folder |
| 4 | Per-entry refresh limit unstated | NIT | Fixed: plan |
| 4 | Sentences (nested parentheses, restart advice, stderr unseen) | NIT | Fixed: plain sentences, board.log note |
| 5 | The move's notes reach nobody | WARNING | Fixed (25b64b57d4): each note also in board.log; plan corrected |
| 5 | "Click OK to stop Kosmos" untrue (launcher source and exe only) | WARNING | Carded as #7492 (signed launcher rebuild) |
| 5 | Settings' sign-in switch also turns crash recovery off | WARNING | Stated in the plan; carded as #7493 |
| 5 | updateInFlight read only the finished journal's root | NIT | Fixed: both roots |
| 5 | Re-read the holds right before /Run | NIT | Fixed; remaining instant documented |
| 5 | Refresh the hand-off hold while start() is pending | NIT | Fixed: unref'd timer |
| 5 | Plain words; a test restating the exit pattern | NIT | Fixed |
| 6 | (no blockers, no warnings) | | Converged |
| 6 | Window board losing the port "says why" was not true | NIT | Fixed: board.log note on EADDRINUSE while holding |
| 6 | Hand-off refresh could run forever if start() never settles | NIT | Fixed: stops after ten minutes |
| 6 | A broken update lock holds the watchdog off silently | NIT | Fixed: one board.log note, cleared once the lock reads normally |
| 6 | Quote could read as the window's exit | NIT | Fixed: "the last exit of the background board" |
| 6 | System codes in user-facing text | NIT | Fixed: words with the code in brackets |
| 6 | Read-count assertion | NIT | Fixed: behaviour test (hold appearing during the crash-loop guard) |
| 6 | Agent named "board" shares board.log rotation | NIT | Recorded as a residual in the plan |

Follow-ups outside this branch: #7492, #7493, #7470.
