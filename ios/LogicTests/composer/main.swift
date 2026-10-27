import Foundation
// Tests for the composer's emoji button and dictation (kosmos#7268). Ends with one verdict line.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() { passed += 1; print("  ok   \(name)") } else { failed += 1; print("  FAIL \(name) (line \(line))") }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? ".")
let boardPage = (try? String(contentsOf: repo.appendingPathComponent("web/index.html"), encoding: .utf8)) ?? ""
check(boardPage.count > 100_000, "premise: the board's page was read")

section("the board's emoji, the same 80 in the same order")
if let start = boardPage.range(of: "const PJ_EMOJI = ["), let end = boardPage.range(of: "];", range: start.upperBound..<boardPage.endIndex) {
    let block = String(boardPage[start.upperBound..<end.lowerBound])
    let theirs = block.components(separatedBy: "'").enumerated().filter { $0.offset % 2 == 1 }.map(\.element)
    check(theirs.count == 80, "premise: the board's list was read (\(theirs.count))")
    check(theirs == ComposerExtras.emoji, "the phone's list is the board's")
} else { check(false, "the board's PJ_EMOJI was not found") }
check(Set(ComposerExtras.emoji).count == ComposerExtras.emoji.count, "no glyph twice")
check(boardPage.contains("aria-label=\"Add an emoji\"") && boardPage.contains("aria-label=\"Pick an emoji\""), "the board's words for the button and the panel")

section("a pick goes in at the cursor")
check(ComposerExtras.insert("👍", into: "ok then", selection: 2..<2) == ("ok👍 then", 3), "at the cursor, the cursor after it")
check(ComposerExtras.insert("👍", into: "ok then", selection: 3..<7) == ("ok 👍", 4), "a selection is replaced")
check(ComposerExtras.insert("👍", into: "ok", selection: nil) == ("ok👍", 3), "no cursor known: at the end")
// kosmos#7346: the keyboard's Send key arrives as one typed new line, which sends; anything else is the person's text.
check(ComposerExtras.typedReturn(was: "Great, start it", now: "Great, start it\n") == "Great, start it", "kosmos#7346: Return at the end sends what was there")
check(ComposerExtras.typedReturn(was: "Great start", now: "Great\n start") == "Great start", "Return in the middle sends too, without the new line")
check(ComposerExtras.typedReturn(was: "", now: "\n") == "", "Return in an empty box gives an empty box (nothing to send)")
check(ComposerExtras.typedReturn(was: "a", now: "a\nb\nc") == nil, "CONTROL: pasted lines keep their breaks")
check(ComposerExtras.typedReturn(was: "ok", now: "oks") == nil, "CONTROL: a typed letter is typing")
check(ComposerExtras.typedReturn(was: "ab", now: "ac\n") == "ac", "a letter changed before the new line reads as a correction plus Send")
check(ComposerExtras.typedReturn(was: "ab", now: "a\nc") == nil, "review: CONTROL: a letter changed AFTER the new line is not the Send key (it goes in at the caret, after any correction)")
check(ComposerExtras.typedReturn(was: "abc", now: "abc\nok") == nil, "review: CONTROL: a short pasted \"\\nok\" keeps its break and does not send")
check(ComposerExtras.typedReturn(was: "helo\nworld", now: "hello\nworld\n") == "hello\nworld", "review: a correction before an earlier pasted break takes out the new Return, not the old break")
check(ComposerExtras.typedReturn(was: "hello there\nworld", now: "hello\n there\nworld") == "hello there\nworld", "review: Send with the caret in an earlier paragraph takes out the new Return, not the break after it")
check(ComposerExtras.typedReturn(was: "ab\ncd", now: "ab\n\ncd") == "ab\ncd", "a Return beside an old break leaves one break")
check(ComposerExtras.typedReturn(was: "abc", now: "a\n") == nil, "CONTROL: text shrinking around a new line is not a Return")
check(ComposerExtras.typedReturn(was: "see you tomorow", now: "see you tomorrow\n") == "see you tomorrow", "review: autocorrect landing with Send still sends, corrected")
check(ComposerExtras.typedReturn(was: "im here", now: "I'm here\n") == "I'm here", "and a correction earlier in the text too")
check(ComposerExtras.typedReturn(was: "a", now: "a\nbcdef") == nil, "CONTROL: a pasted line longer than a correction keeps its break")
check(ComposerExtras.typedReturn(was: "a\nb", now: "a\nb\nc\n") == nil, "CONTROL: two new lines are a paste")
check(ComposerExtras.typedReturn(was: "line\n", now: "line\n\n") == "line\n", "a Return after a pasted break still sends, keeping the paste")
check(ComposerExtras.insert("✌️", into: "", selection: nil) == ("✌️", 1), "an empty box; a two-scalar glyph is one character")
check(ComposerExtras.insert("👍", into: "ab", selection: 5..<9) == ("ab👍", 3), "a stale selection past the end: at the end, never a crash")
check(ComposerExtras.insert("👍", into: "a😀b", selection: 2..<2) == ("a😀👍b", 3), "counted in characters, not bytes or code units")

section("dictation adds to the box")
check(ComposerExtras.dictated(base: "", heard: " send it today ") == "send it today", "an empty box: the words")
check(ComposerExtras.dictated(base: "Yes,", heard: "send it") == "Yes, send it", "one space between")
check(ComposerExtras.dictated(base: "Yes, ", heard: "send it") == "Yes, send it" && ComposerExtras.dictated(base: "Yes\n", heard: "ok") == "Yes\nok", "no second space after white space")
check(ComposerExtras.dictated(base: "Yes", heard: "  ") == "Yes", "nothing heard yet: the box as it was")
check(ComposerExtras.micLine(.ready) == nil && ComposerExtras.micLine(.listening) == nil, "no line while it can listen")
check(ComposerExtras.micLine(.denied)?.contains("Settings, Kosmos") == true, "refused: where to allow it")
check(ComposerExtras.micLine(.restricted) != nil && ComposerExtras.micLine(.unavailable)?.contains("Try again") == true, "restricted and unavailable each say so")
check(ComposerExtras.micLine(.unsupported)?.contains("language") == true && ComposerExtras.micLine(.unsupported)?.contains("Try again") != true, "an unsupported language never says try again")
check(!ComposerExtras.dictationOverridden(current: "Yes, send it", lastWritten: "Yes, send it"), "its own words: dictation goes on")
check(ComposerExtras.dictationOverridden(current: "", lastWritten: "ship it"), "Send cleared the box: dictation stops (no words come back)")
check(ComposerExtras.dictationOverridden(current: "ship it 👍", lastWritten: "ship it"), "an emoji or typing: dictation stops")
check(ComposerExtras.micLabel(listening: true) == "Stop dictating" && ComposerExtras.micLabel(listening: false) == "Dictate a message", "VoiceOver's words")

section("the composers' wiring (review 2: a refactor that drops either line is caught)")
// Comments are dropped first (review 3), so a line that only mentions a call never stands in for it.
func code(_ name: String) -> String {
    let src = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/\(name).swift"), encoding: .utf8)) ?? ""
    return src.components(separatedBy: "\n").map { $0.components(separatedBy: "//").first ?? "" }.joined(separator: "\n")
}
// One function's body, up to the next function (review 3: not the rest of the file).
func body(of fn: String, in src: String) -> String {
    let after = src.components(separatedBy: fn).dropFirst().first ?? ""
    return after.components(separatedBy: "\n    private func ").first ?? after
}
for name in ["ChatView", "RoomView"] {
    let src = code(name)
    let body = body(of: "private func send() {", in: src)
    let stopAt = body.range(of: "dictation.stop()")?.lowerBound
    let clearAt = body.range(of: name == "ChatView" ? "draftText = \"\"" : "draft = \"\"")?.lowerBound
    check(stopAt != nil && clearAt != nil && stopAt! < clearAt!, "\(name): send() stops dictation before it clears the box")
    check(src.contains("dictation.boxChanged(to:"), "\(name): the box's changes reach dictation")
}
// Review 3: the room keeps its draft on every change of the box, so a stop there ended dictation after one word.
let keep = body(of: "private func keepDraft() {", in: code("RoomView"))
check(!keep.isEmpty && !keep.contains("dictation.stop") && !keep.contains("dictation.reset"), "RoomView: keeping the draft (on every keystroke) never stops dictation")
// Review 4: the other wiring sites, each pinned.
for name in ["ChatView", "RoomView"] {
    let src = code(name)
    check(src.contains("dictation.reset(); emojiOpen = false }"), "\(name): leaving resets dictation and closes the panel")
    check(src.components(separatedBy: "dictation.reset(); emojiOpen = false").count - 1 >= 2, "\(name): another account resets them too")
    // Inside the guard itself (review 5), not anywhere in the file.
    let guardBody = src.components(separatedBy: name == "ChatView" ? "private var canSend: Bool {" : "private var canPost: Bool {").dropFirst().first.map { String($0.prefix(400)) } ?? ""
    check(guardBody.contains("!dictation.busy"), "\(name): Send waits while dictating or finishing")
}
// Review 5: dictation's own setup changes the category and the route; only headphones in or out may stop it, and an
// interruption only when it begins.
let extras = code("ComposerExtras")
check(extras.contains("case .oldDeviceUnavailable?, .newDeviceAvailable?:") && extras.contains("return before == now ? .ignore : .headphones") && !extras.contains(".categoryChange?"), "a route change stops dictation only when headphones change the microphone input")
check(extras.contains("== .began ? .interruptionBegan : .ignore"), "an interruption stops it only when it begins")
check(extras.contains("if live && state == .listening && !engine.isRunning"), "an engine change stops it only when the engine really stopped, never while finishing")
check(extras.contains("case .mediaReset, .headphones: if active") && extras.contains("case .background: if active"), "headphones, a media reset and locking the phone leave finishing to complete")
check(extras.contains("[1110, 203]"), "both of Speech's silence codes count as nothing said")
for name in ["ChatView", "RoomView"] { check(code(name).contains(".onChange(of: searchFocused) { focused in if focused { emojiOpen = false } }"), "\(name): opening search closes the emoji panel") }
check(extras.contains("if finishing { return }") && extras.contains(".disabled(dictation.finishing)"), "a press while the last words land does not throw them away, and the spinner cannot be pressed")
check(extras.contains("if state == .denied, !busy, SFSpeechRecognizer.authorizationStatus() == .authorized"), "coming back clears a refusal only once both are really allowed (never on the alert's own dismissal)")
check(extras.contains("&& !silent && self.state == .listening"), "no refusal for silence or after a stop by hand")
// The few lines before the draft is saved on leaving must stop dictation first.
let chat = code("ChatView")
let beforeSave = chat.components(separatedBy: "client.drafts[agent.session] = draftText").first.map { String($0.suffix(400)) } ?? ""
check(chat.contains("client.drafts[agent.session] = draftText") && beforeSave.contains("dictation.stop()"), "ChatView: dictation stops before the draft is saved on leaving")

section("the reasons iOS shows the first time")
let pbx = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos.xcodeproj/project.pbxproj"), encoding: .utf8)) ?? ""
check(pbx.components(separatedBy: "INFOPLIST_KEY_NSSpeechRecognitionUsageDescription = ").count - 1 == 2, "speech recognition has a reason, in both builds")
check(pbx.components(separatedBy: "you dictate a message or record a video").count - 1 == 2, "the microphone's reason names dictation, in both builds")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
