# emojimic-7268 review 5 (blind, CTO lens)

## What I checked

- The full diff `origin/dmbottom-7265...emojimic-7268 -- ios .github`: ComposerExtras.swift (Dictation, CursorField), ComposerLogic.swift, ChatView.swift, RoomView.swift, the composer LogicTests, run-composer.sh, the ios.yml step, the Info.plist keys in project.pbxproj.
- Every path that sets or clears `starting`, `finishing`, `live` and `state`, to see whether `busy` (and so a disabled Send or Post) can stick. It cannot: `finishing` is cleared by `stop()`, every generation bump goes through `stop()` (or `toggle()`, which while finishing calls `stop()`), and the 2 s timer always ends it.
- Every write to `draft` / `draftText` in both views (restore on appear, takeReturned, applyKept, Reply's @name, the reply x, a failed post putting words back), against `boxChanged` and the per-result live-box check.
- Ran `ios/LogicTests/run-composer.sh`: VERDICT: PASS 37/37. Built `-target Kosmos -sdk iphonesimulator`: BUILD SUCCEEDED, no errors.

## Findings

- [BLOCKER] ios/Kosmos/ComposerExtras.swift:107-115 (with :163-164). The route-change observer stops dictation on EVERY `AVAudioSession.routeChangeNotification`, with no look at its reason. Dictation's own `setCategory(.record, ...)` and `setActive(true)` in `start()` change the category and the route (output-only to microphone input), and AVAudioSession posts `routeChangeNotification` with reason `.categoryChange` for exactly that (documented: "The category of the session object changed"). The notification is posted asynchronously and the observer hops to the main queue and then to a main-actor Task, so it runs just after `start()` has set `state = .listening`. Sequence: press the microphone; it turns red; within a moment it goes back to grey, VoiceOver says "Stopped dictating", nothing is typed. This happens on every start, because `releaseAudio()` restores the previous category each time, so the next start changes the category again. `.AVAudioEngineConfigurationChange` on the same engine is a likely second trigger of the same self-stop. The source-text tests cannot see this and the simulator build does not exercise it; the cause is documented API behaviour, not a guess about hardware. Fix: read `AVAudioSessionRouteChangeReasonKey` and stop only for `.oldDeviceUnavailable` and `.newDeviceAvailable` (headphones out or in), ignoring `.categoryChange`, `.override` and `.routeConfigurationChange`; act only when `live` and only for a notification that arrives after this session's own setup (for example, record the generation at setup and ignore route changes within the same run loop turn, or install the route and engine observers after `engine.start()` and remove them in `stop()`). Do the same for the engine configuration observer. Then confirm once on a device that a start stays listening.

- [NIT] ios/Kosmos/ComposerExtras.swift:107-115. `interruptionNotification` stops on both `.began` and `.ended`. An `.ended` arriving after the person came back and pressed the microphone again (they can return to the app before the other side posts `.ended`) stops the new session. Fix: stop only for `AVAudioSession.InterruptionType.began`.

- [NIT] ios/Kosmos/ComposerExtras.swift:123-130 and :178. `lastWritten` is set to the new `base` only in `start()`, after the permission awaits. While starting, `boxChanged` compares against the previous session's `lastWritten`. If the box is changed during starting to text that happens to equal the old `lastWritten` (rare), no stop happens and the first result writes `base + heard` over that change. Fix: set `lastWritten = base` (and clear `heard`) in `toggle()` when the generation moves on.

- [NIT] ios/Kosmos/ComposerExtras.swift:164-165. `didActivate = true` is set whenever `setActive(true)` succeeds, including when the session was already active for something else, so release deactivates a session dictation did not activate. Nothing else in the app uses AVAudioSession today (grep found none), so nobody hits it now. Fix: record `session.isOtherAudioPlaying` / the app's own playback state, or keep the comment honest that it deactivates whatever dictation set active.

- [NIT] ios/Kosmos/ComposerExtras.swift:124 with :30. While finishing, the button already shows the plain microphone (`active` is false) and Send is still disabled, yet a press does not start dictating, it ends the finish. A person who taps the microphone again in those 2 s to keep talking sees nothing start. Fix: keep the stop look (or a third look) while `finishing`, so the press matches what it does.

- [NIT] ios/Kosmos/ChatView.swift:1112-1115, ios/Kosmos/RoomView.swift:867-870. Send and Post are now silently disabled while listening; nothing says why, to sight or to VoiceOver. Fix: a hint on the disabled button ("Stop dictating first") when `dictation.busy`.

- [NIT] ios/LogicTests/composer/main.swift:67-72. `!dictation.busy &&` is checked anywhere in the file, not inside `canSend` / `canPost`; it would still pass if the guard moved to an unrelated expression. And no test pins the observer reasons, so the BLOCKER above has no guard. Fix: check within the body of `private var canSend` / `canPost`, and pin the route-change reason filter in the source.

- [NIT] ios/Kosmos.xcodeproj/project.pbxproj:284 and :317. The speech recognition reason says "until you press Send"; in a project room the button is Post. Fix: "until you send it".

Totals: 1 BLOCKER, 0 WARNING, 7 NIT
