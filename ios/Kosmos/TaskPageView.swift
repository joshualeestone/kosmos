import SwiftUI

// kosmos#7074 (a gap in #6838's plan): a task's page, native, opened from Today's Check it and from a Tasks row. It draws
// what TaskPageLogic.swift says and does what TaskPageModel.swift does: the board's task page (web/index.html,
// paintTaskPage) for reading, and its one human verb, Mark as done / Reopen. What this page does not do (the task's
// composer, the due date and hold, parts, Add subtask, Close them and this task, the receipt) is on the board's page,
// one tap away by the info button.
struct TaskPageRef: Hashable {
    let project: String
    let number: Int
}

struct TaskPageView: View {
    @ObservedObject var client: BoardClient
    let ref: TaskPageRef
    let openPage: (URL) -> Void
    @StateObject private var model: TaskPageModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var loop: Task<Void, Never>?
    @State private var openSub: Int?

    init(client: BoardClient, ref: TaskPageRef, openPage: @escaping (URL) -> Void) {
        self.client = client
        self.ref = ref
        self.openPage = openPage
        #if DEBUG
        var send: TaskPageModel.Send = { [weak client] build in await client?.throughMac(build) }
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" { send = Self.sampleSend }
        #else
        let send: TaskPageModel.Send = { [weak client] build in await client?.throughMac(build) }
        #endif
        _model = StateObject(wrappedValue: TaskPageModel(
            project: ref.project, number: ref.number,
            send: send,
            sleep: { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) },
            epoch: { [weak client] in client?.chatEpoch ?? -1 }))
    }

    // The roster's names, for an agent the project does not list.
    private var roster: [String: String] { Dictionary(client.agents.map { ($0.session, $0.name) }, uniquingKeysWith: { a, _ in a }) }
    // The roster's names, as a snapshot; the model lays the project's own over them after it has read the task.
    private var names: [String: String] { roster }

    var body: some View {
        content
            .background(Palette.ground.ignoresSafeArea())
            .navigationTitle("Task \(ref.number)")
            .navigationBarTitleDisplayMode(.inline)
            .kosmosSolidTopBar()   // kosmos#7346 (Josh 10-27 20:21): no row shows behind the top bar
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    // Not for a task the computer no longer has: its board page would be gone too.
                    if !model.gone {
                    Button { if let url = client.taskURL(project: ref.project, number: ref.number) { openPage(url) } } label: {
                        Image(systemName: "info.circle")
                    }
                    .accessibilityLabel("Open this task on your computer's board")
                    }
                }
            }
            .background(subLink)
            // The person in front of it (the board's tkPresent): on screen, the app in front, and a touch (or a key press
            // that reaches the window) in the last two minutes (PresenceProbe); opening the page or coming back counts.
            .background(PresenceProbe { model.touched() })
            .onAppear {
                visible = true
                model.onScreen = true
                model.appActive = scenePhase == .active
                model.assistive = UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
                model.touched()
                startReading(returning: true)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.voiceOverStatusDidChangeNotification)) { _ in
                model.assistive = UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
            }
            .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.switchControlStatusDidChangeNotification)) { _ in
                model.assistive = UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
            }
            .onDisappear { visible = false; model.onScreen = false; loop?.cancel(); loop = nil }
            .onChange(of: scenePhase) { phase in
                model.appActive = phase == .active
                guard visible else { return }
                if phase == .active {
                    model.touched()
                    startReading(returning: true)
                } else { loop?.cancel(); loop = nil }
            }
            .onChange(of: model.activityKey) { _ in Task { await model.markSeen() } }
    }

    // Read now and every 5 seconds: the task while the page is on screen, its activity and the seen mark only while the
    // person is there (TaskPageModel.shouldReadTask / shouldReadActivity, the board's tick), so a state that landed while
    // they were idle is marked within one tick of their coming back. `returning` (the page appearing, the app coming
    // back) records the state once more, as the board's tkTabReturn does, but only the state just read and drawn: a
    // read that fails records nothing, so a nudge that arrived while they were away is never marked before it is shown.
    private func startReading(returning: Bool = false) {
        loop?.cancel()
        loop = Task {
            var first = true
            while !Task.isCancelled {
                await model.tick(first: first, returning: returning, names: names)
                first = false
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let page = model.page, !model.gone {
            // Redrawn every 30 seconds, so "2 minutes ago" and "today" move on while nothing else changes.
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                ScrollView { pageBody(page).padding(16) }
            }
                .refreshable { await model.read(); await model.readActivity(names: names) }
        } else if model.gone {
            message("This task is not on your computer any more", "It may have been deleted, or its project moved.")
        } else if model.readFailed {
            message("Kosmos could not read this task just now", "It tries again in a few seconds.")
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func message(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 8) {
            Text(title).font(.headline).foregroundColor(Palette.primary)
            Text(detail).font(.subheadline).foregroundColor(Palette.secondary)
        }
        .multilineTextAlignment(.center)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func pageBody(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            header(p)
            doneBlock(p)
            whoBlock(p)
            subtasksBlock(p)
            activityBlock
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func header(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(p.projectName).font(.subheadline).foregroundColor(Palette.secondary)
            Text(p.sentence).font(.title2.weight(.semibold)).foregroundColor(Palette.primary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let detail = p.detail {
                Text(Board.messageText(detail)).font(.body).foregroundColor(Palette.primary).tint(Palette.link)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(p.stateLine(roster: roster)).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
                .padding(.top, 4)
            Group {
                Text(p.addedLine(now: Date()))
                if let due = p.dueLine() { Text(due) }
                if let parent = p.parentNumber, let sentence = p.parentSentence {
                    Button { openSub = parent } label: {
                        Text("Part of #\(parent) " + sentence).foregroundColor(Palette.link)
                            .frame(minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens task \(parent).")
                }
            }
            .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    // The one act the person owns, with what it does not do said above it, and the Mac's refusal under it.
    private func doneBlock(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let note = p.closeNote(roster: roster) {
                Text(note).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let hold = p.holdLine {
                Text(hold).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if p.allSubtasksDone {
                Text("All subtasks done.").font(.footnote).foregroundColor(Palette.secondary)
            } else if p.allSubtasksBuilt {
                Text("All subtasks are built. Check each one first.").font(.footnote).foregroundColor(Palette.secondary)
            }
            let act = p.act
            Button { model.touched(); Task { await model.press(act, names: names) } } label: {
                HStack(spacing: 8) {
                    if model.pressing { ProgressView().tint(Palette.card).accessibilityHidden(true) }
                    Text(act.title).font(.headline)
                }
                .foregroundColor(Palette.card)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 10).fill(Palette.primary))
            }
            .buttonStyle(.plain)
            .disabled(model.pressing)
            .opacity(model.pressing ? 0.6 : 1)
            .accessibilityValue(model.pressing ? "In progress" : "")
            if let refusal = model.refusal {
                Text(refusal).font(.footnote).foregroundColor(Palette.dangerWord).fixedSize(horizontal: false, vertical: true)
                    .onAppear { UIAccessibility.post(notification: .announcement, argument: refusal) }
            }
        }
    }

    private func sectionTitle(_ t: String) -> some View {
        Text(t).font(.footnote.weight(.semibold)).foregroundColor(Palette.secondary).textCase(.uppercase)
            .accessibilityAddTraits(.isHeader)
    }

    private func whoBlock(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Who is on it")
            ForEach(p.partLines(roster: roster)) { part in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(part.who).font(.body.weight(.semibold)).foregroundColor(Palette.primary)
                        if part.done { Text("Done").font(.footnote).foregroundColor(Palette.secondary) }
                    }
                    if let line = part.line { Text(line).font(.footnote).foregroundColor(Palette.secondary) }
                    if let say = part.say { Text(say).font(.footnote.italic()).foregroundColor(Palette.secondary) }
                }
                .accessibilityElement(children: .combine)
            }
            if let why = p.whyLine(roster: roster) {
                Text(why).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func subtasksBlock(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionTitle("Subtasks")
            if p.subtasks.isEmpty {
                Text("None yet.").font(.footnote).foregroundColor(Palette.secondary)
            }
            ForEach(p.subtasks) { s in
                Button { openSub = s.number } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("#\(s.number)").font(.footnote.monospacedDigit()).foregroundColor(Palette.secondary)
                        Text(s.sentence).font(.body).foregroundColor(Palette.primary).multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        Text(s.status).font(.footnote).foregroundColor(s.status == "Built" ? Palette.built : Palette.secondary)
                        Image(systemName: "chevron.right").font(.footnote).foregroundColor(Palette.tertiary)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Task \(s.number), \(s.sentence), \(s.status)")
                .accessibilityAddTraits(.isButton)
                .accessibilityHint("Opens task \(s.number).")
            }
        }
    }

    @ViewBuilder private var activityBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Activity")
            if let rows = model.activity {
                if rows.isEmpty {
                    Text(Board.activityEmpty).font(.footnote).foregroundColor(Palette.secondary)
                }
                // Lazily: a repeating task's history can run long, and only what is on screen is laid out.
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(rows) { row in
                        VStack(alignment: .leading, spacing: 2) {
                            if let at = row.at {
                                // Secondary, not tertiary: small text needs AA contrast in dark mode too.
                                Text(Tasks.agoWords(Date().timeIntervalSince(at) * 1000)).font(.caption).foregroundColor(Palette.secondary)
                            }
                            Text(row.text).font(.subheadline).foregroundColor(Palette.primary).fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            } else if model.activityFailed {
                Text(Board.activityUnread).font(.footnote).foregroundColor(Palette.secondary)
            }
        }
    }

    #if DEBUG
    // The sample Mac (KOSMOS_SAMPLE_AGENTS=1, a Debug build only), matching Today's and Tasks' sample tasks, so a
    // screenshot never shows a real account. A press closes or reopens the sample task for real (in memory).
    // Locked: the sample Mac is called off the main actor, by the loop, a press and a seen mark at once.
    private static let sampleLock = NSLock()
    private static var sampleClosed: Set<Int> = []
    private static func sampleSend(_ build: (URL) -> URLRequest?) async -> (Data, HTTPURLResponse)? {
        guard let r = build(URL(string: "https://sample.invalid")!), let url = r.url else { return nil }
        let path = url.path
        let closedNow: Set<Int> = sampleLock.withLock {
            if path.hasSuffix("/close") || path.hasSuffix("/reopen") {
                if let n = Int(url.deletingLastPathComponent().lastPathComponent) {
                    if path.hasSuffix("/close") { sampleClosed.insert(n) } else { sampleClosed.remove(n) }
                }
            }
            return sampleClosed
        }
        let iso = { (m: Double) in ISO8601DateFormatter().string(from: Date().addingTimeInterval(-m * 60)) }
        func closed(_ n: Int, _ open: String) -> String { closedNow.contains(n) ? #""closedAt":""# + iso(0) + #"","progress":{"done":1,"total":1,"closed":true}"# : open }
        let body: String
        if path.hasSuffix("/projects") {
            body = #"{"projects":[{"id":"p-cat","name":"Spring catalogue","paused":false,"agents":[{"sessionName":"dana","name":"Dana"},{"sessionName":"eli","name":"Eli"}],"tasks":["#
                + #"{"number":3,"sentence":"Print-ready catalogue","addedBy":"operator","addedVia":"screen","createdAt":""# + iso(4000) + #"",\#(closed(3, #""progress":{"done":0,"total":1,"closed":false}"#)),"parts":[{"id":1,"who":null,"sentence":"Print-ready catalogue"}]},"#
                + #"{"number":4,"sentence":"Pages 1 to 8","detail":"Copy for pages 1 to 8, checked against the **price sheet**. Captions follow the March style guide.","parent":3,"addedBy":"operator","addedVia":"screen","createdAt":""# + iso(2900) + #"","dueDate":"2026-10-30","builtAt":""# + iso(40) + #"","builtBy":"dana","builtNote":"captions need a check",\#(closed(4, #""progress":{"done":0,"total":1,"closed":false}"#)),"parts":[{"id":1,"who":"dana","sentence":"Pages 1 to 8"}],"claim":{"claimed":true,"about":"dana"}},"#
                + #"{"number":8,"sentence":"Pages 9 to 12","parent":3,"addedBy":"operator","addedVia":"screen","createdAt":""# + iso(2800) + #"",\#(closed(8, #""progress":{"done":0,"total":1,"closed":false}"#)),"parts":[{"id":1,"who":"dana","sentence":"Pages 9 to 12"}]}"#
                + #"]}]}"#
        } else if path.hasSuffix("/activity") && !path.contains("/task/4/") {
            body = #"{"events":[{"at":""# + iso(4000) + #"","kind":"created"}]}"#
        } else if path.hasSuffix("/activity") {
            body = #"{"events":[{"at":""# + iso(2900) + #"","kind":"created","who":"dana","parent":3},{"at":""# + iso(300) + #"","kind":"said","text":"Use the March photos for the captions."},{"at":""# + iso(40) + #"","kind":"built","by":"dana","note":"captions need a check"}"#
                + (closedNow.contains(4) ? #",{"at":""# + iso(0) + #"","kind":"closed"}"# : "") + "]}"
        } else {
            body = "{}"
        }
        return (Data(body.utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    #endif

    // A subtask, or the task this one is part of, pushed as its own page.
    private var subOpen: Binding<Bool> { Binding(get: { openSub != nil }, set: { if !$0 { openSub = nil } }) }
    private var subLink: some View {
        NavigationLink(isActive: subOpen, destination: subDestination, label: { EmptyView() }).hidden()
    }
    @ViewBuilder private func subDestination() -> some View {
        if let n = openSub { TaskPageView(client: client, ref: TaskPageRef(project: ref.project, number: n), openPage: openPage) }
    }
}
