import SwiftUI
import UIKit

// kosmos#7032 (slice 9 of #6838): the native Projects tab and a project's room, built to Mona Lisa's slice 9 spec
// (#6838, 24 Oct). The list is the board's Roadmap shape (sub-projects under their parent); the room reuses the chat's
// bubbles with a sender on every row. Members, files, tasks and settings stay on the board's project page, one tap away.

// What the Projects tab and a room read, through the client's own session (BoardClient.throughMac).
@MainActor
final class RoomStore: ObservableObject {
    enum ListState: Equatable { case reaching, shown, failed }
    @Published private(set) var list: Board.ProjectList?
    @Published private(set) var listState: ListState = .reaching
    @Published private(set) var rows: [String: [Board.RoomRow]] = [:]
    @Published private(set) var older: [String: (count: Int, cursor: String?)] = [:]
    @Published private(set) var roomFailed: Set<String> = []
    @Published private(set) var loadingOlder: Set<String> = []
    // A post in the air or one that did not go, by project: its words, and the line under it once answered.
    struct Pending: Equatable, Identifiable { let id: String; let text: String; var line: String? }
    @Published private(set) var pending: [String: [Pending]] = [:]
    @Published private(set) var notes: [String: String] = [:]
    static let pageSize = 50

    private let client: BoardClient
    init(client: BoardClient) { self.client = client }

    func loadList() async {
        #if DEBUG
        if Self.sample { list = Board.parseProjects(Data(Self.sampleProjects.utf8)); listState = .shown; return }
        #endif
        let answer = await client.throughMac { Board.projectsRequest(mac: $0) }
        if let answer, answer.1.statusCode == 200, let parsed = Board.parseProjects(answer.0) {
            list = parsed; listState = .shown
        } else if list == nil {
            listState = .failed
        }
    }

    // The newest page, merged into what is shown (a post written late can land inside it; ios/README.md).
    func loadRoom(_ project: String) async {
        #if DEBUG
        if Self.sample {
            rows[project] = Board.parseRoom(Data(Self.sampleRoom.utf8), names: names)?.rows ?? []
            older[project] = (0, nil); return
        }
        #endif
        let answer = await client.throughMac { Board.roomRequest(mac: $0, project: project, n: Self.pageSize) }
        guard let answer, answer.1.statusCode == 200, let page = Board.parseRoom(answer.0, names: names) else {
            roomFailed.insert(project); return
        }
        roomFailed.remove(project)
        let wasEmpty = rows[project] == nil
        rows[project] = Board.mergeRoom(rows[project] ?? [], with: page.rows)
        if wasEmpty { older[project] = (page.olderCount, page.olderCursor) }
        settle(project)
    }

    // The page before the oldest one shown, by the computer's own cursor.
    func loadOlder(_ project: String) async {
        guard let cursor = older[project]?.cursor, !loadingOlder.contains(project) else { return }
        loadingOlder.insert(project)
        defer { loadingOlder.remove(project) }
        let answer = await client.throughMac { Board.roomRequest(mac: $0, project: project, n: Self.pageSize, cursor: cursor) }
        guard let answer, answer.1.statusCode == 200, let page = Board.parseRoom(answer.0, names: names) else { return }
        rows[project] = Board.mergeRoom(page.rows, with: rows[project] ?? [])
        older[project] = (page.olderCount, page.olderCursor)
    }

    func post(_ text: String, to project: String, replyTo: String?) async {
        let item = Pending(id: UUID().uuidString, text: text.trimmingCharacters(in: .whitespacesAndNewlines), line: nil)
        guard !item.text.isEmpty else { return }
        pending[project, default: []].append(item)
        #if DEBUG
        if Self.sample { pending[project]?.removeAll { $0.id == item.id }; return }
        #endif
        let answer = await client.throughMac { Board.roomPostRequest(mac: $0, project: project, text: item.text, replyTo: replyTo) }
        let result = Board.roomPostResult(status: answer?.1.statusCode ?? 0, body: answer?.0)
        if case let .posted(note) = result {
            notes[project] = note
            pending[project]?.removeAll { $0.id == item.id }
            await loadRoom(project)
        } else if let i = pending[project]?.firstIndex(where: { $0.id == item.id }) {
            pending[project]?[i].line = Board.roomPostLine(result)
        }
    }

    func discard(_ id: String, in project: String) { pending[project]?.removeAll { $0.id == id } }

    // The room is seen while it is on screen (the board's pjMarkSeen).
    func markSeen(_ project: String) async {
        #if DEBUG
        if Self.sample { return }
        #endif
        _ = await client.throughMac { mac in
            guard Board.isProjectId(project) else { return nil }
            var r = URLRequest(url: URL(string: "/api/project/\(project)/seen", relativeTo: mac)!.absoluteURL)
            r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Accept")
            return r
        }
    }

    // A pending post the room now shows (same words, by the person) is dropped: the room's row replaces it.
    private func settle(_ project: String) {
        let mine = Set((rows[project] ?? []).filter { $0.byPerson }.map { $0.text })
        pending[project]?.removeAll { $0.line == nil && mine.contains($0.text) }
    }

    // A reaction toggles (the board's route adds it, or takes the person's own back); the room is re-read after.
    func react(_ emoji: String, to row: Board.RoomRow, in project: String) async {
        guard row.kind == .post, Board.isProjectId(project) else { return }
        #if DEBUG
        if Self.sample { return }
        #endif
        _ = await client.throughMac { mac in
            var r = URLRequest(url: URL(string: "/api/project/\(project)/room/\(row.id)/react", relativeTo: mac)!.absoluteURL)
            r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Accept")
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: ["emoji": emoji])
            return r
        }
        await loadRoom(project)
    }

    // The project's members the board says need the person now (their card's tone), for the pinned line.
    func waitingMembers(_ project: Board.ProjectRow) -> [Board.Agent] {
        let members = Set(project.members.map { $0.session })
        return client.agents.filter { members.contains($0.session) && (Board.tone($0) == .needsYou || Board.tone($0) == .asked) }
    }

    func agent(_ session: String?) -> Board.Agent? { session.flatMap { s in client.agents.first { $0.session == s } } }
    var clientForChat: BoardClient { client }
    var macURL: URL? { client.macURL }

    var names: [String: String] { Dictionary(client.agents.map { ($0.session, $0.name) }, uniquingKeysWith: { a, _ in a }) }
    func picture(_ session: String?) -> UIImage? { session.flatMap { client.pictures[$0] }.flatMap { UIImage(data: $0) } }

    #if DEBUG
    // The sample Projects tab (KOSMOS_SAMPLE_AGENTS=1, a Debug build only), for screenshots.
    static var sample: Bool { ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" }
    static let sampleProjects = #"{"agentsUnreadable":false,"projects":[{"id":"springcatalogue","name":"Spring catalogue","description":"The print catalogue for March.","unread":3,"parent":null,"archived":false,"paused":false,"createdAt":"2026-10-20T10:00:00.000Z","agents":[{"sessionName":"cleo","name":"Cleo"},{"sessionName":"dana","name":"Dana"},{"sessionName":"eli","name":"Eli"}],"folderState":{"state":"readable"},"summary":{"needsYou":1,"needsYouQuestions":1,"working":1}},{"id":"covershoot","name":"Cover shoot","description":"","unread":0,"parent":"springcatalogue","archived":false,"paused":false,"createdAt":"2026-10-21T10:00:00.000Z","agents":[{"sessionName":"dana","name":"Dana"}],"folderState":{"state":"readable"},"summary":{"working":1}},{"id":"website","name":"Website","description":"Shipping and returns pages.","unread":0,"parent":null,"archived":false,"paused":true,"createdAt":"2026-10-18T10:00:00.000Z","agents":[{"sessionName":"eli","name":"Eli"}],"folderState":{"state":"readable"},"summary":{}},{"id":"oldlaunch","name":"Old launch","description":"","unread":0,"parent":null,"archived":true,"archivedAt":"2026-09-01T12:00:00.000Z","paused":false,"createdAt":"2026-08-01T10:00:00.000Z","agents":[],"folderState":{"state":"readable"},"summary":{}}]}"#
    static let sampleRoom = #"{"ok":true,"olderCount":0,"olderCursor":null,"unanswered":{"m5":["dana"]},"rows":[{"kind":"note","text":"Cleo, Dana and Eli are on this project.","at":"2026-10-23T15:00:00.000Z","key":"2026-10-23T15:00:00.000Z|0"},{"kind":"post","id":"m1","from":"operator","operator":true,"text":"@cleo kick it off please","mentioned":["cleo"],"at":"2026-10-23T15:01:00.000Z"},{"kind":"post","id":"m2","from":"cleo","text":"Kick-off: the catalogue goes to print on the 3rd. Dana has copy, Eli has research, I have the printer.","mentioned":[],"at":"2026-10-23T15:02:00.000Z"},{"kind":"post","id":"m3","from":"eli","text":"Competitor prices are in the shared sheet, tab March. Two of them undercut us on the linen range by about 8%.","replyTo":"m2","mentioned":[],"reactions":[{"emoji":"🔥","count":1,"mine":true}],"at":"2026-10-23T15:05:00.000Z"},{"kind":"post","id":"m4","from":"dana","text":"Copy for pages 1 to 8 is done. Pages 9 to 12 wait for the new photos.","mentioned":[],"at":"2026-10-23T15:08:00.000Z"},{"kind":"external","id":"x-1","from":"Maple","fromKind":"agent","text":"Our side has the photos; they go over tonight.","at":"2026-10-23T15:10:00.000Z"},{"kind":"post","id":"m5","from":"operator","operator":true,"text":"@dana thanks, start on 9 to 12 when they land.","mentioned":["dana"],"at":"2026-10-23T15:12:00.000Z"}]}"#
    #endif
}

struct ProjectsView: View {
    @ObservedObject var client: BoardClient
    @StateObject private var store: RoomStore
    let openPage: (URL) -> Void
    @AppStorage("kosmos.projects.sort") private var sortRaw = Board.ProjectSort.newest.rawValue
    @State private var openProject: Board.ProjectRow?
    @State private var showArchived = false

    init(client: BoardClient, openPage: @escaping (URL) -> Void) {
        self.client = client
        self.openPage = openPage
        _store = StateObject(wrappedValue: RoomStore(client: client))
    }

    private var sort: Board.ProjectSort { Board.ProjectSort(rawValue: sortRaw) ?? .newest }

    var body: some View {
        NavigationView {
            content
                .navigationTitle("Projects")
                .toolbar { ToolbarItem(placement: .navigationBarTrailing) { sortMenu } }
                .background(Palette.ground.ignoresSafeArea())
                .background(
                    NavigationLink(isActive: Binding(get: { openProject != nil }, set: { if !$0 { openProject = nil } })) {
                        if let p = openProject { RoomView(store: store, project: p, openPage: openPage) }
                    } label: { EmptyView() }
                    .hidden()
                )
        }
        .navigationViewStyle(.stack)
        .onAppear { client.show(BoardClient.projectsViewer) }
        .onDisappear { client.hide(BoardClient.projectsViewer) }
        // The list is read once the connection is live (a cold start reaches the Mac first), and on pull to refresh.
        .onChange(of: client.phase) { phase in if case .live = phase { Task { await store.loadList() } } }
        .task {
            await store.loadList()
            #if DEBUG
            // Screenshots (a Debug build only): KOSMOS_SAMPLE_PROJECT=<id> opens that sample project's room, once a launch.
            if !Self.sampleOpened, RoomStore.sample, let id = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_PROJECT"],
               let p = store.list?.projects.first(where: { $0.id == id }) {
                Self.sampleOpened = true
                openProject = p
            }
            #endif
        }
    }
    #if DEBUG
    private static var sampleOpened = false
    #endif

    // No visible "Sort" word (Josh 08-23): the symbol, with the board's four orders.
    private var sortMenu: some View {
        Menu {
            Picker("Order", selection: $sortRaw) {
                ForEach(Board.ProjectSort.allCases, id: \.rawValue) { s in Text(Board.projectSortLabel(s)).tag(s.rawValue) }
            }
        } label: { Image(systemName: "arrow.up.arrow.down") }
        .accessibilityLabel("Order: \(Board.projectSortLabel(sort))")
    }

    @ViewBuilder private var content: some View {
        if let list = store.list {
            let tree = Board.projectTree(list.projects, sort: sort)
            let archived = Board.archivedProjects(list.projects)
            if tree.isEmpty && archived.isEmpty {
                message("No projects yet.", "Point Kosmos at a folder you already have, and put an agent on it.")
            } else if tree.isEmpty {
                message("Nothing here right now.", "Everything you have is archived.")
            } else {
                List {
                    Section {
                        ForEach(tree) { row in
                            Button { openProject = row.project } label: {
                                ProjectRowView(project: row.project, depth: row.depth, unreadable: list.agentsUnreadable, store: store)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if !archived.isEmpty {
                        Section {
                            DisclosureGroup(isExpanded: $showArchived) {
                                ForEach(archived) { p in ArchivedRow(project: p) }
                            } label: { Text("Archived (\(archived.count))").font(.callout).foregroundColor(Palette.primary) }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .refreshable { await store.loadList() }
            }
        } else if store.listState == .failed {
            message("We cannot read your projects right now.", "This is not saying you have none, it is saying we cannot see them.")
        } else {
            VStack(spacing: 8) {
                ProgressView()
                Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func message(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.headline).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
            Text(detail).font(.subheadline).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
        }
        .padding().frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ProjectRowView: View {
    let project: Board.ProjectRow
    let depth: Int
    let unreadable: Bool
    @ObservedObject var store: RoomStore

    private var word: Board.ProjectWord? { Board.projectWord(project, agentsUnreadable: unreadable) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(project.name).font(.callout.weight(.semibold)).foregroundColor(Palette.primary).lineLimit(1)
                if let bubble = Board.unreadBubble(project.unread) { UnreadBubble(text: bubble) }
                Spacer(minLength: 8)
                if let word { Text(Board.projectWordText(word)).font(.footnote.weight(.semibold)).foregroundColor(wordColor(word)) }
            }
            if !project.description.isEmpty {
                Text(project.description).font(.footnote).foregroundColor(Palette.secondary).lineLimit(1)
            }
            faces
            if let problem = project.folderProblem {
                Text(problem + ".").font(.footnote).foregroundColor(Palette.dangerWord)
            }
        }
        .padding(.leading, CGFloat(depth) * 16)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens the room")
    }

    private func wordColor(_ w: Board.ProjectWord) -> Color {
        switch w {
        case .question: return Palette.askedWord
        case .issue: return Palette.dangerWord
        case .working: return Palette.dot(.working)
        case .paused, .restarting: return Palette.secondary
        }
    }

    @ViewBuilder private var faces: some View {
        if !project.members.isEmpty {
            HStack(spacing: 4) {
                ForEach(project.members.prefix(5), id: \.session) { m in
                    AgentAvatar(name: m.name, picture: store.picture(m.session), tone: nil, size: 22)
                }
                Text(project.members.count == 1 ? "1 agent" : "\(project.members.count) agents")
                    .font(.footnote).foregroundColor(Palette.secondary).padding(.leading, 2)
            }
            .accessibilityHidden(true)
        }
    }

    private var spoken: String {
        var parts = [project.name]
        if let word { parts.append(Board.projectWordText(word)) }
        if let u = project.unread, u > 0 { parts.append("\(u) unread") }
        if !project.description.isEmpty { parts.append(project.description) }
        parts.append(project.members.count == 1 ? "1 agent" : "\(project.members.count) agents")
        return parts.joined(separator: ", ")
    }
}

// The board's unread bubble (.pj-unread: #d93a2f, white, 11pt bold, at least 18pt tall).
struct UnreadBubble: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(.white)
            .padding(.horizontal, 5)
            .frame(minWidth: 18, minHeight: 18)
            .background(Capsule().fill(Color(red: 0xd9 / 255, green: 0x3a / 255, blue: 0x2f / 255)))
            .accessibilityHidden(true)
    }
}

struct ArchivedRow: View {
    let project: Board.ProjectRow
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(project.name).font(.callout).foregroundColor(Palette.primary)
            Text(project.archivedAt.map { "Archived " + $0.formatted(date: .abbreviated, time: .omitted) } ?? "Archived")
                .font(.footnote).foregroundColor(Palette.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
