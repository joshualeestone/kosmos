# #2988: Windows board supervision (an exit-cause line and a watchdog task)

**Posture:** production

## Why
On the Windows box the board died between 22:57 on 10-13 and 00:20 on 10-14 and nothing started it again for about
3.5 days: `Kosmos\board` starts it only at logon, and nothing watches it. There was no record of why it died either,
because the board's output goes to a headless console that is never saved. #7451 (10-28) is a second sighting.

## Design
The measurements and the call are on the card:
https://github.com/joshualeestone/kosmos/issues/2988#issuecomment-6468326726

1. **Exit-cause line** (engine/win32boardwatch.js `recordBoardExits`, armed from server.js only for a task-started
   board, in place of the bare `exitWhenParentGone`, which it now arms itself). Lines in
   `<Kosmos data>\win32-logs\board.log`, through win32supervisorlog (bounded, rotated, secrets redacted), with the data
   root read before any named world (worlds.preWorldEnv) so the board and the watchdog agree on the file:
   - `<iso> board started pid=<pid> parent=<ppid>`
   - `<iso> board exited pid=<pid> code=<code>: <cause>`, the cause being
     `its host process (pid N) was gone` | `a console signal (SIGINT)` (and SIGHUP, SIGBREAK, SIGTERM; written in the
     prepended signal handler, as `signal=SIG` when another handler such as engine/remote.js owns the exit, else
     `code=128+n`) | `an uncaught error (<Name>: <first line>)` (uncaughtExceptionMonitor, only when no uncaughtException
     handler will catch it) | `it exited by itself`.
   - Behaviour change, stated: SIGHUP and SIGBREAK had no listener in the board before, so Windows ended it with
     0xC000013A; a task-started board now exits 129 and 149 for them (SIGINT/SIGTERM still go through
     engine/remote.js's re-raise). Nothing reads the board's exit code: Task Scheduler records it as Last Result and
     the watchdog does not look at it.
2. **Watchdog** `Kosmos\board-watchdog`: TimeTrigger, StartBoundary 2020-01-01T00:00:00, Repetition PT1M with
   StopAtDurationEnd false and no Duration, IgnoreNew, InteractiveToken, LeastPrivilege, PT0S, headless conhost, always
   enabled. It runs `board-watchdog.js` beside `board-boot.js` (pointer indirection like BOOT_JS; BOOT_JS untouched),
   which leaves without loading the engine while any journal is not a whole finished record, then calls
   `win32boardwatch.watchdogMain`. Registered/refreshed by `ensureInstalled` exactly when the board task was registered
   or refreshed, inside ensureInstalled's existing two-schtasks-timeouts budget (#2973/#2983); removed first by
   `win32board.remove()`, and by the uninstall (which now knows it by name).
   Gate order, cheapest first; every gate must hold, and only then `/Run`:
   a. `win32apply.boardMayStart` (a connect-only computer, #4382);
   b. no update in flight: `win32apply.readJournal` not unfinished nor unreadable, and `win32update.lockHeldNow` (a new
      read-only export of takeLock's own `readLock` judgement) neither held nor broken; and (round 2) no board hold
      in force (below);
   c. the port is silent: `win32handoff.probeBoardOnEveryAddress` + `boardMayBeOpen` (only refused is silent);
   d. `win32board.status()`: known, registered, enabled, and not already shown running;
   e. after 5 s, the port is still silent and (b) still holds, the hold included;
   f. (round 1) not crash-looping: 3 starts in 15 minutes, then at most one every 15 minutes, until a board has
      answered for 10 minutes.
   On `/Run` it writes `<iso> board was not answering; started it. The last exit recorded: <exit line> (at <iso>)` or
   `... started it. No exit was recorded, so it was killed or crashed hard`. Every other run writes nothing.
   The board task is the watchdog's only off switch: the task Description says so, and a person who switches the
   watchdog task itself off has it switched back on (`/Create /F`) the next time Kosmos starts.
3. **The board hold** (round 2). Two deliberate stops end the task's board without switching its task off and without
   the update journal or lock, so the watchdog's other gates cannot see them. Each writes its own file,
   `<anchor>\board-hold.<pid>.json` = `{ pid, at, until, why }` (round 3: one per owner, so a second holder never
   overwrites or cancels the first; atomic: temp file then rename) BEFORE its `/End` (`win32boardwatch.holdBoard`).
   The watchdog (gate b, and again before `/Run`) and its shim (before it loads the engine) honour ANY live one: one
   whose `until` has not passed, is at most 5 minutes away (HOLD_MAX_MS; a hold claiming more is ignored), and whose
   owner pid is alive. Release removes only the caller's own file, and only if it is still the hold it last wrote.
   Writing a hold removes other owners' dead or expired files. A hold that cannot be written is said: in the move's
   result `notes` (the JSON the launcher's move prints) and in the hand-off's `holdProblem`. server.js writes that
   one to stderr AND, round 4, as a `board note:` line in win32-logs\board.log: a double-clicked Kosmos.exe hides
   its console, and the launcher has no channel that carries a note from the board to the screen.
   Every caller that ends the board task, and the decision:
   - `win32relocate.relocate`, `endServingBoard` (the move from Downloads): **HOLD**, 5 minutes, taken just before the
     `/End`, refreshed before each top-level entry is copied and once more after the copy (round 3: a copy can outlast
     one hold on a slow disk or under a scanner), released in a `finally` when `relocate` returns, success or failure.
     After the copy and before anchoring, it looks at the port once more and ends a board that came up anyway (round 3).
     By then the pointer names the folder the board should start from (or, on failure, still the old one).
     Round 4: the refresh is per top-level entry, so a single entry slower than 5 minutes can still let the hold
     lapse mid-entry; the second look is the backstop for that. The second look acts only on a board the logon task
     started (its own header says so, or, for a board too old to say, the task reads running), the first look's rule;
     anything else on the port is left alone and named in a true note. The hold and the second look happen whenever
     the pointer names the folder being moved, also when no board answered at the start (a crashed board), not only
     when the move ended one.
   - `win32handoff.attemptHandOff`, the not-confirmed path that ends the task and serves in a window: **HOLD**,
     2 minutes, owner is the board itself; server.js releases it once that board is listening. A board that dies
     before it listens holds nothing (its pid is gone), and the hold expires anyway.
   - `win32handoff.attemptHandOff`, replacing an older task board then `/Run`: no hold; it starts the task itself
     straight after, so a watchdog `/Run` in the gap starts the same board, and IgnoreNew drops the second.
   - `win32board.restartHelperMain` (End, wait, Run): no hold, for the same reason.
   - `win32apply` `stopBoard` (an update): no hold; the journal and the lock already gate it.
   - `win32uninstall`: no hold; it switches the board task off before its `/End` (gate d).
   - KosmosLauncher.cs `StopBoardHere` (connect computer, Kosmos+ sign-in): no hold; it switches the task off first.
   - KosmosLauncher.cs `ReplaceStuckBoard` (End, end the tree, Run): no hold; it runs the task itself, and while the
     frozen board still holds the port the watchdog's look is not "refused", so it does not act.
   Intended, and to say on the card: closing an in-window board (the hand-off-failed case) while the board task is on
   brings the background board back within about a minute. The window was a fallback, not a stop.

## Rejected
- A repetition on the board task itself: a LogonTrigger repetition does not fire before the next logon (measured), and
  a TimeTrigger one would run BOOT_JS every minute, including inside an update's stop-swap-start window.
- Task Scheduler RestartOnFailure: as understood, it keys on a failed start, not a process exit. UNMEASURED.
- A respawn loop in a wrapper: makes the board a child, which BOOT_JS's header forbids.
- `/End` then `/Run` when the task reads Running but nothing answers: it could end a board that is slow to boot or
  recovering an update. The watchdog leaves that case alone (see weakest point).
- A separate `board.log` name to avoid an agent named `board` sharing the file: kept the card's name; the watchdog
  reads only lines that start with an ISO time and `board`, so an agent's lines are never taken for the board's.

## Weakest point
The "no update in flight" gate. It reads the journal and the lock the way win32apply does (its own readers), and a test
rewrites a real staged journal to every phase in `win32apply.PHASES` and holds the real lock; but nothing here ran a
real update while a watchdog ticked. A stuck unfinished journal also keeps the watchdog off until someone starts the
board by hand, which is the behaviour before this change. Second: a task that reads Running while no board answers
(the 10-17 report) is not fixed by `/Run` (IgnoreNew), so the watchdog does nothing there.

## Residual: a rollback to a build without the watchdog
After a downgrade or a user rollback to a build that predates this change, `Kosmos\board-watchdog` stays registered.
It keeps running its shim, which loads the pointer's engine; that engine has no `win32boardwatch.js`, so the shim
exits 0 and does nothing (inert). That older build's uninstall classifies the task as unrecognised and names it
instead of removing it (and so keeps the folders it keeps for any task left). The task's Description carries the
remove hint (`schtasks /Delete /F /TN "Kosmos\board-watchdog"`). No boot removes it: only `win32board.remove()` and
the uninstall of a build with this change do; a later boot of such a build refreshes it if the board task is
registered and on. Likewise, with the board task switched off the watchdog stays registered and does nothing.

## Exports (round 2)
win32boardwatch exports only `recordBoardExits` and `boardLogNote` (server.js), `watchdogMain` (the shim), `holdBoard` (relocate,
hand-off) and `watchdogRun` (the one test seam: watchdogMain with injectable deps, the shape of
`win32board.restartHelperMain(argv, deps)`); the constants and helpers, `boardHeld` included (round 3), are tested
through it. Two tests are WIRING CHECKS, source matches on server.js rather than behaviour, and are named so: that
server.js releases the hand-off's hold once listening, and that it prints `holdProblem`. win32board exports
`WATCHDOG_TASK_NAME` and `removeWatchdog` (the uninstall's), and `WATCH_NAME`, `WATCH_JS`, `watchdogTaskXml`, which
mirror the house's `BOOT_NAME`, `BOOT_JS`, `taskXml` (the definitions a suite runs and reads).

## What would change my mind
A box measurement that `/Run` during an update is harmless (the watchdog could drop gate b), or that the
Running-with-no-board state is common (then an `/End` path with a long grace is worth its risk).

## Rounds
- Round 0 (build)
- Round 1: live check passed on the box (kill back in 55 s, disabled stays down, re-enabled back in 58 s). Fixed:
  (1) the signal line was never written in a real board, because engine/remote.js's SIGINT/SIGTERM handler runs first
  and re-raises with process.kill, which on Windows ends the process with no 'exit' event; our handler is now
  prepended, writes the line synchronously, and leaves the exit to any other handler
  (`exited pid=N signal=SIGINT: a console signal (SIGINT)`), exiting itself (`code=128+n`) only when it is alone;
  (2) a crash-loop guard: 3 starts in 15 minutes, then at most one start every 15 minutes with one line quoting the
  first exit, cleared once a board has answered for 10 minutes (state in `board-watchdog.json` beside the log, so
  rotation cannot lose it); (3) the rollback residual above; (4) RestartOnFailure marked unmeasured.
- Round 2: the generated XML registered and ticked on the box (result 0x0). Fixed: (1) the board hold for the two
  deliberate stops the other gates cannot see (the move, the hand-off serving in a window), honoured by the watchdog
  and its shim, every `/End` caller decided above; (2) the SIGHUP/SIGBREAK exit-code change stated; (3) the residual
  corrected (no boot removes the watchdog); (4) the in-window close brings the background board back, intended;
  (5) the task Description names the board task as the only off switch; (6) exports trimmed to production entries plus
  one test seam.
- Round 3: fixed (1) a slow move outliving its hold: the move refreshes it before each top-level entry and after the
  copy, and before anchoring looks once more and ends a board that came up during the copy; (2) one hold file per
  owner, any live one honoured, release removes only the caller's own, dead and expired files tidied when a hold is
  written; (3) a hold that cannot be written is said in the move's notes and the hand-off's holdProblem; (4)
  `boardHeld` no longer exported, tested through `watchdogRun`; (5) the server.js source matches labelled wiring checks.
- Round 4: fixed (1) a refresh that failed after a first write that worked was silent (holdBoard's `held`/`because`
  were fixed at the first write; now read live); (2) the second look ended any answering board: it now ends only a
  board the logon task started and names anything else truly; and the hold plus second look now also cover a move
  with no board at the start when the pointer still names the folder; (3) the per-entry refresh limit stated, with the
  second look as its backstop; (4) sentences: no nested parentheses, "Restart your computer" only when the pointer
  moved, and the hand-off's hold problem also written to board.log (new export `boardLogNote`, used by server.js).
