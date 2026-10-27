# emojimic-7268 review 1 (blind, CTO lens)

Scope: `git diff origin/dmbottom-7265...emojimic-7268` (ComposerExtras.swift, ComposerLogic.swift, ChatView.swift, RoomView.swift, project.pbxproj, ios.yml, LogicTests/composer).

## What I checked

- Built: `xcodebuild -target Kosmos -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build`: BUILD SUCCEEDED, no warnings from the new code.
- Ran `ios/LogicTests/run-composer.sh`: VERDICT: PASS 20/20.
- Read the emoji panel / focus state in both composers, CursorField and CursorField18 index math, the whole Dictation lifecycle, ChatView's draft save/restore, send(), failed-send restore and chatEpoch reset, RoomView send(), applyKept and onDisappear, the Info.plist keys, the CI step, and the board's own panel rules (web/index.html pjEmojiClose call sites).
- Checked and found sound: insert() clamping (stale/out-of-range selection goes to the end, Character counting), the CursorField18 bounds guard, the reply hint and accessibilityFocused still landing on the TextField (CursorField's body is a single TextField in each branch, so the modifiers reach it), the panel closing when the box takes focus, the tab bar toggle in the room, the CI step (pipefail + VERDICT grep), both plist keys present in Debug and Release.

## Findings

- [BLOCKER] ios/Kosmos/ComposerExtras.swift:110 with ChatView.swift:1122 and RoomView.swift:1116. Sending while dictating brings the sent words back. Scenario: press the mic, say "ship it", press Send. send() clears the box but dictation keeps running with `base` and the full transcript; the next partial or final result calls onText(base + "ship it") and the box fills again with the words just sent. The person sees the message in the box, presses Send again, and the agent or room gets it twice. In ChatView it also defeats the failed-send restore (`if draftText.isEmpty { draftText = text }` now sees a non-empty box), and the chatEpoch reset (ChatView.swift:269, `draftText = ""`) is refilled with the previous account's words. Fix: call `dictation.stop()` in both send() functions and in ChatView's chatEpoch handler before clearing; belt and braces, have Dictation remember the last string it wrote and stop itself when the bound text is no longer that string.

- [WARNING] ios/Kosmos/ComposerExtras.swift:110 (base captured once at start). Anything typed or picked while dictation runs is wiped by the next partial result, because every result rewrites the box as `base + heard` from the snapshot taken at start. Scenario: dictate, tap into the box, type a correction or pick an emoji from the panel: it vanishes on the next word recognised. Fix: stop dictation when the box takes keyboard focus and when an emoji is inserted (or detect the external edit as above and stop).

- [WARNING] ios/Kosmos/ComposerExtras.swift:74-76. toggle() is re-entrant while start() is awaiting permissions or setting up: state stays `.ready` until the engine runs, so a second press starts a second start(). The second removes the first tap, installs its own and overwrites `request`/`task` without cancelling the first task or ending its audio. The orphaned first task later errors (no more buffers), its callback passes the `state == .listening` guard and calls stop(), killing the live session mid-sentence. Same gap: leaving the screen during the awaits runs stop() as a no-op, then start() turns the microphone on for a composer that is gone (in RoomView the Dictation object outlives the composer while a member's chat is pushed, so the mic stays live and keeps writing into the room's draft). Fix: a `.starting` state (ignore toggles while in it, and let stop() cancel it), plus a generation token checked after each await and inside the recognition callback so an old task can never stop a newer one.

- [WARNING] ios/Kosmos/ComposerExtras.swift:91 and :121-130. The shared AVAudioSession is set to `.record` / `.measurement` and never restored; stop() only deactivates it. The next thing in the app that plays sound (a video opened through the Quick Look preview at ChatView.swift:146 / RoomView.swift:215) activates the session with the `.record` category still set, which silences output. Fix: save the category, mode and options before setCategory and put them back in stop(), or use `.playAndRecord` with `.defaultToSpeaker`.

- [WARNING] ios/Kosmos/RoomView.swift:1023 and ChatView.swift:960. emojiOpen is not reset when the composer leaves the screen. Scenario: open the panel in a room, tap a member's name to open their chat, come back: the panel is still open and the tab bar still hidden; the board closes the panel when its composer is left (web/index.html:44899, "the panel belongs to the composer being left"). Fix: `emojiOpen = false` in both onDisappear handlers (and in the chatEpoch handlers).

- [WARNING] ios/Kosmos/ChatView.swift:944 and RoomView.swift:1007 (micLine). A refusal or "not available" line appears silently: nothing posts it to VoiceOver, and the mic button's label does not change, so a VoiceOver user who presses the mic and is refused hears nothing at all. Fix: `UIAccessibility.post(notification: .announcement, argument: line)` when state moves to denied/restricted/unavailable (the files already do this via Self.say / startReply), and an announcement on start/stop listening.

- [NIT] ios/Kosmos/ComposerExtras.swift:121-130. stop() runs on every composer disappear even when dictation never started: it instantiates `engine.inputNode` and deactivates the app's shared audio session. Fix: return early unless `request != nil || engine.isRunning`.

- [NIT] ios/Kosmos/ComposerExtras.swift:66-67 with both composers. The refusal line is sticky: after `.denied` or `.unavailable` it stays under the box for the life of the view, including after the person has allowed access in Settings and come back. Fix: reset to `.ready` on onDisappear, on scenePhase becoming active, or when the person starts typing.

- [NIT] ios/Kosmos/ComposerExtras.swift:88. `SFSpeechRecognizer()` returns nil for a locale with no recognizer; the person is then told "Try again in a moment", which will never help. Fix: a distinct line for the unsupported-language case.

- [NIT] ios/Kosmos/ChatView.swift:1064. The DM box lost its placeholder colour: the old TextField used `prompt: Text(...).foregroundColor(Palette.secondary)`, CursorField takes a plain placeholder String, so the system placeholder colour shows on Palette.card. Fix: let CursorField take a prompt Text and pass the old one.

- [NIT] ios/Kosmos.xcodeproj/project.pbxproj:284. "Nothing is sent until you press Send" is true of the message but not of the audio: when the device does not support on-device recognition (ComposerExtras.swift:95 only requires it when supported), speech goes to Apple's servers. Fix: say "Your message is not sent until you press Send", or drop the sentence.

- [NIT] ios/Kosmos/ComposerExtras.swift:20 and :38. The new buttons have labels but no hints (asked for in the brief). Fix: e.g. "Shows emoji in place of the keyboard" and "Types what you say into the box".

- [NIT] ios/LogicTests/composer/main.swift:476-477. micLine is only checked for `.denied`; `.restricted` and `.unavailable` are untested, and nothing pins the send-while-dictating rule (which would be testable if the "stop when the text was changed by someone else" decision were a pure function in ComposerLogic).

Totals: 1 BLOCKER, 5 WARNING, 7 NIT
