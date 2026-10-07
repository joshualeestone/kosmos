# micsettings-5481: a refused mic on the Mac app offers one Settings pill

Card: joshualeestone/kosmos#5481 (Josh, 2026-10-07; scope updated by Josh 08:16 and Splinter 08:20, 08:33).

## Asks
1. Why did the first click say "not allowed" with no system prompt? Measure. Do not use tccutil on fleet Macs except
   with a throwaway app's own bundle id.
2. When the microphone or speech recognition is refused, replace the directions with ONE "Turn on in Settings" control
   that opens the exact System Settings pane, and start the mic by itself once both are allowed.
3. UI (Josh): a pill IN PLACE of the mic button, `[X   Turn on in Settings]`; X dismisses it back to the plain mic; no
   sentence below the input. Below 480 px the label is `Settings` (Splinter 08:33). A composer placeholder stays one line.

## Design
- native-app/main.swift VoiceBridge:
  - op `settings` with `pane` (`speech` or `mic` only; anything else opens nothing) opens the pane and marks a
    Settings visit with the page's id (at most once a second). On each didBecomeActive, visitOnReturn: within 10
    minutes of the press, allowedEvent says `allowed` (speech on, mic on or never asked) or `settings-next` with pane
    `mic` (speech on, mic refused, after a SPEECH visit only) or `refused` with `mic-restricted`, and closes the visit;
    nothing changed keeps it open; older than 10 minutes, nothing.
  - restricted is told apart from denied (`speech-restricted`, `mic-restricted`).
  - Each permission answer is logged with its duration, so a refusal without a prompt shows as a few milliseconds.
- Every native refusal carries `canOpenSettings: true` (a capability, not a request for the pill). The page offers the pill only then: an older app still running after
  an update (the binary is replaced, the process keeps old code) cannot open Settings, so it keeps the sentence.
- web/index.html: on a desktop-bridge `mic-denied` or `speech-denied`, the mic gets class `has-pill` (hidden) and a
  `.voice-pill` is inserted after it, with ONE visit id minted for the pill. The label posts `{op:'settings', pane, id}`; `allowed` with that id clears the pill
  and calls voiceToggle on the same mic, but only if the box is where it was when Settings was PRESSED (voiceWhere(box, true),
  steady: same agent or room, the box laid out, open, without the page-hidden part), and only once the page is
  visible (a start while it reads hidden would be cancelled by the watcher's first look); that wait lasts a minute at most and
  is dropped by a new start; X clears it (focus goes to the mic only after a keyboard press; a mouse click leaves the caret in the box). The refusal is said by the pill's own hidden role=alert span, never the shared message line.
  The pill belongs to the place it was offered: a view change (another agent or room, the box closing) clears it
  and puts the plain mic back (a 500 ms watch while it shows).
  `settings-next` repoints the same pill to the Microphone pane and says so again (a fresh alert); `refused` swaps it for the restricted sentence. Other refusals keep their sentence.

## Measured (not built)
Ask 1 is NOT REPRODUCED, not fixed. Measured with two throwaway apps of my own bundle ids, built from one probe
that calls requestAuthorization and records the answer and its milliseconds, launched by `open` and directly: neither
was refused without a prompt. The permission log lines in start() are what will show the cause on the next refusal.
The shipped binary is signed alone (identifier kosmos-app, Info.plist not bound). Two throwaway apps, signed both ways,
both got the system prompt on macOS 26.7.1, so that is not the cause there. Re-signing is not done here: it changes
the identity existing grants are keyed on.

## Not measured
The round trip on a real Mac (press the pill, flip the switch in System Settings, come back, the mic starts) needs a
person to click the switch, which a headless run cannot. Unmeasured: that authorizationStatus changes inside the
running process without a relaunch, and the order of didBecomeActive against the page becoming visible (the page
waits for visibilitychange either way). Also unmeasured: that the two x-apple.systempreferences anchors open the exact Privacy pane on the shipped macOS
(not Settings' top level); the selftest checks the strings only. Both are for the first-use check.
Words shipped and mechanism built; the behaviour is to be seen on first use.
If Josh's no-prompt refusal turns out to be the never-asked case (speech-unanswered or mic-unanswered), he gets a
plain sentence and no pill: no Privacy pane lists an app that never asked. The permission log lines will say which.
X does not tell the app: its visit stays open up to 10 minutes and any later answer carries the old visit id, which
the page drops (tested). An op only to close it would add surface and change nothing the person sees.

## Tests
- `--kosmos-app-voice-selftest`: 43 rows, including micRefusal (never asked is mic-unanswered), pageGone (only a reloaded or crashed page drops the visit), settingsAccepted (Settings only after a denial), stampId, visitOnReturn (open, ready, too late), the once-a-second Settings limit, pane mapping, allowedEvent (allowed, settings-next, nothing) (the event and its Settings-visit id), readyToStart (speech allowed with the mic never asked counts as ready), and the restricted split.
- web.voice-4409.test.js: the pill, the X, `allowed`, and the controls.
- docs/browser-checks/render-voice-4409.js: V6, V6b, V6c, V6d and V6e.
- design shots: the screen agent-chat-mic-settings.
