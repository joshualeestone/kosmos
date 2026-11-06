import SwiftUI

// kosmos#7838 (Josh, 11-03 04:15: "We need to do the project info screens"): a project's own page, opened by its
// room's info button, in place of the web board in a sheet. The agent page's shape (AgentInfoView): a header, then a
// segmented control. About shows what the project is for, its members with what they do here, and its open tasks;
// Files is the room's Files (FilesView, kosmos#7679). Settings (rename, notifications, pause) comes next (#7838 slice B);
// until then one row opens the board for them. Words and choices are in BoardRoom.swift (tested).
struct ProjectInfoView: View {
    @ObservedObject var client: BoardClient
    let project: Board.ProjectRow
    let openOnBoard: () -> Void
    // A member's conversation, as the room builds it (RoomView), pushed on top of this page: Back returns here. Review 1:
    // closing this page and pushing the chat from the room in one update dropped the push (measured in the simulator).
    let chat: (Board.Agent) -> AnyView
    let openPage: (URL) -> Void
    // Slice B: read the projects list again after a save, so the page (and the room) show what was saved.
    let reload: () async -> Void
    // Review 2: the project's row as the store holds it NOW. A save runs in a Task holding a copy of this view made at
    // the tap, so after its re-read `project` is still the old row; anything decided after the await reads this.
    let live: () -> Board.ProjectRow?

    @State private var part: Board.ProjectPart = .about
    @State private var openTask: TaskPageRef?
    @State private var chatWith: Board.Agent?
    // Slice B, Settings: the boxes as typed, what they were filled with (Save compares against these, so a rename made
    // on the computer meanwhile is never undone by a description-only save), and the line under each save.
    @State private var nameText = ""
    @State private var descText = ""
    @State private var filledName = ""
    @State private var filledDesc = ""
    @State private var filled = false
    @State private var saving = false
    // Final review: which change is saving, so its own row (only) shows the spinner.
    @State private var savingKind: String?
    @State private var textLine: (text: String, ok: Bool)?
    @State private var notifyLine: (text: String, ok: Bool)?
    @State private var pauseLine: (text: String, ok: Bool)?
    // Review 1: what was just chosen, shown at once and until the board's stored value says the same (or the save fails),
    // so a tap never snaps back for a round trip, nor sits under "Saved." on the old value if the re-read misses.
    @State private var pendingNotify: String?
    @State private var pendingPaused: Bool?
    private var shownNotify: String { pendingNotify ?? project.notify }
    private var shownPaused: Bool { pendingPaused ?? project.paused }
    // Review 1: a read was asked for and came back with no list (the Mac not admitted, say): say so, not "Reading".
    @State private var tasksTried = false

    private var roles: [String: String] {
        Dictionary(client.agents.compactMap { a in a.role.map { (a.session, $0) } }, uniquingKeysWith: { a, _ in a })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            switch part {
            case .about: about
            case .settings: settings
            case .files: FilesView(client: client, owner: .project(project.id), openOnBoard: openOnBoard, titled: false)
            }
        }
        .background(Palette.ground)
        .navigationBarTitleDisplayMode(.inline)
        .kosmosSolidTopBar()
        .navigationTitle(project.name)
        .toolbar(.hidden, for: .tabBar)
        .background(
            NavigationLink(isActive: Binding(get: { openTask != nil }, set: { if !$0 { openTask = nil } })) {
                if let ref = openTask { TaskPageView(client: client, ref: ref, openPage: openPage) }
            } label: { EmptyView() }.hidden()
        )
        .background(
            NavigationLink(isActive: Binding(get: { chatWith != nil }, set: { if !$0 { chatWith = nil } })) {
                if let a = chatWith { chat(a) }
            } label: { EmptyView() }.hidden()
        )
    }

    // Paused when it is, and the segments. The name is the top bar's (said once, not twice).
    private var header: some View {
        VStack(spacing: 8) {
            if shownPaused {   // final review: as Settings shows it, at once
                Text("Paused").font(.subheadline).foregroundColor(Palette.secondary)
            }
            Picker("Section", selection: $part) {
                ForEach(Board.ProjectPart.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 4)
        .background(Palette.ground)   // the list scrolls under this pinned bar: it must not show through it
        .zIndex(1)
    }

    private var about: some View {
        List {
            Section {
                Text(Board.projectAbout(project))
                    .foregroundColor(project.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Palette.secondary : Palette.primary)
            } header: { label("What it is for") }

            Section {
                if project.members.isEmpty {
                    Text("No agents on this project yet.").foregroundColor(Palette.secondary)
                }
                ForEach(project.members, id: \.session) { m in memberRow(m) }
            } header: { label("Members") }

            tasksSection

            Section {
                Button(action: openOnBoard) {
                    HStack {
                        Text(Board.projectMoreOnBoard).foregroundColor(Palette.primary)
                        Spacer()
                        Image(systemName: "arrow.up.right").foregroundColor(Palette.secondary).accessibilityHidden(true)
                    }
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } footer: { Text(Board.projectMoreOnBoardWhy) }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await readTasks() }
        // Review 1: read again on every appearance, so a list from hours ago is never shown as this project's tasks.
        .task { await readTasks() }
    }

    // The agent page's section label (AgentInfoView.label), so the two pages read the same side by side (final review).
    private func label(_ s: String) -> some View { Text(s).font(.footnote.weight(.semibold)).foregroundColor(Palette.secondary).textCase(nil) }

    // MARK: Settings (slice B)

    private var textChanged: Bool {
        Board.projectChangeBody(.text(name: nameText, description: descText), shownName: filledName, shownDescription: filledDesc) != nil
    }

    private var settings: some View {
        List {
            Section {
                TextField("Name", text: $nameText).foregroundColor(Palette.primary)
                    .accessibilityLabel("Name")
            } header: { label("Name") } footer: {
                Text(nameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Board.projectNameNeeded : Board.projectRenameSafe)
            }
            Section {
                TextEditor(text: $descText).frame(minHeight: 96).foregroundColor(Palette.primary)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, -5)   // the editor's own inset, so its words line up with the name's
                    .accessibilityLabel("Description")
            } header: { label("Description") } footer: {
                Text(Board.projectDescriptionLimit + " " + Board.projectDescriptionWho)
            }
            if textChanged || textLine != nil {
                Section {
                    if textChanged {
                        Button { Task { await save(.text(name: nameText, description: descText)) } } label: {
                            HStack { Text("Save changes"); if savingKind == "text" { Spacer(); SweepDots(label: "Loading", scales: false, framesPerSecond: 15, stillWhenReduced: true) } }
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .disabled(saving)
                    }
                    if let textLine { Text(textLine.text).font(.footnote).foregroundColor(textLine.ok ? Palette.secondary : Palette.dangerWord) }
                }
            }
            Section {
                Picker("Notifications from this project", selection: Binding(get: { shownNotify }, set: { level in
                    guard level != shownNotify else { return }
                    pendingNotify = level
                    Task { await save(.notify(level)) }
                })) {
                    ForEach(Board.projectNotifyLevels, id: \.key) { Text($0.label).tag($0.key) }
                }
                .pickerStyle(.segmented)
                .disabled(saving)
                if let notifyLine { Text(notifyLine.text).font(.footnote).foregroundColor(notifyLine.ok ? Palette.secondary : Palette.dangerWord) }
            } header: { label("Notifications from this project") } footer: { Text(Board.projectNotifyHint(shownNotify)) }
            Section {
                Button { let to = !shownPaused; pendingPaused = to; Task { await save(.paused(to)) } } label: {
                    HStack {
                        Text(shownPaused ? "Resume it" : "Pause it").foregroundColor(Palette.primary)
                        if savingKind == "paused" { Spacer(); SweepDots(label: "Loading", scales: false, framesPerSecond: 15, stillWhenReduced: true) }
                    }
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .disabled(saving)
                if let pauseLine { Text(pauseLine.text).font(.footnote).foregroundColor(pauseLine.ok ? Palette.secondary : Palette.dangerWord) }
            } header: { label(shownPaused ? "This project is paused" : "Pause this project") } footer: {
                Text(shownPaused ? Board.projectPausedWhat(byPerson: pendingPaused == true || project.pausedByPerson) : Board.projectPauseWhat)
            }
            Section {
                Button(action: openOnBoard) {
                    HStack {
                        Text(Board.projectMoreOnBoard).foregroundColor(Palette.primary)
                        Spacer()
                        Image(systemName: "arrow.up.right").foregroundColor(Palette.secondary).accessibilityHidden(true)
                    }
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } footer: { Text(Board.projectSettingsOnBoardWhy) }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        // Review 1: on every appearance, not only the first (a rename on the computer while About was open), each box apart.
        .onAppear { refillIfUntouched(project) }
        .onChange(of: project.name) { _ in refillIfUntouched(project) }
        .onChange(of: project.description) { _ in refillIfUntouched(project) }
        // Review 2: a stored value that changes while no save is running always wins (a change on the computer), so a
        // choice can never stick on a value that is no longer stored; a result line from before goes with it.
        // Final review: a result line stays only while it still describes what is stored.
        .onChange(of: project.notify) { stored in
            if pendingNotify == stored { pendingNotify = nil }
            else if !saving { pendingNotify = nil; notifyLine = nil }
        }
        .onChange(of: project.paused) { stored in
            if pendingPaused == stored { pendingPaused = nil }
            else if !saving { pendingPaused = nil; pauseLine = nil }
        }
    }

    // A change made on the computer shows in a box unless the person has typed something of their own in that box; each
    // box on its own (review 1), so typing a description never pins an old name.
    private func refillIfUntouched(_ row: Board.ProjectRow) {
        if !filled { filled = true; nameText = row.name; filledName = row.name; descText = row.description; filledDesc = row.description; return }
        if nameText == filledName { nameText = row.name; filledName = row.name }
        if descText == filledDesc { descText = row.description; filledDesc = row.description }
    }

    private func save(_ change: Board.ProjectChange) async {
        guard let body = Board.projectChangeBody(change, shownName: filledName, shownDescription: filledDesc) else { return }
        saving = true
        switch change { case .text: savingKind = "text"; case .notify: savingKind = "notify"; case .paused: savingKind = "paused" }
        defer { saving = false; savingKind = nil }
        let id = project.id
        let res = await client.throughMac { Board.projectChangeRequest(mac: $0, project: id, body: body) }
        let line: (text: String, ok: Bool)
        switch Board.projectSaveResult(status: res?.1.statusCode ?? 0, body: res?.0) {
        case .saved(let storedNotify, let storedPaused):
            line = (Board.projectSavedLine(change), true)
            switch change {
            case .text:
                // Review 1: what was SENT is now saved; anything typed while it was in flight stays unsaved (Save shows).
                if let n = body["name"] as? String {
                    if nameText.trimmingCharacters(in: .whitespacesAndNewlines) == n { nameText = n }
                    filledName = n
                }
                if let d = body["description"] as? String {
                    if descText.trimmingCharacters(in: .whitespacesAndNewlines) == d { descText = d }
                    filledDesc = d
                }
            case .notify(let level): pendingNotify = storedNotify ?? level
            case .paused(let on): pendingPaused = storedPaused ?? on
            }
            await reload()
            // Review 2: the row the re-read left in the store, never this Task's copy of `project`. If the re-read did
            // not land, the boxes keep what was sent and the controls keep the saved choice (a 200 means it saved).
            if let now = live() {
                refillIfUntouched(now)
                if pendingNotify == now.notify { pendingNotify = nil }
                if pendingPaused == now.paused { pendingPaused = nil }
            }
        case .refused(let why):
            line = (why, false)
            if case .notify = change { pendingNotify = nil }
            if case .paused = change { pendingPaused = nil }
        case .noAnswer:
            line = (Board.projectNoAnswer, false)
            if case .notify = change { pendingNotify = nil }
            if case .paused = change { pendingPaused = nil }
        }
        switch change {
        case .text: textLine = line
        case .notify: notifyLine = line
        case .paused: pauseLine = line
        }
        UIAccessibility.post(notification: .announcement, argument: line.text)
    }

    private func readTasks() async {
        await client.refreshTasks()
        // Review 2: a read cut short (the segment switched away) has not answered, so it is not yet "cannot read".
        if !Task.isCancelled { tasksTried = true }
    }

    @ViewBuilder private func memberRow(_ m: Board.ProjectMember) -> some View {
        let line = Board.projectMemberLine(m, agentRole: roles[m.session])
        let agent = client.agents.first { $0.session == m.session }
        // Review 1: a member the agents list does not have yet opens the board, as the room's own member button does.
        Button { if let agent { chatWith = agent } else { openOnBoard() } } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.name).foregroundColor(Palette.primary)
                    if let line { Text(line).font(.footnote).foregroundColor(Palette.secondary) }
                }
                Spacer(minLength: 8)
                if m.needsYouHere != nil {
                    Text("Needs you").font(.footnote.weight(.semibold)).foregroundColor(Palette.dangerWord)
                }
            }
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(agent == nil ? "Opens your computer\u{2019}s board" : "Opens the conversation")
    }

    @ViewBuilder private var tasksSection: some View {
        let open = Board.projectOpenTasks(client.tasksList, project: project.id)
        Section {
            if let open, open.total == 0 {
                Text(Board.projectNoOpenTasks).foregroundColor(Palette.secondary)
            } else if let open {
                ForEach(open.rows) { t in
                    Button { openTask = TaskPageRef(project: t.projectId, number: t.number) } label: {
                        HStack(spacing: 12) {
                            Text(t.sentence).foregroundColor(Palette.primary).multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            Text(Board.projectTaskState(t)).font(.footnote).foregroundColor(Palette.secondary)
                                .multilineTextAlignment(.trailing)
                        }
                        .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the task")
                }
            } else {
                Text(client.tasksListFailed || tasksTried ? "We cannot read the tasks right now. Pull down to try again." : "Reading the tasks\u{2026}")
                    .foregroundColor(Palette.secondary)
            }
        } header: { label("Open tasks") } footer: {
            if let open, let f = Board.projectTasksFooter(total: open.total, shown: open.rows.count) { Text(f) }
        }
    }
}
