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
        let on = dictation.active   // review 2: starting shows the stop look too (a press cancels it)
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
// kosmos#7268 review 3: one emoji pick, with an id, so two quick taps on the same glyph are two picks.
extension ComposerExtras {
    struct Pick: Equatable { let id = UUID(); let glyph: String }
}

@MainActor final class Dictation: ObservableObject {
    @Published private(set) var state: ComposerExtras.Mic = .ready
    // A start in progress (awaiting permission or setup): the button already shows its stop look, and a press cancels.
    @Published private(set) var starting = false
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var base = ""
    private var lastWritten = ""
    private var heard = false
    private var current: (() -> String)?
    private var onText: ((String) -> Void)?
    private var tapInstalled = false
    // Results are written while this is set: through listening, and after a stop by hand until the last words arrive.
    private var live = false
    // After a stop by hand, while the last words are still on their way (review 4: Send waits for them, a press ends it).
    @Published private(set) var finishing = false
    // Listening, starting or finishing: Send waits, so a message never goes without its last words (review 4).
    var busy: Bool { active || finishing }
    // A generation, so a second press, a stop or a leave during the awaits cancels a start, and an old recognition task
    // can never write for or stop a newer one (review 1).
    private var generation = 0
    // The app's audio session as it was before dictation, put back whenever dictation lets go (review 1 and 2: a video
    // played later must be heard, including after a failed start). Kept only once, never overwritten by our own. The
    // session is deactivated only if dictation activated it (review 3).
    private var savedSession: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    private var didActivate = false
    private var observers: [NSObjectProtocol] = []

    init() {
        // A phone call, Siri, the app going to the background (review 2), the engine's input changing or the media
        // services resetting (review 3), or the audio route changing, as headphones in or out (review 4), end the
        // microphone: stop and say so, never a red button over a dead microphone. A stop while idle does nothing.
        let nc = NotificationCenter.default
        let watch: [(Notification.Name, Any?)] = [
            (AVAudioSession.interruptionNotification, nil), (UIApplication.didEnterBackgroundNotification, nil),
            (AVAudioSession.mediaServicesWereResetNotification, nil), (.AVAudioEngineConfigurationChange, engine),
            (AVAudioSession.routeChangeNotification, nil),   // review 4: headphones in or out, said plainly
        ]
        for (name, object) in watch {
            observers.append(nc.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.stop(say: true) }
            })
        }
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    var active: Bool { starting || state == .listening }

    // `current` reads the box as it is now, so a result never writes over something typed since (review 3).
    func toggle(base: String, current: @escaping () -> String, onText: @escaping (String) -> Void) {
        if starting || finishing { stop(); return }   // review 4: a press while finishing ends it, never a new start
        if state == .listening { finish(); return }
        generation += 1
        let mine = generation
        if state != .ready { state = .ready }   // review 3: an old refusal line goes while this start runs
        starting = true
        Task { await start(base: base, current: current, onText: onText, generation: mine) }
    }

    // The box changed by someone else (Send cleared it, typing, an emoji): stop at once, so no result rewrites the box
    // from the old snapshot (review 1). The composers call this from onChange of their text; each result also checks
    // the box itself before writing, for a change onChange has not delivered yet (review 3).
    func boxChanged(to text: String) {
        if active || live, ComposerExtras.dictationOverridden(current: text, lastWritten: lastWritten) { stop() }
    }

    // A refusal is said every time, not only when the state changes (review 2).
    private func refuse(_ m: ComposerExtras.Mic) {
        starting = false
        state = m
        if let line = ComposerExtras.micLine(m) { UIAccessibility.post(notification: .announcement, argument: line) }
    }

    private func start(base: String, current: @escaping () -> String, onText: @escaping (String) -> Void, generation mine: Int) async {
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        guard mine == generation else { return }
        switch speech {
        case .authorized: break
        case .restricted: refuse(.restricted); return
        default: refuse(.denied); return
        }
        let mic = await withCheckedContinuation { c in AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) } }
        guard mine == generation else { return }
        guard mic else { refuse(.denied); return }
        guard let recognizer = SFSpeechRecognizer() else { refuse(.unsupported); return }
        guard recognizer.isAvailable else { refuse(.unavailable); return }
        do {
            let session = AVAudioSession.sharedInstance()
            if savedSession == nil { savedSession = (session.category, session.mode, session.categoryOptions) }
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            didActivate = true
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            // Review 2: no input (a simulator with none, an unavailable route) has a 0-channel format, and installTap
            // with it is an exception do/catch cannot catch: say unavailable instead.
            guard format.channelCount > 0, format.sampleRate > 0 else { releaseAudio(); refuse(.unavailable); return }
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
            req.addsPunctuation = true   // review 4: on-device text otherwise arrives as one run-on sentence
            // Review 4: anything left from an earlier session goes first, and this session's fields are set only now,
            // after every await has passed its generation check.
            task?.cancel(); request?.endAudio(); task = nil; request = nil
            lastWritten = base
            heard = false
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
            tapInstalled = true
            engine.prepare()
            try engine.start()
            self.base = base
            self.current = current
            self.onText = onText
            request = req
            live = true
            starting = false
            // No spoken "Listening" (review 2): VoiceOver through the speaker would be heard by the open microphone and
            // typed into the box. The button's own label changes to "Stop dictating", which VoiceOver reads.
            state = .listening
            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                let words = result?.bestTranscription.formattedString
                let final = result?.isFinal ?? false
                let failed = error != nil
                // Review 4: Speech's "no speech detected" (kAFAssistantErrorDomain 1110) is not a refusal: nothing said.
                let silent = (error as NSError?).map { $0.domain == "kAFAssistantErrorDomain" && $0.code == 1110 } ?? false
                Task { @MainActor in
                    guard let self, self.generation == mine, self.live else { return }
                    if let words, !words.trimmingCharacters(in: .whitespaces).isEmpty {
                        // Review 3: the box as it is NOW; something typed since means stop, never write over it.
                        if let now = self.current?(), ComposerExtras.dictationOverridden(current: now, lastWritten: self.lastWritten) {
                            self.stop(); return
                        }
                        let text = ComposerExtras.dictated(base: self.base, heard: words)
                        self.heard = true
                        self.lastWritten = text
                        self.onText?(text)
                    }
                    if failed && !self.heard && !silent && self.state == .listening {
                        // Review 3: an error with nothing heard while listening (Siri and Dictation off, no network, no
                        // model yet) is a refusal, said. Review 4: never after a stop by hand, nor for "no speech".
                        self.stop()
                        self.refuse(.unavailable)
                    } else if final || failed {
                        self.stop(say: self.state == .listening)   // ended by itself while listening: say so
                    }
                }
            }
        } catch {
            stop()   // releases whatever was taken, the session included (review 2)
            refuse(.unavailable)
        }
    }

    // A stop by hand (review 3): the microphone closes now, but the last words, about half a second behind the speech,
    // still land. The final result (or an error) ends it; two seconds is the most it waits.
    private func finish() {
        let mine = generation
        finishing = true
        state = .ready
        UIAccessibility.post(notification: .announcement, argument: "Stopped dictating")
        if engine.isRunning { engine.stop() }
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio()
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self, self.generation == mine else { return }
            self.stop()
        }
    }

    // Stops at once and lets go of the microphone: Send, leaving, another account, the box changed by someone else.
    // What was heard stays in the box. A start still awaiting is cancelled (the generation moves on). `say` announces
    // the stop: only when it ended by itself (review 3: not over Send's or a new screen's own announcements).
    func stop(say: Bool = false) {
        generation += 1
        starting = false
        finishing = false
        live = false
        task?.cancel()
        request?.endAudio()
        task = nil
        request = nil
        current = nil
        onText = nil
        releaseAudio()
        if state == .listening {
            state = .ready
            if say { UIAccessibility.post(notification: .announcement, argument: "Stopped dictating") }
        }
    }

    // The audio half, always safe to call: the tap, the engine, and the session put back as it was (review 2: also after
    // a failed start, where nothing else was running yet).
    private func releaseAudio() {
        if engine.isRunning { engine.stop() }
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        let session = AVAudioSession.sharedInstance()
        if didActivate { try? session.setActive(false, options: .notifyOthersOnDeactivation); didActivate = false }
        if let (category, mode, options) = savedSession { try? session.setCategory(category, mode: mode, options: options) }
        savedSession = nil
    }

    // Leaving the composer: stop, and drop a refusal line so it is asked afresh next time (review 1: it was sticky).
    func reset() {
        stop()
        if state != .ready { state = .ready }
    }
}

// The message box's text field, able to put an emoji in at the cursor: on iOS 18, where SwiftUI says where the cursor
// is (TextSelection), the glyph goes there and the cursor lands after it; before iOS 18 it goes at the end. A parent sets
// `insert` to a pick; the field puts it in and clears it. ComposerExtras.insert (tested) does the placing.
struct CursorField: View {
    let placeholder: String
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    @Binding var insert: ComposerExtras.Pick?
    var prompt: Text? = nil   // review 1: the direct message box's own placeholder colour
    var body: some View {
        if #available(iOS 18.0, *) {
            CursorField18(placeholder: placeholder, text: $text, focus: focus, insert: $insert, prompt: prompt)
        } else {
            TextField(placeholder, text: $text, prompt: prompt, axis: .vertical)
                .focused(focus)
                .onChange(of: insert) { pick in
                    guard let pick else { return }
                    text = ComposerExtras.insert(pick.glyph, into: text, selection: nil).text
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
    @Binding var insert: ComposerExtras.Pick?
    var prompt: Text?
    @State private var selection: TextSelection?
    // Review 3: where the cursor last was WHILE the box had focus, as character offsets, and the text it was in. The
    // panel only opens once the box has let go of focus, and nothing promises the selection survives that, so the
    // position is taken while focused and never read from an unfocused field. Text changed since: at the end.
    @State private var caret: Range<Int>?
    @State private var caretText = ""
    var body: some View {
        TextField(placeholder, text: $text, selection: $selection, prompt: prompt, axis: .vertical)
            .focused(focus)
            .onChange(of: selection) { sel in
                guard focus.wrappedValue else { return }
                if case .selection(let r)? = sel?.indices, r.lowerBound >= text.startIndex, r.upperBound <= text.endIndex {
                    caret = text.distance(from: text.startIndex, to: r.lowerBound)..<text.distance(from: text.startIndex, to: r.upperBound)
                } else if caretText != text { caret = nil }   // review 4: a nil on blur keeps the last good caret
                caretText = text
            }
            .onChange(of: insert) { pick in
                guard let pick else { return }
                let out = ComposerExtras.insert(pick.glyph, into: text, selection: caretText == text ? caret : nil)
                text = out.text
                // The next pick goes after this one. The field's own selection is set only while it has focus: setting it
                // on an unfocused field could take focus back and close the panel (review 3).
                caret = out.caret..<out.caret
                caretText = out.text
                if focus.wrappedValue { selection = TextSelection(insertionPoint: text.index(text.startIndex, offsetBy: min(out.caret, text.count))) }
                insert = nil
            }
    }
}
