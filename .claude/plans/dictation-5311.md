# #5311: the Mac mic says "Dictation is off" when that is why it stopped

## Measured (not asked)
Josh's Kosmos app is on Mortals (pid 70033). Unified log, 2026-10-05 11:00:04: localspeechrecognition refused the app's
on-device dictation with `kLSRErrorDomain` 201 "Siri and Dictation are disabled". VoiceBridge.endReason mapped no
kLSRErrorDomain code, so the page showed the catch-all "Listening stopped because of an error. Try again."
Also: logLine writes only to an existing test log, and production sets no KOSMOS_APP_LOG, so the native error was
recorded nowhere; it was found only in macOS's own unified log.

## Change
- native-app/main.swift endReason: kLSRErrorDomain 201 -> "dictation-off". finish() also checks the error's
  NSUnderlyingErrorKey when the top error says only "recognizer" (the framework may wrap the daemon's error).
- finish() NSLogs the voice error (domain, code, underlying, reason), so it reaches the unified log.
- web/index.html VOICE_SAYS['dictation-off']: "Dictation is turned off on this Mac, and Kosmos listens through it.
  Turn on Dictation in System Settings, Keyboard, Dictation, then try again."
- Voice selftest rows: + Dictation off, + a CONTROL (another kLSR code stays "recognizer"); expected 14 -> 16.
- web.voice-reasons-5311.test.js: every reason endReason returns has a page sentence (a class guard), and the new
  mapping and sentence are pinned. Mutation: renaming the page key reds both.

## Weakest premise
That the error the APP receives is kLSRErrorDomain 201 itself or wraps it as the underlying error. The daemon logged
201; the client-side NSError was not observed (the app logged nothing). The NSLog added here is what proves it next
time. If it arrives as something else (e.g. kAFAssistantErrorDomain), the log names it and the map gains one line.
Copy is for Mona to approve.
