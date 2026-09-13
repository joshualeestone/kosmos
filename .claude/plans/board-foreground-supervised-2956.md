# Plan: board foreground/supervised launchd mode (#2956)

Follow-up to #2955's watchdog (landed as PR #2962). Give `kosmos` a foreground mode so
**launchd supervises the board process directly**, replacing the fire-and-forget
`kosmos start` (nohup + exit) + external watchdog with real launchd supervision.

## Scope of THIS PR: macOS only

The thing #2956 replaces (the #2955 watchdog) is macOS/launchd-only. Windows has no board
watchdog today (just an at-logon Task Scheduler start, engine/win32board.js), so Windows board
supervision is NEW capability, not a replacement, and is tracked as a separate follow-up rather
than bolted onto this (untestable-from-macOS) change.

## Design

1. **`kosmos board-run`** (new internal subcommand, install/kosmos): execs node in the FOREGROUND,
   writing the pidfile as `$$` FIRST so node inherits that pid — `kosmos stop`/`status`
   (pidfile-based) keep working under a supervisor. Honors the #2955 `board.stopped` marker on the
   RunAtLoad race. Not in the public help (the supervisor/installer invoke it, not people).

2. **The plist** (install/setup.sh, com.kosmos.board): ProgramArguments `start` -> `board-run`;
   add a throttled `KeepAlive { PathState { <KOSMOS_HOME>/board.stopped = false } }`. Semantics:
   launchd keeps the board up while the marker is ABSENT (so a crash relaunches, throttled), and a
   deliberate stop (marker present) keeps it down — keyed on presence, not exit status, so a SIGTERM
   stop is honored. Byte-frozen-default-plist invariant (#883): label stays literal
   `com.kosmos.board`, no extra env keys added.

3. **cmd_start reconciliation** (install/kosmos): when the board is launchd-supervised, drive
   launchd (`kickstart -k`) instead of nohup'ing a second node. Detection is RECURSION-SAFE — a
   board counts as supervised ONLY when the LOADED launchd job actually runs `board-run` (matched as
   a standalone argument line), so the update window (plist rewritten to board-run but the loaded
   job still `start` until next login) falls through to the nohup path instead of kickstarting a
   `start` job and recursing.

4. **cmd_stop is UNCHANGED**: it writes the marker BEFORE the kill (existing #2955 order), which is
   exactly what makes launchd's PathState keep the board down. (Added: a loud warning when the
   marker can't be written under supervision, since a swallowed failure would let launchd relaunch.)

## Must respect (from the card)
- `kosmos stop` MUST keep meaning stopped — via the PathState marker.
- The updater cycle (engine/update.js -> installer -> `kosmos stop`/`start`) must not fight the
  supervisor — it rides the same marker; mid-update the loaded job is still `start`, so cmd_start
  takes the nohup path (no recursion), and the new plist takes effect at next login.
- Default plist label stays literally `com.kosmos.board` (#883) + byte-stability.
- Cross-platform: Windows is a separate follow-up (see Scope).

## Behavior change (intended)
A deliberate `kosmos stop` now PERSISTS across reboot (the login job runs `board-run`, which honors
the marker; under #2955 the login job ran `kosmos start`, which cleared it). "Stopped means stopped"
is the intended semantic. Crash recovery is unaffected (marker-ABSENT still relaunches).

## Watchdog
Left in place (dormant) this release as belt-and-braces for boards not yet rebooted onto the new
plist (an update rewrites the plist file but does not reload a loaded job until next login). Remove
in a follow-up once installs have cycled through a reboot.

## Weakest premise (measure on staging)
That launchd re-evaluates `KeepAlive.PathState` and relaunches promptly when `kosmos start` removes
the marker. `kickstart -k` on start closes the promptness gap; the deliberate-stop-stays-down and
crash-relaunch behaviors must be MEASURED on a real launchd board (the staging cut), as they are not
locally reproducible on a box without a running installed board.

## Tests
- tools/test-board-foreground-2956.sh — board-run (marker guard, pidfile=$$ exec, integrity).
- tools/test-board-supervised-detect-2956.sh — recursion-safe detection + #883 label mirror.
- tools/test-install.sh — asserts the supervised plist shape (board-run, KeepAlive, PathState, ThrottleInterval).

## Delivery
Full challenge-loop -> PR (merges per the Kosmos beta ship rule) -> staging-first cut to MEASURE the
PathState behavior -> Josh-gated promote per the release policy.
