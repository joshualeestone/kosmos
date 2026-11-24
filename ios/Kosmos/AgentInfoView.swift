import SwiftUI

// kosmos#7267: the agent's own page, opened by the chat's info button. Profile and AI Settings, and since kosmos#7679
// Files, under a segmented control (Josh: "a hybrid of the agent's Profile and its AI Settings, using a segmented
// control to switch between the two sections"), never the conversation again. Words are the board's (web/index.html
// d-sec-profile, d-sec-model, d-sec-memory); the decisions are in AgentInfoLogic.swift (tested).
struct AgentInfoView: View {
    @ObservedObject var client: BoardClient
    let agent: Board.Agent
    let openOnBoard: () -> Void

    // kosmos#7679 (Josh, iPhone build 29, 11-03 04:11: "We should add files to the segment controller"): Files is its own
    // segment, after the two the board's page has.
    enum Part: String, CaseIterable { case profile = "Profile", ai = "AI Settings", files = "Files" }
    @State private var part: Part = .profile
    @State private var details: Board.AgentDetails?
    @State private var readFailed = false
    @State private var instructions: String?
    @State private var skills: [Board.Skill]?
    // kosmos#7840: why there is nothing to show, in the words of whoever could not (the phone or the board).
    @State private var instructionsWhy: String?
    @State private var skillsWhy: String?
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
    // kosmos#8955: Restart and Remove, as the board's agent page has them.
    @State private var restartAsking = false
    @State private var restartBusy = false
    @State private var restartLine: (text: String, ok: Bool)?
    @State private var removal: Board.RemovalPlan?   // nil until the first plan is read
    @State private var removalLoad = 0   // the newest plan read; an older one that finishes later is dropped (REMOVE_TOKEN)
    @State private var removeAsk: Board.RemovalAsk?
    @State private var removeBusy = false
    @State private var removeLine: (text: String, ok: Bool)?
    @State private var removed = false
    // kosmos#8626: the provider switch. The accounts are /api/accounts (nil until read, the board's ACCOUNTS_LOADED;
    // accountsFailed is its ACCOUNTS_UNREADABLE), Claude's models ride the /api/roles read the page already makes.
    @State private var accountRows: [[String: Any]]?
    @State private var accountsFailed = false
    @State private var claudeModels: [Board.SwitchModel] = []
    @State private var switchTo: Board.SwitchProvider?
    @State private var switchAccount: String?
    @State private var switchAccountTouched = false
    @State private var switchModel = ""
    @State private var openaiModels: [Board.SwitchModel] = []
    @State private var openaiModelsLoading = false
    @State private var openaiModelsGen = 0   // review 3: the newest load is the one that counts (the board's SWITCH_MODEL_GEN)
    // Review 3: where a switch landed and where it came from, until /api/status catches up with the restart.
    @State private var landed: (to: String, from: String)?
    @State private var switching = false
    @State private var switchLine: (text: String, ok: Bool)?
    @State private var confirmSwitch = false
    // kosmos#7679: the Files section's read and its opener, owned here so they attach once, to the List (review 1).
    @State private var filesRead: Board.FilesSectionState = .hidden
    // kosmos#7679: whether the first Files read has come back, so the Files segment can tell loading from empty.
    @State private var filesLoaded = false
    // Review 2: which Files load is the newest, so an older one that finishes later never overwrites it.
    @State private var filesLoad = 0
    @StateObject private var filesOpener = FileOpener()

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
                case .files: filesPart
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .navigationBarTitleDisplayMode(.inline)
        .kosmosSolidTopBar()   // kosmos#7346 (Josh 10-27 20:21): no row shows behind the top bar
        .navigationTitle(live.name)
        .toolbar(.hidden, for: .tabBar)
        .task { await load() }
        // Review 6: a refresh clears a success or a "cannot tell" line (the refresh answers it); a refusal or a switch
        // saved but not started stays, as it is still true.
        .dotsRefresh { if let l = switchLine, l.ok || l.text == Board.switchUnknown { switchLine = nil }; await load() }
        .filesQuickLook(filesOpener, client: client)   // kosmos#7679: once, here, never on a Section's rows
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
        // kosmos#8955: the board's restart dialog (openRestartModal): its cost line in the agent's own record's words.
        .confirmationDialog(Board.restartTitle(live.name), isPresented: $restartAsking, titleVisibility: .visible) {
            Button(Board.restartGo(live.name)) { Task { await restart() } }
            Button(Board.restartKeep, role: .cancel) {}
        } message: {
            let cost = Board.restartCost(live.name, live.commitments)
            Text(([cost.small] + cost.list.map { "\u{2022} " + $0 }).joined(separator: "\n"))
        }
        // kosmos#8955: the board's removal dialog (openRemoveModal): the engine's question, reassurance, Loses and Keeps.
        .confirmationDialog(removeAsk?.question ?? "", isPresented: Binding(get: { removeAsk != nil }, set: { if !$0 { removeAsk = nil } }),
                            titleVisibility: .visible, presenting: removeAsk) { ask in
            Button(Board.removeGo(ask), role: .destructive) { Task { await remove(ask) } }
            Button(Board.removeKeep(ask), role: .cancel) {}
        } message: { ask in
            Text(Board.removeMessage(ask))
        }
    }

    // The face, name and role, then the switch between the parts.
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
                        HStack { Text("Save"); if saving { Spacer(); SweepDots(label: "Loading", scales: false) } }
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
                why(instructionsWhy)
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
                why(skillsWhy)
            }
        } header: { label("Skills") }
    }

    // kosmos#7679: the Files segment. The section hides itself when there is nothing to list (as it did at the foot of
    // Profile, the board's #3757); as a segment of its own it says so instead, in the board's words, once the read is back.
    @ViewBuilder private var filesPart: some View {
        if filesRead == .hidden {
            Section {
                if filesLoaded { Text(Board.filesAgentEmpty).foregroundColor(Palette.secondary) } else { HStack { Spacer(); SweepDots(label: "Loading", scales: false); Spacer() } }
            } header: { label(Board.filesTitle) }
        } else {
            FilesSection(client: client, session: agent.session, state: filesRead, opener: filesOpener, openOnBoard: openOnBoard)
        }
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
                    Text(Board.aiSettingsModelLine(details)).foregroundColor(Palette.primary)
                }
                if let account = details.accountLabel { row("Account", account) }
                if let landed, Board.providerOf(details) == landed.from {
                    Text("Moving to \(Board.providerWord(landed.to)). This shows here once it has restarted.")
                        .font(.footnote).foregroundColor(Palette.secondary)
                }
            } else {
                unread
            }
        } header: { label("Runs on") }
        switchSection
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
                .disabled(freshBusy || restartBusy || removeBusy || removed)
            Button(role: .destructive) { asking = .clear } label: { Text("Clear: start over, loses what it is holding") }
                .disabled(freshBusy || restartBusy || removeBusy || removed)
            if let freshLine {
                Text(freshLine.text).font(.footnote).foregroundColor(freshLine.ok ? Palette.secondary : Palette.dangerWord)
            }
            // kosmos#8955: the board's third (d-restart-start), after Compact and Clear as the pack draws it.
            Button { restartAsking = true } label: { Text(Board.restartLabel(live.name)) }
                .disabled(restartBusy || removeBusy || freshBusy || removed)
                .accessibilityLabel("Fresh start: " + Board.restartLabel(live.name))
            if let restartLine {
                Text(restartLine.text).font(.footnote).foregroundColor(restartLine.ok ? Palette.secondary : Palette.dangerWord)
            }
        } header: { label("Fresh start") } footer: {
            Text("Each one shows what it stands to lose before you choose.")
        }
        removeSection
        moreRow
    }

    // MARK: Switch provider (kosmos#8626)

    private var currentProvider: String? { landed?.to ?? details.map(Board.providerOf) }
    private var switchTargets: [Board.SwitchProvider] {
        guard let details, let rows = accountRows else { return [] }
        return Board.switchTargets(details, accounts: rows, landed: landed?.to)
    }
    private var switchAccounts: [Board.SwitchAccount] {
        guard let to = switchTo, let rows = accountRows else { return [] }
        return Board.switchAccounts(rows, for: to)
    }
    private var switchModels: [Board.SwitchModel] {
        switch switchTo {
        case .anthropic: return claudeModels
        case .openai: return openaiModels
        default: return []
        }
    }
    @ViewBuilder private var switchSection: some View {
        if let details, details.isNamedOurs, !details.neverRecorded {
            Section {
                if accountRows == nil {
                    if accountsFailed {
                        Text("We could not check which providers your computer has connected. Pull down to try again.").foregroundColor(Palette.secondary)
                    } else {
                        HStack { Spacer(); SweepDots(label: "Checking your providers", scales: false); Spacer() }
                    }
                } else if switchTargets.isEmpty {
                    Text(Board.switchNothingLine(details)).foregroundColor(Palette.secondary)
                } else {
                    Picker("Switch to", selection: $switchTo) {
                        Text("Choose").tag(Board.SwitchProvider?.none)
                        // kosmos#8635: each with its logo (a Label's image shows in the iOS 16+ menu; template images take
                        // the menu's own colour, so they read in light and dark).
                        ForEach(switchTargets) { p in
                            Label { Text(p.label) } icon: { menuMark(p.mark) }.tag(Board.SwitchProvider?.some(p))
                        }
                    }
                    .disabled(switching)
                    // Review 1: only a pick resets the rest. Clearing it after a switch must not wipe the result line.
                    .onChange(of: switchTo) { v in if v != nil { pickedProvider() } }
                    if switchAccounts.count > 1 {
                        // Review 1: "picked" is set by the person's own change only, never by the default this page
                        // puts in when a provider is chosen (the board's SWITCH_ACCT_TOUCHED).
                        Picker("Account", selection: Binding(get: { switchAccount }, set: { v in
                            let changed = v != switchAccount
                            switchAccount = v
                            switchAccountTouched = true
                            if changed && switchTo == .openai {
                                // Review 5: the old list goes and the button waits in the same frame, not when the Task runs.
                                openaiModels = []; switchModel = ""; openaiModelsLoading = true
                                Task { await loadOpenaiModels() }
                            }
                        })) {
                            ForEach(switchAccounts) { Text($0.label).tag(String?.some($0.dir)) }
                        }
                        .disabled(switching)
                    } else if let only = switchAccounts.first {
                        row("Account", only.label)
                    }
                    if openaiModelsLoading && switchTo == .openai {
                        HStack { Text("Model").foregroundColor(Palette.primary); Spacer(); SweepDots(label: "Loading this account\u{2019}s models", scales: false) }
                    } else if !switchModels.isEmpty {
                        Picker("Model", selection: $switchModel) {
                            ForEach(switchModels) { Text($0.label).tag($0.key) }
                        }
                        .disabled(switching)
                    }
                    if let to = switchTo, let from = currentProvider, to.rawValue != from {
                        Text(Board.switchNote(from: from, to: to, name: live.name))
                            .font(.footnote).foregroundColor(Palette.secondary)
                        Button { confirmSwitch = true } label: {
                            HStack {
                                Text(switching ? "Switching\u{2026}" : "Switch and restart")
                                if switching { Spacer(); SweepDots(label: "Switching", scales: false) }
                            }
                        }
                        .disabled(switching || openaiModelsLoading)
                        .confirmationDialog("Switch \(live.name) to \(to.titleWord)?", isPresented: $confirmSwitch, titleVisibility: .visible) {
                            Button("Switch and restart") { Task { await doSwitch(to) } }
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            Text(Board.switchNote(from: from, to: to, name: live.name))
                        }
                    }
                }
                if let switchLine {
                    Text(switchLine.text).font(.footnote).foregroundColor(switchLine.ok ? Palette.secondary : Palette.dangerWord)
                }
            } header: { label("Switch AI provider") } footer: {
                // Review 2: no claim that they are offered there (each has its own switch), only where they are done.
                if Board.providerOf(details) != "meta" {
                    Text("Some providers, such as Gemini on a Google subscription, can be switched only on your computer\u{2019}s board.")
                }
            }
        }
    }
    // Review 1: after any read, a pick the fresh lists no longer hold is dropped, so what is sent is always something
    // on screen (a switch that landed partway, an account removed on the computer, a model no longer listed).
    private func keepPicksValid() {
        // Review 6: with one row or none there is no menu, so nothing was picked from one (the board refills and resets).
        if switchAccounts.count <= 1 { switchAccountTouched = false }
        // Review 3: status has caught up (or moved on), so the landed provider is no longer needed.
        if let l = landed, let d = details, Board.providerOf(d) != l.from || Board.providerOf(d) == l.to { landed = nil }
        if let to = switchTo, !switchTargets.contains(to) { switchTo = nil; confirmSwitch = false; return }
        guard switchTo != nil else { return }
        if let dir = switchAccount, !switchAccounts.contains(where: { $0.dir == dir }) {
            confirmSwitch = false   // review 3: a dialog never confirms an account that is not the one on screen
            switchAccount = (switchAccounts.first(where: { $0.isDefault }) ?? switchAccounts.first)?.dir
            switchAccountTouched = false
            if switchTo == .openai {   // review 2: the new account's own list; review 6: the old one goes in this frame
                openaiModels = []; switchModel = ""; openaiModelsLoading = true
                Task { await loadOpenaiModels() }
            }
        }
        if !switchModels.isEmpty, !switchModels.contains(where: { $0.key == switchModel }) {
            switchModel = (switchModels.first(where: { $0.isDefault }) ?? switchModels.first)?.key ?? ""
        }
    }
    /* kosmos#8635: a system menu ignores SwiftUI's size modifiers and draws each vector logo at its own size, and the
       files frame their drawings differently (OpenAI's fills about half its viewBox, Gemini's and Grok's nearly all of it;
       measured, the menu showed OpenAI at half the others' size). So each logo is trimmed to its drawn pixels, fitted
       into one box with its aspect kept, and stays a template image, so it takes the menu's own colour in light and dark. */
    // Review 1: made once per logo (it never changes), not on every redraw of the section.
    private static var menuMarks: [String: UIImage] = [:]
    private func menuMark(_ name: String) -> Image {
        if let made = Self.menuMarks[name] { return Image(uiImage: made) }
        guard let src = UIImage(named: name) else { return Image(systemName: "circle") }
        let box = CGSize(width: 22, height: 22)
        let crop = Self.drawnRect(src)
        let scale = min(box.width / max(crop.width, 1), box.height / max(crop.height, 1))
        let fitted = CGSize(width: crop.width * scale, height: crop.height * scale)
        let drawn = UIGraphicsImageRenderer(size: box).image { _ in
            // The whole source, scaled and shifted so its drawn part lands centred in the box.
            src.draw(in: CGRect(x: (box.width - fitted.width) / 2 - crop.minX * scale, y: (box.height - fitted.height) / 2 - crop.minY * scale,
                                width: src.size.width * scale, height: src.size.height * scale))
        }
        let made = drawn.withRenderingMode(.alwaysTemplate)
        Self.menuMarks[name] = made
        return Image(uiImage: made)
    }
    // The part of an image that has any ink, in its own points (the whole image when it cannot be read). Drawn into a
    // bitmap made here with a known layout (RGBA, alpha the 4th byte): a renderer's own bitmap may be 64-bit or
    // little-endian alpha-first, and reading the wrong byte finds no ink (measured: every logo came back whole).
    private static func drawnRect(_ img: UIImage) -> CGRect {
        let whole = CGRect(origin: .zero, size: img.size)
        let px = 128
        guard let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: px * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let raw = ctx.data
        else { return whole }
        // Review 1: the logo (a vector asset, often with no cgImage) is drawn straight into this small bitmap, never
        // rasterised at its own nominal size first (OpenAI's is 716 points). Flipped so UIKit's top is row 0.
        ctx.translateBy(x: 0, y: CGFloat(px)); ctx.scaleBy(x: 1, y: -1)
        UIGraphicsPushContext(ctx)
        img.draw(in: CGRect(x: 0, y: 0, width: px, height: px))
        UIGraphicsPopContext()
        let bytes = raw.bindMemory(to: UInt8.self, capacity: px * px * 4)
        var minX = px, minY = px, maxX = -1, maxY = -1
        for y in 0..<px { for x in 0..<px where bytes[(y * px + x) * 4 + 3] > 8 {
            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
        } }
        guard maxX >= minX, maxY >= minY else { return whole }
        // Row 0 of the buffer is the top of the image (the flip above puts UIKit's y = 0 there).
        let sx = img.size.width / CGFloat(px), sy = img.size.height / CGFloat(px)
        return CGRect(x: CGFloat(minX) * sx, y: CGFloat(minY) * sy, width: CGFloat(maxX - minX + 1) * sx, height: CGFloat(maxY - minY + 1) * sy)
    }

    private func pickedProvider() {
        switchLine = nil
        confirmSwitch = false
        switchAccountTouched = false
        let accounts = switchAccounts
        switchAccount = (accounts.first(where: { $0.isDefault }) ?? accounts.first)?.dir
        openaiModels = []
        openaiModelsLoading = false   // a load for an earlier pick never holds this one's button
        switchModel = (claudeModels.first(where: { $0.isDefault }) ?? claudeModels.first)?.key ?? ""
        if switchTo == .openai { switchModel = ""; openaiModelsLoading = true; Task { await loadOpenaiModels() } }
    }
    private func loadOpenaiModels() async {
        // Review 2: another account's models are never on screen while this one's load (the board's fillSwitchModel).
        openaiModelsGen += 1
        let gen = openaiModelsGen
        openaiModels = []
        switchModel = ""
        guard switchTo == .openai, let dir = switchAccount else { openaiModelsLoading = false; return }
        openaiModelsLoading = true
        #if DEBUG
        if AgentInfoView.sample { openaiModelsLoading = false; openaiModels = Board.parseSwitchModels(Data(#"{"ok":true,"models":[{"key":"gpt-5.6","label":"GPT 5.6"},{"key":"gpt-5.6-mini","label":"GPT 5.6 mini"}]}"#.utf8), openai: true); return }
        #endif
        let res = await client.throughMac { Board.openaiModelsRequest(mac: $0, dir: dir) }
        guard gen == openaiModelsGen, switchTo == .openai, switchAccount == dir else { return }   // a newer load is the one shown
        openaiModelsLoading = false
        openaiModels = res.flatMap { $0.1.statusCode == 200 ? Board.parseSwitchModels($0.0, openai: true) : nil } ?? []
        if !openaiModels.contains(where: { $0.key == switchModel }) { switchModel = "" }
    }
    private func doSwitch(_ to: Board.SwitchProvider) async {
        // Review 2: what is still on offer, never a pick a read dropped while the dialog was up.
        guard switchTo == to, switchTargets.contains(to), !openaiModelsLoading else {
            switchLine = ("The choice changed while you were deciding, so nothing was switched. Pick again.", false)
            return
        }
        let fromProvider = currentProvider ?? ""
        switching = true
        let account = switchAccounts.isEmpty ? nil : switchAccount
        let picked = switchAccountTouched
        let model = switchModels.isEmpty ? nil : switchModel
        let session = agent.session
        let res = await client.throughMac {
            Board.providerSwitchRequest(mac: $0, session: session, to: to, account: account, picked: picked, model: model)
        }
        let said = Board.providerSwitchResult(status: res?.1.statusCode ?? 0, body: res?.0)
        switching = false   // review 4: the answer is in, so the button stops saying it is still switching
        switchLine = (said.sentence, said.ok)
        UIAccessibility.post(notification: .announcement, argument: said.sentence)
        if let to = Board.providerSwitchLanded(status: res?.1.statusCode ?? 0, body: res?.0), to != fromProvider {
            // Review 4: a second switch before status catches up keeps the first from. Review 5: a switch back to where
            // it started is no move at all.
            let from = landed?.from ?? fromProvider
            landed = to == from ? nil : (to, from)
        }
        if said.ok { switchTo = nil }
        await load()
        await client.refreshNow()
        // Review 3: the restart takes a moment to show in /api/status; read once more so Runs on catches up.
        if landed != nil {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            await load()
        }
    }

    // MARK: Remove (kosmos#8955: the board's d-remove-agent, at the foot of the page, below the fresh start)

    @ViewBuilder private var removeSection: some View {
        Section {
            if removed, let removeLine {
                Text(removeLine.text).foregroundColor(Palette.secondary)
            } else {
                switch removal {
                case .none:
                    Text("Reading whether it can be removed\u{2026}").foregroundColor(Palette.secondary)
                case .unreached?:
                    Text(Board.removalUnreached).foregroundColor(Palette.secondary)
                case .cannot(let because, let untied)?:
                    Text(because).foregroundColor(Palette.secondary)
                    if untied { Text(Board.removalUntiedOnBoard).font(.footnote).foregroundColor(Palette.secondary) }
                case .can(let ask)?:
                    if !ask.hint.isEmpty { Text(ask.hint).font(.footnote).foregroundColor(Palette.secondary) }
                    Button(role: .destructive) { removeAsk = ask } label: { Text("Remove this agent\u{2026}") }
                        .disabled(removeBusy || restartBusy || freshBusy)
                }
                if let removeLine {
                    Text(removeLine.text).font(.footnote).foregroundColor(removeLine.ok ? Palette.secondary : Palette.dangerWord)
                }
            }
        } header: { label("Remove this agent") }
    }

    private func loadRemoval(_ session: String) async {
        removalLoad += 1
        let mine = removalLoad
        let res = await client.throughMac { Board.removalPlanRequest(mac: $0, session: session) }
        guard mine == removalLoad, !removed else { return }
        let plan = Board.removalPlan(status: res?.1.statusCode ?? 0, body: res?.0, session: session)
        // A read that did not answer keeps a plan already shown (the next refresh asks again).
        if plan == .unreached, case .can? = removal { return }
        removal = plan
    }

    private func remove(_ ask: Board.RemovalAsk) async {
        let session = agent.session
        removeBusy = true
        removeLine = ("Removing\u{2026}", true)
        let res = await client.throughMac { Board.removeRequest(mac: $0, session: session) }
        let done = Board.removeResult(status: res?.1.statusCode ?? 0, body: res?.0)
        removeBusy = false
        switch done {
        case .removed:
            removed = true
            removeLine = (Board.removedLine(ask.label), true)
        case .partial(let why), .refused(let why):
            removeLine = (why, false)
        }
        UIAccessibility.post(notification: .announcement, argument: removeLine?.text ?? "")
        await client.refreshNow()
        if !removed { await loadRemoval(session) }
    }

    // MARK: Restart (kosmos#8955: the board's rst-go, then its wake hello)

    // RESTART_HELLO_SEQ: per agent and outliving this page, so a restart from a reopened page supersedes the wait of
    // one started before it, and only the newest sends the hello.
    @MainActor private static var restartTokens: [String: Int] = [:]

    private func restart() async {
        let session = agent.session
        let mine = (AgentInfoView.restartTokens[session] ?? 0) + 1
        AgentInfoView.restartTokens[session] = mine
        let current = { AgentInfoView.restartTokens[session] == mine }
        restartBusy = true
        restartLine = nil
        let res = await client.throughMac { Board.restartRequest(mac: $0, session: session) }
        let said = Board.restartResult(status: res?.1.statusCode ?? 0, body: res?.0)
        guard current() else { return }
        guard said.ok else {
            restartBusy = false
            restartLine = (said.sentence ?? "We could not restart them.", false)
            UIAccessibility.post(notification: .announcement, argument: restartLine?.text ?? "")
            return
        }
        restartLine = (Board.restartWaking, true)
        UIAccessibility.post(notification: .announcement, argument: Board.restartWaking)
        // restartReadyWait: its own read of /api/status (not the list's refresh, which re-sorts the Agents list and can
        // reconnect), seen down, then up, within the window; otherwise the person says hello themselves. A read that
        // fails counts as not ready, as the board's does.
        var sawUnready = false
        var ready = false
        let until = Date().addingTimeInterval(Board.restartReadyWindow)
        while Date() < until {
            try? await Task.sleep(nanoseconds: UInt64(Board.restartReadyPoll * 1_000_000_000))
            guard current() else { return }
            let r = await client.throughMac { Board.statusRequest(mac: $0) }
            guard current() else { return }
            let agents = r.flatMap { $0.1.statusCode == 200 ? Board.parseAgents($0.0) : nil } ?? []
            if Board.readyStep(agents.first { $0.session == session }, sawUnready: &sawUnready) { ready = true; break }
        }
        var line = Board.restartManual
        if ready {
            let r = await client.throughMac { Board.wakeHelloRequest(mac: $0, session: session) }
            line = Board.wakeLine(status: r?.1.statusCode ?? 0, body: r?.0)
        }
        guard current() else { return }
        restartBusy = false
        restartLine = (line, true)
        UIAccessibility.post(notification: .announcement, argument: line)
        await load()
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
            // kosmos#8955: Restart and Remove are here now, so the footer says only what is left there, and that it is a
            // web page.
            if Board.isAgentSession(agent.session) {
                Text(Board.boardOnlyFooter)
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
    @ViewBuilder private func why(_ reason: String?) -> some View {
        if let reason {
            Text(reason).foregroundColor(Palette.secondary)
        } else {
            HStack { Spacer(); SweepDots(label: "Loading", scales: false); Spacer() }
        }
    }
    @ViewBuilder private var unread: some View {
        if readFailed {
            Text("We cannot read this right now.").foregroundColor(Palette.secondary)
        } else {
            HStack { Spacer(); SweepDots(label: "Loading", scales: false); Spacer() }
        }
    }

    // MARK: Reading and acting, through the Mac

    private func load() async {
        let session = agent.session
        guard Board.isAgentSession(session) else { return }   // the page says where to change it instead
        #if DEBUG
        if AgentInfoView.sample { applySample(); filesRead = await FilesSection.read(client: client, session: session); filesLoaded = true; return }
        #endif
        // kosmos#7679 review 1: Files is applied as soon as its own read is back, not after the slowest of the others,
        // since it is a segment of its own now.
        async let filesDone: Void = loadFiles(session)
        async let removalDone: Void = loadRemoval(session)   // kosmos#8955
        async let status = client.throughMac { Board.statusRequest(mac: $0) }
        async let instr = client.throughMac { Board.instructionsRequest(mac: $0, session: session) }
        async let sk = client.throughMac { Board.skillsRequest(mac: $0, session: session) }
        async let rl = client.throughMac { Board.rolesRequest(mac: $0) }
        let (s, i, k, roles) = await (status, instr, sk, rl)
        if let t = roles.flatMap({ $0.1.statusCode == 200 ? Board.parseRoleTitles($0.0) : nil }) { roleTitles = t }
        // kosmos#8626: the same answer carries the models a Claude agent can start on (the board's CREATE_MODELS).
        if let m = roles.flatMap({ $0.1.statusCode == 200 ? Board.parseSwitchModels($0.0, openai: false) : nil }), !m.isEmpty { claudeModels = m }
        let d = s.flatMap { $0.1.statusCode == 200 ? Board.parseAgentDetails($0.0, session: session) : nil }
        if let d {
            // Only into fields the person has not changed (a refresh must not undo their typing).
            if details == nil || !changed { fill(d) }
            details = d
        }
        // kosmos#7840: each section shows its value or why not (Board.profileNext keeps a shown value through no answer).
        (instructions, instructionsWhy) = Board.profileNext(shown: instructions, read: Board.instructionsRead(i))
        (skills, skillsWhy) = Board.profileNext(shown: skills, read: Board.skillsRead(k))
        readFailed = d == nil   // the details' own read (the name footer and Runs on); each section says its own why
        await filesDone
        await removalDone
        // kosmos#8626: last, as it can take a while (one live check per account, as on the board); a list already
        // read is kept through a read that fails, as the other sections keep theirs.
        // Review 1: only for an agent the section is shown for, as each read costs a live check per account.
        guard let shown = details, shown.isNamedOurs, !shown.neverRecorded else { return }
        let ac = await client.throughMac { Board.accountsRequest(mac: $0) }
        if let rows = ac.flatMap({ $0.1.statusCode == 200 ? Board.parseSwitchAccounts($0.0) : nil }) {
            accountRows = rows
            accountsFailed = false
        } else if accountRows == nil {
            accountsFailed = true
        }
        keepPicksValid()
    }

    private func loadFiles(_ session: String) async {
        filesLoad += 1
        let mine = filesLoad
        let newFiles = await FilesSection.read(client: client, session: session)
        guard mine == filesLoad else { return }   // a newer load started meanwhile; its answer is the one shown
        // What a refresh keeps (unlike the board, which says it could not read): Board.filesSection and filesSectionAfter.
        filesRead = Board.filesSectionAfter(filesRead, newFiles, loaded: filesLoaded)
        filesLoaded = true
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
    // KOSMOS_SAMPLE_INFO=ai opens on AI Settings, =files on Files; KOSMOS_SAMPLE_SWITCH=<provider> also picks a switch.
    static var sample: Bool { ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" }
    private func applySample() {
        let d = Board.AgentDetails(session: live.session, name: live.name, role: live.role, reportsTo: nil, runner: "",
                                   modelName: "Opus 5.5", plannedModelName: nil, settingModelName: nil, neverRecorded: false,
                                   accountProvider: nil, accountLabel: "Work account", running: true, isNamedOurs: true)
        // kosmos#8626: a computer with Claude, OpenAI and Gemini connected, for the switch's design shots.
        accountRows = Board.parseSwitchAccounts(Data(#"{"accounts":[{"provider":"anthropic","dir":"/s/c","name":"Work account","email":"work@example.com","memoryShared":true,"isDefault":true},{"provider":"openai","dir":"/s/o","name":"Studio","keyTail":"4F2A"},{"provider":"google","dir":"/s/g","keyTail":"91C0"},{"provider":"xai","dir":"/s/x","keyTail":"7B1D"}]}"#.utf8))
        claudeModels = Board.parseSwitchModels(Data(#"{"models":[{"key":"opus","label":"Claude Opus 5.5","default":true},{"key":"sonnet","label":"Claude Sonnet 5.5"},{"key":"haiku","label":"Claude Haiku 5.5"}]}"#.utf8), openai: false)
        details = d
        fill(d)
        instructions = "You look after the spring catalogue: the cover, the order of the pages, and getting proofs to the printer on time.\n\nAsk before you spend money or send anything outside the team."
        skills = [Board.Skill(key: "meeting-minutes", name: "Meeting minutes"), Board.Skill(key: "proof-checklist", name: "Proof checklist")]
        // kosmos#8955: the engine's own plan words for an agent with a startup job (engine/remove.js plan), for the shots.
        removal = .can(Board.RemovalAsk(question: "Are you sure you want to remove \(live.name) from Kosmos?",
                                        reassurance: "Removing is not deleting. Its files will not be deleted.", label: live.name,
                                        hint: "It stops running and leaves the board, and Kosmos stops it starting again; you can put it back. Its folder, its instructions and everything it has written stay on this computer. Removing is not deleting.",
                                        loses: ["Its place on the board", "Starting again on its own, until you put it back"],
                                        keeps: ["Its folder, on this computer", "Its instructions", "Everything it has written"]))
        switch ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_INFO"] { case "ai": part = .ai; case "files": part = .files; default: break }
        // kosmos#8626: KOSMOS_SAMPLE_SWITCH=openai (or google, xai) opens AI Settings with that provider picked, for the
        // store screen that shows a switch.
        if let s = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SWITCH"].flatMap(Board.SwitchProvider.init(rawValue:)) {
            part = .ai
            switchTo = s
            pickedProvider()
        }
    }
    #endif
}
