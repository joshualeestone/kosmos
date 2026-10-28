import SwiftUI

// kosmos#7488: + on Agents opens this full-height sheet, Mona Lisa's phone design of the desktop's New Agent (#4554):
// What would you like to create? -> What should this agent do? -> Set up your agent -> Making it -> Say hello. Cancel is
// top left on the first screen, Back on the others, and each screen's one action is a full-width button pinned at the
// bottom. The lists come from the board (NewAgent.rolesRequest); the request is the desktop's (NewAgent.createRequest).
// Team is native too (NewTeam): a ready-made team, its project and model, then each member made, the lead first.
struct NewAgentView: View {
    @ObservedObject var client: BoardClient
    let opened: (_ session: String, _ shownAs: String) -> Void   // Say hello: the new agent's chat (a team's lead)
    // The projects a new agent was put on, told by the app once the board sees it, so leaving this sheet early loses none.
    let tell: (_ session: String, _ projects: [String]) -> Void
    @Environment(\.dismiss) private var dismiss

    enum Step: Hashable { case role, otherRoles, setup, made, team, teamMade }
    @State private var path: [Step] = []
    @State private var draft = NewAgent.Draft()
    @State private var catalogue: NewAgent.Catalogue?
    @State private var loading = false
    @State private var loadFailed = false
    @State private var sending = false
    @State private var message: String?
    @State private var made: (session: String, shownAs: String)?
    @State private var seen = false
    @State private var timedOut = false          // 30 s and the board still cannot see it (the desktop's "has not come up")
    @State private var lastLabel = ""     // the role title the Role field was last filled with (still untouched if equal)
    // The Team path (NewTeam).
    @State private var teams: [NewTeam.Team]?
    @State private var teamsFailed = false
    @State private var teamKey: String?
    @State private var detail: NewTeam.Detail?
    @State private var detailFailed = false
    @State private var names: [String: String] = [:]
    @State private var projects: [Board.ProjectRow] = []
    @State private var projectChoice: NewTeam.ProjectChoice = .new
    @State private var newProjectName = ""
    @State private var madeProject: String?      // the project this team's run made, kept for a Try again
    @State private var teamStarted = false       // the desktop's TC.started: the names were checked and making began
    @State private var states: [String: NewTeam.State] = [:]
    @State private var teamRunning = false
    @State private var teamMessage: String?
    @State private var maybeMade: [String: String] = [:]   // slot: the session a create with no answer may have made
    @State private var loadingTeams = false
    @State private var teamTask: Task<Void, Never>?   // the run, ended if the sheet goes (a tab change can take it)
    @State private var teamProject: String?            // the project this run's members go on, for a member adopted later

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
                    case .team: teamScreen
                    case .teamMade: teamMadeScreen
                    }
                }
        }
        .interactiveDismissDisabled(sending || (made != nil && !seen && !timedOut) || teamRunning)
        .onChange(of: client.agents) { rows in agentsChanged(rows) }
        .onDisappear { teamTask?.cancel() }
        .task {
            #if DEBUG
            if showSample() { return }
            #endif
            await loadCatalogue()
        }
    }

    #if DEBUG
    // Design shots only: KOSMOS_SAMPLE_NEWAGENT=kind|role|own|setup|swarm|made|notup|team|teammade opens that screen on a sample catalogue,
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
        case "notup": draft.name = "Ada"; made = ("ada", "Ada"); timedOut = true; path = [.role, .setup, .made]
        case "team", "teammade":
            teams = NewTeam.parseTeams(Data(#"{"teams":[{"key":"marketing","label":"Marketing","blurb":"Plans and runs your campaigns","count":3},{"key":"support","label":"Customer Support","blurb":"Answers your customers","count":3}]}"#.utf8))
            detail = NewTeam.parseDetail(Data(#"{"team":{"key":"marketing","label":"Marketing","purpose":"A lead who plans the campaigns, and two who make them.","project":{"name":"Marketing"}},"members":[{"slot":"head","title":"Head of Marketing","name":"Maya","reportsTo":null},{"slot":"writer","title":"Copywriter","name":"Wes","reportsTo":"lead"},{"slot":"social","title":"Social Media Manager","name":"Sol","reportsTo":"lead"}]}"#.utf8))
            teamKey = "marketing"
            names = ["head": "Maya", "writer": "Wes", "social": "Sol"]
            newProjectName = "Marketing"
            if at == "teammade" {
                states = ["head": .made(session: "maya", shownAs: "Maya"), "writer": .making, "social": .waiting]
                path = [.team, .teamMade]
            } else { path = [.team] }
        default: break
        }
        return true
    }
    #endif

    // MARK: 1. What would you like to create?

    private var kinds: [NewAgent.Kind] { client.swarmsOn || catalogue?.swarms == true ? [.single, .team, .swarm] : [.single, .team] }

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
        if kind == .team {
            draft.kind = .single
            path = [.team]
            if teams == nil { Task { await loadTeams() } }
            return
        }
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
                    if let caution = NewAgent.caution(other, kind: draft.kind) {
                        Text(caution).font(.footnote).foregroundColor(Palette.askedWord)
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

    // MARK: 2b. Create a Team of Agents

    private var teamScreen: some View {
        Form {
            Section {
                Text(NewTeam.Words.hint).font(.subheadline).foregroundColor(Palette.secondary)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 4, trailing: 4))
            }
            Section(NewTeam.Words.pick) {
                if let teams {
                    if teams.isEmpty { Text(NewTeam.Words.none).foregroundColor(Palette.secondary) }
                    ForEach(teams) { t in
                        pickRow(title: t.label, line: t.blurb.isEmpty ? nil : t.blurb, picked: teamKey == t.key) {
                            guard !teamRunning, teamKey != t.key else { return }
                            teamKey = t.key
                            Task { await loadDetail(t.key) }
                        }
                    }
                } else if teamsFailed {
                    HStack { Text(NewTeam.Words.teamsUnread).foregroundColor(Palette.secondary); Spacer()
                        Button(NewTeam.Words.tryAgain) { Task { await loadTeams() } } }
                } else {
                    ProgressView()
                }
            }
            if let detail, detail.key == teamKey {
                Section {
                    if !detail.purpose.isEmpty { Text(detail.purpose).font(.footnote).foregroundColor(Palette.secondary) }
                    if let caution = detail.caution { Text(caution).font(.footnote).foregroundColor(Palette.askedWord) }
                    ForEach(detail.members) { m in
                        VStack(alignment: .leading, spacing: 4) {
                            nameField(m).disabled(teamLocked)
                            Text(NewTeam.Words.reportsTo(m.title, m.isLead ? NewAgent.Words.you : leadName(detail)))
                                .font(.footnote).foregroundColor(Palette.secondary)
                        }
                    }
                } header: { Text(detail.label) }
                Section(NewTeam.Words.project) {
                    Picker(NewTeam.Words.project, selection: $projectChoice) {
                        Text(NewTeam.Words.newProject(newProjectName)).tag(NewTeam.ProjectChoice.new)
                        Text(NewTeam.Words.noProject).tag(NewTeam.ProjectChoice.none)
                        ForEach(projects.filter { !$0.archived }) { p in Text(p.name).tag(NewTeam.ProjectChoice.existing(p.id)) }
                    }
                    .labelsHidden()
                    .disabled(teamLocked)
                }
                if let models = catalogue?.models, !models.isEmpty {
                    Section {
                        Picker(NewAgent.Words.model, selection: $draft.model) {
                            ForEach(models) { m in Text(m.label).tag(m.key) }
                        }
                        .disabled(teamLocked)
                    } header: { Text(NewAgent.Words.model + " " + NewTeam.Words.modelSoft) }
                }
            } else if teamKey != nil {
                Section {
                    if detailFailed {
                        HStack { Text(NewTeam.Words.teamsUnread).foregroundColor(Palette.secondary); Spacer()
                            Button(NewTeam.Words.tryAgain) { if let k = teamKey { Task { await loadDetail(k) } } } }
                    } else { ProgressView() }
                }
            }
            if let teamMessage {
                Section { Text(teamMessage).foregroundColor(Palette.dangerWord) }
            }
        }
        .navigationTitle(NewTeam.Words.title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(teamRunning)
        .safeAreaInset(edge: .bottom) {
            let n = detail?.members.count ?? 0
            let named = detail.map { $0.key == teamKey && $0.members.allSatisfy { !NewProject.trimmed(names[$0.slot] ?? "").isEmpty } } ?? false
            pinned(NewTeam.Words.create(max(n, 1)), enabled: !teamRunning && n > 0 && named, busy: teamRunning) {
                runTeam()
            }
        }
    }

    private func loadTeams() async {
        guard !loadingTeams else { return }
        loadingTeams = true
        defer { loadingTeams = false }
        teamsFailed = false
        let got = await client.throughMac { NewTeam.teamsRequest(mac: $0) }
        if let got, (200...299).contains(got.1.statusCode), let list = NewTeam.parseTeams(got.0) { teams = list } else { teamsFailed = true }
        // The project menu's existing projects, and the names a new one must not take. A team opened before they
        // arrived has its new project's name worked out again.
        let pj = await client.throughMac { Board.projectsRequest(mac: $0) }
        if let pj, (200...299).contains(pj.1.statusCode), let list = Board.parseProjects(pj.0) {
            projects = list.projects
            if let detail, !teamStarted, madeProject == nil { newProjectName = NewTeam.newProjectName(detail, taken: projects.map(\.name)) }
        }
    }

    // The desktop locks the team's choices from the click on (its review 27); a member that failed is renamed on the
    // Made screen instead.
    private var teamLocked: Bool { teamRunning || teamStarted }

    private func nameField(_ m: NewTeam.Member) -> some View {
        TextField(m.title, text: Binding(get: { names[m.slot] ?? "" }, set: { names[m.slot] = $0 }))
            .textInputAutocapitalization(.words)
            .accessibilityLabel(m.title + ", " + NewAgent.Words.name)
    }

    private func leadName(_ d: NewTeam.Detail) -> String {
        guard let lead = d.members.first(where: \.isLead) else { return "" }
        let typed = NewProject.trimmed(names[lead.slot] ?? "")
        return typed.isEmpty ? lead.title : typed
    }

    private func loadDetail(_ key: String) async {
        detailFailed = false
        detail = nil
        teamMessage = nil
        let got = await client.throughMac { NewTeam.detailRequest(mac: $0, key: key) }
        guard teamKey == key else { return }   // another team picked meanwhile
        if let got, (200...299).contains(got.1.statusCode), let d = NewTeam.parseDetail(got.0) {
            detail = d
            names = Dictionary(d.members.map { ($0.slot, $0.name) }, uniquingKeysWith: { first, _ in first })
            newProjectName = NewTeam.newProjectName(d, taken: projects.map(\.name))
            projectChoice = .new
            madeProject = nil
            teamStarted = false
            states = [:]
        } else {
            detailFailed = true
        }
    }

    // The desktop's tcMake: names checked with nothing made, then the project, then the members, the lead first.
    private func makeTeam() async {
        guard !teamRunning, let d = detail else { return }
        teamRunning = true
        teamMessage = nil
        defer { teamRunning = false }
        let epoch = client.chatEpoch
        let typed = names.mapValues { NewProject.trimmed($0) }
        let model = draft.model
        // 1. The names, checked against this computer, before anything is made. Only before: on Try again the members
        // already made hold their own names, which the check would refuse (the desktop's tcRunOnce reads without it).
        if !teamStarted {
            let check = await client.throughMac { NewTeam.specsRequest(mac: $0, key: d.key, names: typed, project: nil, model: model, check: true) }
            guard epoch == client.chatEpoch else { return }
            switch NewTeam.specsAnswer(status: check?.1.statusCode ?? 0, body: check?.0) {
            case .refused(let why): say(why); return
            case .unknown: say(NewAgent.unsureWords); return
            case .specs: break
            }
        }
        // 2. The project.
        var project: String?
        switch projectChoice {
        case .none: project = nil
        case .existing(let id): project = id
        case .new:
            if let made = madeProject { project = made; break }
            // The free name, then the next ones while the board answers folder_taken (the desktop's tc-go retry).
            let candidates = NewTeam.projectNames(d, taken: projects.map(\.name), count: NewTeam.projectNameTries + 1)
            for (i, want) in candidates.enumerated() {
                let draftProject = NewProject.Draft(name: want, description: d.projectGoal ?? "")
                var built = false
                let got = await client.throughMac { mac -> URLRequest? in let r = NewProject.request(mac: mac, draft: draftProject); built = r != nil; return r }
                guard epoch == client.chatEpoch else { return }
                if NewTeam.folderTaken(got?.0), i + 1 < candidates.count { continue }
                switch NewProject.result(sent: built, status: got?.1.statusCode ?? 0, body: got?.0) {
                case .made(let id): project = id; madeProject = id; newProjectName = want
                case .refused(let why): say(NewTeam.sentence(why)); return
                case .unknown: say(NewProject.unsureWords); return
                }
                break
            }
        }
        // 3. The members, with the project, the lead first; the rest only once it is made.
        let read = await client.throughMac { NewTeam.specsRequest(mac: $0, key: d.key, names: typed, project: project, model: model, check: false) }
        guard epoch == client.chatEpoch else { return }
        let specs: [NewTeam.Spec]
        switch NewTeam.specsAnswer(status: read?.1.statusCode ?? 0, body: read?.0) {
        case .specs(let list): specs = list
        case .refused(let why): say(why); return   // this read makes nothing, so a refusal is only that
        case .unknown: say(NewAgent.unsureWords); return
        }
        teamProject = project
        for s in specs where states[s.slot].map({ if case .made = $0 { return false } else { return true } }) ?? true { states[s.slot] = .waiting }
        if path.last != .teamMade { path.append(.teamMade) }
        teamStarted = true
        let lead = d.members.first?.slot
        for s in specs {
            if Task.isCancelled { return }   // the sheet went: nothing more is made that nobody can see
            if case .made = states[s.slot] { continue }
            if s.slot != lead, let lead, !isMade(lead) { states[s.slot] = .afterLead; continue }
            // A create whose answer was lost may have landed: once that agent is on the board, it is this member (the
            // desktop's maybeMade, checked against the board's list).
            if maybeMade[s.slot] == s.session, client.agents.contains(where: { $0.session == s.session }) {
                states[s.slot] = .made(session: s.session, shownAs: s.name)
                maybeMade[s.slot] = nil
                tellLater(s.session, teamProject.map { [$0] } ?? [])
                continue
            }
            states[s.slot] = .making
            var built = false
            let got = await client.throughMac { mac -> URLRequest? in built = true; return NewTeam.memberRequest(mac: mac, spec: s) }
            guard epoch == client.chatEpoch else { return }
            switch NewAgent.result(sent: built, status: got?.1.statusCode ?? 0, body: got?.0) {
            case .made(let session, let shown):
                states[s.slot] = .made(session: session, shownAs: shown)
                maybeMade[s.slot] = nil
                tellLater(session, NewAgent.addedProjects(got?.0))
                announce(shown + ": " + NewTeam.Words.made)
            case .refused(let why):
                states[s.slot] = .failed(NewTeam.sentence(why))
                announce(s.name + ": " + NewTeam.sentence(why))
            case .unknown:
                maybeMade[s.slot] = s.session   // sent, and no answer: it may be on the board soon
                states[s.slot] = .failed(NewAgent.unsureWords)
                announce(s.name + ": " + NewAgent.unsureWords)
            }
        }
    }

    // The board's list moved: take a lost create that turned up as made, and mark a single agent seen.
    private func agentsChanged(_ rows: [Board.Agent]) {
        let on = Set(rows.map(\.session))
        for (slot, session) in maybeMade where on.contains(session) {
            if case .failed = states[slot] {
                states[slot] = .made(session: session, shownAs: NewProject.trimmed(names[slot] ?? session))
                tellLater(session, teamProject.map { [$0] } ?? [])
            }
            maybeMade[slot] = nil
        }
        if let made, !seen, on.contains(made.session) { seen = true }
        if !draft.reportsTo.isEmpty, !on.contains(draft.reportsTo) { draft.reportsTo = "" }   // a manager no longer listed
    }

    private func tellLater(_ session: String, _ projects: [String]) {
        if !projects.isEmpty { tell(session, projects) }
    }

    private func announce(_ words: String) { UIAccessibility.post(notification: .announcement, argument: words) }

    private func runTeam() {
        guard !teamRunning else { return }
        teamTask = Task { await makeTeam() }
    }

    private func isMade(_ slot: String) -> Bool { if case .made = states[slot] { return true }; return false }

    private func say(_ why: String) {
        teamMessage = why
        UIAccessibility.post(notification: .announcement, argument: why)
    }

    // The members as they are made; Try again makes the ones not made yet; the lead's chat once it is made.
    private var teamMadeScreen: some View {
        let members = detail?.members ?? []
        let allMade = !members.isEmpty && members.allSatisfy { isMade($0.slot) }
        return List {
            Section {
                ForEach(members) { m in
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            if renamable(m) {
                                nameField(m)   // the desktop lets a failed row be renamed before Try again
                            } else {
                                Text(NewProject.trimmed(names[m.slot] ?? m.name)).foregroundColor(Palette.primary)
                            }
                            Text(m.title).font(.footnote).foregroundColor(Palette.secondary)
                            if case .failed(let why) = states[m.slot] { Text(why).font(.footnote).foregroundColor(Palette.dangerWord) }
                            if states[m.slot] == .afterLead { Text(NewTeam.Words.afterLead).font(.footnote).foregroundColor(Palette.secondary) }
                        }
                        Spacer(minLength: 8)
                        switch states[m.slot] ?? .waiting {
                        case .making: ProgressView().accessibilityLabel(NewTeam.Words.making)
                        case .made: Image(systemName: "checkmark").foregroundColor(Palette.ringOk).accessibilityLabel(NewTeam.Words.made)
                        case .failed: Image(systemName: "exclamationmark.circle").foregroundColor(Palette.dangerWord).accessibilityHidden(true)
                        default: Text(NewTeam.Words.waiting).font(.footnote).foregroundColor(Palette.secondary)
                        }
                    }
                    // A row with a name field keeps it reachable: combined, VoiceOver could not edit it.
                    .accessibilityElement(children: renamable(m) ? .contain : .combine)
                }
            } header: { Text(detail.map { NewAgent.Words.makingNamed($0.label) } ?? NewAgent.Words.making) }
            if let teamMessage { Section { Text(teamMessage).foregroundColor(Palette.dangerWord) } }
        }
        .navigationTitle(NewTeam.Words.title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .safeAreaInset(edge: .bottom) {
            if allMade, let lead = members.first, case .made(let session, let shown) = states[lead.slot] {
                pinned(NewTeam.Words.goTo(members.count), enabled: true) { dismiss(); opened(session, shown) }
            } else if !teamRunning {
                pinned(NewTeam.Words.tryAgain, enabled: members.allSatisfy { isMade($0.slot) || !NewProject.trimmed(names[$0.slot] ?? "").isEmpty }) { runTeam() }
            }
        }
        .toolbar {
            // A way out when the rest is not wanted: the members made stay made.
            if !teamRunning && !allMade { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    // Not a row whose create may have landed: a new name would make a second agent for it.
    private func renamable(_ m: NewTeam.Member) -> Bool {
        if case .failed = states[m.slot] { return !teamRunning && maybeMade[m.slot] == nil }
        return false
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
                    ForEach(client.agents.filter { !$0.isGuide }) { a in Text(a.name).tag(a.session) }   // as the desktop's menu
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
            timedOut = false
            path.append(.made)
            tellLater(session, NewAgent.addedProjects(got?.0))
        case .refused(let why):
            message = NewTeam.sentence(why)
            UIAccessibility.post(notification: .announcement, argument: NewTeam.sentence(why))
        case .unknown:
            message = NewAgent.unsureWords
            UIAccessibility.post(notification: .announcement, argument: NewAgent.unsureWords)
        }
    }

    // MARK: 4. Making it, then Say hello

    // The desktop's watch: Say hello once the board sees the agent (the phone's list is the board's, read every 5 s);
    // after 30 s unseen, its "has not come up" words and no hello. The list keeps being watched after that.
    private var madeScreen: some View {
        let shown = made?.shownAs ?? ""
        return VStack(spacing: 16) {
            Spacer()
            if seen {
                Text(NewAgent.Words.running(shown)).font(.title3.weight(.semibold)).foregroundColor(Palette.primary)
                Text(NewAgent.Words.hello).font(.body).foregroundColor(Palette.primary)
            } else if timedOut {
                Text(NewAgent.Words.notUp(shown)).font(.title3.weight(.semibold)).foregroundColor(Palette.primary)
                Text(NewAgent.Words.notUpWhy + " " + NewAgent.Words.notUpNext).font(.body).foregroundColor(Palette.secondary)
            } else {
                ProgressView().controlSize(.large)
                Text(NewAgent.Words.makingNamed(shown)).font(.title3.weight(.semibold)).foregroundColor(Palette.primary)
            }
            Spacer()
        }
        .multilineTextAlignment(.center)
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Palette.ground.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .onChange(of: seen) { now in if now { announce(NewAgent.Words.running(shown)) } }
        .onChange(of: timedOut) { now in if now && !seen { announce(NewAgent.Words.notUp(shown)) } }
        .task {
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            guard !Task.isCancelled else { return }
            timedOut = true
        }
        .safeAreaInset(edge: .bottom) {
            if seen, let made {
                pinned(NewAgent.Words.sayHello(made.shownAs), enabled: true) {
                    dismiss()
                    opened(made.session, made.shownAs)
                }
            } else if timedOut {
                pinned(NewAgent.Words.done, enabled: true) { dismiss() }
            }
        }
    }

    // MARK: pieces

    private var loadingRow: some View {
        HStack {
            if loadFailed {
                Text(NewAgent.Words.rolesUnread).foregroundColor(Palette.secondary)
                Spacer()
                Button(NewTeam.Words.tryAgain) { Task { await loadCatalogue() } }.disabled(loading)
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
                // The label in the card colour, as the app's other prominent buttons (build 13 shots: unreadable in dark).
                Text(title).font(.headline).foregroundColor(Palette.card).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(Palette.card) }
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
