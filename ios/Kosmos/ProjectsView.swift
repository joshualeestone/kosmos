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
    // kosmos#7072: the rooms held at their last newest-page read, with when each should lift (nil: it did not say).
    @Published private(set) var held: [String: Date?] = [:]
    // Each room's newest-page reads in the order they started, and the read count when a reopen landed: a read started
    // before the reopen never writes the hold back (review 1: an older poll landing late brought the notice back).
    private var roomReads: [String: Int] = [:]
    private var reopenedAt: [String: Int] = [:]
    @Published private(set) var loadingOlder: Set<String> = []
    // Rooms whose last older-page read failed: the top of the room offers it again rather than spinning.
    @Published private(set) var olderFailed: Set<String> = []
    // A post in the air or one that did not go, by project: its words, the line under it once answered, and the ids of
    // the person's posts already in the room when Post was pressed (so an earlier post with the same words never
    // settles it).
    struct Pending: Equatable, Identifiable {
        let id: String; let text: String; var line: String?; var before: Set<String> = []
        // The newest row's time when Post was pressed: only a row after it can be this post.
        var after: Date? = nil
    }
    @Published private(set) var pending: [String: [Pending]] = [:]
    @Published private(set) var notes: [String: String] = [:]
    // Words a post that did not go hands back to the box, by project, kept here (the board's PJ_ROOM_DRAFTS) so they
    // survive leaving the room before the answer comes; the room takes them when its box is empty.
    struct Returned: Equatable { let text: String; let replyTo: Board.RoomRow?; let pendingId: String }
    @Published private(set) var returned: [String: Returned] = [:]
    // The words of a not-confirmed post the room now shows as kept: a box still holding exactly them is cleared, so
    // the same post is not sent twice (the board's pend.onKept).
    @Published private(set) var kept: [String: String] = [:]
    // The room's unsent box, by project (the board's PJ_ROOM_DRAFTS): what was typed, the reply and its @name, kept when
    // the person leaves the room or another room replaces it. Not published: the room writes it as the box changes.
    struct Draft { var text = ""; var replyTo: Board.RoomRow?; var mention: String? }
    var drafts: [String: Draft] = [:]
    static let pageSize = 50

    private let client: BoardClient
    init(client: BoardClient) { self.client = client }

    // Sign-out, another account or another Mac (the client's chatEpoch): nothing of the one before is kept, and a read
    // that was in the air when it moved is dropped (each read checks `same`).
    func reset() {
        list = nil; listState = .reaching
        rows = [:]; older = [:]; roomFailed = []; loadingOlder = []; olderFailed = []; pending = [:]; notes = [:]
        returned = [:]; kept = [:]; drafts = [:]
        held = [:]; roomReads = [:]; reopenedAt = [:]   // kosmos#7072 review 1: another account or computer's holds go too
    }
    private func same(_ epoch: Int) -> Bool { epoch == client.chatEpoch }
    private var listReads = 0
    private var listApplied = 0

    func loadList() async {
        #if DEBUG
        if Self.sample { list = Board.parseProjects(Data(Self.sampleProjects.utf8)); listState = .shown; return }
        #endif
        // Not connected yet (a cold start, or the Mac asking for Allow): still reaching, never "we cannot read your
        // projects". Signed out, no Mac, or unreachable is a real "cannot read".
        if client.macURL == nil {
            switch client.phase {
            case .starting, .connecting, .waitingForAllow: return
            default: if list == nil { listState = .failed }; return
            }
        }
        let epoch = client.chatEpoch
        listReads += 1
        let read = listReads
        let answer = await client.throughMac { Board.projectsRequest(mac: $0) }
        // An older read landing after a newer one never replaces it (the 5-second poll and a notification's re-read
        // overlap).
        // A read cancelled (the tab left mid-read) is no answer, never "cannot read".
        guard same(epoch), read > listApplied, !Task.isCancelled else { return }
        listApplied = read
        if let answer, answer.1.statusCode == 200, let parsed = Board.parseProjects(answer.0) {
            list = parsed; listState = .shown
        } else if list == nil {
            listState = .failed
        }
    }

    // The newest page, merged into what is shown (a post written late can land inside it; ios/README.md).
    // True when the read landed. A read cancelled (the room left, a member's chat pushed over it) is no answer, never
    // "we cannot read this room".
    @discardableResult
    func loadRoom(_ project: String) async -> Bool {
        #if DEBUG
        if Self.sample {
            rows[project] = Board.parseRoom(Data(Self.sampleRoom.utf8), names: names)?.rows ?? []
            // kosmos#7072: KOSMOS_SAMPLE_HELD=1 shows the sample room held, for its screenshots (a Debug build only).
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_HELD"] == "1", !Self.sampleReopened.contains(project) {
                held[project] = .some(Self.sampleHeldUntil)
            }
            older[project] = (0, nil); return true
        }
        #endif
        let epoch = client.chatEpoch
        roomReads[project, default: 0] += 1
        let read = roomReads[project]!
        let answer = await client.throughMac { Board.roomRequest(mac: $0, project: project, n: Self.pageSize) }
        guard same(epoch), !Task.isCancelled else { return false }
        guard let answer, answer.1.statusCode == 200, let page = Board.parseRoom(answer.0, names: names) else {
            roomFailed.insert(project); return false
        }
        roomFailed.remove(project)
        if Board.readMayWriteHold(read: read, reopenedAt: reopenedAt[project]) { if page.held { held[project] = .some(page.heldUntil) } else { held[project] = nil } }
        let fresh = Board.refreshRoom(rows[project], older: older[project], page: page)
        rows[project] = fresh.rows
        older[project] = fresh.older
        settle(project)
        return true
    }

    // The page before the oldest one shown, by the computer's own cursor.
    func loadOlder(_ project: String) async {
        guard let cursor = older[project]?.cursor, !loadingOlder.contains(project) else { return }
        loadingOlder.insert(project)
        olderFailed.remove(project)
        defer { loadingOlder.remove(project) }
        let epoch = client.chatEpoch
        let answer = await client.throughMac { Board.roomRequest(mac: $0, project: project, n: Self.pageSize, cursor: cursor) }
        guard same(epoch), older[project]?.cursor == cursor else { return }   // a re-read replaced the room meanwhile
        guard let answer, answer.1.statusCode == 200, let page = Board.parseRoom(answer.0, names: names) else {
            olderFailed.insert(project); return
        }
        rows[project] = Board.mergeRoom(page.rows, with: rows[project] ?? [])
        older[project] = (page.olderCount, page.olderCursor)
    }

    // Posts the words. Kept: the room is re-read, then the bubble goes (so the post never blinks out). Otherwise, as the
    // board's pjPostSend: the bubble stays, marked Not posted or Not confirmed (with Delete), the words go back to the
    // box, and the sentence goes under it (the computer's own, or the board's unsure one). A not-confirmed post a read
    // then shows kept settles, and a box still holding those words is cleared (`kept`).
    func post(_ text: String, to project: String, replyTo: Board.RoomRow?) async {
        let mine = Set((rows[project] ?? []).filter { $0.byPerson }.map { $0.id })
        let newest = (rows[project] ?? []).compactMap { $0.at }.max()
        let item = Pending(id: UUID().uuidString, text: text.trimmingCharacters(in: .whitespacesAndNewlines), line: nil, before: mine, after: newest)
        guard !item.text.isEmpty else { return }
        notes[project] = nil   // the last post's line goes at the next press, as on the board
        pending[project, default: []].append(item)
        #if DEBUG
        if Self.sample { pending[project]?.removeAll { $0.id == item.id }; return }
        #endif
        let epoch = client.chatEpoch
        let result: Board.RoomPostResult
        if let sure = Board.roomPostRefusedBeforeSending(text: item.text, connected: client.macURL != nil) {
            // Nothing was sent, so it is Not posted, never Not confirmed.
            result = sure
        } else {
            let answer = await client.throughMac { Board.roomPostRequest(mac: $0, project: project, text: item.text, replyTo: replyTo?.id) }
            guard same(epoch) else { return }
            // No answer because the connection went between the check and the send: nothing left, so Not posted.
            result = answer == nil && client.macURL == nil
                ? (Board.roomPostRefusedBeforeSending(text: item.text, connected: false) ?? .unsure)
                : Board.roomPostResult(status: answer?.1.statusCode ?? 0, body: answer?.0)
        }
        switch result {
        case let .posted(note):
            // A read that shows the post settles its bubble (inside loadRoom). Once a re-read has landed, the bubble
            // goes even if it did not match (the board's #6168: kept is kept); a re-read that failed leaves it, so a
            // kept post never disappears while the room cannot be read.
            if await loadRoom(project) { pending[project]?.removeAll { $0.id == item.id } }
            notes[project] = note
        case .refused, .unsure:
            if pending[project]?.contains(where: { $0.id == item.id }) != true {
                // A read already settled it on a same-words row: not confirmed, that row is the post. Refused, it was
                // someone else's (or an older) post, so the bubble comes back, marked (the board's pjPostSend).
                guard case .refused = result else { return }
                pending[project, default: []].append(item)
            }
            guard let i = pending[project]?.firstIndex(where: { $0.id == item.id }) else { return }
            pending[project]?[i].line = Board.roomPostLine(result)
            if case let .refused(because) = result { notes[project] = because } else { notes[project] = Board.roomUnsureLine }
            returned[project] = Returned(text: item.text, replyTo: replyTo, pendingId: item.id)
        }
    }

    func discard(_ id: String, in project: String) {
        pending[project]?.removeAll { $0.id == id }
        if returned.values.contains(where: { $0.pendingId == id }) { returned = returned.filter { $0.value.pendingId != id } }
    }

    // The room's box is empty and takes the handed-back words (once).
    func takeReturned(_ project: String) -> Returned? { returned.removeValue(forKey: project) }
    func clearKept(_ project: String) { kept[project] = nil }

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

    // kosmos#7072: the board's Reopen the room. On a reopen the notice goes now, before the re-read, so a re-read that
    // fails cannot leave a held notice with a dead button (pjHeldReopenClick); a refusal carries the board's sentence.
    func reopen(_ project: String) async -> Board.ReopenOutcome {
        #if DEBUG
        if Self.sample { Self.sampleReopened.insert(project); held[project] = nil; return .reopened }
        #endif
        let epoch = client.chatEpoch
        let answer = await client.throughMac { Board.reopenRequest(mac: $0, project: project) }
        guard same(epoch) else { return .dropped }
        if let refusal = Board.reopenRefusal(status: answer?.1.statusCode, answer?.0) { return .refused(refusal) }
        held[project] = nil
        reopenedAt[project] = roomReads[project] ?? 0
        // The re-read is the caller's next step (RoomView announces first, then reads: review 2, so a hold found by
        // the re-read is said after "Reopened", never before it).
        return .reopened
    }

    // A pending or not-confirmed post the room now shows is dropped: the room's row replaces it. A refused one never
    // settles (it did not go).
    private func settle(_ project: String) {
        guard let list = pending[project], !list.isEmpty else { return }
        let unsure = Board.roomPostLine(.unsure)
        let open = list.enumerated().filter { $0.element.line == nil || $0.element.line == unsure }
        let done = Board.settledPosts(open.map { ($0.element.text, $0.element.before, $0.element.after) }, rows: rows[project] ?? [])
        let gone = Set(done.map { open[$0].element.id })
        guard !gone.isEmpty else { return }
        for p in list where gone.contains(p.id) && p.line != nil {
            // A not-confirmed post that was kept: its words are not handed back, and a box holding them is cleared.
            if returned[project]?.pendingId == p.id { returned[project] = nil }
            kept[project] = p.text
            if notes[project] == Board.roomUnsureLine { notes[project] = nil }
        }
        pending[project]?.removeAll { gone.contains($0.id) }
    }

    // A reaction toggles (the board's route adds it, or takes the person's own back); the room is re-read after.
    func react(_ emoji: String, to row: Board.RoomRow, in project: String) async {
        // Post ids are the room's m<digits>; anything else is never put into a path.
        guard row.kind == .post, Board.isProjectId(project), row.id.range(of: #"^m\d{1,15}$"#, options: .regularExpression) != nil else { return }
        #if DEBUG
        if Self.sample { return }
        #endif
        let epoch = client.chatEpoch
        let answer = await client.throughMac { mac in
            var r = URLRequest(url: URL(string: "/api/project/\(project)/room/\(row.id)/react", relativeTo: mac)!.absoluteURL)
            r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Accept")
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: ["emoji": emoji])
            return r
        }
        // The post's fresh pills from the answer itself: the re-read below reaches only the newest page.
        guard same(epoch) else { return }
        if let answer, answer.1.statusCode == 200, let got = Board.reacted(answer.0),
           let k = rows[project]?.firstIndex(where: { $0.id == got.of }) {
            rows[project]?[k].reactions = got.reactions
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
    // The sample hold: one lift time for the launch, and gone for good once reopened (review 3: re-reads brought it back).
    static let sampleHeldUntil = Date().addingTimeInterval(40 * 60)
    static var sampleReopened: Set<String> = []
    static let sampleRoom = #"{"ok":true,"olderCount":0,"olderCursor":null,"unanswered":{"m5":["dana"]},"rows":[{"kind":"note","text":"Cleo, Dana and Eli are on this project.","at":"2026-10-23T15:00:00.000Z","key":"2026-10-23T15:00:00.000Z|0"},{"kind":"post","id":"m1","from":"operator","operator":true,"text":"@cleo kick it off please","mentioned":["cleo"],"at":"2026-10-23T15:01:00.000Z"},{"kind":"post","id":"m2","from":"cleo","text":"Kick-off: the catalogue goes to print on the 3rd. Dana has copy, Eli has research, I have the printer.","mentioned":[],"at":"2026-10-23T15:02:00.000Z"},{"kind":"post","id":"m3","from":"eli","text":"Competitor prices are in the shared sheet, tab March. Two of them undercut us on the linen range by about 8%.","replyTo":"m2","mentioned":[],"reactions":[{"emoji":"🔥","count":1,"mine":true}],"at":"2026-10-23T15:05:00.000Z"},{"kind":"post","id":"m4","from":"dana","text":"Copy for pages 1 to 8 is done. Pages 9 to 12 wait for the new photos.","mentioned":[],"at":"2026-10-23T15:08:00.000Z"},{"kind":"external","id":"x-1","from":"Maple","fromKind":"agent","text":"Our side has the photos; they go over tonight.","at":"2026-10-23T15:10:00.000Z"},{"kind":"post","id":"m5","from":"operator","operator":true,"text":"@dana thanks, start on 9 to 12 when they land.","mentioned":["dana"],"at":"2026-10-23T15:12:00.000Z"}]}"#
    #endif
}

struct ProjectsView: View {
    @ObservedObject var client: BoardClient
    @StateObject private var store: RoomStore
    @Binding var roomRequest: PushBridge.RoomTarget?
    let openPage: (URL) -> Void
    @AppStorage("kosmos.projects.sort") private var sortRaw = Board.ProjectSort.newest.rawValue
    @State private var openProject: Board.ProjectRow?
    // A notification's room was not in the list: it has had its one fresh read.
    @State private var listReread = false
    @State private var listShown = false
    @State private var showArchived = false

    init(client: BoardClient, roomRequest: Binding<PushBridge.RoomTarget?>, openPage: @escaping (URL) -> Void) {
        self.client = client
        self._roomRequest = roomRequest
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
                        // One view per room: a notification for another room while one is open starts fresh, never
                        // with the first room's draft, reply or polling.
                        if let p = openProject { RoomView(store: store, client: store.clientForChat, opened: p, openPage: openPage).id(p.id) }
                    } label: { EmptyView() }
                    .hidden()
                )
        }
        .navigationViewStyle(.stack)
        .onAppear { listShown = true; client.show(BoardClient.projectsViewer) }
        .onDisappear { listShown = false; client.hide(BoardClient.projectsViewer) }
        // The list is read again whenever the connection changes (a cold start reaches the Mac first), and on pull to refresh.
        .onChange(of: client.phase) { _ in Task { await store.loadList(); openRequested() } }
        .onChange(of: roomRequest) { _ in openRequested() }
        // Sign-out, another account or another Mac: the room open and every room read go with it (as AgentsView).
        .onChange(of: client.chatEpoch) { _ in openProject = nil; store.reset() }
        // Back from a room: its unread bubble and the other rooms' words are read again.
        .onChange(of: openProject?.id) { id in if id == nil { Task { await store.loadList() } } }
        .onChange(of: store.list) { _ in openRequested() }
        .onChange(of: store.listState) { _ in openRequested() }
        // While the list is the screen shown, it follows the client's 5-second poll (status words and unread bubbles),
        // as the board's list repaints on its own.
        .onChange(of: client.updatedAt) { _ in if listShown && openProject == nil { Task { await store.loadList() } } }
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

    // A room a notification asked for opens once the list has it. A project the list does not have (removed since,
    // or archived) opens the board's own room page instead, so a tap never lands nowhere.
    private func openRequested(afterReread: Bool = false) {
        guard let target = roomRequest else { return }
        let id = target.project
        // The list cannot be read: the board's own room page now, rather than a room that pushes itself much later.
        guard let list = store.list else {
            if store.listState == .failed { roomRequest = nil; listReread = false; openBoardRoom(target) }
            return
        }
        if let p = list.projects.first(where: { $0.id == id && !$0.archived }) {
            roomRequest = nil
            listReread = false
            openProject = p
            return
        }
        // Not in the list as read: a room made since gets one fresh read before the board's page is the answer, and
        // only that read decides (a poll read that lands first is not it).
        if !listReread {
            listReread = true
            Task { await store.loadList(); openRequested(afterReread: true) }
            return
        }
        guard afterReread else { return }
        listReread = false
        roomRequest = nil
        openBoardRoom(target)
    }

    // The board's room page for the computer the notification named: its host rides the request, so this works even
    // when the client is not connected (usually why the list could not be read).
    private func openBoardRoom(_ target: PushBridge.RoomTarget) {
        if let url = PushBridge.roomBoardURL(target) { openPage(url) }
    }

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
            } else {
                List {
                    if tree.isEmpty {
                        // Everything archived: the sentence, and the Archived fold under it so they can still be reached
                        // (the board keeps its disclosure beside the same words).
                        Section {
                            VStack(spacing: 6) {
                                Text("Nothing here right now.").font(.headline).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
                                Text("Everything you have is archived.").font(.subheadline).foregroundColor(Palette.secondary)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                        }
                    } else {
                        Section {
                            ForEach(tree) { row in
                                Button { openProject = row.project } label: {
                                    ProjectRowView(project: row.project, depth: row.depth, unreadable: list.agentsUnreadable, store: store)
                                }
                                .buttonStyle(.plain)
                            }
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
        .frame(minHeight: 64)   // the spec's row: slice 1 geometry
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
