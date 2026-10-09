# #4342 — the board comes back on its own after the Mac wakes from sleep

**Card:** #4342 (bug, claimed:raiden; Josh hit it on 0.7.03, from a daily report). Real users hit it.

## The bug
On macOS, after the Mac wakes from sleep the local board is alive but not answering on
127.0.0.1:16180; the window says "Kosmos is not answering on this computer" and only a quit/reopen
fixes it. Root cause (from the architecture — no live sleep repro was possible on this shared box):
the board is alive-but-WEDGED (holds the port, never replies), not dead. launchd's KeepAlive
(PathState on board.stopped) only relaunches a DEAD process; a plain `kosmos start` refuses the held
port; the watchdog can reclaim a wedged board only after its 300s busy-grace, far longer than a user
waits. A run computer had NO wake observer at all. Windows already solved this exact condition
(ReplaceBoardIfStuck, #4543); macOS had no equivalent.

## The fix (native-app/main.swift) — the macOS analog of ReplaceBoardIfStuck
A run-computer `NSWorkspace.didWakeNotification` observer that, only on a CONFIRMED wedge,
reclaim-restarts the board:
- Probes `/api/health` (NOT /api/status — avoids the heavy snapshot() so a board busy with agents is
  not falsely reclaimed, the #4466 harm). First probe uses a longer catch-up grace
  (wakeFirstProbeGrace 20s); on a timeout, settle wakeSettleBeforeConfirm (4s), re-check the gate,
  then a confirm probe (wakeStuckTimeout 10s). Only a SECOND sustained timeout reclaims — ~34s of
  no-answer, so transient post-wake thrash does not kill a healthy board.
- Pure `wakeProbeOutcome(hasHTTPResponse:errorCode:)`: any HTTP answer=alive; NSURLErrorTimedOut=
  wedged (reclaim); anything else (refused)=down, LEFT to launchd's relaunch (reclaiming would race
  a mid-boot board). Verified at build by `--kosmos-app-wake-reclaim-selftest` (diffed truth table).
- `wakeRecoveryGeneration` token serializes overlapping wakes (monotonic, cannot latch). Gate
  (`board.stopped` / `installUnderWay` / in-flight) re-checked before each kill. The reclaim completion
  undoes the start if the computer switched to connect meanwhile (mirrors loadBoard #4356).
- Reclaim = `KOSMOS_RECLAIM_BUSY=1 kosmos start --force` (the watchdog's own form; #5215 makes it
  ours-only, so it only ever kills this user's own board). No web change: the page's own /api/status
  poll clears the offline note and restart screen on the first answer, so the window reconnects with
  no quit.

## Expected / done
After wake the board comes back on its own and the window reconnects without a quit. The busy-wake
guard is a BOUNDED mitigation (~34s); a healthy board blocked synchronously past that is still
reclaimed — the categorical fix is a CPU-busy check, deferred as the follow-up once a live sleep QA
measures real post-wake behavior.

## Validation / gates
Challenge-loop converged (7 passes opus+sonnet; found+fixed a busy-board false-reclaim, a connect
race, an overlapping-wake race). Rebased onto main-with-#5215 (code byte-identical to the converged
state). Source-assertion tests + the build-gated decision selftest. REMAINING: full suite green on the
head (big wait bound); then PR (Addresses #4342) with Sonya re-checking the probe logic; FLAG that a
live sleep/wake repro on a spare/personal Mac is owed (could not sleep the shared box). Merge pinned to
the approved head.
