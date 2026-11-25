import SwiftUI

// kosmos#8959 slice D1a: the computer's Automation settings, native (the board's Settings > Automation). Each box is
// read from the computer and written back to it, as the phone-notification switches are: while a change saves, the
// control shows what the person chose; then what the computer answered. A refused change goes back to what the
// computer says, and the box's footer gives the computer's own sentence. The logic is AutomationLogic.swift.
struct AutomationView: View {
    // The computer this phone shows, with its kept sign-in (Settings.keptMac); nil when there is none.
    let mac: Settings.Mac?
    var sample = false
    // Settings is still finding the computer (its own first read), so "no computer" would not be true yet (review 6).
    var finding = false
    // Signed out of Kosmos+: what is needed is a sign-in, not a computer (review 7), as Settings itself says.
    var signedOut = false
    // kosmos#8959 slice D1d1: opens an agent's chat, as a push tap does (ContentView, through Settings).
    var openAgent: (PushBridge.AgentTarget) -> Void = { _ in }

    // The Prompter's check-ins (the page's #hb-nudges): nil hides them, as any failure does on the page.
    @State private var checkins: [Checkins.Row]?
    @State private var checkinsGeneration = 0
    // kosmos#8959 slice D1d2a: Community's kind of business (the page's #community-industry-row), read on its own.
    @State private var industry: Industry.State?
    @State private var industryRead = false          // the first answer (or none) has come
    @State private var industryKept: [Industry.Choice] = []   // the board's list from the last good read
    @State private var industryNote: String?
    @State private var industrySaving: String?       // the choice being saved, shown until the board answers
    @State private var industryGeneration = 0
    // kosmos#8959 slice D1d2b: Community's held posts (the page's #community-held-list), read on their own.
    private enum HeldLoad: Equatable { case reading, read(Held.Read), failed }
    @State private var held: HeldLoad = .reading
    @State private var heldGeneration = 0
    @State private var heldBusy: String?            // the row being released or discarded
    @State private var heldNotes: [String: String] = [:]   // each row's own line (a refusal, "Releasing…")
    @State private var heldSay: String?             // a 5xx: said where the list says things
    @State private var heldAsking: String?          // the row whose Discard ask is open
    @State private var heldShowWords: Set<String> = []     // stopped rows whose words were asked for
    @State private var heldOpen: Set<String> = []           // long rows read in full
    @State private var lastCommunity: Automation.Community? // the last Community setting read, kept through a failed read
    // kosmos#8959 slice D1d3a: "Where each agent stands" (the page's #community-ready-list), read on its own.
    @State private var ready: Ready.Load = .looking
    @State private var readyOpen: Set<String> = []      // rows opened, kept per agent across reads (COMMUNITY_READY_OPEN)
    @State private var readyGeneration = 0
    // kosmos#8959 slice D1d3b: "Your agents’ posts and comments in the community" (the page's #community-mine), with Delete.
    private enum MineLoad: Equatable { case reading, read(Mine.Read), failed }
    @State private var mine: MineLoad = .reading
    @State private var mineGeneration = 0
    @State private var mineOpen = false              // the fold holding the rows (closed, as the page's)
    @State private var mineAsking: String?           // the row whose Delete ask is open
    @State private var mineBusy: String?
    @State private var mineNotes: [String: String] = [:]
    @State private var mineGoneSay: String?          // a refusal whose row is gone after the re-read: said under the list

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
    // Bumped by every read, every write and a change of computer, so an answer that started before any of them is dropped.
    @State private var generations: [Automation.Box: Int] = [:]
    // The computer the boxes on screen came from. Review 5: another computer starts the screen over.
    @State private var shownURL: URL?

    var body: some View {
        List {
            if mac == nil && !sample && finding {
                Section {
                    HStack(spacing: 10) {
                        SweepDots(scales: false)
                        Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary)
                    }
                }
            } else if mac == nil && !sample && signedOut {
                Section {
                    Text("Sign in to Kosmos+ first, then your computer's settings show here.")
                        .font(.subheadline).foregroundColor(Palette.secondary)
                }
            } else if mac == nil && !sample {
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
        // A pull clears each box's last line; coming back to the screen (from the Language list, say) keeps it, so a
        // "Saved. ..." or a refusal is not wiped by the read that follows (review 2).
        .dotsRefresh { await readAll(keepNotes: false) }
        // Review 4: keyed on the computer, so a computer that arrives after the screen opened is read too.
        .task(id: mac?.url) {
            if shownURL != mac?.url {
                // Another computer: nothing from the last one may show or be saved as this one's.
                shownURL = mac?.url
                loads = [:]; notes = [:]; pending = [:]; checkins = nil; checkinsGeneration += 1
                industry = nil; industryRead = false; industryKept = []; industryNote = nil; industrySaving = nil; industryGeneration += 1
                held = .reading; lastCommunity = nil; ready = .looking; readyOpen = []; readyGeneration += 1
                mine = .reading; mineGeneration += 1; mineOpen = false; mineAsking = nil; mineBusy = nil; mineNotes = [:]; mineGoneSay = nil; heldGeneration += 1; heldBusy = nil; heldNotes = [:]; heldSay = nil; heldAsking = nil; heldShowWords = []; heldOpen = []
                for box in Automation.Box.allCases { generations[box, default: 0] += 1 }
            }
            await readAll(keepNotes: true)
            // The page repaints the check-ins from its poll; here they are read again every 30 s while the screen shows.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if !Task.isCancelled { await readCheckins() }
            }
        }
        .onChange(of: loads[.community]) { l in if case .loaded(.community(let c))? = l { lastCommunity = c } }
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
            // The check-ins, under the Prompter box's controls as on the page, read on their own (round 1: whatever
            // the box's own read did); hidden while there are none.
            if box == .prompter, let rows = checkins, !rows.isEmpty { checkinRows(rows) }
            if box == .community, industryRead { industryRows() }
            if box == .community { heldRows() }
            if box == .community { readyRows() }
            if box == .community { mineRows() }
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
                // A save's "Saved, but we could not read it back" stands alone, as the page's one message line does.
                ForEach(Automation.notes(state).filter { notes[box]?.text != Automation.Words.savedUnread || $0 != Automation.Words.languageUnread },
                        id: \.self) { Text($0).foregroundColor(Palette.secondary) }
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
                          hint: Automation.Words.failoverHint + " " + Automation.Words.failoverOff, value: fo) { .failover($0) }
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
            // Review 3: picking the ticked row hands back the same value; the page sends nothing then, so neither do we.
            set: { n in if n != (shown ?? value) { Task { await write(box, key: key, value: n, change(n)) } } }
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
            set: { c in if c != unknown && c != (shown ?? current) { Task { await write(box, key: "choice", value: c, .language(c)) } } }
        )) {
            ForEach(tags, id: \.self) { tag in
                Text(tag == unknown ? Automation.Words.languageCouldNotRead
                     : tag == "auto" ? l.automaticLabel : (l.options.first { $0.tag == tag }?.name ?? tag)).tag(tag)
                    // As the page's disabled option: shown, never picked.
                    .disabled(tag == unknown)
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

    // A read that is no box's (the check-ins).
    private func fetch(_ request: URLRequest) async -> (Int, Data) {
        guard let (data, response) = try? await Self.http.data(for: request), let answer = response as? HTTPURLResponse else { return (0, Data()) }
        return (answer.statusCode, data)
    }

    @MainActor private func readAll(keepNotes: Bool) async {
        await withTaskGroup(of: Void.self) { group in
            for box in Automation.Box.allCases { group.addTask { await read(box, keepNote: keepNotes) } }
            group.addTask { await readCheckins() }
            group.addTask { await readIndustry(keepNote: keepNotes) }
            group.addTask { await readHeld() }
            group.addTask { await readReady() }
            group.addTask { await readMine() }
        }
    }

    // paintPrompterNudges: the check-ins, and only when a lost connection needs it, each agent's reconnect phase.
    @MainActor private func readCheckins() async {
        if sample {
            let ns = Checkins.nudges(status: 200, data: Data(Checkins.sampleNudges.utf8)) ?? []
            checkins = Checkins.rows(ns, phases: Checkins.samplePhases)
            return
        }
        guard let mac, mac.url == shownURL else { return }
        checkinsGeneration += 1
        let mine = checkinsGeneration
        let (status, data) = await fetch(Checkins.nudgesRequest(mac))
        // Cancelled (a tap that left the screen, say): nothing changes, so the list is not taken for a failure.
        guard !Task.isCancelled, mine == checkinsGeneration, mac.url == shownURL else { return }
        guard let ns = Checkins.nudges(status: status, data: data) else { checkins = nil; return }
        var phases: [String: String] = [:]
        if Checkins.needsPhases(ns) {
            let (s2, d2) = await fetch(Checkins.statusRequest(mac))
            guard !Task.isCancelled, mine == checkinsGeneration, mac.url == shownURL else { return }
            phases = Checkins.phases(status: s2, data: d2)
        }
        checkins = Checkins.rows(ns, phases: phases)
    }

    // industryPaint: the picker, its hint, the line under it, and the two picture lines.
    @ViewBuilder private func industryRows() -> some View {
        let choices = Industry.choices(industry, kept: industryKept)
        Picker(selection: Binding(
            get: { industrySaving ?? Industry.selected(industry) },
            // The choice shows from the moment it is picked (industrySaving is set here, before the save's first await).
            set: { key in
                guard industrySaving == nil, key != Industry.unknownKey, key != Industry.selected(industry) else { return }
                industrySaving = key
                Task { await saveIndustry(key) }
            }
        )) {
            ForEach(choices) { c in Text(c.text).tag(c.key) }
        } label: {
            HStack(spacing: 6) {
                Text(Industry.Words.label).foregroundColor(Palette.primary)
                if industrySaving != nil { SweepDots(size: 16, label: "Loading", scales: false) }
            }
        }
        // A menu, as the Language picker: no screen is pushed, so choosing does not re-read the screen on the way back.
        .pickerStyle(.menu)
        // One save at a time; the page queues a choice made during a save (INDUSTRY_PENDING), which a menu that closes
        // on a pick does not need.
        .disabled(industrySaving != nil)
        .accessibilityIdentifier("automation-community-industry")
        Text(Industry.Words.hint).font(.footnote).foregroundColor(Palette.secondary)
        // The note (a save's line or a refusal) and, when the setting is unread, the unread sentence too.
        if let said = industryNote {
            Text(said).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("automation-community-industry-msg")
        }
        if let unread = Industry.readSaid(industry, kept: industryKept), industryNote == nil || Industry.isRefusal(industryNote!) {
            Text(unread).font(.footnote).foregroundColor(Palette.secondary)
        }
        if let s = industry, s.picturesStuck > 0 { Text(Industry.Words.stuck(s.picturesStuck)).font(.footnote).foregroundColor(Palette.secondary) }
        if let s = industry, s.picturesUnsendable > 0 { Text(Industry.Words.unsendable(s.picturesUnsendable)).font(.footnote).foregroundColor(Palette.secondary) }
    }

    // communityHeldPaint: "Waiting for you", the off line, and each row with Release and Discard.
    @ViewBuilder private func heldRows() -> some View {
        // The setting as loaded, else the last one read (as the page keeps COMMUNITY_POLICY_STOPPED), so a failed read
        // never drops the "it stays on this computer" wording.
        let community: Automation.Community? = { if case .loaded(.community(let c))? = loads[.community] { return c } else { return lastCommunity } }()
        Text(Held.Words.heading).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
        if let off = Held.offLine(on: community?.on, policyStopped: community?.stopped) {
            Text(off).font(.footnote).foregroundColor(Palette.secondary)
        }
        if let say = heldSay { Text(say).font(.footnote).foregroundColor(Palette.dangerWord) }
        switch held {
        case .reading:
            HStack(spacing: 10) { SweepDots(scales: false); Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary) }
        case .failed:
            Text(Held.Words.unread).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("automation-held-msg")
        case .read(let r):
            if let line = Held.listLine(r) { Text(line).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("automation-held-msg") }
            ForEach(Held.shown(r.rows, policyStopped: community?.stopped)) { row in heldRow(row) }
        }
    }

    @ViewBuilder private func heldRow(_ row: Held.Shown) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(row.title).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
            if !row.stopped || heldShowWords.contains(row.id) {
                // Clamped only when Read all is offered beside it (round 2: the phone wraps by width, so a short post
                // can run past 4 lines on a narrow screen). Otherwise whole, so nothing is ever cut off unseen above a
                // Release that cannot be taken back. A stopped row's words, once asked for, show whole, as the page's.
                Text(row.words).font(.footnote).foregroundColor(Palette.secondary)
                    .lineLimit(row.long && !row.stopped && !heldOpen.contains(row.id) ? Held.clampLines : nil)
                    .accessibilityIdentifier("automation-held-words-" + row.id)
                if row.long && !row.stopped {
                    Button(heldOpen.contains(row.id) ? Held.Words.readLess : Held.Words.readAll) {
                        if heldOpen.contains(row.id) { heldOpen.remove(row.id) } else { heldOpen.insert(row.id) }
                    }.buttonStyle(.borderless).font(.footnote)
                }
            }
            if row.stopped {
                Button(heldShowWords.contains(row.id) ? Held.Words.hide : Held.Words.show) {
                    if heldShowWords.contains(row.id) { heldShowWords.remove(row.id) } else { heldShowWords.insert(row.id) }
                }.buttonStyle(.borderless).font(.footnote)
            }
            if let link = row.postLink { Link(Held.Words.seePost, destination: link).font(.footnote).buttonStyle(.borderless) }
            Text(row.meta).font(.footnote).foregroundColor(Palette.secondary)
            if let why = row.why { Text(why).font(.footnote).foregroundColor(Palette.secondary) }
            if heldAsking == row.id {
                // openCommunityDiscard: the page's ask, with Keep it first.
                Text(row.isComment ? Held.Words.askComment : Held.Words.askPost).font(.footnote).foregroundColor(Palette.primary)
                HStack(spacing: 16) {
                    Button(Held.Words.keep) { heldAsking = nil }.disabled(heldBusy != nil)
                    Button(Held.Words.discardIt, role: .destructive) { Task { await discardHeld(row) } }
                        .disabled(heldBusy != nil)
                        .accessibilityIdentifier("automation-held-discard-it-" + row.id)
                }
                .buttonStyle(.borderless)
            } else {
                HStack(spacing: 16) {
                    if row.canRelease {
                        Button(Held.Words.release) { Task { await releaseHeld(row) } }
                            .accessibilityLabel("Release “" + row.label + "”")
                            .accessibilityIdentifier("automation-held-release-" + row.id)
                    }
                    Button(Held.Words.discard, role: .destructive) { heldAsking = row.id }
                        .accessibilityLabel("Discard “" + row.label + "”")
                        .accessibilityIdentifier("automation-held-discard-" + row.id)
                }
                .buttonStyle(.borderless)
                .disabled(heldBusy != nil)
            }
            if let note = heldNotes[row.id] {
                let working = note == Held.Words.releasing || note == Held.Words.discarding
                Text(note).font(.footnote).foregroundColor(working ? Palette.secondary : Palette.dangerWord)
            }
        }
        .padding(.vertical, 4)
    }

    // communityReadyPaint: the heading, its note, and one row per agent that opens to its lines.
    @ViewBuilder private func readyRows() -> some View {
        Text(Ready.Words.heading).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
        Text(Ready.Words.note).font(.footnote).foregroundColor(Palette.secondary)
        switch ready {
        case .looking: Text(Ready.Words.looking).font(.footnote).foregroundColor(Palette.secondary)
        case .none: Text(Ready.Words.none).font(.footnote).foregroundColor(Palette.secondary)
        case .couldNot: Text(Ready.Words.couldNot).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("automation-ready-msg")
        case .rows(let rows):
            ForEach(rows) { r in
                DisclosureGroup(isExpanded: Binding(
                    get: { readyOpen.contains(r.session) },
                    set: { if $0 { readyOpen.insert(r.session) } else { readyOpen.remove(r.session) } }
                )) {
                    ForEach(Array(r.lines.enumerated()), id: \.offset) { _, l in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            if l.needsYou { needsYouDot() }
                            Text(Ready.lineText(l)).font(.footnote).foregroundColor(Palette.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(r.name).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
                        if let n = r.needsYou { needsYouDot(); Text(n + r.rest).font(.footnote).foregroundColor(Palette.secondary) }
                        else { Text(r.rest).font(.footnote).foregroundColor(Palette.secondary) }
                    }
                    .accessibilityElement(children: .combine)
                }
                .accessibilityIdentifier("automation-ready-" + r.session)
            }
        }
    }

    // communityMinePaint and communityMineSummaryPaint.
    @ViewBuilder private func mineRows() -> some View {
        Text(Mine.Words.heading).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
        switch mine {
        case .reading:
            HStack(spacing: 10) { SweepDots(scales: false); Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary) }
        case .failed:
            Text(Mine.Words.unread).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("automation-mine-msg")
        case .read(let r):
            if let line = Mine.summaryLine(r.summary, rowCount: r.rows.count) { Text(line).font(.footnote).foregroundColor(Palette.secondary) }
            let agents = Mine.agentLinks(r.summary, rowCount: r.rows.count)
            if !agents.isEmpty {
                // As the page: "See them on each agent’s community page: A, B." in one line, each name a link.
                Text(Mine.inline(Mine.Words.agentsLead, links: agents, tail: ".")).font(.footnote).foregroundColor(Palette.secondary)
            }
            if let page = Mine.siteLink(r.summary, rowCount: r.rows.count) {
                Text(Mine.inline(Mine.Words.siteLead, links: [(Mine.Words.siteLink, page)], tail: Mine.Words.siteTail)).font(.footnote).foregroundColor(Palette.secondary)
            }
            if !r.rows.isEmpty {
                DisclosureGroup(isExpanded: $mineOpen) {
                    ForEach(r.rows) { row in mineRow(row) }
                } label: {
                    Text(mineOpen ? Mine.Words.foldOpen : Mine.Words.foldClosed).font(.footnote).foregroundColor(Palette.primary)
                        .accessibilityIdentifier("automation-mine-fold")
                }
            }
            if let gone = mineGoneSay { Text(gone).font(.footnote).foregroundColor(Palette.dangerWord) }
            // After the fold, as the page orders them.
            if r.rows.isEmpty && !r.commentsUnread { Text(Mine.Words.none).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("automation-mine-msg") }
            if r.commentsUnread { Text(Mine.Words.commentsUnread).font(.footnote).foregroundColor(Palette.secondary) }
        }
    }

    @ViewBuilder private func mineRow(_ r: Mine.Row) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Mine.label(r)).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
            // The meta in the page's order as ONE wrapping line (" · " between), a comment's post as a link inside it.
            Text(Mine.metaText(Mine.meta(r))).font(.footnote).foregroundColor(Palette.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if r.canDelete {
                if mineAsking == r.id {
                    Text(Mine.ask(r)).font(.footnote).foregroundColor(Palette.primary)
                    HStack(spacing: 16) {
                        Button(Mine.Words.keep) { mineAsking = nil }.disabled(mineBusy != nil)
                        Button(Mine.Words.deleteIt, role: .destructive) { Task { await deleteMine(r) } }
                            .disabled(mineBusy != nil)
                            .accessibilityIdentifier("automation-mine-delete-it-" + r.id)
                    }
                    .buttonStyle(.borderless)
                } else {
                    Button(Mine.Words.delete, role: .destructive) { mineAsking = r.id }
                        .buttonStyle(.borderless)
                        .disabled(mineBusy != nil)
                        .accessibilityLabel("Delete “" + Mine.label(r) + "” from the community")
                        .accessibilityIdentifier("automation-mine-delete-" + r.id)
                }
            }
            if let note = mineNotes[r.id] {
                Text(note).font(.footnote).foregroundColor(note == Mine.Words.deleting ? Palette.secondary : Palette.dangerWord)
            }
        }
        .padding(.vertical, 2)
    }

    @MainActor private func readMine(during busy: Bool = false) async {
        if sample { if mine == .reading { mine = Mine.read(status: 200, data: Data(Mine.sample.utf8)).map { .read($0) } ?? .failed }; return }
        guard let mac, mac.url == shownURL, busy || mineBusy == nil else { return }
        mineGeneration += 1
        let gen = mineGeneration
        let (status, data) = await fetch(Mine.readRequest(mac))
        guard !Task.isCancelled, gen == mineGeneration, mac.url == shownURL else { return }
        mine = Mine.read(status: status, data: data).map { .read($0) } ?? .failed
        // A repaint drops what earlier deletes said, as the page's (its rows are rebuilt); a delete's own read sets its
        // sentence again after this.
        if !busy { mineNotes = [:]; mineGoneSay = nil; mineAsking = nil }
    }

    // openCommunityDelete's Delete it.
    @MainActor private func deleteMine(_ r: Mine.Row) async {
        guard mineBusy == nil else { return }
        if sample { mineAsking = nil; if case .read(var x) = mine { x.rows.removeAll { $0.id == r.id }; mine = .read(x) }; return }
        guard let mac else { return }
        mineBusy = r.id
        mineNotes[r.id] = Mine.Words.deleting
        let (status, data) = await fetch(Mine.deleteRequest(mac, id: r.id))
        guard mac.url == shownURL else { return }
        switch Mine.outcome(status: status, data: data) {
        case .done:
            mineAsking = nil; mineNotes[r.id] = nil
            await readMine(during: true); mineBusy = nil; await readReady()
        case .changed(let said):
            // The row changed under it: read again, and keep the board's sentence on the row.
            mineAsking = nil; mineGoneSay = nil
            await readMine(during: true); mineBusy = nil; mineNotes[r.id] = nil
            // On the row if it is still there; else under the list (the page's list.after(note)).
            if case .read(let x) = mine, x.rows.contains(where: { $0.id == r.id }) { mineNotes[r.id] = said } else { mineGoneSay = said }
            await readReady()
        case .refused(let said):
            mineBusy = nil; mineNotes[r.id] = said
        }
    }

    // communityReadyDot: the mark, and "Needs you: " for a screen reader.
    private func needsYouDot() -> some View {
        Circle().fill(Palette.dangerWord).frame(width: 7, height: 7).alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 1 }
            .accessibilityLabel(Ready.Words.needsYouSpoken)
    }

    @MainActor private func readReady() async {
        if sample { if ready == .looking { ready = Ready.read(status: 200, data: Data(Ready.sample.utf8)) }; return }
        guard let mac, mac.url == shownURL else { return }
        readyGeneration += 1
        let mine = readyGeneration
        let (status, data) = await fetch(Ready.request(mac))
        guard !Task.isCancelled, mine == readyGeneration, mac.url == shownURL else { return }
        ready = Ready.read(status: status, data: data)
        // An agent no longer listed is forgotten (the page's open set does the same).
        if case .rows(let rows) = ready { readyOpen.formIntersection(rows.map(\.session)) }
    }

    // refreshCommunityHeld: both reads must answer.
    @MainActor private func readHeld(during busy: Bool = false) async {
        if sample {
            if case .reading = held {
                held = Held.read(held: Held.queue(status: 200, data: Data(Held.sampleHeld.utf8)), stopped: Held.queue(status: 200, data: Data(Held.sampleStopped.utf8))).map { .read($0) } ?? .failed
            }
            return
        }
        guard let mac, mac.url == shownURL, busy || heldBusy == nil else { return }
        heldGeneration += 1
        let mine = heldGeneration
        async let a = fetch(Held.queueRequest(mac, stopped: false))
        async let b = fetch(Held.queueRequest(mac, stopped: true))
        let (ha, hb) = await (a, b)
        guard !Task.isCancelled, mine == heldGeneration, mac.url == shownURL else { return }
        held = Held.read(held: Held.queue(status: ha.0, data: ha.1), stopped: Held.queue(status: hb.0, data: hb.1)).map { .read($0) } ?? .failed
    }

    @MainActor private func releaseHeld(_ row: Held.Shown) async {
        guard heldBusy == nil else { return }
        heldSay = nil
        if sample { removeSampleHeld(row.id); return }
        guard let mac else { return }
        heldBusy = row.id
        heldNotes[row.id] = Held.Words.releasing
        let (status, data) = await fetch(Held.releaseRequest(mac, id: row.id))
        guard mac.url == shownURL else { return }
        switch Held.outcome(status: status, data: data, releasing: true) {
        // Done: the buttons stay disabled until the list is read again, so a released post never looks untouched.
        case .done: await readHeld(during: true); heldNotes[row.id] = nil; heldBusy = nil; await readReady(); await readMine()
        case .refused(let said): heldBusy = nil; heldNotes[row.id] = said
        case .unfinished(let said): heldNotes[row.id] = nil; await settleUnfinished(said)
        }
    }

    @MainActor private func discardHeld(_ row: Held.Shown) async {
        guard heldBusy == nil else { return }
        heldSay = nil
        if sample { heldAsking = nil; removeSampleHeld(row.id); return }
        guard let mac else { return }
        heldBusy = row.id
        heldNotes[row.id] = Held.Words.discarding
        let (status, data) = await fetch(Held.discardRequest(mac, id: row.id))
        guard mac.url == shownURL else { return }
        switch Held.outcome(status: status, data: data, releasing: false) {
        case .done: heldAsking = nil; await readHeld(during: true); heldNotes[row.id] = nil; heldBusy = nil; await readReady(); await readMine()
        case .refused(let said): heldBusy = nil; heldNotes[row.id] = said
        case .unfinished(let said): heldNotes[row.id] = nil; heldAsking = nil; await settleUnfinished(said)
        }
    }

    // A request that could not finish: the list is read again, and "it shows where it stands now" is said only if it does.
    @MainActor private func settleUnfinished(_ said: String) async {
        await readHeld(during: true)
        heldBusy = nil
        heldSay = held == .failed ? String(said.dropLast(Held.Words.whereNow.count)) : said
        await readReady()   // as the page's communityHeldDone: the rows name what is held
    }

    private func removeSampleHeld(_ id: String) {
        if case .read(var r) = held { r.rows.removeAll { $0.id == id }; held = .read(r) }
    }

    @MainActor private func readIndustry(keepNote: Bool, after saved: String? = nil) async {
        if sample {
            if industry == nil { industry = Industry.read(status: 200, data: Data(Industry.sample.utf8)); industryKept = industry?.list ?? [] }
            industryRead = true
            return
        }
        guard let mac, mac.url == shownURL, industrySaving == nil else { return }
        // A re-read after a save whose answer did not read shows the saved choice until it answers.
        if let saved { industrySaving = saved }
        defer { if saved != nil && industrySaving == saved { industrySaving = nil } }
        industryGeneration += 1
        let mine = industryGeneration
        let (status, data) = await fetch(Industry.readRequest(mac))
        guard !Task.isCancelled, mine == industryGeneration, mac.url == shownURL else { return }
        let next = Industry.read(status: status, data: data)
        // As the page's quiet refresh: a re-read that fails keeps a setting already shown, rather than turning it into
        // "could not be read" over a blip. Only a first read that fails says so.
        if next == nil, industry != nil, industry?.unread == false { return }
        industry = next
        if let l = industry?.list, !l.isEmpty { industryKept = l }
        // A note never stays beside an unread setting it no longer describes ("Saved. ..." under "Could not be read").
        // "Saved, but we could not read it back" is answered by a read that worked.
        if let s = industry, !s.unread, industryNote == Industry.Words.savedUnread { industryNote = Industry.savedSaid(s) }
        if industry?.unread != false {
            // Unread now: only a refusal being kept may stay (it says why); a "Saved." line goes.
            if !(keepNote && industryNote.map(Industry.isRefusal) == true) { industryNote = nil }
        } else if !keepNote {
            industryNote = nil
        }
        industryRead = true
    }

    @MainActor private func saveIndustry(_ key: String) async {
        // industrySaving was set by the picker's Binding, so the choice already shows.
        guard industrySaving == key else { return }
        if sample {
            industry?.industry = key == Industry.noneKey ? nil : key
            if let s = industry { industryNote = Industry.savedSaid(s) }
            industrySaving = nil
            return
        }
        guard let mac, let request = Industry.saveRequest(mac, key: key) else { industrySaving = nil; return }
        industryGeneration += 1
        let mine = industryGeneration
        let sentTo = mac.url
        let (status, data) = await fetch(request)
        guard mine == industryGeneration, sentTo == shownURL else { return }
        if status == 200, let s = Industry.read(status: status, data: data) {
            industrySaving = nil
            industry = s
            if !s.list.isEmpty { industryKept = s.list }
            industryNote = Industry.savedSaid(s)
        } else if status == 200 {
            // Saved, but the answer did not read: the page's res.json().catch(() => ({})) then "Saved, but ...". The
            // choice stays shown until the re-read answers.
            industryNote = Industry.Words.savedUnread
            // As the page's industryPaint({}): what was shown is no longer known, so it reads as unread; a re-read that
            // fails then says so, never shows the old business as chosen beside "Saved" (review 3).
            industry?.unread = true
            industrySaving = nil
            await readIndustry(keepNote: true, after: key)
        } else {
            // Refused: the old choice is shown again by the re-read, not before it.
            industryNote = Industry.refused(status: status, data: data)
            industrySaving = nil
            await readIndustry(keepNote: true)
        }
    }

    @ViewBuilder private func checkinRows(_ rows: [Checkins.Row]) -> some View {
        Text(Checkins.Words.heading).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
            .accessibilityAddTraits(.isHeader)
        ForEach(rows) { r in
            let line = (Text(r.session).bold().foregroundColor(Palette.primary) + Text(" " + r.question).foregroundColor(Palette.secondary))
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            // A row is a button only when it can open its agent (a session the board's names allow).
            if target(r.session) != nil {
                Button { open(r.session) } label: { line }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("automation-checkin-" + r.session)
            } else {
                line.accessibilityIdentifier("automation-checkin-" + r.session)
            }
        }
    }

    private func target(_ session: String) -> PushBridge.AgentTarget? {
        let mac = mac ?? (sample ? Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "sample") : nil)
        return mac.flatMap { Checkins.target($0, session: session) }
    }

    private func open(_ session: String) {
        if let t = target(session) { openAgent(t) }
    }

    // keepNote: a read that follows a save keeps the save's line under the box.
    @MainActor private func read(_ box: Automation.Box, keepNote: Bool = false) async {
        await Task.yield()
        // Review 6: a read queued for a computer no longer shown never paints.
        guard sample || mac?.url == shownURL else { return }
        // Review 1: no read while a save is out; the save reads again itself when it needs to.
        guard pending[box] == nil else { return }
        guard let mac = mac ?? (sample ? Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "sample") : nil)
        else { return }
        // Review 3: every read takes its own number too, as the page's ++epoch, so an older read cannot land over a newer.
        generations[box, default: 0] += 1
        let started = generations[box] ?? 0
        if case .loaded = loads[box] ?? .reading {} else { loads[box] = .reading }
        let (status, data) = await send(box, Automation.readRequest(mac, box))
        // A write landed meanwhile: its answer is newer than this one. A pull cancelled by leaving is not a failure.
        guard started == (generations[box] ?? 0) else { return }
        if Task.isCancelled {
            // Review 4: the newest read was cut off (a pull let go, the screen left) after an older one was dropped as
            // stale, so nothing would paint this box: give it Try again rather than a wait that never ends.
            if case .reading = loads[box] ?? .reading { loads[box] = .failed(Automation.Words.readFailed) }
            return
        }
        if let s = Automation.parse(box, status: status, data: data) {
            loads[box] = .loaded(s)
            // Review 5 and 7: a read that worked answers "could not read it back", for every box (the page's next readable
            // read clears its line too).
            // Review 8: but not when the read-back is itself unread (Language's choice nil); then the line stands, as the
            // page's does, and the footer's filter hides the duplicate unread sentence.
            var readBackUnread = false
            if case .language(let l) = s, l.choice == nil { readBackUnread = true }
            if !keepNote || (notes[box]?.text == Automation.Words.savedUnread && !readBackUnread) { notes[box] = nil }
        } else {
            let why = Automation.readRefusal(box, status: status, data: data)
            loads[box] = .failed(why)
            if notes[box]?.text == why { notes[box] = nil }   // review 5: one sentence, not the same one twice
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
        let sentTo = mac.url
        let sentGeneration = generations[box] ?? 0
        let (status, data) = await send(box, request)
        // Review 5 and 6: the computer changed while this was out (even A to B and back to A, which the generation bump
        // in .task records), so its answer is dropped.
        guard (sentTo == shownURL || (shownURL == nil && sample)) && sentGeneration == (generations[box] ?? 0) else { return }
        // Ends the save and makes any read that started during it stale, so it cannot paint over this answer.
        generations[box, default: 0] += 1
        pending[box] = nil
        switch Automation.writeOutcome(box, status: status, data: data) {
        case .saved(let s):
            loads[box] = .loaded(s)
            let said = box == .language ? Automation.languageSaved(status: status, data: data) : nil
            notes[box] = said.map { Note(text: $0, problem: false) }
            // The page reads Where each agent stands again after either switch is saved: its rows name both switches.
            if box == .community || box == .prompter { await readReady() }
        case .savedUnread:
            notes[box] = Note(text: Automation.Words.savedUnread, problem: false)
            await read(box, keepNote: true)
            if box == .community || box == .prompter { await readReady() }
        case .refused(let why):
            // The control goes back to what the computer says, read again (a save with no answer may have landed), and
            // the footer says why.
            notes[box] = Note(text: why, problem: true)
            await read(box, keepNote: true)
            if box == .community || box == .prompter { await readReady() }   // a save with no answer may have landed
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
