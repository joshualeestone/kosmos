# voice-4409: talk to agents and hear them, built in (slice 1, Mac)

## Why
Josh 2026-09-28 15:02: "it would be so great to be able to get an agent to speak and to be able to speak to them
through Kosmos.. I mean I use wisp flow but if it was just built in that would be awesome".

## Measured first (card #4409, 15:20 CDT)
A probe app with our WKWebView set up as main.swift makeWebView does: isSecureContext true on http://127.0.0.1;
speechSynthesis works with 68 voices, all on-device; webkitSpeechRecognition present; getUserMedia undefined; native
SFSpeechRecognizer(en-US) supportsOnDeviceRecognition true. The mic was never started (no prompt left on a shared Mac).

## Call
- Hear: in the page, speechSynthesis, on-device voices only (no local voice = no button). A speaker button in an agent
  message's hover bar (DM and room, before Reply, which #4358 keeps last) and on the Guide's answers. Code blocks
  (span.mdcb) are said as "code block", links read as their text, <br> lines kept apart, long text in pieces; one
  message at a time, a second press stops it.
- Talk: a native kosmosVoice bridge in the Mac app. SFSpeechRecognizer with requiresOnDeviceRecognition = true; a
  language with no on-device model is REFUSED, never sent to the network. Audio from an AVAudioEngine tap, nothing
  written to disk. Only the board's own main frame can use the bridge. Partial text lands in the box at the caret;
  nothing is sent. Click to start, click / Send / Escape to stop; the button says it is listening (screen reader too).
- The mic is drawn only where the bridge exists (the Mac app). In a browser it is hidden: Chrome's
  webkitSpeechRecognition sends audio to Google.
- The app signs with com.apple.security.device.audio-input (hardened runtime blocks the mic without it; read back from
  the signature at build) and install/setup.sh's Info.plist carries NSMicrophoneUsageDescription and
  NSSpeechRecognitionUsageDescription. The bridge refuses rather than crashing when either is missing.

- Review iteration 1: (BLOCKER) opening another agent or room fires no hashchange (history.replaceState) and #d-say /
  #pj-post are shared boxes, so a word heard after a switch landed in the next agent's box and was parked as their
  draft. Dictation is now bound to the view it started in (voiceWhere: box, agent, room, box on screen, page not
  hidden); a word arriving after any change cancels instead, and a 500 ms watch stops the mic when nothing is heard.
  The window closing or minimising cancels natively (hostCancel). The recognizer is held for the task's life; a stop
  with no final answer ends after 5 s. Read-aloud is keyed on the message's words and view, follows its message
  through a repaint, and stops on a switch or when the message leaves the screen. Paste or drop takes the box back.
  A browser whose voice list loads late waits for it once. Driven by web.voice-4409.test.js (switch, closed Guide,
  hidden page, repaint); removing the view check or the repaint hand-off reds them. The native changes are read from
  source and typecheck at the floor target; they need a person at a Mac to be seen working (same as the mic itself).
- Review iteration 2: (WARNING) moving from one mic to another is cancel-then-start in one turn, and the cancel's
  "stopped" arrived after the new start and ended it: mic on, button off. The page now tags each start with an id,
  the app echoes it on every event, and the page ignores another session's events (an app without ids is taken as
  before). NITs: a window hidden during the permission prompt now cancels the pending start; two messages with the
  same words keep read-aloud on the one it started on; the tests now drive voiceToggle and the watch itself.
- Review iteration 3: (WARNING) a crashed page process, or a reload, left the Mac listening while the new page drew
  every mic off. The app now cancels on webViewWebContentProcessDidTerminate and on each main-frame commit. NIT: the
  idle stop clears the pending flag. The test harness now runs on the page's own VOICE, SPEAK and VOICE_WATCH.
  ACCEPTED (not changed): if the bridge were to drop a start without a word (an origin mismatch, not seen on a normal
  board load), the button stays "asking" until a reload. Clearing it on the page alone could say off while the mic
  is on, which is the one thing this card must not do. The native half of the id protocol is pinned by source
  reads; its ordering (cancel emits before a new start sets the id) holds because WebKit delivers the page's
  messages in order on the main thread.
- Review iteration 4 (converged): NIT fixed, the box gets focus back when listening starts, so Escape (a promise on
  the card) works after clicking the mic. ACCEPTED: no AVAudioEngineConfigurationChange observer, so an unplugged mic
  leaves the button on until the recognizer errors or the 300 s cap; that is the safe direction (on while off).
- Review iteration 5: (WARNING) the Guide ends a chat with readOnly, not disabled, and the mic still wrote into it:
  words the person could not delete, sent when the chat came back. The mic now refuses a read-only box, and a box
  that closes mid-dictation (read-only, or #d-say disabled when an agent goes offline) counts as a move and stops it.
  NIT: with focus in the box, a screen reader heard nothing about listening; the box's message line now says
  "Listening. Press Escape to stop." (cleared when it ends), and #pj-room-msg became a live region (role=status).
- Review iteration 6: (WARNING) the box is rebuilt from the before/after read at the start, so any other write while
  listening (an emoji from the picker, Reply's @mention, undo, autocorrect) was wiped by the next word. Dictation now
  remembers what it last left in the box; if the box holds anything else, the person changed it, and dictation stops
  and keeps their text. NIT: starting the mic no longer clears another message's line (only the mic's own), and the
  listening line is written only into an empty line. ACCEPTED: #d-say-msg is role=alert (assertive), so "Listening"
  interrupts a screen reader; #pj-room-msg is display:none while empty, and a live region shown with its text in one
  step can be announced unreliably by VoiceOver. Both are existing elements' semantics, not changed here.
- DEFERRED: the browser check covers the DM composer only; the room and Guide mics share the same functions.
## Rejected
- The page's webkitSpeechRecognition: needs the same permissions and entitlement, and the page cannot demand
  on-device recognition, so it costs the same and gives up the guarantee.
- SpeechTranscriber (macOS 26 only): the floor stays 13.5; later.

## Not done (later slices)
Windows (Homer), a per-agent "read replies aloud" switch, SpeechTranscriber.

## Weakest premise
The mic path has not been seen working end to end: that needs a person at a Mac to allow both prompts and speak.
The mechanism, entitlement and plist keys are checked in the build and by --kosmos-app-voice-selftest (14/14); the
page side by web.voice-4409.test.js and the render-voice-4409 browser check. Behaviour is measured on a person's
Mac after release.
