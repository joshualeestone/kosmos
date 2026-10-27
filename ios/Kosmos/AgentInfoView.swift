import SwiftUI

// kosmos#7267: the agent's own page, opened by the chat's info button. Profile and AI Settings under a segmented
// control (Josh: "a hybrid of the agent's Profile and its AI Settings, using a segmented control to switch between the
// two sections"), never the conversation again. Words are the board's (web/index.html d-sec-profile, d-sec-model,
// d-sec-memory); the decisions are in AgentInfoLogic.swift (tested).
struct AgentInfoView: View {
    @ObservedObject var client: BoardClient
    let agent: Board.Agent
    let openOnBoard: () -> Void

    enum Part: String, CaseIterable { case profile = "Profile", ai = "AI Settings" }
    @State private var part: Part = .profile
    @State private var details: Board.AgentDetails?
    @State private var readFailed = false
    @State private var instructions: String?
    @State private var skills: [Board.Skill]?
    @State private var roleTitles: [String: String]?
    // Name and role as typed, and what was last read, so Save shows only for a change.
    @State private var nameText = ""
    @State private var roleText = ""
    // What the boxes were last filled with: Save compares against these, not the newest read, so a rename made on the
    // computer meanwhile is never undone by a role-only save (the board's #4421, review 1).
    @State private var filledName = ""
    @State private var filledRole = ""
    @State private var saving = false
    @State private var saveLine: (text: String, ok: Bool)?
    @State private var asking: Board.FreshStart?
    @State private var freshLine: (text: String, ok: Bool)?
    @State private var freshBusy = false

    @ScaledMetric(relativeTo: .body) private var markSize: CGFloat = 22
    private var live: Board.Agent { client.agents.first { $0.session == agent.session } ?? agent }
    private var names: [String: String] { Dictionary(client.agents.map { ($0.session, $0.name) }, uniquingKeysWith: { a, _ in a }) }

    var body: some View {
        List {
            Section {
                header
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if !Board.isAgentSession(agent.session) {
                Section {
                    Text(Board.agentPageOnBoardOnly(live.name)).foregroundColor(Palette.secondary)
                }
                moreRow
            } else {
                switch part {
                case .profile: profile
                case .ai: aiSettings
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle(live.name)
        .toolbar(.hidden, for: .tabBar)
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog(asking.map { Board.freshConfirm($0, name: live.name).title } ?? "",
                            isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
                            titleVisibility: .visible, presenting: asking) { which in
            Button(Board.freshConfirm(which, name: live.name).go, role: which == .clear ? .destructive : nil) {
                Task { await fresh(which) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { which in
            Text(Board.freshConfirm(which, name: live.name).small)
        }
    }

    // The face, name and role, then the two parts' switch.
    private var header: some View {
        VStack(spacing: 10) {
            AgentAvatar(name: live.name, picture: client.pictures[live.session].flatMap { UIImage(data: $0) }, tone: nil, size: 72)
                .accessibilityHidden(true)
            VStack(spacing: 2) {
                Text(live.name).font(.title3.weight(.semibold)).foregroundColor(Palette.primary)
                    .multilineTextAlignment(.center)
                if let role = details.flatMap({ Board.roleLine($0, titles: roleTitles) }) ?? live.role {   // as the fields show
                    Text(role).font(.subheadline).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
                }
            }
            .accessibilityElement(children: .combine)
            if Board.isAgentSession(agent.session) {   // review 5: nothing to switch between for an agent it cannot load
            Picker("Section", selection: $part) {
                ForEach(Part.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    // MARK: Profile

    @ViewBuilder private var profile: some View {
        Section {
            TextField("What you call them", text: $nameText)
                // Review 2: typing during a save would be marked saved, then overwritten. Review 5: and before the first read,
                // what was typed would be overwritten by it.
                .disabled(saving || details == nil)
                .onChange(of: nameText) { v in let c = Board.capped(v); if c != v { nameText = c } }
                .textInputAutocapitalization(.words)
                .foregroundColor(Palette.primary)
        } header: { label("Name") } footer: {
            // Review 6: the fields stay locked until the first read; when it failed, say so here, where they are.
            if details == nil && readFailed {
                Text("We cannot read this agent\u{2019}s details right now. Pull down to try again.")
            } else {
                Text("What you call them here, and what their own instructions will say.")
            }
        }
        Section {
            TextField("Executive Assistant, Bookkeeper, Researcher…", text: $roleText)
                .disabled(saving || details == nil)
                .onChange(of: roleText) { v in let c = Board.capped(v); if c != v { roleText = c } }
                .foregroundColor(Palette.primary)
        } header: { label("What they do") } footer: {
            Text("Shown under their name, and written into their own instructions.")
        }
        if changed || saveLine != nil {
            Section {
                if changed {
                    Button { Task { await save() } } label: {
                        HStack { Text("Save"); if saving { Spacer(); ProgressView() } }
                    }
                    .disabled(saving || nameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let saveLine {
                    Text(saveLine.text).font(.footnote).foregroundColor(saveLine.ok ? Palette.secondary : Palette.dangerWord)
                }
            }
        }
        if let details, client.agents.count > 1 {
            Section {
                row("Reports to", Board.reportsToWords(details, names: names))
            } footer: { Text("Who they report their work to. Until you pick somebody, that is you.") }
        }
        Section {
            if let instructions {
                if instructions.isEmpty {
                    Text("No instructions yet.").foregroundColor(Palette.secondary)
                } else {
                    Text(instructions).font(.footnote).foregroundColor(Palette.primary).lineLimit(12)
                }
            } else {
                unread
            }
        } header: { label("Instructions") } footer: {
            Text("What this agent is for, in your words. Change them on your computer.")
        }
        Section {
            if let skills {
                if skills.isEmpty {
                    Text("No skills here yet.").foregroundColor(Palette.secondary)
                } else {
                    ForEach(skills) { Text($0.name).foregroundColor(Palette.primary) }
                }
            } else {
                unread
            }
        } header: { label("Skills") }
    }

    private var changed: Bool {
        guard details != nil else { return false }
        return nameText.trimmingCharacters(in: .whitespacesAndNewlines) != filledName
            || roleText.trimmingCharacters(in: .whitespacesAndNewlines) != filledRole
    }
    private func fill(_ d: Board.AgentDetails) {
        let role = Board.roleLine(d, titles: roleTitles) ?? ""
        nameText = d.name; roleText = role
        filledName = d.name; filledRole = role
    }

    // MARK: AI Settings

    @ViewBuilder private var aiSettings: some View {
        Section {
            if let details {
                HStack(spacing: 10) {
                    if let mark = Board.runnerMark(details) {
                        Image(mark).resizable().scaledToFit().frame(width: markSize, height: markSize).foregroundColor(Palette.primary)
                            .accessibilityHidden(true)
                    }
                    Text(Board.modelLine(details)).foregroundColor(Palette.primary)
                }
                if let account = details.accountLabel { row("Account", account) }
            } else {
                unread
            }
        } header: { label("Runs on") }
        Section {
            HStack {
                Text("How full").foregroundColor(Palette.primary)
                Spacer()
                Text(memoryWords).foregroundColor(memoryColor).monospacedDigit()
            }
            .accessibilityElement(children: .combine)
        } header: { label("Memory") }
        Section {
            Button { asking = .compact } label: { Text("Compact: summarise and keep going") }
                .disabled(freshBusy)
            Button(role: .destructive) { asking = .clear } label: { Text("Clear: start over, loses what it is holding") }
                .disabled(freshBusy)
            if let freshLine {
                Text(freshLine.text).font(.footnote).foregroundColor(freshLine.ok ? Palette.secondary : Palette.dangerWord)
            }
        } header: { label("Fresh start") } footer: {
            Text("Each one shows what it stands to lose before you choose.")
        }
        moreRow
    }

    @ViewBuilder private var moreRow: some View {
        Section {
            Button {
                // #7280: land on AI Settings, not the conversation (the URL is built inside openOnBoard's chatURL).
                client.boardSectionOnce = "model"
                openOnBoard()
                client.boardSectionOnce = nil
            } label: {
                HStack {
                    Text("Open on your computer\u{2019}s board").foregroundColor(Palette.primary)
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundColor(Palette.tertiary)
                }
            }
        } footer: {
            // Not "open its Terminal": from a phone the board refuses that (it opens on the computer itself; review 3).
            // #7280: the row opens the board on this agent's AI Settings (an older board ignores sec and opens the
            // conversation, with AI Settings beside it).
            // Review 6: only for an agent the link can name; otherwise it opens the board's home, so promise nothing.
            if Board.isAgentSession(agent.session) {
                Text("Its AI Settings there change the model or the account it runs on, restart it, or remove it.")
            }
        }
    }

    private var memoryWords: String {
        if live.contextFull { return "Full" }
        guard let p = live.contextPercent else { return "Not known" }
        return "\(Int(p.rounded()))%"   // the row's label already says "How full"
    }
    private var memoryColor: Color {
        if live.contextFull { return Palette.ring(.high) }
        return Board.memBand(live.contextPercent).map(Palette.ring) ?? Palette.secondary
    }

    // MARK: Pieces

    private func label(_ s: String) -> some View { Text(s).font(.footnote.weight(.semibold)).foregroundColor(Palette.secondary).textCase(nil) }
    private func row(_ k: String, _ v: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(k).foregroundColor(Palette.primary)
            Spacer(minLength: 12)
            Text(v).foregroundColor(Palette.secondary).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
    @ViewBuilder private var unread: some View {
        if readFailed {
            Text("We cannot read this right now.").foregroundColor(Palette.secondary)
        } else {
            ProgressView()
        }
    }

    // MARK: Reading and acting, through the Mac

    private func load() async {
        let session = agent.session
        guard Board.isAgentSession(session) else { return }   // the page says where to change it instead
        #if DEBUG
        if AgentInfoView.sample { applySample(); return }
        #endif
        async let status = client.throughMac { Board.statusRequest(mac: $0) }
        async let instr = client.throughMac { Board.instructionsRequest(mac: $0, session: session) }
        async let sk = client.throughMac { Board.skillsRequest(mac: $0, session: session) }
        async let rl = client.throughMac { Board.rolesRequest(mac: $0) }
        let (s, i, k, roles) = await (status, instr, sk, rl)
        if let t = roles.flatMap({ $0.1.statusCode == 200 ? Board.parseRoleTitles($0.0) : nil }) { roleTitles = t }
        let d = s.flatMap { $0.1.statusCode == 200 ? Board.parseAgentDetails($0.0, session: session) : nil }
        if let d {
            // Only into fields the person has not changed (a refresh must not undo their typing).
            if details == nil || !changed { fill(d) }
            details = d
        }
        instructions = i.flatMap { $0.1.statusCode == 200 ? Board.parseInstructions($0.0) : nil } ?? instructions
        skills = k.flatMap { $0.1.statusCode == 200 ? Board.parseSkills($0.0) : nil } ?? skills
        readFailed = d == nil || instructions == nil || skills == nil
    }

    private func save() async {
        guard let details else { return }
        saving = true
        defer { saving = false }
        let typed = nameText
        let before = filledName
        let res = await client.throughMac {
            Board.profileSaveRequest(mac: $0, session: details.session, name: typed, role: roleText, shownName: before)
        }
        switch Board.profileSaveResult(status: res?.1.statusCode ?? 0, body: res?.0, running: live.running, before: before,
                                       typed: Board.capped(typed.trimmingCharacters(in: .whitespacesAndNewlines))) {
        case .saved(let said):
            saveLine = (said, true)
            // What was sent is now what the boxes hold, so the read after it refills them with the saved values.
            filledName = nameText.trimmingCharacters(in: .whitespacesAndNewlines)
            filledRole = roleText.trimmingCharacters(in: .whitespacesAndNewlines)
            await load()
            await client.refreshNow()
        case .refused(let why): saveLine = (why, false)
        case .noAnswer: saveLine = ("We could not reach your computer, so it was not saved.", false)
        }
        if let saveLine { UIAccessibility.post(notification: .announcement, argument: saveLine.text) }   // the board's aria-live
    }

    private func fresh(_ which: Board.FreshStart) async {
        freshBusy = true
        defer { freshBusy = false }
        let res = await client.throughMac { Board.freshRequest(mac: $0, session: agent.session, which) }
        let said = Board.freshResult(which, status: res?.1.statusCode ?? 0, body: res?.0)
        freshLine = (said.sentence, said.ok)
        UIAccessibility.post(notification: .announcement, argument: said.sentence)
    }

    #if DEBUG
    // KOSMOS_SAMPLE_AGENTS=1 (a Debug build): the sample agent's page without a Mac, for the design shots.
    // KOSMOS_SAMPLE_INFO=ai opens on AI Settings.
    static var sample: Bool { ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" }
    private func applySample() {
        let d = Board.AgentDetails(session: live.session, name: live.name, role: live.role, reportsTo: nil, runner: "",
                                   modelName: "Opus 5.5", plannedModelName: nil, settingModelName: nil, neverRecorded: false,
                                   accountProvider: nil, accountLabel: "Work account", running: true)
        details = d
        fill(d)
        instructions = "You look after the spring catalogue: the cover, the order of the pages, and getting proofs to the printer on time.\n\nAsk before you spend money or send anything outside the team."
        skills = [Board.Skill(key: "meeting-minutes", name: "Meeting minutes"), Board.Skill(key: "proof-checklist", name: "Proof checklist")]
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_INFO"] == "ai" { part = .ai }
    }
    #endif
}
