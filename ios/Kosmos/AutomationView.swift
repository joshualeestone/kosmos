import SwiftUI

// kosmos#8959 slice D1a: the computer's Automation settings, native (the board's Settings > Automation). Each box is
// read from the computer and written back to it, as the phone-notification switches are: while a change saves, the
// control shows what the person chose; then what the computer answered. A refused change goes back to what the
// computer says, and the box's footer gives the computer's own sentence. The logic is AutomationLogic.swift.
struct AutomationView: View {
    // The computer this phone shows, with its kept sign-in (Settings.keptMac); nil when there is none.
    let mac: Settings.Mac?
    var sample = false

    private enum Load: Equatable {
        case reading
        case loaded(Automation.State)
        case failed(String)
    }

    @State private var loads: [Automation.Box: Load] = [:]
    // The control being saved in each box and the value chosen for it, shown until the computer answers.
    @State private var pending: [Automation.Box: (key: String, value: AnyHashable)] = [:]
    // The line a box's last save left: a refusal (problem) or what the save did ("Saved. ...").
    private struct Note: Equatable { let text: String; let problem: Bool }
    @State private var notes: [Automation.Box: Note] = [:]
    // Bumped by every write to a box, so a read that started before it cannot paint the older state over the newer.
    @State private var generations: [Automation.Box: Int] = [:]

    var body: some View {
        List {
            if mac == nil && !sample {
                Section {
                    Text("Open the Agents tab to connect to your computer, then its settings show here.")
                        .font(.subheadline).foregroundColor(Palette.secondary)
                }
            } else {
                ForEach(Automation.Box.allCases, id: \.self) { box in boxSection(box) }
                Section {
                } footer: {
                    Text(Automation.Words.elsewhere).font(.footnote).foregroundColor(Palette.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .tint(Color(UIColor.systemGreen))
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle("Automation")
        .navigationBarTitleDisplayMode(.inline)
        .dotsRefresh { await readAll() }
        .task { await readAll() }
        .accessibilityIdentifier("automation-list")
    }

    // MARK: One box

    @ViewBuilder private func boxSection(_ box: Automation.Box) -> some View {
        Section {
            switch loads[box] ?? .reading {
            case .reading:
                HStack(spacing: 10) {
                    SweepDots(scales: false)
                    Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary)
                }
            case .failed(let why):
                VStack(alignment: .leading, spacing: 8) {
                    Text(why).font(.subheadline).foregroundColor(Palette.secondary)
                    Button("Try again") { Task { await read(box) } }
                }
            case .loaded(let state):
                controls(box, state)
            }
        } header: {
            Text(box.title)
        } footer: {
            footer(box)
        }
    }

    @ViewBuilder private func footer(_ box: Automation.Box) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let note = notes[box] {
                Text(note.text).foregroundColor(note.problem ? Palette.dangerWord : Palette.secondary)
            }
            if case .loaded(let state) = loads[box] ?? .reading {
                ForEach(Automation.notes(state), id: \.self) { Text($0).foregroundColor(Palette.secondary) }
            }
            if let hint = hint(box) { Text(hint).foregroundColor(Palette.secondary) }
        }
        .font(.footnote)
    }

    // The board's line under each box's control, for the boxes whose line is not under a switch's label.
    private func hint(_ box: Automation.Box) -> String? {
        switch box {
        case .geminiCap: return Automation.Words.geminiCapHint
        case .accountCap: return Automation.Words.accountCapHint
        case .language: return Automation.Words.languageHint
        default: return nil
        }
    }

    @ViewBuilder private func controls(_ box: Automation.Box, _ state: Automation.State) -> some View {
        switch state {
        case .autoSave(let a):
            switchRow(box, key: "on", label: Automation.Words.autoSaveLabel, hint: Automation.Words.autoSaveHint, value: a.on) {
                .autoSave(on: $0, threshold: a.threshold)
            }
            if a.on {
                picker(box, key: "level", label: Automation.Words.autoSaveLevel,
                       choices: Automation.choices(Automation.autoSaveLevels, keeping: a.threshold), value: a.threshold,
                       name: Automation.percentLabel) { .autoSave(on: a.on, threshold: $0) }
            }
        case .prompter(let p):
            switchRow(box, key: "on", label: Automation.Words.prompterLabel, hint: Automation.Words.prompterHint, value: p.on) { .prompterOn($0) }
            if p.on {
                picker(box, key: "minutes", label: Automation.Words.prompterEvery, choices: Automation.choices(p.choices, keeping: p.minutes),
                       value: p.minutes, name: Automation.minutesLabel) { .prompterMinutes($0) }
            }
        case .cap(let c):
            picker(box, key: "max", label: Automation.Words.capLabel, choices: Automation.choices(c.choices, keeping: c.max),
                   value: c.max, name: Automation.capLabel) { .cap($0) }
        case .messages(let m):
            switchRow(box, key: "on", label: Automation.Words.messagesLabel, hint: Automation.Words.messagesHint, value: m.on) {
                .messages(on: $0, perHour: m.perHour)
            }
            if m.on {
                picker(box, key: "tier", label: Automation.Words.messagesTier, choices: Automation.choices(m.tiers, keeping: m.perHour),
                       value: m.perHour, name: { "\($0) " + Automation.Words.messagesTierUnit }) { .messages(on: m.on, perHour: $0) }
            }
        case .dailyReport(let on, _):
            switchRow(box, key: "on", label: Automation.Words.dailyReportLabel, hint: Automation.Words.dailyReportHint, value: on) { .dailyReport($0) }
        case .community(let c):
            switchRow(box, key: "on", label: Automation.Words.communityLabel, hint: Automation.Words.communityHint, value: c.on) { .community($0) }
        case .language(let l):
            languagePicker(box, l)
        case .recommender(let r):
            switchRow(box, key: "on", label: Automation.Words.recommenderLabel, hint: Automation.Words.recommenderHint, value: r.on) { .recommenderOn($0) }
            if r.on {
                // Review 1: the page's heading over the guards. Without it an On guard reads as permission, the opposite.
                Text(Automation.Words.recommenderGuardsHead).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
                    .accessibilityAddTraits(.isHeader)
                ForEach(Automation.Guard.allCases, id: \.self) { g in
                    switchRow(box, key: "guard-" + g.rawValue, label: g.label, hint: nil, value: r.guards[g] ?? true) { .recommenderGuard(g, $0) }
                }
            }
        case .assigner(let a):
            switchRow(box, key: "on", label: Automation.Words.assignerLabel, hint: Automation.Words.assignerHint, value: a.on) { .assignerOn($0) }
            if Automation.failoverShown(a), let fo = a.failover {
                switchRow(box, key: "failover", label: Automation.Words.failoverLabel,
                          hint: Automation.Words.failoverHint + (fo ? "" : " " + Automation.Words.failoverOff), value: fo) { .failover($0) }
            }
        }
    }

    private func chosen<T: Hashable>(_ box: Automation.Box, _ key: String, as: T.Type) -> T? {
        guard let p = pending[box], p.key == key else { return nil }
        return p.value.base as? T
    }

    private func switchRow(_ box: Automation.Box, key: String, label: String, hint: String?, value: Bool,
                           change: @escaping (Bool) -> Automation.Change) -> some View {
        let shown = chosen(box, key, as: Bool.self)
        return Toggle(isOn: Binding(
            get: { shown ?? value },
            set: { on in Task { await write(box, key: key, value: on, change(on)) } }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(label).foregroundColor(Palette.primary)
                    if shown != nil { SweepDots(size: 16, label: "Loading", scales: false) }
                }
                if let hint { Text(hint).font(.footnote).foregroundColor(Palette.secondary) }
            }
        }
        // One save at a time in a box, so two halves of one setting never cross.
        .disabled(pending[box] != nil)
        .accessibilityIdentifier("automation-\(box.rawValue)-\(key)")
    }

    private func picker(_ box: Automation.Box, key: String, label: String, choices: [Int], value: Int, name: @escaping (Int) -> String,
                        change: @escaping (Int) -> Automation.Change) -> some View {
        let shown = chosen(box, key, as: Int.self)
        return Picker(selection: Binding(
            get: { shown ?? value },
            set: { n in Task { await write(box, key: key, value: n, change(n)) } }
        )) {
            ForEach(choices, id: \.self) { Text(name($0)).tag($0) }
        } label: {
            HStack(spacing: 6) {
                Text(label).foregroundColor(Palette.primary)
                if shown != nil { SweepDots(size: 16, label: "Loading", scales: false) }
            }
        }
        .pickerStyle(.menu)
        .disabled(pending[box] != nil)
        .accessibilityIdentifier("automation-\(box.rawValue)-\(key)")
    }

    private func languagePicker(_ box: Automation.Box, _ l: Automation.Language) -> some View {
        let shown = chosen(box, "choice", as: String.self)
        // A choice the computer could not read shows as the page's "Could not be read just now", never picked again.
        let unknown = "__unknown"
        let current = l.choice ?? unknown
        let kept = (current == "auto" || current == unknown || l.options.contains { $0.tag == current }) ? [] : [current]
        let tags = (l.choice == nil ? [unknown] : []) + ["auto"] + l.options.map(\.tag) + kept
        return Picker(selection: Binding(
            get: { shown ?? current },
            set: { c in if c != unknown { Task { await write(box, key: "choice", value: c, .language(c)) } } }
        )) {
            ForEach(tags, id: \.self) { tag in
                Text(tag == unknown ? Automation.Words.languageCouldNotRead
                     : tag == "auto" ? l.automaticLabel : (l.options.first { $0.tag == tag }?.name ?? tag)).tag(tag)
            }
        } label: {
            HStack(spacing: 6) {
                Text(Automation.Words.languageLabel).foregroundColor(Palette.primary)
                if shown != nil { SweepDots(size: 16, label: "Loading", scales: false) }
            }
        }
        .pickerStyle(.navigationLink)
        .disabled(pending[box] != nil)
        .accessibilityIdentifier("automation-language-choice")
    }

    // MARK: Reading and writing

    private static let http = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private func send(_ box: Automation.Box, _ request: URLRequest?) async -> (Int, Data) {
        // A sample build's computer answers reads with its sample (writes are applied in write(), below).
        if sample { return request == nil ? (0, Data()) : (200, Data(Automation.sampleAnswer(box).utf8)) }
        guard let request, let (data, response) = try? await Self.http.data(for: request),
              let answer = response as? HTTPURLResponse
        else { return (0, Data()) }
        return (answer.statusCode, data)
    }

    @MainActor private func readAll() async {
        await withTaskGroup(of: Void.self) { group in
            for box in Automation.Box.allCases { group.addTask { await read(box) } }
        }
    }

    // keepNote: a read that follows a save keeps the save's line under the box.
    @MainActor private func read(_ box: Automation.Box, keepNote: Bool = false) async {
        await Task.yield()
        // Review 1: no read while a save is out; the save reads again itself when it needs to.
        guard pending[box] == nil else { return }
        guard let mac = mac ?? (sample ? Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "sample") : nil)
        else { return }
        let started = generations[box] ?? 0
        if case .loaded = loads[box] ?? .reading {} else { loads[box] = .reading }
        let (status, data) = await send(box, Automation.readRequest(mac, box))
        // A write landed meanwhile: its answer is newer than this one. A pull cancelled by leaving is not a failure.
        guard started == (generations[box] ?? 0), !Task.isCancelled else { return }
        if let s = Automation.parse(box, status: status, data: data) {
            loads[box] = .loaded(s)
            if !keepNote { notes[box] = nil }
        } else {
            loads[box] = .failed(Automation.readRefusal(box, status: status, data: data))
        }
    }

    @MainActor private func write(_ box: Automation.Box, key: String, value: AnyHashable, _ change: Automation.Change) async {
        guard pending[box] == nil else { return }
        guard let mac = mac ?? (sample ? Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "sample") : nil),
              let request = Automation.writeRequest(mac, box, change)
        else { return }
        generations[box, default: 0] += 1
        pending[box] = (key, value)
        if sample {
            // A sample build changes its own copy, as the computer would answer, so the screen moves for screenshots.
            if case .loaded(let s) = loads[box] ?? .reading { loads[box] = .loaded(Automation.applying(change, to: s)) }
            pending[box] = nil
            return
        }
        let (status, data) = await send(box, request)
        // Ends the save and makes any read that started during it stale, so it cannot paint over this answer.
        generations[box, default: 0] += 1
        pending[box] = nil
        switch Automation.writeOutcome(box, status: status, data: data) {
        case .saved(let s):
            loads[box] = .loaded(s)
            let said = box == .language ? Automation.languageSaved(status: status, data: data) : nil
            notes[box] = said.map { Note(text: $0, problem: false) }
        case .savedUnread:
            notes[box] = Note(text: Automation.Words.savedUnread, problem: false)
            await read(box, keepNote: true)
        case .refused(let why):
            // The control goes back to what the computer says, read again (a save with no answer may have landed), and
            // the footer says why.
            notes[box] = Note(text: why, problem: true)
            await read(box, keepNote: true)
        }
    }
}

// As Settings' own: a redirect is refused, so the computer's cookie can never be carried to another host.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
