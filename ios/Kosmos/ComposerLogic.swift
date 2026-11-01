import Foundation

// kosmos#7268 (Josh, 2026-10-26 18:26, TestFlight build 4): an emoji button (the greyed-out face, as on the desktop)
// inside the message box, and a microphone for dictation, in a direct message and in a project room. The decisions
// are here (tested in LogicTests/composer); ComposerExtras.swift draws the button, the panel and the microphone.
enum ComposerExtras {
    // The board's PJ_EMOJI (web/index.html, #3744), the same 80 in the same order, so the phone offers what the
    // computer does. LogicTests checks they stay equal.
    static let emoji: [String] = [
        "😀", "😄", "😁", "😅", "😂", "🙂", "😉", "😊", "😍", "😘", "😎", "🤔", "😐", "😴", "😇", "🤗",
        "🙃", "😢", "😭", "😤", "😠", "😳", "🤯", "😱", "🥳", "🤩", "😏", "🙄", "😬", "🤨", "😮", "😲",
        "👍", "👎", "👏", "🙌", "🙏", "👌", "🤝", "💪", "👀", "🫡", "🤙", "✌️", "🫶", "👋", "🤞", "🤦",
        "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💯", "🔥", "✨", "⭐", "🎉", "🚀", "✅", "❌", "⚠️",
        "💡", "📌", "📝", "🐛", "🔧", "🔒", "⏳", "📈", "☕", "🎯", "🧠", "🍕", "🐢", "🎈", "📎", "🗂️",
    ]

    // kosmos#7687 review 2: the send button refuses only a tap within sendSettle of dictation ending (it appears where the
    // stop button was, so a quick second tap on Stop would send words nobody has read). Never keyed on the button appearing.
    static let sendSettle: TimeInterval = 0.4
    static func sendTakes(now: Date, dictationEnded: Date?) -> Bool { dictationEnded.map { now.timeIntervalSince($0) >= sendSettle } ?? true }

    // kosmos#7687 (Josh 10-31, reversing #7346's no-arrow): the keyboard's return key puts in a new line and never sends;
    // a send button takes the microphone's place once there is something to send (words, or files with or without
    // words), as Discord's composer does. Not while dictating or while its last words land: the microphone is the stop
    // button then, and it stays until dictation ends.
    static func showsSend(text: String, files: Int, dictating: Bool) -> Bool {
        guard !dictating else { return false }
        return files > 0 || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // The board's pjEmojiInsert: the glyph replaces the selection (or goes in at the cursor), and the cursor lands
    // after it. `selection` is in Characters of `text`; nil (no cursor known: older iOS, or the box not focused) puts
    // it at the end. Returns the new text and the cursor's place in Characters.
    static func insert(_ glyph: String, into text: String, selection: Range<Int>?) -> (text: String, caret: Int) {
        let count = text.count
        let lo = min(max(selection?.lowerBound ?? count, 0), count)
        let hi = min(max(selection?.upperBound ?? count, lo), count)
        let start = text.index(text.startIndex, offsetBy: lo)
        let end = text.index(text.startIndex, offsetBy: hi)
        let out = String(text[..<start]) + glyph + String(text[end...])
        return (out, lo + glyph.count)
    }

    // Dictation adds to what was already in the box when the microphone was pressed, never replaces it: the words heard
    // so far go after it, with one space between when it does not already end in white space.
    static func dictated(base: String, heard: String) -> String {
        let words = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return base }
        guard let last = base.last else { return words }
        return base + (last.isWhitespace ? "" : " ") + words
    }

    // What the microphone says when it cannot listen, in the person's words. nil: it can.
    enum Mic: Equatable { case ready, listening, denied, restricted, unavailable, unsupported }
    static func micLine(_ m: Mic) -> String? {
        switch m {
        case .ready, .listening: return nil
        case .denied: return "Kosmos is not allowed to use the microphone or speech recognition. You can allow both in Settings, Kosmos."
        case .restricted: return "This iPhone does not allow dictation here."
        case .unavailable: return "Dictation is not available right now. Try again in a moment."
        case .unsupported: return "Dictation is not available in this iPhone's language."
        }
    }
    // VoiceOver's words for the two buttons.
    static let emojiLabel = "Add an emoji"   // the board's aria-label
    static func micLabel(listening: Bool) -> String { listening ? "Stop dictating" : "Dictate a message" }
    static let emojiHint = "Shows emoji in place of the keyboard"
    static let micHint = "Types what you say into the box"
    // kosmos#7268 review 1: dictation rewrites the box as base + heard, so anyone else changing the box (Send clearing
    // it, typing, an emoji) means dictation must stop, or its next result would bring the old words back.
    static func dictationOverridden(current: String, lastWritten: String) -> Bool { current != lastWritten }
}
