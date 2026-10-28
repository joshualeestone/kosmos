import SwiftUI
import UIKit

// kosmos#7030 (the iPhone plan's slice 4, #6838): the native Today tab, built to Mona Lisa's slice 4 spec (24 Oct).
// What needs you, what an agent marked built, and who is working, in the board's own words; what to show and in which
// order is decided in TodayLogic.swift. Answer and Open open the agent's native chat, as the Agents tab does; Check it
// opens the task's native page (kosmos#7074, TaskPageView).
struct TodayView: View {
    @ObservedObject var client: BoardClient
    let openPage: (URL) -> Void
    let openBoard: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var wasBackground = false
    @State private var openAgent: Board.Agent?
    @State private var openTask: TaskPageRef?
    // The order is set when the screen appears, on a pull and at a re-sort, never under the thumb: live updates change a
    // card in place (slice 1's rule), and a new arrival goes after the ones already shown (Board.TodayOrder).
    @State private var order = Board.TodayOrder()

    var body: some View {
        NavigationView {
            content
                .navigationTitle("Today")
                .background(Palette.ground.ignoresSafeArea())
                // On the page, not on a card, so a card that goes away (its question answered) does not close the chat.
                .background(chatLink)
                .background(taskLink)
        }
        .navigationViewStyle(.stack)
        .onChange(of: client.chatEpoch) { _ in openAgent = nil; openTask = nil; order.clear() }
        .onAppear {
            visible = true
            order.clear()
            client.show(BoardClient.todayViewer)
            #if DEBUG
            // kosmos#7074's screenshots (a Debug build only): KOSMOS_SAMPLE_TASK=<n> opens that sample task's page, once.
            if !Self.sampleTaskOpened, let n = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_TASK"].flatMap(Int.init) {
                Self.sampleTaskOpened = true
                openTask = TaskPageRef(project: "p-cat", number: n)
            }
            #endif
        }
        .onDisappear { visible = false; wasBackground = false; client.hide(BoardClient.todayViewer) }
        .onChange(of: scenePhase) { phase in
            guard visible else { return }
            if phase == .background { wasBackground = true; client.stop() }
            else if phase == .active && wasBackground { wasBackground = false; client.start() }
        }
    }

    // Built in typed steps: as one expression it took over 50 ms to type-check here, and CI's Xcode is much slower.
    private var chatOpen: Binding<Bool> {
        Binding(get: { openAgent != nil }, set: { if !$0 { openAgent = nil } })
    }
    private var chatLink: some View {
        NavigationLink(isActive: chatOpen, destination: chatDestination, label: { EmptyView() }).hidden()
    }
    @ViewBuilder private func chatDestination() -> some View {
        if let agent = openAgent { chat(for: agent) }
    }
    private func chat(for agent: Board.Agent) -> ChatView {
        let open: () -> Void = { openOnBoard(agent) }
        return ChatView(client: client, agent: agent, openOnBoard: open)
    }
    #if DEBUG
    private static var sampleTaskOpened = false
    #endif
    // kosmos#7074: Check it pushes the task's native page.
    private var taskOpen: Binding<Bool> {
        Binding(get: { openTask != nil }, set: { if !$0 { openTask = nil } })
    }
    private var taskLink: some View {
        NavigationLink(isActive: taskOpen, destination: taskDestination, label: { EmptyView() }).hidden()
    }
    @ViewBuilder private func taskDestination() -> some View {
        if let ref = openTask { TaskPageView(client: client, ref: ref, openPage: openPage) }
    }
    private func openOnBoard(_ agent: Board.Agent) {
        if let url = client.chatURL(for: agent) { openPage(url) }
    }

    private var model: Board.TodayModel { order.apply(fresh) }
    // The model in its own order, as a re-sort takes it.
    private var fresh: Board.TodayModel {
        Board.today(agents: client.agents, tasks: client.readyTasks, stars: client.shownStars)
    }
    private var freshOrder: [String] { fresh.needsYou.map(\.session) }

    // As the Agents tab: a list once the Mac has answered, marked not updating while it does not.
    private var shown: Bool? {
        switch client.phase {
        case .starting, .connecting, .unreachable: return client.agents.isEmpty ? nil : true
        case .live: return client.updatedAt == nil ? nil : !client.fresh
        default: return nil
        }
    }

    @ViewBuilder private var content: some View {
        if let stale = shown {
            screen(stale: stale)
        } else {
            BoardStates(client: client, openBoard: openBoard) { screen(stale: false) }
        }
    }

    private func screen(stale: Bool) -> some View {
        let m = model
        return ScrollViewReader { proxy in List {
            // The subhead sits directly under the large title, as one header with it (Mona Lisa's review, 10-24): the
            // first section's header, not a row, which the list would pad as a row and push about 40pt down.
            // No line at all while nothing needs you and the tasks are not known (TodayModel.subhead).
            Section(header: Text(m.subhead ?? "")
                .font(.subheadline)
                .foregroundColor(Palette.secondary)
                .textCase(nil)
                .padding(.leading, -16)
                .padding(.top, -24)) {
                if stale {
                    notUpdating
                        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 0, trailing: 0))
                        .listRowBackground(Color.clear)
                }
            }
            if !m.needsYou.isEmpty {
                Section(header: header("Needs you")) {
                    ForEach(m.needsYou) { agent in
                        NeedsYouCard(agent: agent, picture: picture(agent), stale: stale) { openAgent = agent }
                            .cardRow()
                    }
                }
            }
            if client.tasksFailed && m.ready == nil {
                Section(header: header("Ready to check")) {
                    // Never zero shown as if nothing were ready (the board's TSK_DECISION_UNKNOWN pattern).
                    Text("Kosmos could not read your tasks just now.")
                        .font(.footnote).foregroundColor(Palette.secondary)
                        .listRowBackground(Color.clear)
                }
            } else if let ready = m.ready, !ready.isEmpty {
                Section(header: header("Ready to check")) {
                    ForEach(ready) { task in
                        let agent = task.builtBy.flatMap { s in client.agents.first { $0.session == s } }
                        ReadyCard(task: task, agentName: agent?.name ?? task.builtBy, picture: agent.flatMap(picture),
                                  tone: agent.map { stale ? .quiet : Board.tone($0) }, stale: stale) {
                            openTask = TaskPageRef(project: task.projectId, number: task.number)
                        }
                        .cardRow()
                    }
                }
            }
            if !m.working.isEmpty {
                Section(header: header("Working now")) {
                    ForEach(m.working) { agent in
                        Button { openAgent = agent } label: { AgentRow(agent: agent, picture: picture(agent), stale: stale) }
                            .buttonStyle(.plain)
                            .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                            .listRowBackground(Palette.card)
                            .listRowSeparatorTint(Palette.separator)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .refreshable {
            order.pullStarted()
            await client.refreshNow()
            order.pullEnded(freshOrder)
            await client.refreshTasks()
        }
        .onAppear { order.updated(freshOrder) }
        .onChange(of: client.updatedAt) { _ in order.updated(freshOrder) }
        // #7034: a re-sort (appear, pull, a reconnect) re-takes the order with the stars it read.
        .onChange(of: client.sortEpoch) { _ in order.resorted(freshOrder) }
        #if DEBUG
        // The sample screenshots only: KOSMOS_SAMPLE_SCROLL=ready scrolls to Ready to check (nothing here can scroll).
        .onAppear {
            guard ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLL"] == "ready", let first = m.ready?.first else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { proxy.scrollTo(first.id, anchor: .top) }
        }
        #endif
        }
    }

    private func picture(_ agent: Board.Agent) -> UIImage? {
        agent.hasAvatar ? client.pictures[agent.session].flatMap(UIImage.init(data:)) : nil
    }

    // The system grouped-list header: footnote, uppercase, secondary.
    private func header(_ title: String) -> some View {
        Text(title).font(.footnote).foregroundColor(Palette.secondary).textCase(.uppercase).accessibilityAddTraits(.isHeader)
    }

    private var notUpdating: some View {
        // kosmos#7416: not answering, the line says when the Mac was last heard from; "Last checked" stays unless it
        // says the same minute (Shell.saysLastChecked).
        let heard = client.phase.isUnreachable ? client.failingMacLastHeard : nil
        return Text((client.phase.isUnreachable ? Shell.notUpdatingLine(client.failingMacName, lastHeard: heard) : "Checking for updates.")
             + (Shell.saysLastChecked(client.updatedAt, lastHeard: heard)
                ? client.updatedAt.map { " Last checked \($0.formatted(date: .omitted, time: .shortened))." } ?? "" : ""))
            .font(.footnote)
            .foregroundColor(Palette.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.banner))
    }
}

private extension BoardClient.Phase {
    var isUnreachable: Bool { if case .unreachable = self { return true } else { return false } }
}

private extension View {
    // A card is its own inset shape: the list row around it is clear, 12pt between cards.
    func cardRow() -> some View {
        listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}

// "3 min ago", the system's relative style.
private func ago(_ date: Date?) -> String? {
    guard let date else { return nil }
    let f = RelativeDateTimeFormatter()
    f.unitsStyle = .short
    return f.localizedString(for: min(date, Date()), relativeTo: Date())
}

// The card's one button: full width, at least 44pt, filled with the primary text colour, label in the card colour.
private struct TodayButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .foregroundColor(Palette.card)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 10).fill(Palette.primary))
        }
        .buttonStyle(.plain)
    }
}

// One agent the board says needs the person: who, the board's word, the project and how long, the board's reason
// sentence, and one button into its chat. No question text on the card (Josh, 10-20, #6716).
private struct NeedsYouCard: View {
    let agent: Board.Agent
    let picture: UIImage?
    let stale: Bool
    let open: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var tone: Board.Tone { stale ? .quiet : Board.tone(agent) }
    private var word: String { stale ? Board.statusWord(agent) : Board.toneWord(agent) }   // kosmos#7342: never a red Idle or Working (keyed on the tone it is drawn in)
    private var why: (sentence: String, action: Board.TodayAction) { Board.todayReason(agent) }
    private var meta: String? {
        let parts = [agent.stateProjectName, ago(agent.waitingSince)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                AgentAvatar(name: agent.name, picture: picture, tone: tone, size: typeSize.isAccessibilitySize ? 48 : 40)
                VStack(alignment: .leading, spacing: 2) {
                    if typeSize.isAccessibilitySize {
                        // The largest sizes: the word moves under the name, and nothing truncates it.
                        Text(agent.name).font(.callout.weight(.semibold)).foregroundColor(Palette.primary)
                        statusWord
                    } else {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(agent.name).font(.callout.weight(.semibold)).foregroundColor(Palette.primary).lineLimit(1)
                            Spacer(minLength: 8)
                            statusWord.layoutPriority(1)
                        }
                    }
                    if let meta {
                        Text(meta).font(.footnote).foregroundColor(Palette.secondary)
                    }
                }
            }
            Text(why.sentence)
                .font(.subheadline)
                .foregroundColor(Palette.primary)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            TodayButton(title: why.action.title, action: open)
                .padding(.top, 12)
                .accessibilityHidden(true)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12).fill(Palette.card))
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
        // One element: "Cleo, Question, Launch the spring catalogue, 3 minutes ago. Waiting for your answer."
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([agent.name, word, agent.stateProjectName, ago(agent.waitingSince)].compactMap { $0 }.joined(separator: ", ")
                            + ". " + why.sentence + (stale ? " Not updating." : ""))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens the chat")
        .accessibilityAction(named: Text(why.action.title), open)
    }

    private var statusWord: some View {
        Text(word)
            .font(.footnote.weight(.semibold))
            .foregroundColor(Palette.word(tone))
            .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
    }
}

// One task an agent marked built: the project and number, the person's own words for it, who marked it and when, the
// agent's note, and Check it, which opens the task's page.
private struct ReadyCard: View {
    let task: Board.ReadyTask
    let agentName: String?
    let picture: UIImage?
    let tone: Board.Tone?
    var stale = false
    let check: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var place: String { (task.projectName.isEmpty ? "" : task.projectName + " \u{00B7} ") + "Task \(task.number)" }
    private var marked: String {
        let who = task.byPerson ? " by you" : agentName.map { " by " + $0 } ?? ""
        return "Marked built" + who + (ago(task.builtAt).map { " \u{00B7} " + $0 } ?? "")
    }
    private var spoken: String {
        let at = [task.projectName.isEmpty ? nil : task.projectName, "Task \(task.number)", task.sentence].compactMap { $0 }
        let who = task.byPerson ? " by you" : agentName.map { " by " + $0 } ?? ""
        let when = ago(task.builtAt).map { " " + $0 } ?? ""
        return at.joined(separator: ", ") + ", marked built" + who + when + "." + (task.note.map { " " + $0 } ?? "")
            + (stale ? " Not updating." : "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                if !task.byPerson, let agentName {
                    AgentAvatar(name: agentName, picture: picture, tone: tone, size: typeSize.isAccessibilitySize ? 48 : 40)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(place).font(.footnote).foregroundColor(Palette.secondary)
                    Text(task.sentence).font(.callout.weight(.semibold)).foregroundColor(Palette.primary)
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        // The board's built colour, only on this dot; never red, which means somebody is waiting on you.
                        Circle().fill(Palette.built).frame(width: 8, height: 8).accessibilityHidden(true)
                        Text(marked).font(.footnote).foregroundColor(Palette.secondary)
                    }
                    .padding(.top, 2)
                    if let note = task.note {
                        Text(note).font(.footnote).foregroundColor(Palette.primary).lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                    }
                }
            }
            TodayButton(title: "Check it", action: check)
                .padding(.top, 12)
                .accessibilityHidden(true)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12).fill(Palette.card))
        .contentShape(Rectangle())
        .onTapGesture(perform: check)
        // "Task 4, Pages 1 to 8, marked built by Dana 20 minutes ago."
        .accessibilityElement(children: .ignore)
        // Review 2: names keep their case, and the parts are joined with commas, not the middle dot.
        .accessibilityLabel(spoken)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens the task")
        .accessibilityAction(named: Text("Check it"), check)
    }
}
