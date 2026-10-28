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

// The microphone beside it: grey at rest, red while listening (a press stops it). While the last words land after a
// stop (review 6), a small spinner, not pressable: a second press there would throw those words away.
struct ComposerMicButton: View {
    @ObservedObject var dictation: Dictation
    let action: () -> Void
    var body: some View {
        let on = dictation.active
        Button(action: action) {
            Group {
                if dictation.finishing { ProgressView().controlSize(.small) }
                else {
                    Image(systemName: on ? "stop.circle.fill" : "mic")
                        .font(.system(size: 20))
                        .foregroundColor(on ? Palette.dangerWord : Palette.tertiary)
                }
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .disabled(dictation.finishing)
        .accessibilityLabel(dictation.finishing ? "Finishing dictation" : ComposerExtras.micLabel(listening: on))
        .accessibilityHint(on || dictation.finishing ? "" : ComposerExtras.micHint)
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
        .background(Palette.card.ignoresSafeArea(edges: .bottom))   // review 8: down under the home indicator
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
    // Review 6: kept for the whole session, as Apple's own sample does; nothing promises the task keeps it alive.
    private var recognizer: SFSpeechRecognizer?
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
    // session is deactivated only after dictation's own setActive(true) succeeded (review 3); nothing else in the app
    // uses the audio session today, so that is also the only activation there is (review 5).
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
            (UIApplication.didBecomeActiveNotification, nil),   // review 6: back from Settings
        ]
        for (name, object) in watch {
            observers.append(nc.addObserver(forName: name, object: object, queue: .main) { [weak self] note in
                // Review 5: read the reason here, where the notification is; act on the main actor.
                let why = Dictation.reason(note)
                Task { @MainActor in self?.handle(why) }
            })
        }
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    // Review 5: which notifications mean the microphone really ended. Dictation's own setup changes the category and the
    // route, and those notices must never stop the session it just started.
    private enum Ended { case interruptionBegan, background, mediaReset, engineChanged, headphones, active, ignore }
    nonisolated private static func reason(_ note: Notification) -> Ended {
        switch note.name {
        case AVAudioSession.interruptionNotification:
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            return raw.flatMap(AVAudioSession.InterruptionType.init) == .began ? .interruptionBegan : .ignore   // not .ended
        case UIApplication.didEnterBackgroundNotification: return .background
        case UIApplication.didBecomeActiveNotification: return .active
        case AVAudioSession.mediaServicesWereResetNotification: return .mediaReset
        case .AVAudioEngineConfigurationChange: return .engineChanged
        case AVAudioSession.routeChangeNotification:
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            switch raw.flatMap(AVAudioSession.RouteChangeReason.init) {
            case .oldDeviceUnavailable?, .newDeviceAvailable?:
                // In or out; never .categoryChange. Review 6: only when the microphone input itself changed (AirPods
                // connecting for output alone leave dictation's built-in microphone as it was).
                let before = (note.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription)?.inputs.map(\.uid) ?? []
                let now = AVAudioSession.sharedInstance().currentRoute.inputs.map(\.uid)
                return before == now ? .ignore : .headphones
            default: return .ignore
            }
        default: return .ignore
        }
    }
    private func handle(_ why: Ended) {
        switch why {
        case .ignore: return
        case .interruptionBegan: if busy { stop(say: true) }
        case .background: if active { stop(say: true) }   // review 8: locking the phone leaves finishing to complete
        case .mediaReset, .headphones: if active { stop(say: true) }   // review 7: finishing is left to complete
        // The engine stops itself when its input really changed; a notice while it still runs is our own setup.
        case .engineChanged: if live && state == .listening && !engine.isRunning { stop(say: true) }   // not while finishing (review 6)
        // Review 6 and 7: back from Settings with both allowed, the old "not allowed" line goes. Only then: dismissing the
        // permission alert itself also makes the app active, and must never wipe the refusal just given.
        case .active:
            if state == .denied, !busy, SFSpeechRecognizer.authorizationStatus() == .authorized,
               AVAudioSession.sharedInstance().recordPermission == .granted { state = .ready }
        }
    }

    var active: Bool { starting || state == .listening }

    // `current` reads the box as it is now, so a result never writes over something typed since (review 3).
    func toggle(base: String, current: @escaping () -> String, onText: @escaping (String) -> Void) {
        if finishing { return }   // review 6: the last words are landing (at most 2 s); a press must not throw them away
        if starting { stop(); return }
        if state == .listening { finish(); return }
        generation += 1
        let mine = generation
        lastWritten = base   // review 5: boxChanged during starting compares against THIS start's box
        heard = false
        if state != .ready { state = .ready }   // review 3: an old refusal line goes while this start runs
        starting = true
        Task { await start(base: base, current: current, onText: onText, generation: mine) }
    }

    // The box changed by someone else (Send cleared it, typing, an emoji): stop at once, so no result rewrites the box
    // from the old snapshot (review 1). The composers call this from onChange of their text; each result also checks
    // the box itself before writing, for a change onChange has not delivered yet (review 3).
    func boxChanged(to text: String) {
        guard active || live, ComposerExtras.dictationOverridden(current: text, lastWritten: lastWritten) else { return }
        let wasStarting = starting
        stop(say: true)   // review 7: said
        // Review 8: a stop while still starting changes the button too; say it then as well.
        if wasStarting { UIAccessibility.post(notification: .announcement, argument: "Stopped dictating") }
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
        self.recognizer = recognizer
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
                // Review 4: Speech's "no speech detected" is not a refusal: nothing was said.
                // Review 7: 203 ("Retry") is how server recognition often reports silence too.
                let silent = (error as NSError?).map { $0.domain == "kAFAssistantErrorDomain" && [1110, 203].contains($0.code) } ?? false
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
        recognizer = nil
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

// kosmos#7419 (Josh 10-27 20:24, Mona Lisa's design on the card): long-press a message, in a direct message or a project
// room, for a bottom sheet as Discord has: a row of quick reactions and More (the board's whole list), then Reply and Copy
// text. A light haptic on the press. The sheet is sized to its content and grows to full height for More.
// Review 1: ONE sheet per chat or room (.messageActionsHost), not one per row, so a row recycled or replaced while the
// sheet is up cannot take it away; a row asks for it through the environment (.messageActions).
struct MessageActionTarget: Identifiable {
    let id = UUID()
    let mine: Set<String>                 // the reactions already the person's (marked; a tap takes one off)
    let react: ((String) -> Void)?        // nil where the message takes no reactions
    let reply: (() -> Void)?              // nil where it takes no reply
    let text: String                      // what Copy text copies: the words shown; empty hides Copy text
}

private struct MessageActionsOpenKey: EnvironmentKey { static let defaultValue: ((MessageActionTarget) -> Void)? = nil }
extension EnvironmentValues {
    var openMessageActions: ((MessageActionTarget) -> Void)? {
        get { self[MessageActionsOpenKey.self] }
        set { self[MessageActionsOpenKey.self] = newValue }
    }
}

struct MessageActionsSheet: View {
    let target: MessageActionTarget
    @Binding var detent: PresentationDetent
    let small: PresentationDetent
    // What to run once the sheet has gone (Reply): run from the host's onDismiss, never on a guessed delay (review 1).
    let after: (@escaping () -> Void) -> Void
    @Environment(\.dismiss) private var dismiss

    private var more: Bool { detent == .large }

    var body: some View {
        if more { picker } else { actions }
    }

    private func pick(_ e: String) {
        target.react?(e)
        dismiss()
    }

    // In the row: a 40 pt circle (smaller on the narrowest phones, review 1), the person's own ringed in gold on a warm fill.
    private func quick(_ e: String, size: CGFloat) -> some View {
        let mine = target.mine.contains(e)
        return Button { pick(e) } label: {
            Text(e).font(.system(size: size * 0.55))
                .frame(width: size, height: size)
                .background(Circle().fill(mine ? Palette.mineReaction : Palette.card))
                .overlay(Circle().strokeBorder(Palette.starGold, lineWidth: mine ? 2 : 0))
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(mine ? "Remove " + e : "React with " + e)
        .accessibilityAddTraits(mine ? .isSelected : [])
    }

    // In More: the bare emoji, as the mock; the person's own in a rounded square ringed in gold.
    private func cell(_ e: String) -> some View {
        let mine = target.mine.contains(e)
        return Button { pick(e) } label: {
            Text(e).font(.system(size: 26))
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(mine ? Palette.mineReaction : Color.clear))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Palette.starGold, lineWidth: mine ? 2 : 0))
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(mine ? "Remove " + e : "React with " + e)
        .accessibilityAddTraits(mine ? .isSelected : [])
    }

    private var actions: some View {
        VStack(spacing: 12) {
            if target.react != nil {
                // Eight across whatever width there is: 40 pt each where they fit, smaller on a 320 pt screen.
                GeometryReader { g in
                    let size = min(40, g.size.width / 8 - 4)
                    HStack(spacing: 0) {
                        ForEach(Board.quickReactions, id: \.self) { e in quick(e, size: size) }
                        Button { detent = .large } label: {
                            Image(systemName: "face.smiling").font(.system(size: size * 0.5)).foregroundColor(Palette.secondary)
                                .overlay(Image(systemName: "plus").font(.system(size: size * 0.22, weight: .bold)).foregroundColor(Palette.secondary)
                                    .offset(x: size * 0.22, y: -size * 0.22))
                                .frame(width: size, height: size)
                                .background(Circle().fill(Palette.card))
                                .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("More reactions")
                    }
                }
                .frame(height: 44)
            }
            if let reply = target.reply {
                row("Reply", "arrowshape.turn.up.left") { after(reply); dismiss() }
            }
            if !target.text.isEmpty {
                row("Copy text", "doc.on.doc") {
                    UIPasteboard.general.string = target.text
                    dismiss()
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 20).padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private func row(_ title: String, _ symbol: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.body).foregroundColor(Palette.primary).accessibilityHidden(true)
                Text(title).font(.body).foregroundColor(Palette.primary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).frame(minHeight: 50)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.card))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // More: the board's 80 (ComposerExtras.emoji, PJ_EMOJI), eight to a row, in its order.
    private var picker: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Reactions").font(.headline).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
                Spacer()
                // Review 1: Done only closes; it does not shrink the sheet on the way out.
                Button("Done") { dismiss() }.font(.body.weight(.semibold)).foregroundColor(Palette.starGold)
            }
            .padding(.horizontal, 16).padding(.top, 16)
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 8), spacing: 4) {
                    ForEach(ComposerExtras.emoji, id: \.self) { e in cell(e) }
                }
                .padding(.horizontal, 8).padding(.bottom, 16)
            }
        }
    }
}

// The one sheet of a chat or a room: rows ask for it with .messageActions; Reply runs once it has gone.
struct MessageActionsHost: ViewModifier {
    @State private var target: MessageActionTarget?
    @State private var detent: PresentationDetent = .large
    @State private var afterClose: (() -> Void)?
    @Environment(\.dynamicTypeSize) private var typeSize
    #if DEBUG
    static var sampleOpened = false
    #endif

    // The sheet's height before More: the reaction row, Reply and Copy text, at the person's text size.
    private func small(_ t: MessageActionTarget) -> PresentationDetent {
        let rowH: CGFloat = typeSize.isAccessibilitySize ? 76 : 50
        return .height(32 + (t.react != nil ? 56 : 0) + (t.reply != nil ? rowH + 12 : 0) + (t.text.isEmpty ? 0 : rowH) + 24)
    }

    func body(content: Content) -> some View {
        content
            .environment(\.openMessageActions) { t in
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                detent = small(t)
                target = t
            }
            .sheet(item: $target, onDismiss: { let run = afterClose; afterClose = nil; run?() }) { t in
                MessageActionsSheet(target: t, detent: $detent, small: small(t), after: { afterClose = $0 })
                    // Review 1: both heights always offered, the current one chosen, so More resizes on iOS 16 too.
                    .presentationDetents([small(t), .large], selection: $detent)
                    .presentationDragIndicator(.visible)
                    #if DEBUG
                    .onReceive(NotificationCenter.default.publisher(for: .sampleSheetMore)) { _ in detent = .large }
                    #endif
                    .background(Palette.ground.ignoresSafeArea())
            }
    }
}

// On a message view: a long press opens the host's sheet for it. High priority, so lifting the finger after it cannot
// also tap a file card, a reply header or a link inside the bubble; a short tap still goes to them, and a scroll still
// wins (the press fails once the finger moves). The system's half second (review 1).
struct MessageActions: ViewModifier {
    let target: () -> MessageActionTarget
    @Environment(\.openMessageActions) private var open

    func body(content: Content) -> some View {
        content
            .highPriorityGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in open?(target()) })
            // Review 2: VoiceOver reaches the sheet (Copy text, More) as an action, since a long press is not one.
            .accessibilityAction(named: "Message actions") { open?(target()) }
            #if DEBUG
            // Design shots only: KOSMOS_SAMPLE_SHEET=1 (or =more) opens the sheet on the first message that takes reactions.
            .onAppear {
                let t = target()
                if let want = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SHEET"], t.react != nil, !MessageActionsHost.sampleOpened {
                    MessageActionsHost.sampleOpened = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { open?(t) }
                    if want == "more" { DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { NotificationCenter.default.post(name: .sampleSheetMore, object: nil) } }
                }
            }
            #endif
    }
}

#if DEBUG
extension Notification.Name { static let sampleSheetMore = Notification.Name("kosmos.sampleSheetMore") }
#endif

extension View {
    func messageActions(mine: Set<String>, react: ((String) -> Void)?, reply: (() -> Void)?, text: String) -> some View {
        modifier(MessageActions(target: { MessageActionTarget(mine: mine, react: react, reply: reply, text: text) }))
    }
    func messageActionsHost() -> some View { modifier(MessageActionsHost()) }
}
