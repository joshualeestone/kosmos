import SwiftUI

// The native Tasks tab (kosmos#7031, slice 7 of #6838; Mona Lisa's slice7/SPEC.md). It draws what TasksLogic decides,
// which is the board's Tasks view: its groups in Josh's order, its title words and its project picker. A row opens the
// board's task page in the board view until a native task page has its own slice; Answer opens the agent's chat.
struct TasksView: View {
    let read: Board.TasksRead?
    let failed: Bool
    let earned: Bool                       // the board shows Tasks (counts.tasksTab); before that, "No tasks yet"
    let agentName: (String) -> String      // tskAgentName: the roster's name for a session, else the session name
    let open: (Board.TaskRow) -> Void
    let answer: (Board.TaskRow) -> Void
    let refresh: () async -> Void

    @State private var project: String? = nil
    @State private var shown: [Tasks.Section] = []
    @State private var laidOutFor: String? = "\u{0}"   // the project the layout was made for (never a real id at first)
    @State private var completedOpen = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Tasks")
                .toolbar { if read != nil && earned { ToolbarItem(placement: .topBarTrailing) { picker } } }
                .background(Palette.ground.ignoresSafeArea())
        }
        .onAppear { completedOpen = false; layOut() }
        .onChange(of: read) { _, _ in update() }
        .onChange(of: project) { _, _ in layOut() }
    }

    @ViewBuilder private var content: some View {
        if !earned {
            centred(title: "No tasks yet", detail: "Tasks are made on your computer, or by your agents.")
        } else if let read {
            list(read)
        } else if failed {
            centred(title: "Kosmos could not read your tasks just now.", detail: "Pull down to try again.")
        } else {
            VStack(spacing: 8) {
                ProgressView()
                Text("Reading your tasks\u{2026}").font(.footnote).foregroundColor(Palette.secondary)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func list(_ read: Board.TasksRead) -> some View {
        let projectShown = !Tasks.leaveOutProjectLine(read, project: project)
        return List {
            Section {
                EmptyView()
            } header: {
                Text(Tasks.title(read, project: project))
                    .font(.subheadline).foregroundColor(Palette.secondary).textCase(nil)
            }
            ForEach(shown, id: \.group.key) { s in
                if s.group.key == "closed" {
                    Section {
                        DisclosureGroup(isExpanded: $completedOpen) {
                            ForEach(s.rows) { t in row(t, projectShown: projectShown) }
                        } label: {
                            Text("Completed (\(s.rows.count))").font(.callout).foregroundColor(Palette.primary)
                        }
                        .accessibilityLabel("Completed, \(s.rows.count), " + (completedOpen ? "expanded" : "collapsed"))
                        .listRowBackground(Palette.card)
                    }
                } else {
                    Section {
                        if s.unknown {
                            Text(Tasks.decisionUnknown).font(.footnote).foregroundColor(Palette.secondary)
                                .listRowBackground(Palette.card)
                        }
                        ForEach(s.rows) { t in row(t, projectShown: projectShown) }
                    } header: { header(s, read: read) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .refreshable { await refresh(); layOut() }
    }

    private func header(_ s: Tasks.Section, read: Board.TasksRead) -> some View {
        let count = s.unknown ? "?" : String(s.rows.count)
        return HStack(spacing: 6) {
            Circle().fill(TasksPalette.dot(Tasks.dotToken(s.group, count: s.rows.count, rosterUnknown: read.rosterUnknown)))
                .frame(width: 8, height: 8)
            Text(s.group.label).foregroundColor(Palette.primary)
            Text(count).foregroundColor(Palette.secondary)
        }
        .font(.footnote.weight(.semibold))
        .textCase(nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.group.label + ", " + (s.unknown ? "cannot tell" : count))
        .accessibilityAddTraits(.isHeader)
    }

    private func row(_ t: Board.TaskRow, projectShown: Bool) -> some View {
        let line = Tasks.rowLine(t, now: Date(), name: agentName)
        let large = typeSize >= .accessibility1
        return VStack(alignment: .leading, spacing: 4) {
            Button { open(t) } label: {
                VStack(alignment: .leading, spacing: 3) {
                    if projectShown {
                        Text(Tasks.chainText(Tasks.chain(t))).font(.footnote).foregroundColor(Palette.secondary)
                            .lineLimit(large ? nil : 1)
                    }
                    Text(t.sentence).font(.callout.weight(.semibold)).foregroundColor(Palette.primary)
                        .lineLimit(large ? nil : 2).multilineTextAlignment(.leading)
                    if !line.isEmpty {
                        Text(line).font(.footnote).foregroundColor(Palette.secondary)
                            .lineLimit(large ? nil : 2).multilineTextAlignment(.leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Tasks.spoken(t, line: line, projectShown: projectShown))
            .accessibilityHint("Opens the task")
            .accessibilityActions {
                if t.state == "decision" { Button("Answer") { answer(t) } }
            }
            if t.state == "decision" && !t.waitingOn.isEmpty {
                Button { answer(t) } label: {
                    Text("Answer").font(.footnote.weight(.semibold)).foregroundColor(Palette.card)
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .background(Capsule().fill(Palette.primary))
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the chat")
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(Palette.card)
        .listRowSeparatorTint(Palette.separator)
    }

    private var picker: some View {
        let projects = read.map(Tasks.pickerProjects) ?? []
        let name = project.flatMap { id in projects.first { $0.id == id }?.chain.last } ?? "All projects"
        return Menu {
            Button("All projects") { project = nil }
            ForEach(projects, id: \.id) { p in Button(Tasks.pickerWords(p)) { project = p.id } }
        } label: {
            HStack(spacing: 4) {
                Text(name).lineLimit(1)
                Image(systemName: "chevron.down").font(.footnote.weight(.semibold))
            }
            .foregroundColor(Palette.primary)
        }
        .accessibilityLabel("Project: " + name)
    }

    private func centred(title: String, detail: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.headline).foregroundColor(Palette.primary).multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(detail).font(.subheadline).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // Laid out afresh (appearing, a pull, another project): each row in its own group.
    private func layOut() {
        guard let read else { shown = []; return }
        if let p = project, !Tasks.pickerProjects(read).contains(where: { $0.id == p }) { project = nil }
        shown = Tasks.sections(read, project: project)
        laidOutFor = project
    }
    // A live read: rows change in place and keep their group until the next layout (slice 1's rule).
    private func update() {
        guard let read else { return }
        if laidOutFor != project || shown.isEmpty { layOut(); return }
        shown = Tasks.keepingPlaces(shown, with: read, project: project)
    }
}

// The group dots, the board's own colours (#panel-tasks --tsk-*), resolved from web/index.html in each theme by a
// headless browser on 2026-10-24 (light, dark). A board change to these is a change here too.
enum TasksPalette {
    static func dot(_ token: String) -> Color {
        switch token {
        case "--tsk-decision": return Palette.pair(0xb3261e, 0xff6b5e)
        case "--tsk-working": return Palette.pair(0x1f7a4d, 0x4ade80)
        case "--tsk-assigned": return Palette.pair(0xb88920, 0xb88920)
        case "--tsk-built": return Palette.pair(0x0a58d8, 0x5aa2ff)
        case "--tsk-scheduled": return Palette.pair(0x396053, 0x83c19f)
        case "--tsk-closed": return Palette.pair(0x8f9193, 0x707378)
        default: return Palette.pair(0x4a4f57, 0xa9adb3)   // --tsk-nobody and --tsk-held
        }
    }
}
