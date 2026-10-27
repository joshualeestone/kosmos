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
    // kosmos#7096: rooms whose last read said it could not read all of it (ok false): a search there cannot say nothing
    // matches (the board's paint holds the sentence back on body.ok === false).
    @Published private(set) var roomPartial: Set<String> = []
    // kosmos#7080: when each agent's latest post reached each room (as this phone learned it), for the working line's
    // "spoke after the status was read" rule (the board's ROOM_SPOKE_AT).
    @Published private(set) var spokeAt: [String: [String: Date]] = [:]
    // The rooms that have had one real newest-page read: only then are the rows a baseline for who spoke since (review 2:
    // a first read an older computer could not answer, ok:false at 200, left an empty room, and the next read stamped
    // everyone in it; a current computer's 503 never reaches the stamping at all). Only
    // ever added to, as the board's ROOM_SPOKE_SEEDED (review 3: a later unreadable read leaves the rows as they were,
    // so they stay a baseline; dropping it would leave the next reply unstamped, under its own "is working").
    private var spokeBaseline: Set<String> = []
    // The agents whose post reached this room after `statusAt` (the status read the line is drawn from).
    func spokeSince(_ statusAt: Date?, in project: String) -> Set<String> {
        Board.spokeSince(spokeAt[project] ?? [:], statusAt: statusAt)
    }

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
        // kosmos#7093: the files it carries, off the box's chips while it is in the air; and whether the computer kept
        // it (it may stay while the room cannot be re-read, but its files no longer count toward the ten: review 3).
        var files: [Board.Attached] = []
        var kept = false
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
    // kosmos#7137: the own-compare read by project (whether this computer has a code and waits to be let in), for the
    // line above a shared room. Never the code itself.
    @Published private(set) var ownCompare: [String: Board.OwnCompareKept] = [:]
    private var ownSeq: [String: Int] = [:]
    private var ownAsk: [String: Board.OwnAsk] = [:]
    static let ownEvery: TimeInterval = 10
    static let pageSize = 50

    private let client: BoardClient
    init(client: BoardClient) { self.client = client }

    // Sign-out, another account or another Mac (the client's chatEpoch): nothing of the one before is kept, and a read
    // that was in the air when it moved is dropped (each read checks `same`).
    func reset() {
        list = nil; listState = .reaching
        rows = [:]; older = [:]; roomFailed = []; roomPartial = []; loadingOlder = []; olderFailed = []; pending = [:]; notes = [:]
        returned = [:]; kept = [:]; drafts = [:]; needsFailed = [:]; ownCompare = [:]; ownSeq = [:]; ownAsk = [:]
        held = [:]; roomReads = [:]; reopenedAt = [:]; spokeAt = [:]; spokeBaseline = []; cameBack = [:]   // kosmos#7072 review 1: another account or computer's holds go too
    }
    private func same(_ epoch: Int) -> Bool { epoch == client.chatEpoch }
    private var listReads = 0
    private var listApplied = 0

    // True when a read landed and was applied (kosmos#7106: a dismiss is said done only once the list shows it).
    @discardableResult
    func loadList() async -> Bool {
        #if DEBUG
        if Self.sample { list = Board.parseProjects(Data(Self.sampleProjects.utf8)); listState = .shown; return true }
        #endif
        // Not connected yet (a cold start, or the Mac asking for Allow): still reaching, never "we cannot read your
        // projects". Signed out, no Mac, or unreachable is a real "cannot read".
        if client.macURL == nil {
            switch client.phase {
            case .starting, .connecting, .waitingForAllow: return false
            default: if list == nil { listState = .failed }; return false
            }
        }
        let epoch = client.chatEpoch
        listReads += 1
        let read = listReads
        let answer = await client.throughMac { Board.projectsRequest(mac: $0) }
        // An older read landing after a newer one never replaces it (the 5-second poll and a notification's re-read
        // overlap).
        // A read cancelled (the tab left mid-read) is no answer, never "cannot read".
        guard same(epoch), read > listApplied, !Task.isCancelled else { return false }
        listApplied = read
        if let answer, answer.1.statusCode == 200, let parsed = Board.parseProjects(answer.0) {
            list = parsed; listState = .shown
            return true
        } else if list == nil {
            listState = .failed
        }
        return false
    }

    // kosmos#7137: the board's own-compare read for the line above a shared room, as its fedOwnLoad and fedOwnTick:
    // offered with each room read, landed or not, and asked only when Board.ownShouldAsk says (never while one is in
    // flight, then 10 s after the last finished). Only the newest read for a project writes (FED_OWN_SEQ); any 2xx JSON
    // answer replaces what is kept, and a failed read keeps it through two misses (Board.ownCompareAfter). While the
    // shared-room UI is not shown it is not asked and what was kept is forgotten (the board keeps it).
    func loadOwnCompare(_ project: String) async {
        guard client.fedShown else { ownCompare[project] = nil; return }
        guard Board.ownShouldAsk(ownAsk[project], now: Date(), every: Self.ownEvery) else { return }
        ownAsk[project, default: Board.OwnAsk()].inFlight = true
        let epoch = client.chatEpoch
        ownSeq[project, default: 0] += 1
        let seq = ownSeq[project]!
        let answer = await client.throughMac { Board.ownCompareRequest(mac: $0, project: project) }
        // A read from before an entry or an account change is dropped; those reset ownAsk, so nothing is left in flight.
        guard same(epoch), ownSeq[project] == seq else { return }
        ownAsk[project] = Board.OwnAsk(inFlight: false, doneAt: Date())
        let read = answer.flatMap { (200...299).contains($0.1.statusCode) ? Board.parseOwnCompare($0.0) : nil }
        ownCompare[project] = Board.ownCompareAfter(ownCompare[project], answer: read)
    }
    // Entering the room starts it empty, as the board's fedOwnReset on entering a project: a previous visit's answer is
    // not drawn before this visit's read lands, a read still in the air is dropped (a newer seq), and it asks at once.
    func enterOwnCompare(_ project: String) { ownCompare[project] = nil; ownSeq[project, default: 0] += 1; ownAsk[project] = nil }
    func ownSealLine(_ project: String) -> String? { Board.ownSealLine(ownCompare[project]?.compare, fedShown: client.fedShown) }

    // The newest page, merged into what is shown (a post written late can land inside it; ios/README.md).
    // True when the read landed. A read cancelled (the room left, a member's chat pushed over it) is no answer, never
    // "we cannot read this room".
    @discardableResult
    func loadRoom(_ project: String) async -> Bool {
        #if DEBUG
        if Self.sample {
            // kosmos#7111: KOSMOS_SAMPLE_REFUSAL=1 adds an addable refusal by Farah (not a member), for the Add shots.
            let room = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_REFUSAL"] == "1"
                ? Self.sampleRoom.replacingOccurrences(of: #"{"kind":"post","id":"m5""#, with: Self.sampleRefusal + #",{"kind":"post","id":"m5""#)
                : Self.sampleRoom
            rows[project] = Board.parseRoom(Data(room.utf8), names: names)?.rows ?? []
            // kosmos#7072: KOSMOS_SAMPLE_HELD=1 shows the sample room held, for its screenshots (a Debug build only).
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_HELD"] == "1", !Self.sampleReopened.contains(project) {
                held[project] = .some(Self.sampleHeldUntil)
            }
            older[project] = (0, nil); return true
        }
        #endif
        Task { await self.loadOwnCompare(project) }   // kosmos#7137: with each room read, landed or not (at most every 10 s)
        let epoch = client.chatEpoch
        roomReads[project, default: 0] += 1
        let read = roomReads[project]!
        let answer = await client.throughMac { Board.roomRequest(mac: $0, project: project, n: Self.pageSize) }
        guard same(epoch), !Task.isCancelled else { return false }
        guard let answer, answer.1.statusCode == 200, let page = Board.parseRoom(answer.0, names: names) else {
            roomFailed.insert(project); return false
        }
        roomFailed.remove(project)
        roomPartial = Board.partialRooms(roomPartial, project: project, partial: page.unread)
        if Board.readMayWriteHold(read: read, reopenedAt: reopenedAt[project]) { if page.held { held[project] = .some(page.heldUntil) } else { held[project] = nil } }
        let fresh = Board.refreshRoom(rows[project], older: older[project], page: page)
        // Stamped before the rows are replaced: `before` must be what the room held until this read. The phone's clock,
        // as BoardClient.updatedAt is (its env.now() is Date() outside the tests).
        let stamped = Board.stampSpeakers(spokeAt[project] ?? [:], baselined: spokeBaseline.contains(project), before: rows[project],
                                          fresh: fresh.rows, unread: page.unread, at: Date())
        spokeAt[project] = stamped.spokeAt
        if stamped.baselined { spokeBaseline.insert(project) }
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
    // kosmos#7093: a pick for this room's next post goes through the chat's own upload (BoardClient.attach), waiting
    // under the room's key. The sample rooms (a Debug build only) add it at once, as the sample chats do.
    // The files of this room's posts still in the air, counted toward the ten (Board.roomFilesCounted).
    func filesInAir(_ project: String) -> [[Board.Attached]] { (pending[project] ?? []).filter { $0.line == nil && !$0.kept }.map(\.files) }
    // The ids a refused or not-confirmed post put back on the chips, so the room does not announce them as added.
    @Published private(set) var cameBack: [String: Set<String>] = [:]
    func attach(_ pick: BoardClient.Pick, epoch: Int, to project: String) async {
        let key = Board.roomAttachKey(project)
        let counted = Board.roomFilesCounted(waiting: client.attached[key]?.count ?? 0, uploading: client.uploading[key] ?? 0,
                                             inAir: filesInAir(project))
        if let refusal = Board.uploadRefusal(size: nil, waiting: counted) { client.attachLine[key] = refusal; return }
        #if DEBUG
        let sample = Self.sample
        #else
        let sample = false
        #endif
        await client.attach(pick, epoch: epoch, key: Board.roomAttachKey(project), sample: sample) { mac, name, type in
            Board.roomUploadRequest(mac: mac, project: project, name: name, type: type)
        }
    }

    // `files` go with the words (kosmos#7093). They leave the box's chips at the press, as the chat's do, so a second
    // press or the next post can never carry them again (review 1: the board refuses a second send while one is in the
    // air, PJ_POSTING). Refused or not confirmed, they come back to the chips with the words; a not-confirmed post a
    // read then shows kept takes them off again (settle).
    func post(_ text: String, to project: String, replyTo: Board.RoomRow?, files: [Board.Attached] = []) async {
        let mine = Set((rows[project] ?? []).filter { $0.byPerson }.map { $0.id })
        let newest = (rows[project] ?? []).compactMap { $0.at }.max()
        let item = Pending(id: UUID().uuidString, text: text.trimmingCharacters(in: .whitespacesAndNewlines), line: nil, before: mine,
                           after: newest, files: files)
        guard !item.text.isEmpty else { return }
        for f in files { client.unattach(f.id, for: Board.roomAttachKey(project)) }
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
            let answer = await client.throughMac { Board.roomPostRequest(mac: $0, project: project, text: item.text, replyTo: replyTo?.id,
                                                                         attachments: files.map(\.id)) }
            guard same(epoch) else { return }
            // No answer because the connection went between the check and the send: nothing left, so Not posted.
            result = answer == nil && client.macURL == nil
                ? (Board.roomPostRefusedBeforeSending(text: item.text, connected: false) ?? .unsure)
                : Board.roomPostResult(status: answer?.1.statusCode ?? 0, body: answer?.0)
        }
        switch result {
        case let .posted(note):
            if let i = pending[project]?.firstIndex(where: { $0.id == item.id }) { pending[project]?[i].kept = true }
            // A read that shows the post settles its bubble (inside loadRoom). Once a re-read has landed, the bubble
            // goes even if it did not match (the board's #6168: kept is kept); a re-read that failed leaves it, so a
            // kept post never disappears while the room cannot be read.
            if await loadRoom(project) { pending[project]?.removeAll { $0.id == item.id } }
            notes[project] = note
        case .refused, .unsure:
            let settledByRead = pending[project]?.contains(where: { $0.id == item.id }) != true
            if Board.roomFilesAfter(result, settledByRead: settledByRead) == .comeBack {
                cameBack[project] = Set(files.map(\.id))
                client.reattach(files, for: Board.roomAttachKey(project))
            }
            if settledByRead {
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
    // kosmos#7111: an addable refusal's Add. Added: the project list and the room are read again, so the button goes with
    // the agent now a member (the board's pjReload). Refused: the route's sentence. Dropped: another account or computer.
    func addMember(_ agent: String, to project: String) async -> Board.AddMemberOutcome {
        let epoch = client.chatEpoch
        let answer = await client.throughMac { Board.addMemberRequest(mac: $0, project: project, agent: agent) }
        guard same(epoch) else { return .dropped }
        if let refusal = Board.addMemberRefusal(status: answer?.1.statusCode, answer?.0) { return .refused(refusal) }
        await loadList()
        await loadRoom(project)
        guard same(epoch) else { return .dropped }
        return .added
    }

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
            for f in p.files { client.unattach(f.id, for: Board.roomAttachKey(project)) }   // they went with it
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
    // kosmos#7106: the room's needs-you notice from the projects route's own count for THIS project (needsYouHere), as
    // the board's pjNeedsNotice; an agent's card tone can be about another project, so it is never the test here.
    func needsNotice(_ project: String) -> Board.NeedsNotice? {
        list?.projects.first(where: { $0.id == project }).flatMap { Board.needsNotice($0.members, names: names) }
    }
    // Dismiss one member's row (the board's pjNeedsDismissClick). Taken: the list is read again (twice at most, as the
    // board does) so the row goes, and the board's sentence is returned only once a read shows it; not taken: the
    // failure sentence, kept under the notice (needsFailed) until its rows change or the room opens again. Nil: nothing
    // to say (another account or computer meanwhile, or a re-read that never landed).
    // The failure sentence and the row whose Dismiss did not go (only that one reads "Try again"; review 5).
    @Published private(set) var needsFailed: [String: (session: String, said: String)] = [:]
    func dismissNeeds(_ row: Board.NeedsRow, in project: String) async -> String? {
        let epoch = client.chatEpoch
        let answer = await client.throughMac { Board.needsDismissRequest(mac: $0, project: project, agent: row.session, reason: row.key) }
        guard same(epoch) else { return nil }
        guard let said = Board.needsDismissSaid(status: answer?.1.statusCode) else { return nil }
        if said == Board.needsDismissFailed { needsFailed[project] = (row.session, said); return said }
        needsFailed[project] = nil
        var landed = await loadList()
        if !landed { landed = await loadList() }
        guard same(epoch), landed else { return nil }
        return said
    }
    func clearNeedsFailed(_ project: String) { needsFailed[project] = nil }

    func agent(_ session: String?) -> Board.Agent? { session.flatMap { s in client.agents.first { $0.session == s } } }
    var clientForChat: BoardClient { client }
    var macURL: URL? { client.macURL }

    var names: [String: String] { Dictionary(client.agents.map { ($0.session, $0.name) }, uniquingKeysWith: { a, _ in a }) }
    func picture(_ session: String?) -> UIImage? { session.flatMap { client.pictures[$0] }.flatMap { UIImage(data: $0) } }

    #if DEBUG
    // The sample Projects tab (KOSMOS_SAMPLE_AGENTS=1, a Debug build only), for screenshots.
    static var sample: Bool { ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" }
    // kosmos#7269: KOSMOS_SAMPLE_CROWD=1 adds a project of 15 members with sub-projects of 3 and 12 (and one deeper), for
    // the faces' "+N" and the connector lines in design shots.
    static var sampleProjects: String {
        guard ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_CROWD"] == "1" else { return sampleBase }
        return sampleBase.replacingOccurrences(of: #""projects":["#, with: #""projects":"# + String(sampleCrowd.dropLast()) + ",")
    }
    static let sampleCrowd = #"[{"id":"retail","name":"Retail rollout","description":"Every store, one launch day.","unread":0,"parent":null,"archived":false,"paused":false,"createdAt":"2026-10-24T10:00:00.000Z","agents":[{"sessionName":"cleo","name":"Cleo"},{"sessionName":"dana","name":"Dana"},{"sessionName":"eli","name":"Eli"},{"sessionName":"farah","name":"Farah"},{"sessionName":"gus","name":"Gus"},{"sessionName":"iris","name":"Iris"},{"sessionName":"jun","name":"Jun"},{"sessionName":"kai","name":"Kai"},{"sessionName":"lena","name":"Lena"},{"sessionName":"milo","name":"Milo"},{"sessionName":"nia","name":"Nia"},{"sessionName":"otto","name":"Otto"},{"sessionName":"pia","name":"Pia"},{"sessionName":"rex","name":"Rex"},{"sessionName":"suki","name":"Suki"}],"folderState":{"state":"readable"},"summary":{"working":3}},{"id":"signage","name":"Store signage","description":"","unread":0,"parent":"retail","archived":false,"paused":false,"createdAt":"2026-10-24T11:00:00.000Z","agents":[{"sessionName":"cleo","name":"Cleo"},{"sessionName":"dana","name":"Dana"},{"sessionName":"eli","name":"Eli"}],"folderState":{"state":"readable"},"summary":{}},{"id":"training","name":"Staff training","description":"Guides and the first week.","unread":0,"parent":"retail","archived":false,"paused":false,"createdAt":"2026-10-24T12:00:00.000Z","agents":[{"sessionName":"cleo","name":"Cleo"},{"sessionName":"dana","name":"Dana"},{"sessionName":"eli","name":"Eli"},{"sessionName":"farah","name":"Farah"},{"sessionName":"gus","name":"Gus"},{"sessionName":"iris","name":"Iris"},{"sessionName":"jun","name":"Jun"},{"sessionName":"kai","name":"Kai"},{"sessionName":"lena","name":"Lena"},{"sessionName":"milo","name":"Milo"},{"sessionName":"nia","name":"Nia"},{"sessionName":"otto","name":"Otto"}],"folderState":{"state":"readable"},"summary":{"working":1}},{"id":"weekone","name":"Week one","description":"","unread":0,"parent":"training","archived":false,"paused":false,"createdAt":"2026-10-24T13:00:00.000Z","agents":[{"sessionName":"cleo","name":"Cleo"},{"sessionName":"dana","name":"Dana"}],"folderState":{"state":"readable"},"summary":{}}]"#
    static let sampleBase = #"{"agentsUnreadable":false,"projects":[{"id":"springcatalogue","name":"Spring catalogue","description":"The print catalogue for March.","unread":3,"parent":null,"archived":false,"paused":false,"createdAt":"2026-10-20T10:00:00.000Z","agents":[{"sessionName":"cleo","name":"Cleo","needsYouHere":"question","needsYouKey":"question:Which cover photo should we use?","because":"Which cover photo should we use?"},{"sessionName":"dana","name":"Dana"},{"sessionName":"eli","name":"Eli","needsYouHere":"trust","needsYouKey":"trust"}],"folderState":{"state":"readable"},"summary":{"needsYou":2,"needsYouQuestions":1,"working":1}},{"id":"covershoot","name":"Cover shoot","description":"","unread":0,"parent":"springcatalogue","archived":false,"paused":false,"createdAt":"2026-10-21T10:00:00.000Z","agents":[{"sessionName":"dana","name":"Dana"}],"folderState":{"state":"readable"},"summary":{"working":1}},{"id":"website","name":"Website","description":"Shipping and returns pages.","unread":0,"parent":null,"archived":false,"paused":true,"createdAt":"2026-10-18T10:00:00.000Z","agents":[{"sessionName":"eli","name":"Eli"}],"folderState":{"state":"readable"},"summary":{}},{"id":"oldlaunch","name":"Old launch","description":"","unread":0,"parent":null,"archived":true,"archivedAt":"2026-09-01T12:00:00.000Z","paused":false,"createdAt":"2026-08-01T10:00:00.000Z","agents":[],"folderState":{"state":"readable"},"summary":{}}]}"#
    // The sample hold: one lift time for the launch, and gone for good once reopened (review 3: re-reads brought it back).
    static let sampleHeldUntil = Date().addingTimeInterval(40 * 60)
    static var sampleReopened: Set<String> = []
    static let sampleRefusal = #"{"kind":"refused","from":"farah","because":"farah is not on this project","addable":true,"key":"2026-10-23T15:11:00.000Z|r","at":"2026-10-23T15:11:00.000Z"}"#
    static let sampleRoom = #"{"ok":true,"olderCount":0,"olderCursor":null,"unanswered":{"m5":["dana"]},"rows":[{"kind":"note","text":"Cleo, Dana and Eli are on this project.","at":"2026-10-23T15:00:00.000Z","key":"2026-10-23T15:00:00.000Z|0"},{"kind":"post","id":"m1","from":"operator","operator":true,"text":"@cleo kick it off please","mentioned":["cleo"],"at":"2026-10-23T15:01:00.000Z"},{"kind":"post","id":"m2","from":"cleo","text":"Kick-off: the catalogue goes to print on the 3rd. Dana has copy, Eli has research, I have the printer.","mentioned":[],"at":"2026-10-23T15:02:00.000Z"},{"kind":"post","id":"m3","from":"eli","text":"Competitor prices are in the shared sheet, tab March. Two of them undercut us on the linen range by about 8%.","replyTo":"m2","mentioned":[],"reactions":[{"emoji":"🔥","count":1,"mine":true}],"at":"2026-10-23T15:05:00.000Z"},{"kind":"post","id":"m4","from":"dana","text":"Copy for pages 1 to 8 is done. Pages 9 to 12 wait for the new photos.","mentioned":[],"at":"2026-10-23T15:08:00.000Z"},{"kind":"external","id":"x-1","from":"Maple","fromKind":"agent","text":"Our side has the photos; they go over tonight.","at":"2026-10-23T15:10:00.000Z"},{"kind":"post","id":"m5","from":"operator","operator":true,"text":"@dana thanks, start on 9 to 12 when they land.","mentioned":["dana"],"at":"2026-10-23T15:12:00.000Z"}]}"#
    #endif
}

struct ProjectsView: View {
    @ObservedObject var client: BoardClient
    @StateObject private var store: RoomStore
    @Binding var roomRequest: PushBridge.RoomTarget?
    let openPage: (URL) -> Void
    // kosmos#7266: the + at the top right, the board's own new-project form (ContentView.openCreate).
    var create: () -> Void = {}
    @AppStorage("kosmos.projects.sort") private var sortRaw = Board.ProjectSort.newest.rawValue
    @State private var openProject: Board.ProjectRow?
    // A notification's room was not in the list: it has had its one fresh read.
    @State private var listReread = false
    @State private var listShown = false
    @State private var showArchived = false

    init(client: BoardClient, roomRequest: Binding<PushBridge.RoomTarget?>, openPage: @escaping (URL) -> Void,
         create: @escaping () -> Void = {}) {
        self.client = client
        self._roomRequest = roomRequest
        self.openPage = openPage
        self.create = create
        _store = StateObject(wrappedValue: RoomStore(client: client))
    }

    private var sort: Board.ProjectSort { Board.ProjectSort(rawValue: sortRaw) ?? .newest }

    var body: some View {
        NavigationView {
            content
                .navigationTitle("Projects")
                .navigationBarTitleDisplayMode(.inline)   // kosmos#7343: the shared bar, no big title
                .toolbar {
                    ToolbarItem(placement: .principal) { ScreenHeading(title: "Projects") }
                    ToolbarItem(placement: .navigationBarLeading) { KosmosMark() }
                    ToolbarItem(placement: .navigationBarLeading) { MacSwitcher(client: client) }
                    // kosmos#7266 review 1: two items, not one HStack, so each keeps the toolbar's full tap target.
                    ToolbarItemGroup(placement: .navigationBarTrailing) {
                        sortMenu
                        Button(action: create) { Image(systemName: "plus").font(.body.weight(.semibold)) }
                            .accessibilityLabel("Add project")   // the board's own button says Add Project
                    }
                }
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
        // kosmos#7111 and #7106: also while a room is open, so its members and its needs-you notice follow the projects
        // route (an Add goes once the agent is a member; the board re-reads its projects while a room is on screen).
        .onChange(of: client.updatedAt) { _ in if listShown { Task { await store.loadList() } } }
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
                                    ProjectRowView(project: row.project, depth: row.depth, lastKid: row.lastKid, hasKids: row.hasKids, through: row.through,
                                                   parentName: row.depth > 0 ? list.projects.first { $0.id == row.project.parent }?.name : nil, unreadable: list.agentsUnreadable, store: store)
                                }
                                .buttonStyle(.plain)
                                // kosmos#7269: the row draws its own top and bottom space, so its connector line reaches
                                // the cell's edges and meets the next row's; no separator crosses a family's line.
                                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                                .listRowSeparator(row.depth > 0 ? .hidden : .automatic, edges: .top)
                                .listRowSeparator(row.depth > 0 && !row.lastKid ? .hidden : .automatic, edges: .bottom)
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
    var lastKid = false
    var hasKids = false
    var through: [Int] = []
    var parentName: String? = nil
    let unreadable: Bool
    @Environment(\.dynamicTypeSize) private var typeSize
    @ObservedObject var store: RoomStore

    private var word: Board.ProjectWord? { Board.projectWord(project, agentsUnreadable: unreadable) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                // Review 2: at the largest sizes a sub-project's indent leaves little room, so the name may wrap.
                Text(project.name).font(.callout.weight(.semibold)).foregroundColor(Palette.primary)
                    .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
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
        .padding(.vertical, 10)   // the list's own row inset, drawn by the row (kosmos#7269: see listRowInsets)
        .padding(.leading, CGFloat(depth) * indent)
        // Top-aligned (review 1: centred, a short row's name sat below the elbow drawn at the name's height).
        .frame(minHeight: 64, alignment: .topLeading)   // the spec's row: slice 1 geometry
        .background(alignment: .topLeading) { connector }
        // Every separator starts at the card's text edge, so the one that closes a family is not indented with its
        // last child (review 1).
        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens the room")
    }

    // kosmos#7269 (Josh: "show nesting with a connector line, light and maybe dashed, like the desktop"): the board's
    // file-tree rails (.pj-row.child::before/::after, #5712) as a light dashed line. A sub-project draws a vertical line
    // under its parent's first face, down from the top of its row, and an elbow across to its own name; the last sub-project's
    // line stops at its elbow. Unlike the board (one line at the row's own level), a deeper row also carries the lines of
    // ancestors that run on past it (`through`), so a line never breaks where a sub-project has sub-projects of its own.
    // Scaled with the faces (review 1: a fixed indent let the scaled line run through a sub-project's name at the
    // largest text sizes).
    @ScaledMetric(relativeTo: .footnote) private var indent: CGFloat = 28
    // The middle of the name's line (the row's 10pt top space plus half a callout line), scaled with the text.
    @ScaledMetric(relativeTo: .callout) private var nameMid: CGFloat = 10.5
    private static let rail = Palette.pair(0xbdb8ae, 0x4a4e55)
    @ViewBuilder private var connector: some View {
        if depth > 0 || !through.isEmpty || hasKids {
            GeometryReader { g in
                Path { path in
                    // A parent: the line's start, from under its last line (faces, name or folder problem) down to its
                    // row's bottom space, which no text is in.
                    if hasKids {
                        let px = CGFloat(depth) * indent + face / 2 + 1.5
                        path.move(to: CGPoint(x: px, y: g.size.height - 10 + 2))
                        path.addLine(to: CGPoint(x: px, y: g.size.height))
                    }
                    // An ancestor's line passing this row on to that ancestor's later sibling: the whole row's height.
                    for level in through {
                        let ax = CGFloat(level - 1) * indent + face / 2 + 1.5
                        path.move(to: CGPoint(x: ax, y: 0))
                        path.addLine(to: CGPoint(x: ax, y: g.size.height))
                    }
                    guard depth > 0 else { return }
                    // Under the centre of the parent's first face (its ring included), at the parent's own indent.
                    let x = CGFloat(depth - 1) * indent + face / 2 + 1.5
                    let mid = 10 + nameMid
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: lastKid ? mid : g.size.height))
                    path.move(to: CGPoint(x: x, y: mid))
                    path.addLine(to: CGPoint(x: CGFloat(depth) * indent - 4, y: mid))
                }
                .stroke(Self.rail, style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 3]))
            }
            .accessibilityHidden(true)
        }
    }

    private func wordColor(_ w: Board.ProjectWord) -> Color {
        switch w {
        case .question: return Palette.askedWord
        case .issue: return Palette.dangerWord
        case .working: return Palette.dot(.working)
        case .paused, .restarting: return Palette.secondary
        }
    }

    // kosmos#7269 (Josh, 2026-10-26: "remove the '5 agents' text and just show the members as small avatar bubbles",
    // "design the truncation, the first N then +3"): the members as overlapping faces, each ringed in the row's colour so
    // the overlap reads, then "+N" for the rest (Board.faceBubbles: 12 members are 9 faces and +3). Fewer faces at the
    // largest text sizes and on deep sub-projects, so the row never runs past its edge. No count and no model marks.
    @ScaledMetric(relativeTo: .footnote) private var face: CGFloat = 24
    @ViewBuilder private var faces: some View {
        if !project.members.isEmpty {
            ViewThatFits(in: .horizontal) {
                faceRow(room: 10)
                faceRow(room: 6)
                faceRow(room: 4)
                faceRow(room: 2)
            }
            .accessibilityHidden(true)
        }
    }
    private func faceRow(room: Int) -> some View {
        let fit = Board.faceBubbles(project.members.count, room: room)
        return HStack(spacing: -face * 0.25) {
            ForEach(project.members.prefix(fit.faces), id: \.session) { m in
                AgentAvatar(name: m.name, picture: store.picture(m.session), tone: nil, size: face)
                    .padding(1.5)
                    .background(Circle().fill(Palette.card))
            }
            if fit.more > 0 {
                Text("+\(fit.more)")
                    .font(.system(size: face * 0.42, weight: .semibold)).monospacedDigit()
                    .foregroundColor(Palette.secondary)
                    .padding(.horizontal, face * 0.22)
                    .frame(minWidth: face, minHeight: face)
                    .background(Capsule().fill(Palette.avatarFill))
                    .padding(1.5)
                    .background(Capsule().fill(Palette.card))
                    .fixedSize()
            }
        }
    }

    private var spoken: String {
        var parts = [project.name]
        if let parentName { parts.append("in " + parentName) }   // kosmos#7269 review 1: the nesting, said
        if let word { parts.append(Board.projectWordText(word)) }
        if let u = project.unread, u > 0 { parts.append("\(u) unread") }
        if !project.description.isEmpty { parts.append(project.description) }
        // kosmos#7269: the faces are hidden from VoiceOver, so it hears the count the row no longer prints.
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
