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
    // Opening a member: the room's own chat push (RoomView), so the conversation opens as it does from a post.
    let openAgent: (Board.Agent) -> Void
    let openPage: (URL) -> Void

    @State private var part: Board.ProjectPart = .about
    @State private var openTask: TaskPageRef?

    private var roles: [String: String] {
        Dictionary(client.agents.compactMap { a in a.role.map { (a.session, $0) } }, uniquingKeysWith: { a, _ in a })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            switch part {
            case .about: about
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
    }

    // Paused when it is, and the segments. The name is the top bar's (said once, not twice).
    private var header: some View {
        VStack(spacing: 8) {
            if project.paused {
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
    }

    private var about: some View {
        List {
            Section {
                Text(Board.projectAbout(project))
                    .foregroundColor(project.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Palette.secondary : Palette.primary)
            } header: { Text("What it is for") }

            Section {
                if project.members.isEmpty {
                    Text("No agents on this project yet.").foregroundColor(Palette.secondary)
                }
                ForEach(project.members, id: \.session) { m in memberRow(m) }
            } header: { Text("Members") }

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
        .refreshable { await client.refreshTasks() }
        .task { if client.tasksList == nil { await client.refreshTasks() } }
    }

    @ViewBuilder private func memberRow(_ m: Board.ProjectMember) -> some View {
        let line = Board.projectMemberLine(m, agentRole: roles[m.session])
        let agent = client.agents.first { $0.session == m.session }
        Button { if let agent { openAgent(agent) } } label: {
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
        .disabled(agent == nil)
        .accessibilityHint(agent == nil ? "" : "Opens the conversation")
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
                Text(client.tasksListFailed ? "We cannot read the tasks right now. Pull down to try again." : "Reading the tasks\u{2026}")
                    .foregroundColor(Palette.secondary)
            }
        } header: { Text("Open tasks") } footer: {
            if let open, let f = Board.projectTasksFooter(total: open.total, shown: open.rows.count) { Text(f) }
        }
    }
}
