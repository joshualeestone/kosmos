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
    `mic` (speech on, mic refused) and closes the visit; nothing changed keeps it open; older than 10 minutes, nothing.
  - restricted is told apart from denied (`speech-restricted`, `mic-restricted`).
  - Each permission answer is logged with its duration, so a refusal without a prompt shows as a few milliseconds.
- web/index.html: on a desktop-bridge `mic-denied` or `speech-denied`, the mic gets class `has-pill` (hidden) and a
  `.voice-pill` is inserted after it. The label posts `{op:'settings', pane, id}`; `allowed` with that id clears the pill
  and calls voiceToggle on the same mic, but only if the box is where it was when Settings was PRESSED (voiceWhere: same
  agent or room, shown, open); X clears it and focuses the mic. The refusal is said by the pill's own hidden role=alert span, never the shared message line.
  `settings-next` repoints the same pill to the Microphone pane. Other refusals keep their sentence.

## Measured (not built)
The shipped binary is signed alone (identifier kosmos-app, Info.plist not bound). Two throwaway apps, signed both ways,
both got the system prompt on macOS 26.7.1, so that is not the cause there. Re-signing is not done here: it changes
the identity existing grants are keyed on.

## Tests
- `--kosmos-app-voice-selftest`: 33 rows, including visitOnReturn (open, ready, too late), the once-a-second Settings limit, pane mapping, allowedEvent (allowed, settings-next, nothing) (the event and its Settings-visit id), readyToStart (speech allowed with the mic never asked counts as ready), and the restricted split.
- web.voice-4409.test.js: the pill, the X, `allowed`, and the controls.
- docs/browser-checks/render-voice-4409.js: V6, V6b, V6c, V6d and V6e.
- design shots: the screen agent-chat-mic-settings.
