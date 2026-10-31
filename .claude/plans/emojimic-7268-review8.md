# emojimic-7268 review 8 (blind, CTO lens)

## What I checked

- The whole diff `origin/dmbottom-7265...emojimic-7268 -- ios .github`: ComposerExtras.swift (Dictation, CursorField and CursorField18, EmojiPanel, the two buttons), ComposerLogic.swift, the ChatView and RoomView wiring, the pbxproj usage strings, run-composer.sh and the CI step.
- Every way out of `starting` and `finishing` (refuse, stop, the 2 s timer, the result handler), the generation check after each await, the result handler's override check and its refusal condition (1110 and 203 as silence), the notification filter (interruption began, input-only route changes, engine stopped while listening, media reset and headphones now `active` only, background, didBecomeActive with both permissions granted), and the save and restore of the audio session.
- Sequences: first press with both permission alerts (allow and refuse), a press while starting, a stop by hand then a second press, Send and Post while busy, typing, an emoji pick, Reply in a room, a mention pick, the Reply strip's x, a returned post and a failed DM coming back, applyKept, leaving, another account, the search button, and both emoji panel open and close paths on iOS 16/17 and iOS 18.
- Every write to `draft` in RoomView and to `draftText` in ChatView, and every place `typing` and `composerFocused` are set or read.
- Built: `xcodebuild ... -target Kosmos -sdk iphonesimulator`, BUILD SUCCEEDED. Ran `ios/LogicTests/run-composer.sh`: VERDICT: PASS 43/43.

## Findings

- [WARNING] ios/Kosmos/RoomView.swift:141-147, :1018 and ios/Kosmos/ChatView.swift:157-162, :957. The emoji panel closes only when the message box itself takes focus, so it stays open under the search keyboard. The sequence: in a room (or a direct message), tap the face to open the panel, then tap the magnifier. `searchFocused = true` brings the keyboard up for the search field, but `typing` (or `composerFocused`) never becomes true, so `emojiOpen` stays true. The composer, which sits above the keyboard's safe area, now carries the 216 pt panel on top of the keyboard. On a small iPhone (SE, 667 pt) that leaves roughly 30 to 40 pt for the thread, so the search results the person just asked for cannot be seen, and the only way out (the keyboard icon inside the box) is not where they are looking. Picks made from the panel at that point go into the message box, not the search field they are typing in. Fix: close the panel whenever search opens (`emojiOpen = false` next to `searchOpen = true` in both views), or more generally on `UIResponder.keyboardWillShowNotification` when the composer is not the field taking focus.

- [NIT] ios/Kosmos/ComposerExtras.swift:162. `.background` stops when `busy`, which includes `finishing`. Locking the phone or going home in the 2 s after a stop by hand cancels the task, so the last half second of words is lost, even though the microphone is already closed. Review 7 fixed this same thing for media reset and headphones. Fix: for `.background`, call `stop(say: true)` only when `active`, and let `finishing` complete (or let its timer end it).

- [NIT] ios/Kosmos/ComposerExtras.swift:193-195. A box change while `starting` (for example a returned post or a failed DM landing in the empty box in the half second before listening begins) calls `stop(say: true)`, but `stop` only announces when `state == .listening`. The button turns from red back to grey and VoiceOver says nothing. Fix: in `boxChanged`, announce when `active` was true, not only when the state was `.listening`.

- [NIT] ios/Kosmos/ChatView.swift:948-954, ios/Kosmos/RoomView.swift:1015. With the keyboard down, the panel sits on top of the bottom safe area, and the strip under it (home indicator) shows `Palette.ground` rather than the panel's `Palette.card`. The panel reads as cut off above the home indicator. Fix: give the panel's background `.ignoresSafeArea(edges: .bottom)`.

- [NIT] ios/LogicTests/composer/main.swift:77-84. The review 7 change (`.mediaReset, .headphones: if active`) and the 203 silence code are pinned only by the larger `&& !silent && self.state == .listening` string, which does not include either. Changing `active` back to `busy`, or dropping 203, fails nothing. Fix: add a pin for `case .mediaReset, .headphones: if active` and for `[1110, 203]`.

Totals: 0 BLOCKER, 1 WARNING, 4 NIT
