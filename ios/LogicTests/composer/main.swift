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

section("the reasons iOS shows the first time")
let pbx = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos.xcodeproj/project.pbxproj"), encoding: .utf8)) ?? ""
check(pbx.components(separatedBy: "INFOPLIST_KEY_NSSpeechRecognitionUsageDescription = ").count - 1 == 2, "speech recognition has a reason, in both builds")
check(pbx.components(separatedBy: "you dictate a message or record a video").count - 1 == 2, "the microphone's reason names dictation, in both builds")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
