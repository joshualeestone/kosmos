# win32-launcher-serve-signal-2983 -- a positive "serving here" signal, not a timeout-derived guess

Addresses #2983 (joshualeestone/kosmos). Branch off origin/main @ 1bfd8ad2.

## The bug (confirmed on origin/main, and by the issue author)

The Windows launcher (`tools/windows/KosmosLauncher.cs`) shows its "running from
here... click OK to stop" box once the board child reaches
`UnreadableTableFallbackMs` (45 s) with EVERY `GetExtendedTcpTable` read failed
(`unreadableLongPastAnyHandOff`, KosmosLauncher.cs:268). That 45 s is derived
(`HANDOFF_UNREADABLE_LISTENER_FALLBACK_MS` = `HANDOFF_CHECK_FOR_SERVING_AFTER_MS`
18 s + `SCHTASKS_TIMEOUT_MS` 20 s + 7 s margin) on the assumption that a
successful hand-off exits by ~34 s. That assumption is wrong for the
"a same-identity board is already serving" path: server.js runs, BEFORE
`handOffToTask`, module load + `ensureInstalled` (`status()` + `install()`, two
schtasks calls each bounded by `SCHTASKS_TIMEOUT_MS` = 20 s) +
`reports.syncEveryone`/`connections.syncEveryone` (each a synchronous
`claude agents --json` spawn, 15 s timeout, `engine/win32roster.js:90`).

Recomputed worst case before `handOffToTask` is even entered:
module load ~2 s + status 20 s + install 20 s + reports 15 s + connections 15 s =
**~72 s**, already 27 s past the 45 s fallback; `handOffToTask` then adds its own
~34 s, ~106 s total. On a box where every `GetExtendedTcpTable` read fails
(the exact trigger), a FALSE box appears at 45 s during a slow-but-successful
launch and "click OK" then kills a board that was about to hand off cleanly.

## The fix (PREFERRED engine-signal approach; NOT the server.js-touching alternative)

Make the board hand the launcher a POSITIVE proof of "I am serving from here"
that does not depend on the TCP table, so the launcher waits on proof rather than
a timeout-derived guess.

- **Signal mechanism: a file, at a path the LAUNCHER chooses and passes to the
  board in an environment variable** (`KOSMOS_SERVE_HERE_SIGNAL`). Chosen over a
  file in the anchor dir (would force the C# launcher to replicate
  `win32anchor.anchorDir`'s world/override derivation) and over a named Win32
  event (node cannot create a native named kernel event without a native addon).
  A launcher-chosen unique temp path is race-free (fresh GUID per launch, no
  stale file, no collision between installs), fully lifecycle-owned by the
  launcher (it creates the name, deletes the file after), and trivially
  sandboxed in tests (the launcher's `Path.GetTempPath()` honours the test's
  `TEMP`).

- **Board side (`engine/win32handoff.js`, NOT server.js):** `handOffToTask` is
  wrapped so that whenever it resolves `serve:true` (serve from here) it writes
  `process.pid` to the file named in `process.env.KOSMOS_SERVE_HERE_SIGNAL`, if
  set. Written ONLY on the serve-here decision -- never while a hand-off is still
  being attempted, and never when one succeeds (`serve:false`, the process then
  exits). Never throws. The env var is set only by the real launcher, so the
  task's headless board and non-win32 boots never write it.

- **Launcher side (`tools/windows/KosmosLauncher.cs`):** generate a unique signal
  path, set it in `KOSMOS_SERVE_HERE_SIGNAL` on the server `ProcessStartInfo`,
  and in the serving loop show the box on positive proof only:
  `ListenerStateOf(p.Id) == Listening || ServeHereSignalPresent(serveHereSignal)`.
  The time-derived `unreadableLongPastAnyHandOff` fallback (and `everyReadFailed`)
  are REMOVED: the signal is the authoritative unreadable-table proof, and it can
  never fire during a slow-but-successful boot. Listener proof stays as the other
  path. Signal file deleted after the board exits.

- **Comments:** the stale "34 s" derivation comment
  (`engine/win32handoff.js` UNREADABLE_LISTENER_MARGIN_MS block) and the
  UnreadableTableFallbackMs comment in KosmosLauncher.cs are removed with the
  mechanism they described. The `CheckForServingAfterMs` comments (both files)
  are updated to name the signal as the second positive proof.

## Constants pinned equal (convention 5, one fact two copies)

- Kept: `CheckForServingAfterMs` (C#) == `HANDOFF_CHECK_FOR_SERVING_AFTER_MS`
  (node), still the poll-start mark.
- Removed: the `UnreadableTableFallbackMs`==`HANDOFF_UNREADABLE_LISTENER_FALLBACK_MS`
  pin (both constants deleted with the fallback).
- Added: `ServeHereSignalEnvVar` (C#) == `SERVE_HERE_SIGNAL_ENV` (node), pinned
  by `tools.win-launcher-native.test.js`.

## Tests

1. `engine/win32handoff.test.js`: with `process.env.KOSMOS_SERVE_HERE_SIGNAL`
   set, `handOffToTask` writes the file (pid) when it resolves serve:true, does
   NOT write it when serve:false (hand-off succeeds), does not throw when the env
   is unset or the path is unwritable. Cross-platform (seams force the decision;
   fs-only write), so macOS CI runs it too.
2. `tools.win-launcher-native.test.js`: rewrite the serving-loop source-shape
   assertion to the signal-or-listener gate; drop the fallback pin; add the
   env-var-name pin; add a compiled-probe arm exercising `ServeHereSignalPresent`
   (present/absent/empty) beside the real KosmosLauncher.cs, and assert the
   server `ProcessStartInfo` sets the env var.
3. Rebuild `tools/windows/Kosmos.exe` from source and prove it with
   `verify-launcher.ps1` (the committed binary must reproduce from the committed
   source).

## Revert controls

Each new assertion is checked to go red against the pre-fix source (scratch copy,
never `git checkout` on working files).

## Scope guard

STAY OUT of server.js, web/index.html, update.js, win32update.js, platform.js,
win32create.js, win32job.js. The signal is written from win32handoff.js reading
`process.env` directly -- no server.js edit. If that proved impossible I would
stop and report; it is not.

## Environment

Node via `C:\Users\joshu\AppData\Local\Kosmos\runtime\node.exe` (v24.19). Every
test run uses the schtasks guard (`no-schtasks-preload.cjs`), scratch
APPDATA/LOCALAPPDATA, and a scratch `KOSMOS_SCHTASKS_BLOCK_LOG`. Suite compared
on the branch and on a `git archive` of origin/main (names AND first error line).
Launcher live-check uses FAKE boards in a scratch dir, never the real board.
