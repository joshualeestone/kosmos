import SwiftUI

// The native Tasks tab (kosmos#7031, slice 7 of #6838; Mona Lisa's slice7/SPEC.md). It draws what TasksLogic decides,
// which is the board's Tasks view: its groups in Josh's order, its title words and its project picker. A row opens the
// task's native page (kosmos#7074, TaskPageView), as Today's Check it does; Answer opens that agent's native chat, as
// Today's Answer does.
struct TasksTab: View {
    @ObservedObject var client: BoardClient
    let openPage: (URL) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var wasBackground = false
    @State private var openAgent: Board.Agent?
    @State private var openTask: TaskPageRef?
    // kosmos#7078: the New task sheet (its project, picked in the list) and the line it leaves after a create.
    @State private var newTaskFor: NewTaskStart?
    @State private var notice: String?
    @State private var newTaskDraft = NewTask.Draft()   // kept when the sheet closes, as the board keeps its draft

    var body: some View {
        NavigationView {
            TasksView(read: client.tasksList, failed: client.tasksListFailed, agentName: name,
                      open: { t in openTask = TaskPageRef(project: t.projectId, number: t.number) },
                      answer: answer,
                      refresh: { await client.refreshTasks() },
                      newTask: { picked in notice = nil; newTaskFor = NewTaskStart(picked: picked) },
                      notice: notice)
                .background(chatLink)
                .background(taskLink)
                .sheet(item: $newTaskFor) { start in
                    NewTaskView(client: client, tasks: client.tasksList, picked: start.picked, draft: $newTaskDraft) { line in
                        notice = line
                        Task { await client.refreshTasks() }
                    }
                }
        }
        .navigationViewStyle(.stack)
        .onChange(of: client.chatEpoch) { _ in openAgent = nil; openTask = nil }
        .onAppear {
            visible = true; client.show(BoardClient.tasksViewer)
            if Self.sampleNewTask && !Self.sampleNewTaskShown { Self.sampleNewTaskShown = true; newTaskFor = NewTaskStart(picked: nil) }
        }
        .onDisappear { visible = false; wasBackground = false; client.hide(BoardClient.tasksViewer) }
        .onChange(of: scenePhase) { phase in
            guard visible else { return }
            if phase == .background { wasBackground = true; client.stop() }
            else if phase == .active && wasBackground { wasBackground = false; client.start() }
        }
    }

    // Screenshots only (a Debug build with KOSMOS_SAMPLE_AGENTS=1): KOSMOS_SAMPLE_NEWTASK=1 opens the New task sheet once.
    #if DEBUG
    private static let sampleNewTask = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1"
        && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NEWTASK"] == "1"
    #else
    private static let sampleNewTask = false
    #endif
    private static var sampleNewTaskShown = false
    // tskAgentName: the roster's name for a session, else the session name itself.
    private func name(_ session: String) -> String { client.agents.first { $0.session == session }?.name ?? session }
    // The agent the decision row waits on (the first named), in its native chat; one the roster does not list yet opens
    // its chat on the board instead.
    private func answer(_ t: Board.TaskRow) {
        guard let who = t.waitingOn.first?.who else { return }
        if let agent = client.agents.first(where: { $0.session == who }) { openAgent = agent; return }
        if let url = client.chatURL(session: who) { openPage(url) }
    }
    // Built in typed steps, as Today's (a single expression type-checks slowly on CI's Xcode).
    private var chatOpen: Binding<Bool> {
        Binding(get: { openAgent != nil }, set: { if !$0 { openAgent = nil } })
    }
    private var chatLink: some View {
        NavigationLink(isActive: chatOpen, destination: chatDestination, label: { EmptyView() }).hidden()
    }
    @ViewBuilder private func chatDestination() -> some View {
        if let agent = openAgent { chat(for: agent) }
    }
    private var taskOpen: Binding<Bool> {
        Binding(get: { openTask != nil }, set: { if !$0 { openTask = nil } })
    }
    private var taskLink: some View {
        NavigationLink(isActive: taskOpen, destination: taskDestination, label: { EmptyView() }).hidden()
    }
    @ViewBuilder private func taskDestination() -> some View {
        if let ref = openTask { TaskPageView(client: client, ref: ref, openPage: openPage) }
    }
    private func chat(for agent: Board.Agent) -> ChatView {
        let onBoard: () -> Void = { if let url = client.chatURL(for: agent) { openPage(url) } }
        return ChatView(client: client, agent: agent, openOnBoard: onBoard)
    }
}

struct TasksView: View {
    let read: Board.TasksRead?
    let failed: Bool
    let agentName: (String) -> String      // tskAgentName
    let open: (Board.TaskRow) -> Void
    let answer: (Board.TaskRow) -> Void
    let refresh: () async -> Void
    // kosmos#7078: the New task sheet, opened with the project picked here (nil on All projects), and the line the
    // sheet leaves after a create ("Added task 12 to Launch."). Both optional, so the samples and checks need neither.
    var newTask: ((String?) -> Void)? = nil
    var notice: String? = nil

    @State private var project: String? = nil
    @State private var shown: [Tasks.Section] = []
    @State private var laidOutFor: String? = "\u{0}"   // the project the layout was made for (never a real id at first)
    @State private var completedOpen = false
    @State private var sampleScrolled = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        content
            .navigationTitle("Tasks")
            .toolbar {
                if let read, !read.tasks.isEmpty { ToolbarItem(placement: .navigationBarTrailing) { picker } }
                if read != nil, let newTask {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button { newTask(project) } label: { Image(systemName: "plus") }
                            .accessibilityLabel("New task")
                    }
                }
            }
            .background(Palette.ground.ignoresSafeArea())
            .onAppear { completedOpen = Self.sampleCompletedOpen; layOut() }
            .onChange(of: read) { _ in update() }
            .onChange(of: project) { _ in layOut() }
    }

    @ViewBuilder private var content: some View {
        if let read {
            // The board's own empty line, as slice 1's empty state.
            if read.tasks.isEmpty && !read.rosterUnknown {
                centred(title: "No tasks yet", detail: newTask != nil ? (notice ?? "Add one with +, or ask an agent to.")
                        : "Tasks are made on your computer, or by your agents.")
            } else {
                list(read)
            }
        } else if failed {
            // A scroll view so "Pull down to try again" is true: the pull is the retry.
            GeometryReader { g in
                ScrollView {
                    centred(title: "Kosmos could not read your tasks just now.", detail: "Pull down to try again.")
                        .frame(minHeight: g.size.height)
                }
                .refreshable { await refresh(); layOut() }
            }
        } else {
            VStack(spacing: 8) {
                ProgressView()
                Text("Reading your tasks\u{2026}").font(.footnote).foregroundColor(Palette.secondary)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func list(_ read: Board.TasksRead) -> some View {
        let projectShown = !Tasks.leaveOutProjectLine(read, project: project)
        return ScrollViewReader { scroller in List {
            Section {
                EmptyView()
            } header: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Tasks.title(read, project: project))
                        .font(.subheadline).foregroundColor(Palette.secondary).textCase(nil)
                    // kosmos#7078: the board's tsk-msg line after a New task, where the board puts it.
                    if let notice {
                        Text(notice).font(.footnote).foregroundColor(Palette.primary).textCase(nil)
                    }
                }
            }
            ForEach(shown, id: \.group.key) { s in
                if s.group.key == "closed" {
                    Section {
                        DisclosureGroup(isExpanded: $completedOpen) {
                            rows(s.rows, projectShown: projectShown)
                        } label: {
                            Text("Completed (\(s.rows.count))").font(.callout).foregroundColor(Palette.primary)
                        }
                        .accessibilityLabel("Completed, \(s.rows.count), " + (completedOpen ? "expanded" : "collapsed"))
                        .listRowBackground(Palette.card)
                        .id("closed-label")
                    }
                } else {
                    Section {
                        if s.unknown {
                            Text(Tasks.decisionUnknown).font(.footnote).foregroundColor(Palette.secondary)
                                .listRowBackground(Palette.card)
                        }
                        rows(s.rows, projectShown: projectShown)
                    } header: { header(s, read: read) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .refreshable { await refresh(); layOut() }
        // A moment after appearing: at appear the rows are not drawn yet and a scroll goes nowhere, and `shown` is
        // already set by then, so a change of it never fires either (both tried, both shot the top of the list).
        .onAppear {
            guard Self.sampleScrollToEnd, !sampleScrolled else { return }
            sampleScrolled = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                // A row inside a closed Completed is not drawn and cannot be scrolled to: then Completed itself.
                guard let last = shown.last else { return }
                let closedShut = last.group.key == "closed" && !completedOpen
                scroller.scrollTo(closedShut ? "closed-label" : (last.rows.last?.id ?? last.group.key), anchor: .bottom)
                // scrollTo lines the row up with the visible edge, which stops short of the bottom inset a person's
                // own scroll ends at (Mona Lisa's review: the open shot sat flush on the tab bar). Then the true end.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { Self.sampleScrollToVeryEnd() }
            }
        }
        }
    }

    // Screenshots only (a Debug build with KOSMOS_SAMPLE_AGENTS=1, as the other tabs' samples): Completed open, and the
    // list scrolled to its end, for the design review's "Completed clears the tab bar" shot. Release has neither.
    #if DEBUG
    private static let sampleCompletedOpen = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1"
        && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_COMPLETED"] == "open"
    private static let sampleScrollToEnd = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1"
        && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLL"] == "end"
    // The list's own scroll view, at its largest offset (content height plus the bottom inset the tab bar asks for).
    private static func sampleScrollToVeryEnd() {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        func find(_ v: UIView) -> UIScrollView? {
            if let s = v as? UICollectionView, s.window != nil, !s.isHidden, s.bounds.height > 0 { return s }
            for c in v.subviews { if let s = find(c) { return s } }
            return nil
        }
        guard let s = windows.lazy.compactMap(find).first else { return }
        let end = s.contentSize.height - s.bounds.height + s.adjustedContentInset.bottom
        s.setContentOffset(CGPoint(x: 0, y: max(-s.adjustedContentInset.top, end)), animated: false)
    }
    #else
    private static let sampleCompletedOpen = false
    private static let sampleScrollToEnd = false
    private static func sampleScrollToVeryEnd() {}
    #endif

    private func header(_ s: Tasks.Section, read: Board.TasksRead) -> some View {
        let count = s.unknown ? "?" : String(s.rows.count)
        let token = Tasks.dotToken(s.group, count: s.rows.count, rosterUnknown: read.rosterUnknown)
        // The dot is centred on the label's FIRST line at any text size (Mona Lisa's review: resting on the baseline it
        // read as a full stop): it sits in a hidden one-line text of the same font, which also gives it that line's
        // baseline, so a label wrapped at the largest sizes keeps its dot beside the first line.
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            ZStack {
                Text("Ag").hidden()
                Circle().fill(TasksPalette.dot(token)).frame(width: 8, height: 8)
            }
            .fixedSize()
            .accessibilityHidden(true)
            Text(s.group.label).foregroundColor(Palette.primary)
            Text(count).foregroundColor(Palette.secondary)
        }
        .font(.footnote.weight(.semibold))
        .textCase(nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.group.label + ", " + (s.unknown ? "cannot tell" : count))
        .accessibilityAddTraits(.isHeader)
    }

    // A group's rows as taskNest places them: under their parent when it is in the same group, else with a crumb.
    private func rows(_ list: [Board.TaskRow], projectShown: Bool) -> some View {
        ForEach(Tasks.nest(list), id: \.row.id) { p in row(p.row, depth: p.depth, crumb: p.crumb, projectShown: projectShown) }
    }

    private func row(_ t: Board.TaskRow, depth: Int, crumb: Bool, projectShown: Bool) -> some View {
        let line = Tasks.rowLine(t, now: Date(), name: agentName)
        let large = typeSize >= .accessibility1
        let decision = t.state == "decision" && !t.waitingOn.isEmpty
        return VStack(alignment: .leading, spacing: 6) {
            Button { open(t) } label: { rowText(t, line: line, crumb: crumb, projectShown: projectShown, large: large) }
                .buttonStyle(.plain)
                .accessibilityLabel(Tasks.spoken(t, line: line, projectShown: projectShown)
                    + (crumb ? ", " + Tasks.partOf(t) : ""))
                .accessibilityHint("Opens the task")
                .modifier(AnswerAction(on: decision) { answer(t) })
            if decision {
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
        .padding(.leading, CGFloat(depth) * 16)
        .listRowBackground(Palette.card)
        .listRowSeparatorTint(Palette.separator)
    }

    private func rowText(_ t: Board.TaskRow, line: String, crumb: Bool, projectShown: Bool, large: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if crumb {
                Text(Tasks.partOf(t)).font(.footnote).foregroundColor(Palette.secondary)
                    .lineLimit(large ? nil : 1)
            }
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
    // A read that is gone (another Mac, signed out) carries nothing over: the next one is laid out afresh, All projects.
    // A project that left the read (deleted, emptied) goes back to All projects rather than an empty list.
    private func update() {
        guard let read else { laidOutFor = "\u{0}"; project = nil; shown = []; return }
        if let p = project, !Tasks.pickerProjects(read).contains(where: { $0.id == p }) { project = nil; layOut(); return }
        if laidOutFor != project || shown.isEmpty { layOut(); return }
        shown = Tasks.keepingPlaces(shown, with: read, project: project)
    }
}

// A decision row's Answer, also as a custom accessibility action (the spec), only on a row that has one.
private struct AnswerAction: ViewModifier {
    let on: Bool
    let run: () -> Void
    @ViewBuilder func body(content: Content) -> some View {
        if on { content.accessibilityAction(named: Text("Answer"), run) } else { content }
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

// kosmos#7078: one opening of the New task sheet, with the project the Tasks list had picked.
struct NewTaskStart: Identifiable {
    let id = UUID()
    let picked: String?
}
