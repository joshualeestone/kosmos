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
