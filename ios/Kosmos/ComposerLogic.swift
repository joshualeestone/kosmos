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

    // The board's pjEmojiInsert: the glyph replaces the selection (or goes in at the cursor), and the cursor lands
    // after it. `selection` is in Characters of `text`; nil (no cursor known: older iOS, or the box not focused) puts
    // it at the end. Returns the new text and the cursor's place in Characters.
    // kosmos#7346 (Josh 10-27): no send arrow; the keyboard's Send key sends. The box is a multi-line field, so the key
    // arrives as one new line typed into the text: that one character, and nothing else changed, is a send, and this is
    // the text without it. Pasted text (more than the one character) keeps its line breaks, and is nil here.
    // Review: the keyboard can fix the word before the caret in the same change as the Send key (autocorrect, "tomorow"
    // to "tomorrow"), so a change of a few characters holding exactly one more new line also counts, and the result keeps
    // the correction: the first new line at or after where the texts start to differ is the one taken out.
    static let returnSlack = 4
    static func typedReturn(was: String, now: String) -> String? {
        let a = Array(was), b = Array(now)
        let newLine: Set<Character> = ["\n", "\r\n"]
        let added = b.count - a.count
        guard added >= 1, added <= returnSlack,
              b.filter({ newLine.contains($0) }).count == a.filter({ newLine.contains($0) }).count + 1 else { return nil }
        var i = 0
        while i < a.count && a[i] == b[i] { i += 1 }
        // Back to the start of the word being corrected, so a correction that ends in a new line is still found.
        while i > 0 && !b[i - 1].isWhitespace { i -= 1 }
        guard let at = b[i...].firstIndex(where: { newLine.contains($0) }) else { return nil }
        var out = b
        out.remove(at: at)
        return String(out)
    }

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
