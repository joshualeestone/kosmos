import SwiftUI
import Speech
import AVFoundation

// kosmos#7268: the emoji button, its panel and the dictation microphone, shared by a direct message's composer
// (ChatView) and a project room's (RoomView). The words and rules are in ComposerLogic.swift (tested).

// The greyed-out face inside the message box (the board's .emojibtn), 44pt to press.
struct ComposerEmojiButton: View {
    let open: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: open ? "keyboard" : "face.smiling")
                .font(.system(size: 20))
                .foregroundColor(Palette.tertiary)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(open ? "Back to the keyboard" : ComposerExtras.emojiLabel)
        .accessibilityHint(open ? "" : ComposerExtras.emojiHint)
    }
}

// The microphone beside it: grey at rest, red while listening (a press stops it).
struct ComposerMicButton: View {
    @ObservedObject var dictation: Dictation
    let action: () -> Void
    var body: some View {
        let on = dictation.state == .listening
        Button(action: action) {
            Image(systemName: on ? "stop.circle.fill" : "mic")
                .font(.system(size: 20))
                .foregroundColor(on ? Palette.dangerWord : Palette.tertiary)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(ComposerExtras.micLabel(listening: on))
        .accessibilityHint(on ? "" : ComposerExtras.micHint)
    }
}

// The board's emoji panel (#pj-emoji): the 80 glyphs in a grid, in place of the keyboard while open.
struct EmojiPanel: View {
    let pick: (String) -> Void
    var body: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 8), spacing: 2) {
                ForEach(ComposerExtras.emoji, id: \.self) { glyph in
                    Button { pick(glyph) } label: {
                        Text(glyph).font(.system(size: 28)).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityLabel(glyph)
                }
            }
            .padding(8)
        }
        .frame(height: 216)
        .background(Palette.card)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Pick an emoji")   // the board's aria-label
    }
}

// Dictation into the message box: the words heard so far go after what was already there (ComposerExtras.dictated).
// Asks for speech recognition and the microphone the first time, with the reasons in Info.plist. On this iPhone when it
// can (requiresOnDeviceRecognition), so what is said stays on the phone where the phone allows it.
@MainActor final class Dictation: ObservableObject {
    @Published private(set) var state: ComposerExtras.Mic = .ready {
        didSet { if state != oldValue { announce() } }
    }
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var base = ""
    private var lastWritten = ""
    private var onText: ((String) -> Void)?
    // Review 1: a start in progress (awaiting permission or setup), and a generation, so a second press, a stop or a
    // leave during the awaits cancels it, and an old recognition task can never stop or write for a newer one.
    private var starting = false
    private var generation = 0
    // Review 1: the app's audio session as it was, put back when dictation stops (a video played later must be heard).
    private var savedSession: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?

    var active: Bool { starting || state == .listening }

    func toggle(base: String, onText: @escaping (String) -> Void) {
        if active { stop(); return }
        generation += 1
        let mine = generation
        starting = true
        Task { await start(base: base, onText: onText, generation: mine) }
    }

    // Review 1: the box changed by someone else (Send cleared it, typing, an emoji): stop, so the next result cannot
    // rewrite the box from the old snapshot. The composers call this from onChange of their text.
    func boxChanged(to text: String) {
        if active, ComposerExtras.dictationOverridden(current: text, lastWritten: lastWritten) { stop() }
    }

    private func start(base: String, onText: @escaping (String) -> Void, generation mine: Int) async {
        lastWritten = base
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        guard mine == generation else { return }
        switch speech {
        case .authorized: break
        case .restricted: starting = false; state = .restricted; return
        default: starting = false; state = .denied; return
        }
        let mic = await withCheckedContinuation { c in AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) } }
        guard mine == generation else { return }
        guard mic else { starting = false; state = .denied; return }
        guard let recognizer = SFSpeechRecognizer() else { starting = false; state = .unsupported; return }
        guard recognizer.isAvailable else { starting = false; state = .unavailable; return }
        do {
            let session = AVAudioSession.sharedInstance()
            savedSession = (session.category, session.mode, session.categoryOptions)
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
            let input = engine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in req.append(buffer) }
            engine.prepare()
            try engine.start()
            self.base = base
            self.onText = onText
            request = req
            starting = false
            state = .listening
            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                let words = result?.bestTranscription.formattedString
                let done = error != nil || (result?.isFinal ?? false)
                Task { @MainActor in
                    guard let self, self.generation == mine, self.state == .listening else { return }
                    if let words {
                        let text = ComposerExtras.dictated(base: self.base, heard: words)
                        self.lastWritten = text
                        self.onText?(text)
                    }
                    if done { self.stop() }
                }
            }
        } catch {
            stop()
            state = .unavailable
        }
    }

    // Stops listening and lets go of the microphone. What was heard stays in the box. A start still awaiting is
    // cancelled (the generation moves on). Nothing to do when dictation never started (review 1: no audio work then).
    func stop() {
        generation += 1
        starting = false
        guard request != nil || task != nil || engine.isRunning else {
            if state == .listening { state = .ready }
            return
        }
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        onText = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        if let (category, mode, options) = savedSession { try? session.setCategory(category, mode: mode, options: options) }
        savedSession = nil
        if state == .listening { state = .ready }
    }

    // Leaving the composer: stop, and drop a refusal line so it is asked afresh next time (review 1: it was sticky).
    func reset() {
        stop()
        if state != .ready { state = .ready }
    }

    // Review 1: VoiceOver hears a refusal, and listening starting and stopping.
    private func announce() {
        let words: String?
        switch state {
        case .listening: words = "Listening"
        case .ready: words = nil
        default: words = ComposerExtras.micLine(state)
        }
        if let words { UIAccessibility.post(notification: .announcement, argument: words) }
    }
}

// The message box's text field, able to put an emoji in at the cursor: on iOS 18, where SwiftUI says where the cursor
// is (TextSelection), the glyph goes there and the cursor lands after it; before iOS 18 it goes at the end. A parent sets
// `insert` to a glyph; the field puts it in and clears it. ComposerExtras.insert (tested) does the placing.
struct CursorField: View {
    let placeholder: String
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    @Binding var insert: String?
    var prompt: Text? = nil   // review 1: the direct message box's own placeholder colour
    var body: some View {
        if #available(iOS 18.0, *) {
            CursorField18(placeholder: placeholder, text: $text, focus: focus, insert: $insert, prompt: prompt)
        } else {
            TextField(placeholder, text: $text, prompt: prompt, axis: .vertical)
                .focused(focus)
                .onChange(of: insert) { glyph in
                    guard let glyph else { return }
                    text = ComposerExtras.insert(glyph, into: text, selection: nil).text
                    insert = nil
                }
        }
    }
}

@available(iOS 18.0, *)
private struct CursorField18: View {
    let placeholder: String
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    @Binding var insert: String?
    var prompt: Text?
    @State private var selection: TextSelection?
    var body: some View {
        TextField(placeholder, text: $text, selection: $selection, prompt: prompt, axis: .vertical)
            .focused(focus)
            .onChange(of: insert) { glyph in
                guard let glyph else { return }
                var range: Range<Int>?
                // Only a single selection whose ends are still inside today's text counts; anything else: at the end.
                if case .selection(let r)? = selection?.indices, r.lowerBound >= text.startIndex, r.upperBound <= text.endIndex {
                    range = text.distance(from: text.startIndex, to: r.lowerBound)..<text.distance(from: text.startIndex, to: r.upperBound)
                }
                let out = ComposerExtras.insert(glyph, into: text, selection: range)
                text = out.text
                selection = TextSelection(insertionPoint: text.index(text.startIndex, offsetBy: min(out.caret, text.count)))
                insert = nil
            }
    }
}
