import Foundation

// kosmos#7032 (slice 9 of #6838): a project's room, read natively. UIKit-free, so ios/LogicTests/run-room.sh runs it on
// a Mac. The room is GET /api/project/<id>/room, a page at a time (ios/README.md, "A project's room, a page at a time"):
// the computer makes every cursor; the phone only echoes it. Kept apart from ChatRow (a 1:1 thread has one agent and no
// sender field); a room row always says who wrote it, and runs are grouped by that sender.
extension Board {
    // The board's project id: lower-case letters, digits, - and _ (engine/projects.js idFor, store.safeKey).
    static func isProjectId(_ s: String) -> Bool {
        !s.isEmpty && s.count <= 80 && s.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" || $0 == "_" }
    }

    struct Reaction: Equatable {
        let emoji: String
        let count: Int
        // The person's own reaction (the room is read as "you").
        let mine: Bool
    }

    struct RoomRow: Equatable, Identifiable {
        enum Kind: Equatable {
            // A post by the person (operator) or an agent.
            case post
            // Kosmos's own line: a note, a valve, or a refusal (several refusals for one reason folded into one).
            case kosmos
            // A message from outside this Kosmos (a shared room): `fromKind` says person or agent.
            case external
        }
        let id: String
        let atRaw: String?
        let at: Date?
        let kind: Kind
        // The writer: an agent's session name, or nil for the person's own post and Kosmos's lines.
        let from: String?
        let byPerson: Bool
        let text: String
        var externalAgent = false
        var replyTo: String? = nil
        var mentioned: [String] = []
        var reactions: [Reaction] = []
        var attachments: [Attachment] = []
        // Agents this post addressed that have not answered here yet (the route's `unanswered`).
        var unanswered: [String] = []
        // A refusal's parts, kept so consecutive refusals fold into one line when the room is drawn (roomItems), after
        // every page is merged: folding per page made a second line whenever a page began inside a run.
        var refusal: Refusal? = nil
        // The sender key a run is grouped by: the person, an agent, an outside sender, or Kosmos (which never groups).
        var sender: String {
            switch kind {
            case .kosmos: return "kosmos|" + id
            case .external: return "external|" + (from ?? "")
            case .post: return byPerson ? "person" : "agent|" + (from ?? "")
            }
        }
    }

    struct Refusal: Equatable {
        // The agent's session name (what a fold dedupes by) and its shown name.
        var key: String? = nil
        let who: String?
        let doing: String?
        let because: String?
        // The board draws an Add button on it, so it never folds (pjFoldRoomRows).
        var addable = false
    }

    struct RoomPage: Equatable {
        let rows: [RoomRow]
        let olderCount: Int
        // The computer's cursor for the page before this one; nil at the start of the room.
        let olderCursor: String?
        let held: Bool
    }

    // The newest page (no cursor) or the page before a cursor the computer gave.
    static func roomRequest(mac: URL, project: String, n: Int, cursor: String? = nil) -> URLRequest? {
        guard isProjectId(project), (1...200).contains(n) else { return nil }
        var parts = URLComponents(url: URL(string: "/api/project/\(project)/room", relativeTo: mac)!.absoluteURL, resolvingAgainstBaseURL: true)
        var items = [URLQueryItem(name: "n", value: String(n))]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        parts?.queryItems = items
        guard let url = parts?.url else { return nil }
        var r = URLRequest(url: url)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // The board's words for Kosmos's lines in a room (web/index.html pjRoomRow, the room's text view in server.js).
    static let valveFallback = "This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in."
    // One refusal (web/index.html pjRoomRow 'refused'), or a folded run of them ('refused-group': "stopped them").
    static func refusedLine(_ names: [String], doing: String?, because: String?) -> String {
        let who: String
        switch names.count {
        case 0: who = "An agent"
        case 1: who = names[0]
        default: who = names.dropLast().joined(separator: ", ") + " and " + names.last!
        }
        let reason = sentence(because.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } ?? "no reason was recorded")
        if names.count > 1 { return "\(who) tried to post here and Kosmos stopped them: \(reason)" }
        return "\(who) tried to \(doing ?? "post") here and Kosmos stopped it: \(reason)"
    }

    // A page of the room route. nil for an answer that is not a room (the caller says it could not read it).
    static func parseRoom(_ data: Data, names: [String: String] = [:]) -> RoomPage? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = obj["rows"] as? [[String: Any]] else { return nil }
        let silent = obj["unanswered"] as? [String: [String]] ?? [:]
        let shown = { (s: String) in names[s] ?? s }
        var rows: [RoomRow] = []
        for (i, r) in raw.enumerated() {
            let at = r["at"] as? String
            let kind = r["kind"] as? String ?? ""
            // A Kosmos line carries no id; the computer's `key` (its exact place in the room) is its identity, so a
            // re-read page merges onto it instead of adding it twice. A page without keys (an older computer) falls back to
            // its place on this page, which only that page's own merge relies on.
            let fallbackId = "k|" + ((r["key"] as? String) ?? "\(at ?? "")|p\(i)")
            switch kind {
            case "post":
                guard let id = r["id"] as? String, let text = r["text"] as? String else { continue }
                let byPerson = isTrue(r["operator"])
                var row = RoomRow(id: id, atRaw: at, at: isoDate(at), kind: .post, from: byPerson ? nil : r["from"] as? String,
                                  byPerson: byPerson, text: text)
                row.replyTo = r["replyTo"] as? String
                row.mentioned = r["mentioned"] as? [String] ?? []
                row.reactions = (r["reactions"] as? [[String: Any]] ?? []).compactMap { x in
                    guard let e = x["emoji"] as? String, let c = integer(x["count"]), c > 0 else { return nil }
                    return Reaction(emoji: e, count: c, mine: isTrue(x["mine"]))
                }
                row.attachments = parseAttachments(r)
                row.unanswered = (silent[id] ?? []).map(shown)
                rows.append(row)
            case "external":
                guard let text = r["text"] as? String else { continue }
                var row = RoomRow(id: r["id"] as? String ?? fallbackId, atRaw: at, at: isoDate(at), kind: .external,
                                  from: r["from"] as? String, byPerson: false, text: text)
                row.externalAgent = (r["fromKind"] as? String) == "agent"
                rows.append(row)
            case "note":
                guard let text = r["text"] as? String, !text.isEmpty else { continue }
                rows.append(RoomRow(id: fallbackId, atRaw: at, at: isoDate(at), kind: .kosmos, from: nil, byPerson: false, text: text))
            case "valve":
                let because = (r["because"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? valveFallback
                rows.append(RoomRow(id: fallbackId, atRaw: at, at: isoDate(at), kind: .kosmos, from: nil, byPerson: false, text: because))
            case "refused":
                let who = (r["from"] as? String).map(shown)
                let because = r["because"] as? String
                let doing = r["doing"] as? String
                let doingWord = doing.flatMap { $0.isEmpty ? nil : $0 }
                var row = RoomRow(id: "r|" + fallbackId, atRaw: at, at: isoDate(at), kind: .kosmos, from: nil, byPerson: false,
                                  text: refusedLine(who.map { [$0] } ?? [], doing: doingWord, because: because))
                row.refusal = Refusal(key: r["from"] as? String, who: who, doing: doingWord, because: because, addable: isTrue(r["addable"]))
                rows.append(row)
            default:
                continue   // a kind this build does not know is left out, never drawn as something it is not
            }
        }
        let cursor = (obj["olderCursor"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return RoomPage(rows: rows, olderCount: max(0, integer(obj["olderCount"]) ?? 0), olderCursor: cursor,
                        held: obj["held"] is [String: Any])
    }

    // Consecutive refusals for the same reason fold into one line naming every agent once (Josh 09-10: "It's just a
    // string of notifications"), as the board's pjFoldRoomRows: never one that says what was tried (`doing`) or carries
    // an Add, and only when at least two agents are in the run (one agent held twice keeps its rows). The line takes
    // the run's first row's id and its last row's time. Run on the merged rows, so a run split across pages is one.
    static func foldRefusals(_ rows: [RoomRow]) -> [RoomRow] {
        func foldable(_ r: RoomRow) -> Refusal? {
            guard let f = r.refusal, !f.addable, f.doing == nil else { return nil }
            return f
        }
        var out: [RoomRow] = []
        var i = 0
        while i < rows.count {
            guard let first = foldable(rows[i]) else { out.append(rows[i]); i += 1; continue }
            var keys: [String] = []
            var names: [String] = []
            var j = i
            while j < rows.count, let f = foldable(rows[j]), (f.because ?? "") == (first.because ?? "") {
                let k = f.key ?? f.who ?? ""
                if !keys.contains(k) { keys.append(k); names.append(f.who ?? k) }
                j += 1
            }
            if keys.count > 1 {
                var folded = RoomRow(id: rows[i].id, atRaw: rows[j - 1].atRaw, at: rows[j - 1].at, kind: .kosmos, from: nil,
                                     byPerson: false, text: refusedLine(names, doing: nil, because: first.because))
                folded.refusal = first
                out.append(folded)
            } else {
                out.append(contentsOf: rows[i..<j])
            }
            i = j
        }
        return out
    }

    // The newest page merged into what is already shown: a row seen before is replaced by its newer reading (reactions,
    // unanswered), a new row is added, and everything stays in the computer's time order. A post written after a page was
    // read can be dated inside it (ios/README.md), so merging by row, not appending, is what keeps it.
    static func mergeRoom(_ shown: [RoomRow], with page: [RoomRow]) -> [RoomRow] {
        var byId: [String: RoomRow] = [:]
        var order: [String] = []
        for r in shown + page {
            if byId[r.id] == nil { order.append(r.id) }
            byId[r.id] = r
        }
        let merged = order.compactMap { byId[$0] }
        // Stable by time: rows with no time keep their place relative to each other. Parsed times are compared when
        // both have one (a time kept without milliseconds, "…:00Z", sorts after "…:00.500Z" as text); text otherwise.
        return merged.enumerated().sorted { a, b in
            if let x = a.element.at, let y = b.element.at, x != y { return x < y }
            switch (a.element.atRaw, b.element.atRaw) {
            case let (x?, y?) where x != y && (a.element.at == nil || b.element.at == nil): return x < y
            default: return a.offset < b.offset
            }
        }.map { $0.element }
    }

    // A re-read of the newest page onto rows already shown. When it overlaps them it is merged and the older cursor kept
    // (it still points before the oldest row shown). When it shares no row with them and the computer says older rows
    // exist, more than a page arrived while the room was away: merging would hide a gap no cursor can reach, so the
    // page replaces what was shown and its own cursor takes over.
    static func refreshRoom(_ shown: [RoomRow]?, older: (count: Int, cursor: String?)?, page: RoomPage)
        -> (rows: [RoomRow], older: (count: Int, cursor: String?)) {
        guard let shown, let older else { return (page.rows, (page.olderCount, page.olderCursor)) }
        let ids = Set(shown.map { $0.id })
        if page.olderCount > 0, !shown.isEmpty, !page.rows.contains(where: { ids.contains($0.id) }) {
            return (page.rows, (page.olderCount, page.olderCursor))
        }
        return (mergeRoom(shown, with: page.rows), older)
    }

    // The person's posts in the air (or not confirmed) that the room now shows: a row by the person, with the same
    // words, that was NOT in the room when they pressed Post (the board's #6168 rule) and is dated after the newest row
    // shown then (`after`): the phone holds only the pages it has read, so an older same-words post loaded later is
    // not in `before` and must not settle it. Each row settles one post, in order, so two "ok"s in a row need two new
    // rows. Returns the indices into `posts` that settled.
    static func settledPosts(_ posts: [(text: String, before: Set<String>, after: Date?)], rows: [RoomRow]) -> [Int] {
        var used = Set<String>()
        var out: [Int] = []
        for (i, p) in posts.enumerated() {
            if let r = rows.first(where: { $0.byPerson && $0.kind == .post && $0.text.trimmingCharacters(in: .whitespacesAndNewlines) == p.text
                                       && !p.before.contains($0.id) && !used.contains($0.id)
                                       && (p.after == nil || $0.at == nil || $0.at! > p.after!) }) {
                used.insert(r.id)
                out.append(i)
            }
        }
        return out
    }

    // Reply on an agent's post puts "@<its session name> " in front of what the box already holds (the board's
    // pjReplyMention): the session name, because the engine reads an @word as [A-Za-z0-9._-]+ and a display name like
    // "Mona Lisa" would stop at the space. The mention an earlier Reply put there (`previous`) is taken off the front
    // first, so replying to Dana after Cleo swaps the name rather than asking both. Nothing is added when the words
    // already @-name that agent. Returns the box and the mention inserted (nil when none), to pass as `previous` next.
    static func replyMention(draft: String, from: String?, previous: String?) -> (text: String, mention: String?) {
        var text = draft
        if let previous, !previous.isEmpty, text.hasPrefix(previous) { text = String(text.dropFirst(previous.count)) }
        guard let from, !from.isEmpty else { return (text, nil) }
        if mentionsWord(text, from) { return (text, nil) }
        let mention = "@" + from + " "
        return (mention + text, mention)
    }

    // A box holding nothing but the mention Reply put there is not a post (the board's pjPostSend, #4359: "Say
    // something first."): it would hand that agent a request with no words.
    static func isOnlyMention(_ draft: String, mention: String?) -> Bool {
        let said = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let m = mention?.trimmingCharacters(in: .whitespacesAndNewlines), !m.isEmpty else { return false }
        return said.caseInsensitiveCompare(m) == .orderedSame
    }

    // Whether `text` holds @word as a whole token (the engine's rule: not inside a longer name), without case.
    static func mentionsWord(_ text: String, _ word: String) -> Bool {
        mentionRanges(text, word).isEmpty == false
    }

    static func mentionRanges(_ text: String, _ word: String) -> [Range<String.Index>] {
        guard !word.isEmpty else { return [] }
        func isName(_ c: Character) -> Bool { c.isASCII && (c.isLetter || c.isNumber || c == "." || c == "_" || c == "-") }
        var out: [Range<String.Index>] = []
        var from = text.startIndex
        while let r = text.range(of: "@" + word, options: [.caseInsensitive], range: from..<text.endIndex) {
            let before = r.lowerBound == text.startIndex ? nil : text[text.index(before: r.lowerBound)]
            // A trailing run of . _ - is punctuation, as the board reads it ("thanks @eli." names eli; pjMentionResolve).
            var end = r.upperBound
            while end < text.endIndex, ".-_".contains(text[end]) { end = text.index(after: end) }
            let after = end == text.endIndex ? nil : text[end]
            if !(before.map(isName) ?? false) && !(after.map(isName) ?? false) { out.append(r) }
            from = r.upperBound
        }
        return out
    }

    struct RoomItem: Equatable, Identifiable {
        enum Kind: Equatable {
            case day(String)
            // The name and picture go on the first of a run; the time on the last.
            case row(RoomRow, firstOfRun: Bool, lastOfRun: Bool)
        }
        let id: String
        let kind: Kind
    }

    // Day lines as in the chat; a run is consecutive rows by the SAME sender on the same day, so two agents in a row are
    // two runs. Kosmos's lines stand alone.
    static func roomItems(_ rows: [RoomRow], now: Date, calendar: Calendar) -> [RoomItem] {
        func together(_ a: RoomRow?, _ b: RoomRow) -> Bool {
            guard let a, a.kind != .kosmos, b.kind != .kosmos, a.sender == b.sender else { return false }
            if let x = a.at, let y = b.at { return calendar.isDate(x, inSameDayAs: y) }
            return true
        }
        let rows = foldRefusals(rows)
        var out: [RoomItem] = []
        var shownDay: Date?
        for (i, r) in rows.enumerated() {
            if let at = r.at, shownDay.map({ !calendar.isDate(at, inSameDayAs: $0) }) ?? true {
                out.append(RoomItem(id: "day|" + r.id, kind: .day(dayLine(at, now: now, calendar: calendar))))
                shownDay = at
            }
            let prev = i > 0 ? rows[i - 1] : nil
            let next = i + 1 < rows.count ? rows[i + 1] : nil
            let first = !together(prev, r) || out.last.map({ if case .day = $0.kind { return true } else { return false } }) == true
            out.append(RoomItem(id: r.id, kind: .row(r, firstOfRun: first, lastOfRun: !(next.map { together(r, $0) } ?? false))))
        }
        return out
    }
}

// MARK: The Projects list (GET /api/projects; the board's projectCard, pjPillOf, sortProjects, pjTreeRows)

extension Board {
    struct ProjectMember: Equatable {
        let session: String
        let name: String
        let hasAvatar: Bool
        let provider: String?
    }

    struct ProjectRow: Equatable, Identifiable {
        let id: String
        let name: String
        let description: String
        // The server's count; nil when it is not known ("unknown is not zero").
        let unread: Int?
        let parent: String?
        let archived: Bool
        let archivedAt: Date?
        let paused: Bool
        let createdAt: Date?
        let members: [ProjectMember]
        // The project folder's own reason when it cannot be read (folderState.because), else nil.
        let folderProblem: String?
        let needsYou: Int
        let needsYouQuestions: Int
        let working: Int
        let restarting: Int
    }

    struct ProjectList: Equatable {
        let projects: [ProjectRow]
        // The board could not read the agents: no status words at all (#4730), never a guess.
        let agentsUnreadable: Bool
    }

    static func parseProjects(_ data: Data) -> ProjectList? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = obj["projects"] as? [[String: Any]] else { return nil }
        let rows: [ProjectRow] = raw.compactMap { p in
            guard let id = p["id"] as? String, isProjectId(id), let name = p["name"] as? String, !name.isEmpty else { return nil }
            let s = p["summary"] as? [String: Any] ?? [:]
            let members: [ProjectMember] = (p["agents"] as? [Any] ?? []).compactMap { a in
                guard let a = a as? [String: Any], let session = a["sessionName"] as? String, !session.isEmpty else { return nil }
                return ProjectMember(session: session, name: (a["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? session,
                                     hasAvatar: isTrue(a["hasAvatar"]), provider: a["provider"] as? String)
            }
            let folder = p["folderState"] as? [String: Any]
            let folderProblem = (folder?["state"] as? String).flatMap { $0 == "readable" ? nil : (folder?["because"] as? String) }
            return ProjectRow(id: id, name: name, description: p["description"] as? String ?? "",
                              unread: integer(p["unread"]), parent: (p["parent"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                              archived: isTrue(p["archived"]), archivedAt: isoDate(p["archivedAt"] as? String),
                              paused: isTrue(p["paused"]), createdAt: isoDate(p["createdAt"] as? String), members: members,
                              folderProblem: folderProblem.flatMap { $0.isEmpty ? nil : $0 },
                              needsYou: integer(s["needsYou"]) ?? 0, needsYouQuestions: integer(s["needsYouQuestions"]) ?? 0,
                              working: integer(s["working"]) ?? 0, restarting: integer(s["restarting"]) ?? 0)
        }
        return ProjectList(projects: rows, agentsUnreadable: isTrue(obj["agentsUnreadable"]))
    }

    enum ProjectWord: Equatable { case question, issue, paused, working, restarting }

    // The board's one status word (pjPillOf): Question (only agents' own questions, calm) > Issue > Paused > Working >
    // Restarting > none. None when nothing is running or the agents could not be read (#4730).
    static func projectWord(_ p: ProjectRow, agentsUnreadable: Bool) -> ProjectWord? {
        if !agentsUnreadable && p.needsYou > 0 && p.needsYouQuestions == p.needsYou { return .question }
        if !agentsUnreadable && p.needsYou > 0 { return .issue }
        if p.paused && !p.archived { return .paused }
        if !agentsUnreadable && p.working > 0 { return .working }
        if !agentsUnreadable && p.restarting > 0 { return .restarting }
        return nil
    }

    static func projectWordText(_ w: ProjectWord) -> String {
        switch w {
        case .question: return "Question"
        case .issue: return "Issue"
        case .paused: return "Paused"
        case .working: return "Working"
        case .restarting: return "Restarting"
        }
    }

    // The unread bubble's words (the board's unreadBadge): none at 0 or unknown, "99+" past 99.
    static func unreadBubble(_ n: Int?) -> String? {
        guard let n, n > 0 else { return nil }
        return n > 99 ? "99+" : String(n)
    }

    enum ProjectSort: String, CaseIterable { case newest, oldest, az, za }
    static func projectSortLabel(_ s: ProjectSort) -> String {
        switch s {
        case .newest: return "Newest first"
        case .oldest: return "Oldest first"
        case .az: return "Name A to Z"
        case .za: return "Name Z to A"
        }
    }

    // The board's sortProjects: by creation (an undated project after every dated one, in store order), or by name
    // ignoring case. Never by last update (#168: a list that reorders itself reads as the app losing a project).
    static func sortProjects(_ list: [ProjectRow], _ mode: ProjectSort) -> [ProjectRow] {
        let indexed = Array(list.enumerated())
        func byName(_ a: ProjectRow, _ b: ProjectRow) -> ComparisonResult {
            a.name.compare(b.name, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: Locale.current)
        }
        return indexed.sorted { x, y in
            switch mode {
            case .az:
                let c = byName(x.element, y.element); return c == .orderedSame ? x.offset < y.offset : c == .orderedAscending
            case .za:
                let c = byName(y.element, x.element); return c == .orderedSame ? x.offset < y.offset : c == .orderedAscending
            case .newest, .oldest:
                switch (x.element.createdAt, y.element.createdAt) {
                case (nil, nil): return x.offset < y.offset
                case (nil, _): return false
                case (_, nil): return true
                case let (a?, b?):
                    if a == b { return x.offset < y.offset }
                    return mode == .newest ? a > b : a < b
                }
            }
        }.map { $0.element }
    }

    struct ProjectTreeRow: Equatable, Identifiable {
        let project: ProjectRow
        let depth: Int
        var id: String { project.id }
    }

    // The active projects as the board's tree (pjTreeRows): sorted, then each sub-project right after its parent, one
    // level deeper. A child whose parent is archived or gone sits at the top level; a cycle never repeats a row and never
    // hides one. Archived projects are left out here (they have their own folded list).
    static func projectTree(_ all: [ProjectRow], sort: ProjectSort) -> [ProjectTreeRow] {
        let active = sortProjects(all.filter { !$0.archived }, sort)
        let ids = Set(active.map { $0.id })
        var kids: [String: [ProjectRow]] = [:]
        for p in active { kids[(p.parent.flatMap { ids.contains($0) ? $0 : nil }) ?? "", default: []].append(p) }
        var out: [ProjectTreeRow] = []
        var seen = Set<String>()
        func emit(_ parent: String, _ depth: Int) {
            for c in kids[parent] ?? [] where !seen.contains(c.id) {
                seen.insert(c.id)
                out.append(ProjectTreeRow(project: c, depth: depth))
                emit(c.id, depth + 1)
            }
        }
        emit("", 0)
        for p in active where !seen.contains(p.id) {   // a cycle kept it out of the walk: still shown, at the top
            seen.insert(p.id)
            out.append(ProjectTreeRow(project: p, depth: 0))
        }
        return out
    }

    static func archivedProjects(_ all: [ProjectRow]) -> [ProjectRow] { all.filter { $0.archived } }

    static func projectsRequest(mac: URL) -> URLRequest? {
        var r = URLRequest(url: URL(string: "/api/projects", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
}

// MARK: Posting to a room (POST /api/project/<id>/room; the board's pjPostSend)

extension Board {
    // The board refuses empty posts and ones over its limit (the composer's maxlength, 10000).
    // A post that cannot be sent at all, answered before any request: words over the board box's limit (its maxlength,
    // 10,000), or no connection to the computer. nil when it can be sent.
    static let roomPostMax = 10000
    static func roomPostRefusedBeforeSending(text: String, connected: Bool) -> RoomPostResult? {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).count > roomPostMax {
            return .refused("That is longer than a post can be (10,000 characters). Shorten it and post again.")
        }
        if !connected { return .refused("We cannot reach your computer right now, so nothing was posted.") }
        return nil
    }

    static func roomPostRequest(mac: URL, project: String, text: String, replyTo: String? = nil) -> URLRequest? {
        let said = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isProjectId(project), !said.isEmpty, said.count <= roomPostMax else { return nil }
        var r = URLRequest(url: URL(string: "/api/project/\(project)/room", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["text": said]
        if let replyTo, !replyTo.isEmpty { body["reply_to"] = replyTo }
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return r
    }

    enum RoomPostResult: Equatable {
        // Kept. `note` is the computer's sentence when an @word named two agents (it reached neither as a request).
        case posted(note: String?)
        // Not kept: the computer's own sentence. The words go back in the box.
        case refused(String)
        // It may have gone: no answer, or a server error with no sentence of its own. Never said to have failed.
        case unsure
    }

    static let roomUnsureLine = "We could not tell whether that was posted. Check the room before posting it again."

    // The board's reading of a post's answer (pjPostSend): no answer or a 5xx with no sentence is unsure; a refusal
    // (an error status, or delivery.state could_not) carries the computer's own words; anything else was kept.
    static func roomPostResult(status: Int, body: Data?) -> RoomPostResult {
        if status == 0 { return .unsure }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let error = (obj?["error"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let d = obj?["delivery"] as? [String: Any]
        let state = d?["state"] as? String
        if !(200...299).contains(status) || state == nil {
            if status >= 500 && error == nil { return .unsure }
            return .refused(sentence(error ?? "we could not post that"))
        }
        if state == "could_not" { return .refused(sentence((d?["because"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "we could not post that")) }
        return .posted(note: (d?["ambiguousNote"] as? String).flatMap { $0.isEmpty ? nil : $0 })
    }

    // What a post that did not go says under its bubble, in the board's words (the longer roomUnsureLine goes under the
    // box, as the board writes both).
    static func roomPostLine(_ r: RoomPostResult) -> String? {
        switch r {
        case .posted: return nil
        case .refused(let why): return "Not posted. " + why
        case .unsure: return "Not confirmed. We could not tell whether it was posted."
        }
    }
}
