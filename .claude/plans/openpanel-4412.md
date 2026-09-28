# openpanel-4412: a file picker that drops its callback no longer aborts the app (kosmos#4412)

Josh, 2026-09-28 15:10: the Mac app aborted (SIGABRT) while he changed an agent's picture. The report's
backtrace: WebKit's UIClient::runOpenPanel -> _Block_release -> ~CompletionHandlerCallChecker -> NSException
-> abort, with no Kosmos frame between runOpenPanel and the release.

## Mechanism (read from the report)
The handler WebKit hands `webView(_:runOpenPanelWith:)` was released un-called when the method returned. On
every shipped path the only thing still holding it was `NSOpenPanel.begin(completionHandler:)`'s completion, so
begin dropped its completion without calling it. #2807's fix assumed begin always calls back.

## What changes (native-app/main.swift)
1. The answer is held past begin (by the watch, and defensively by `openPanelHeld`), so WebKit's handler can
   never be released un-called.
2. A watch looks 5 s after the picker was asked (openPanelFirstLook), then every 0.5 s; it answers nil once the
   picker is seen gone on two looks in a row (so a panel that hides just before AppKit delivers its answer keeps
   the pick). While Kosmos is in the background the answer is deferred (Josh's repro: switch to the browser with
   the picker up). A panel slower than 5 s to appear would be answered nil under the person; begin shows it in
   about 0.03 s (measured), so this is accepted.
3. Every path still answers exactly once (the existing call-once `respond`).

## Test (red on the old behaviour)
`--kosmos-app-filepanel-selftest` gains a dropped-callback arm: a presenter that throws the callback away, as
begin did. With the fix removed the selftest aborts there (exit 134, "Completion handler passed to
-[AppDelegate webView:runOpenPanelWithParameters:...] was not called", Josh's exact exception). With it, no abort,
and the next press reaches the app again. The bundle gate (tools/build-kosmos-bundle.sh) now requires the four new
lines; tools.filepanel-gate.test.js pins them (each dropped at a clean exit must fail and be named) and that a run
dying at that arm fails the gate. Timing: see the verification section below.

## Not reproduced, stated plainly
Josh's trigger (picker up, switch apps, come back) could not be driven from an agent: a probe with a real
NSOpenPanel ran, but macOS would not let a process launched from a shell make itself active again (it read
inactive at every step), so the deactivate/reactivate path was never exercised. The fix does not depend on the
trigger: whatever makes begin drop its completion, the app no longer aborts.

## Weakest premises
- If a real picker is up but reports not visible while Kosmos is active, the watch answers nil after 5 s and a
  later pick does nothing (no crash). isVisible is AppKit's own answer for an on-screen panel.
- Stale-bundle vs general: treated as general (told Splinter); #4347 only protects updates after it ships.

## Josh 17:09: Change picture dead in Create Agent until an app restart (same root)
The stuck state: a picker that keeps its callback but never calls it (or drops it) left openPanelOutstanding true, so
every later press was refused with nil and no picker opened again. The watch answers it and `respond` clears the flag.
- New selftest arm after-a-hung-picker: a presenter that keeps the callback and never calls it, then a second press
  must reach a picker. Mutation (watch removed): the second press after the dropped picker is refused
  ("reaches-the-app-again:no", exit 1), which is Josh's symptom.
- Verified on the real board page (a sandbox board on this branch, a scratch probe loading it in the native window,
  real NSOpenPanel each time): create-form Change picture opens, opens after a cancel, and opens after a picker that
  dropped its callback; the agent page and profile Change picture open too. Switching apps cannot be driven from an
  agent (macOS refuses programmatic activation), so that step is covered by the dropped/hung arms, not by a click.
- Timing: selftest now ~29 s; its watchdog 50 s; the bundle gate's alarm 55 s.
- The real panel's rule (openPanelStillUp: on screen, or Kosmos in the background, counts as up) is a function the
  selftest prints for all four cases and the gate requires. NOT covered: that the watch passes the real panel's
  isVisible and NSApp.isActive into it (a shell-launched selftest is never the active app); that wiring is the
  out-of-tree probe above. NSOpenPanel does not hide on deactivate (hidesOnDeactivate=false), so the away clause
  defers answering while the person is away rather than protecting a hidden panel.
- The re-look is 0.5 s, so a picker that closes without answering is answered within half a second.
