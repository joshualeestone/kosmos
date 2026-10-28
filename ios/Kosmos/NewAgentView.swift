import SwiftUI

// kosmos#7488: + on Agents opens this full-height sheet, Mona Lisa's phone design of the desktop's New Agent (#4554):
// What would you like to create? -> What should this agent do? -> Set up your agent -> Making it -> Say hello. Cancel is
// top left on the first screen, Back on the others, and each screen's one action is a full-width button pinned at the
// bottom. The lists come from the board (NewAgent.rolesRequest); the request is the desktop's (NewAgent.createRequest).
// Team opens the board's own Team screen until its native slice (the card's slice 2).
struct NewAgentView: View {
    @ObservedObject var client: BoardClient
    let opened: (_ session: String, _ shownAs: String) -> Void   // Say hello: the new agent's chat
    let openTeam: () -> Void
    @Environment(\.dismiss) private var dismiss

    enum Step: Hashable { case role, otherRoles, setup, made }
    @State private var path: [Step] = []
    @State private var draft = NewAgent.Draft()
    @State private var catalogue: NewAgent.Catalogue?
    @State private var loading = false
    @State private var loadFailed = false
    @State private var sending = false
    @State private var message: String?
    @State private var made: (session: String, shownAs: String)?
    @State private var seen = false
    @State private var lastLabel = ""     // the role title the Role field was last filled with (still untouched if equal)

    var body: some View {
        NavigationStack(path: $path) {
            kindScreen
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
                .navigationDestination(for: Step.self) { step in
                    switch step {
                    case .role: roleScreen
                    case .otherRoles: otherRolesScreen
                    case .setup: setupScreen
                    case .made: madeScreen
                    }
                }
        }
        .interactiveDismissDisabled(sending || (made != nil && !seen))
        .task {
            #if DEBUG
            if showSample() { return }
            #endif
            await loadCatalogue()
        }
    }

    #if DEBUG
    // Design shots only: KOSMOS_SAMPLE_NEWAGENT=kind|role|own|setup|swarm|made opens that screen on a sample catalogue,
    // since a simulator run has no board to read the roles from.
    private func showSample() -> Bool {
        guard let at = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NEWAGENT"], !at.isEmpty else { return false }
        let json = #"""
        {"models":[{"key":"opus","provider":"anthropic","label":"Claude Opus","default":false},{"key":"sonnet","provider":"anthropic","label":"Claude Sonnet","default":true}],
         "own":{"key":"own","instructions":"You are **{{NAME}}**, an assistant.\n\nYou take on what they hand you and work it through to something they can use."},
         "roles":[{"key":"pm","label":"Project Manager","blurb":"Breaks down work, assigns tasks, and briefs your other agents","group":"Running the work"},
                  {"key":"writer","label":"Writer","blurb":"Drafts posts, pages and emails","group":"Words"},
                  {"key":"editor","label":"Editor","blurb":"Tightens and checks what others wrote","group":"Words"},
                  {"key":"researcher","label":"Researcher","blurb":"Finds and sums up what is known","group":"Finding things out"}]}
        """#
        guard let c = NewAgent.parseCatalogue(Data(json.utf8), swarms: true) else { return false }
        catalogue = c
        draft.model = c.defaultModel?.key ?? ""
        switch at {
        case "role": draft.roleKey = "pm"; path = [.role]
        case "own": draft.roleKey = "own"; draft.ownWords = NewAgent.ownExample(c); path = [.role]
        case "setup": draft.roleKey = "pm"; draft.name = "Ada"; draft.label = "Project Manager"; lastLabel = draft.label; path = [.role, .setup]
        case "swarm": draft.kind = .swarm; draft.roleKey = "researcher"; draft.name = "Hive"; draft.label = "Researcher"; lastLabel = draft.label; path = [.role, .setup]
        case "made": draft.name = "Ada"; made = ("ada", "Ada"); seen = true; path = [.role, .setup, .made]
        default: break
        }
        return true
    }
    #endif

    // MARK: 1. What would you like to create?

    private var kinds: [NewAgent.Kind] { client.swarmsOn ? [.single, .team, .swarm] : [.single, .team] }

    private var kindScreen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(NewAgent.Words.kindTitle).font(.title2.weight(.semibold)).foregroundColor(Palette.primary)
                    .padding(.bottom, 4).accessibilityAddTraits(.isHeader)
                ForEach(kinds) { kind in
                    Button { choose(kind) } label: { KindCard(kind: kind) }
                        .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(Palette.ground.ignoresSafeArea())
    }

    private func choose(_ kind: NewAgent.Kind) {
        if kind == .team { dismiss(); openTeam(); return }
        if draft.kind != kind {
            draft.kind = kind
            // Josh: a recommended Project Manager makes no sense for a swarm, so a swarm starts with nothing picked.
            if kind == .swarm, draft.roleKey == catalogue?.recommended?.key { draft.roleKey = nil }
        }
        if draft.roleKey == nil, kind == .single { draft.roleKey = catalogue?.recommended?.key }
        path = [.role]
    }

    // MARK: 2. What should this agent do?

    private var roleScreen: some View {
        List {
            Section {
                Text(NewAgent.Words.roleHint).font(.subheadline).foregroundColor(Palette.secondary)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 4, trailing: 4))
            }
            if let c = catalogue {
                Section {
                    if draft.kind != .swarm, let rec = c.recommended {
                        pickRow(title: rec.label, line: nil, picked: draft.roleKey == rec.key) { draft.roleKey = rec.key }
                    }
                    let other = otherPicked(c)
                    NavigationLink(value: Step.otherRoles) {
                        pickLabel(title: NewAgent.Words.pickAnother, line: other?.label, picked: other != nil)
                    }
                    if c.own != nil {
                        pickRow(title: NewAgent.Words.ownName, line: NewAgent.Words.ownLine, picked: draft.roleKey == "own") {
                            draft.roleKey = "own"
                            if NewProject.trimmed(draft.ownWords).isEmpty { draft.ownWords = NewAgent.ownExample(c) }
                        }
                        if draft.roleKey == "own" {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(NewAgent.Words.ownFull).font(.footnote).foregroundColor(Palette.secondary)
                                TextEditor(text: $draft.ownWords)
                                    .frame(minHeight: 160)
                                    .accessibilityLabel(NewAgent.Words.ownLine)
                            }
                        }
                    }
                }
            } else {
                Section { loadingRow }
            }
        }
        .navigationTitle(NewAgent.Words.roleTitle)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            pinned(NewAgent.Words.continueWord, enabled: catalogue.map { NewAgent.canContinueRole(draft, $0) } ?? false) {
                fillLabel()
                path.append(.setup)
            }
        }
    }

    private func otherPicked(_ c: NewAgent.Catalogue) -> NewAgent.Role? {
        guard let key = draft.roleKey, key != "own" else { return nil }
        if draft.kind != .swarm, key == c.recommended?.key { return nil }
        return c.role(key)
    }

    // The Role field starts as the picked role's title, and follows a new pick until the person has typed their own.
    private func fillLabel() {
        guard let c = catalogue, let role = c.role(draft.roleKey) else { return }
        let title = role.key == "own" ? "" : role.label
        if draft.label.isEmpty || draft.label == lastLabel { draft.label = title; lastLabel = title }
    }

    private var otherRolesScreen: some View {
        List {
            if let c = catalogue {
                ForEach(c.groups, id: \.name) { group in
                    Section(group.name) {
                        ForEach(group.roles.filter { draft.kind == .swarm || $0.key != c.recommended?.key }) { role in
                            pickRow(title: role.label, line: role.blurb.isEmpty ? nil : role.blurb, picked: draft.roleKey == role.key) {
                                draft.roleKey = role.key
                                path.removeLast()
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(NewAgent.Words.pickAnother)
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: 3. Set up your agent

    private var setupScreen: some View {
        Form {
            Section {
                TextField(NewAgent.Words.name, text: $draft.name)
                    .textInputAutocapitalization(.words)
                    .accessibilityLabel(NewAgent.Words.name)
            } header: { Text(NewAgent.Words.name) }
            Section {
                TextField(NewAgent.Words.role, text: $draft.label)
                    .accessibilityLabel(NewAgent.Words.role)
            } header: { Text(NewAgent.Words.role) }
            Section {
                Picker(NewAgent.Words.reportsTo, selection: $draft.reportsTo) {
                    Text(NewAgent.Words.you).tag("")
                    ForEach(client.agents) { a in Text(a.name).tag(a.session) }
                }
            }
            if let models = catalogue?.models, !models.isEmpty {
                Section {
                    Picker(NewAgent.Words.model, selection: $draft.model) {
                        ForEach(models) { m in Text(m.label).tag(m.key) }
                    }
                } header: { Text(NewAgent.Words.model + " " + NewAgent.Words.modelSoft) }
            }
            if draft.kind == .swarm { swarmSection }
            if let message {
                Section { Text(message).foregroundColor(Palette.dangerWord) }
            }
        }
        .navigationTitle(NewAgent.Words.setupTitle)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(sending)
        .onAppear { if draft.model.isEmpty { draft.model = catalogue?.defaultModel?.key ?? "" } }
        .safeAreaInset(edge: .bottom) {
            pinned(NewAgent.Words.create, enabled: !sending && (catalogue.map { NewAgent.canCreate(draft, $0) } ?? false), busy: sending) {
                Task { await create() }
            }
        }
    }

    private var swarmSection: some View {
        Group {
            Section {
                Stepper(value: $draft.maxHelpers, in: NewAgent.helpersRange) {
                    HStack { Text(NewAgent.Words.maxHelpers); Spacer(); Text("\(draft.maxHelpers)").foregroundColor(Palette.secondary) }
                }
                .accessibilityValue("\(draft.maxHelpers) helpers at most")
                Text(NewAgent.Words.swarmExplain(draft.maxHelpers)).font(.footnote).foregroundColor(Palette.secondary)
                Text(NewAgent.Words.swarmWarn(draft.maxHelpers)).font(.footnote).foregroundColor(Palette.askedWord)
            }
            Section {
                Text(NewAgent.Words.dailyLimit)
                Slider(value: Binding(get: { Double(draft.capMillions) }, set: { draft.capMillions = Int($0.rounded()) }),
                       in: Double(NewAgent.capRange.lowerBound)...Double(NewAgent.capRange.upperBound), step: 1)
                    .accessibilityLabel(NewAgent.Words.dailyLimit)
                    .accessibilityValue(NewAgent.capWords(draft.capMillions))
                Text(NewAgent.capWords(draft.capMillions)).foregroundColor(Palette.secondary)
            } footer: { Text(NewAgent.Words.pauses) }
        }
    }

    private func create() async {
        guard !sending, let c = catalogue, NewAgent.canCreate(draft, c) else { return }
        sending = true
        message = nil
        let sent = draft
        let epoch = client.chatEpoch   // another account or Mac meanwhile: the answer is not this sheet's
        var built = false
        let got = await client.throughMac { mac in
            let r = NewAgent.createRequest(mac: mac, draft: sent, catalogue: c)
            built = r != nil
            return r
        }
        sending = false
        guard epoch == client.chatEpoch else { return }
        switch NewAgent.result(sent: built, status: got?.1.statusCode ?? 0, body: got?.0) {
        case .made(let session, let shown):
            made = (session, shown)
            seen = client.agents.contains { $0.session == session }
            path.append(.made)
        case .refused(let why):
            message = why
            UIAccessibility.post(notification: .announcement, argument: why)
        case .unknown:
            message = NewAgent.unsureWords
            UIAccessibility.post(notification: .announcement, argument: NewAgent.unsureWords)
        }
    }

    // MARK: 4. Making it, then Say hello

    // The desktop shows Say hello once the board sees the agent; the phone's list is the board's (read every 5 s), so
    // it waits for the row, and after 30 s offers hello anyway (the agent was made; the chat follows when it appears).
    private var madeScreen: some View {
        VStack(spacing: 20) {
            Spacer()
            if seen, let made {
                Text(NewAgent.Words.hello).font(.body).multilineTextAlignment(.center).foregroundColor(Palette.primary)
            } else {
                ProgressView().controlSize(.large)
                Text(NewAgent.Words.makingNamed(made?.shownAs ?? "")).font(.title3.weight(.semibold)).foregroundColor(Palette.primary)
            }
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Palette.ground.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .onChange(of: client.agents) { rows in if let made, rows.contains(where: { $0.session == made.session }) { seen = true } }
        .task {
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            seen = true
        }
        .safeAreaInset(edge: .bottom) {
            if seen, let made {
                pinned(NewAgent.Words.sayHello(made.shownAs), enabled: true) {
                    dismiss()
                    opened(made.session, made.shownAs)
                }
            }
        }
    }

    // MARK: pieces

    private var loadingRow: some View {
        HStack {
            if loadFailed {
                Text(NewAgent.Words.rolesUnread).foregroundColor(Palette.secondary)
                Spacer()
                Button("Try again") { Task { await loadCatalogue() } }.disabled(loading)
            } else {
                ProgressView()
            }
        }
    }

    private func loadCatalogue() async {
        guard !loading else { return }
        loading = true
        loadFailed = false
        let got = await client.throughMac { NewAgent.rolesRequest(mac: $0) }
        loading = false
        if let got, (200...299).contains(got.1.statusCode), let c = NewAgent.parseCatalogue(got.0, swarms: client.swarmsOn) {
            catalogue = c
            if draft.kind == .single, draft.roleKey == nil { draft.roleKey = c.recommended?.key }
            if draft.model.isEmpty { draft.model = c.defaultModel?.key ?? "" }
        } else {
            loadFailed = true
        }
    }

    private func pickRow(title: String, line: String?, picked: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { pickLabel(title: title, line: line, picked: picked) }
            .buttonStyle(.plain)
            .accessibilityAddTraits(picked ? [.isSelected] : [])
    }

    private func pickLabel(title: String, line: String?, picked: Bool) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundColor(Palette.primary)
                if let line { Text(line).font(.footnote).foregroundColor(Palette.secondary) }
            }
            Spacer(minLength: 8)
            if picked { Image(systemName: "checkmark").foregroundColor(Palette.built).accessibilityHidden(true) }
        }
        .contentShape(Rectangle())
    }

    private func pinned(_ title: String, enabled: Bool, busy: Bool = false, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                Text(title).font(.headline).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(.white) }
            }
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.borderedProminent)
        .disabled(!enabled)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

// One of the first screen's three cards: the desktop's line art (its 278 x 90 drawing, nak-art), title and line,
// stacked full width.
private struct KindCard: View {
    let kind: NewAgent.Kind

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            KindArt(kind: kind).frame(height: 54).frame(maxWidth: .infinity)
            Text(NewAgent.Words.kindName(kind)).font(.headline).foregroundColor(Palette.primary)
            Text(NewAgent.Words.kindLine(kind)).font(.subheadline).foregroundColor(Palette.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.card))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.separator))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

private struct KindArt: View {
    let kind: NewAgent.Kind

    var body: some View {
        Canvas { ctx, size in
            let s = min(size.width / 278, size.height / 90)
            ctx.translateBy(x: (size.width - 278 * s) / 2, y: (size.height - 90 * s) / 2)
            ctx.scaleBy(x: s, y: s)
            func dot(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path { Path(ellipseIn: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
            let line = StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
            switch kind {
            case .single:
                ctx.stroke(dot(139, 45, 30), with: .color(Palette.secondary), style: line)
                ctx.fill(dot(139, 45, 13), with: .color(Palette.starGold))
            case .team:
                var p = Path()
                p.move(to: CGPoint(x: 139, y: 26)); p.addLine(to: CGPoint(x: 139, y: 45))
                p.move(to: CGPoint(x: 76, y: 45)); p.addLine(to: CGPoint(x: 202, y: 45))
                for x: CGFloat in [76, 118, 160, 202] { p.move(to: CGPoint(x: x, y: 45)); p.addLine(to: CGPoint(x: x, y: 62)) }
                ctx.stroke(p, with: .color(Palette.secondary), style: line)
                ctx.fill(dot(139, 17, 11), with: .color(Palette.starGold))
                for x: CGFloat in [76, 118, 160, 202] { ctx.fill(dot(x, 72, 9), with: .color(Palette.starGold)) }
            case .swarm:
                ctx.stroke(dot(139, 45, 38), with: .color(Palette.secondary), style: line)
                for (x, y, r) in [(139, 45, 11), (113, 30, 8), (166, 30, 8), (110, 60, 8), (168, 60, 8), (139, 17, 6), (139, 73, 6)] as [(CGFloat, CGFloat, CGFloat)] {
                    ctx.fill(dot(x, y, r), with: .color(Palette.starGold))
                }
            }
        }
        .accessibilityHidden(true)
    }
}
