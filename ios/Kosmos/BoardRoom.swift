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
        // kosmos#7072: when the hold should lift on its own (the route's held.until), nil when it did not say.
        var heldUntil: Date? = nil
        // The route's `unanswered` for the WHOLE room (messages.unanswered is not filtered by page), names shown; nil
        // when the computer did not send it. Applied to every post shown, not only this page's.
        var silent: [String: [String]]? = nil
        // kosmos#7080 review 2: the computer could not read the room's log (ok:false at 200 with no rows). Never a baseline
        // for who spoke next, as the board seeds only when body.ok !== false. Only a computer older than paged reads sends
        // this: a current one answers the phone's ?n= read with a 503, which lands in roomFailed and never reaches here
        // (review 6).
        var unread = false
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

    // kosmos#7072: a held room (#5800), as the board says it above its composer (web/index.html pjHeldNotice), word for
    // word. The time it should lift is in the person's own clock format, as the board's toLocaleTimeString.
    static func heldNotice(until: Date?, time: (Date) -> String = { $0.formatted(date: .omitted, time: .shortened) }) -> String {
        "This room has reached its limit for agent posts, because it kept going back and forth without a result. "
            + "Your agents' posts will most likely not go through until you post something yourself or reopen the room."
            + (until.map { " Otherwise it should lift on its own by " + time($0) + "." } ?? "")
            + " An agent whose post was held can still send one summary to wrap things up."
    }
    static let reopenButton = "Reopen the room"
    static let reopenedAnnouncement = "Reopened the room. Your agents can post here again."
    // Said when the notice first appears while the room is on screen (the board's paint, review 1).
    static let heldAnnouncement = "This room has reached its limit for agent posts. Post something yourself or reopen the room to let them through."
    // What a Reopen came to: reopened, refused (the board's sentence), or dropped because the person signed out or the
    // computer changed while it was on its way (nothing is said then: review 1).
    enum ReopenOutcome: Equatable { case reopened, refused(String), dropped }
    // Whether a newest-page read may write the room's hold: only one started after the last reopen landed, so an
    // older read that lands late never brings a lifted hold back (review 1). Reads are numbered as they start.
    static func readMayWriteHold(read: Int, reopenedAt: Int?) -> Bool { read > (reopenedAt ?? 0) }

    // The board's own Reopen (pjHeldReopenClick): POST /api/project/<id>/room/reopen, which answers {ok, at} or
    // {ok: false, because}.
    static func reopenRequest(mac: URL, project: String) -> URLRequest? {
        guard isProjectId(project) else { return nil }
        var r = URLRequest(url: URL(string: "/api/project/\(project)/room/reopen", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // nil when the room reopened; otherwise the board's sentence for a refusal, its reason when it gave one. An answer
    // this build cannot read is a refusal, never taken for a reopen.
    static func reopenRefusal(status: Int?, _ data: Data?) -> String? {
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if let status, (200...299).contains(status), let obj, isTrue(obj["ok"]) { return nil }   // the board's res.ok
        let because = (obj?["because"] as? String).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        return "We could not reopen the room" + (because.map { ": " + $0 } ?? "") + ". Try again, or post in the room."
    }

    // kosmos#7111: an addable refusal's Add (web/index.html pjRoomRow 'refused', kosmos#5752 slice 3; pjRefusedAddClick,
    // addMemberToProject). Shown only while it can help: the refusal is addable, the agent is not yet a member, and the
    // agent is one this computer still has (the board's `live`: a deleted one would be added as a ghost).
    static func addMemberShown(_ row: RoomRow, members: [String], live: Set<String>) -> Bool {
        guard row.kind == .kosmos, let f = row.refusal, f.addable, let key = f.key, !key.isEmpty else { return false }
        return !members.contains(key) && live.contains(key)
    }
    static func addMemberLabel(_ name: String) -> String { "Add \(name) to this project" }
    static func addedMemberLine(_ name: String) -> String { "Added \(name) to this project." }
    // POST /api/project/<id>/agent/<session>, as the board's addMemberToProject.
    static func addMemberRequest(mac: URL, project: String, agent: String) -> URLRequest? {
        guard isProjectId(project), isAgentSession(agent) else { return nil }
        var r = URLRequest(url: URL(string: "/api/project/\(project)/agent/\(agent)", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }
    // nil when the agent was added (the board's res.ok); otherwise the route's own reason as a sentence (pjSentence), or
    // the board's fallback.
    static func addMemberRefusal(status: Int?, _ data: Data?) -> String? {
        if let status, (200...299).contains(status) { return nil }
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let said = sentence(obj?["error"] as? String)
        return said.isEmpty ? "We could not change that project." : said
    }
    enum AddMemberOutcome: Equatable { case added, refused(String), dropped }

    // kosmos#7080: the room's grouped working line (web/index.html paintRoomBusy). The members, in the room's own member
    // order (names never reshuffle with the status order), whose card says working AND whose work is this project's:
    // an unattributed working agent shows in no room, the board's deliberate under-claim (#2882). An agent whose post
    // reached this room after the status was read is left out until the next status read (#1150), so the line never
    // seems to follow the answer.
    static func workingNames(members: [String], agents: [Agent], project: String, spokeSinceStatus: Set<String>) -> [String] {
        members.compactMap { m in
            guard let a = agents.first(where: { $0.session == m }), a.state == "working", a.stateProject == project,
                  !spokeSinceStatus.contains(m) else { return nil }
            return a.name
        }
    }
    // The agents with a post in `fresh` that `before` did not have: they spoke in this read. Nobody on a room's first
    // read (before is nil), so opening a room never hides everyone until the next status read. The byPerson check backs
    // up parseRoom, which already gives the person's posts no sender; no test can tell it apart.
    static func newSpeakers(before: [RoomRow]?, fresh: [RoomRow]) -> Set<String> {
        guard let before else { return [] }
        let had = Set(before.map(\.id))
        return Set(fresh.compactMap { r in r.kind == .post && !r.byPerson && !had.contains(r.id) ? r.from : nil })
    }
    // One newest-page read's effect on who spoke since (review 4: tested here, as loadRoom is not in the suite). `before`
    // is what the room held until this read, and counts as a baseline only once the room has had a real read
    // (`baselined`); a read the computer could not answer never makes one, and nothing ever unmakes one (the board's
    // ROOM_SPOKE_SEEDED). Returns the room's stamps and whether it is now baselined.
    static func stampSpeakers(_ spokeAt: [String: Date], baselined: Bool, before: [RoomRow]?, fresh: [RoomRow], unread: Bool,
                              at learned: Date) -> (spokeAt: [String: Date], baselined: Bool) {
        var stamps = spokeAt
        for who in newSpeakers(before: baselined ? before : nil, fresh: fresh) { stamps[who] = learned }
        return (stamps, baselined || !unread)
    }
    // The agents whose post reached the room strictly after `statusAt`, the status read the line is drawn from (the
    // board's learnedAt > LAST_AT). Both stamps are this phone's clock. No status read yet: nobody (there is no line).
    static func spokeSince(_ spokeAt: [String: Date], statusAt: Date?) -> Set<String> {
        guard let statusAt else { return [] }
        return Set(spokeAt.filter { $0.value > statusAt }.keys)
    }

    // The one word that carries the claim (the board's WORKING_VERB): working, never typing. We can see output, not that
    // it is a message to this room.
    static let workingVerb = "working"
    // "A is working…", "A and B are working…", "A, B, and C are working…" (the board's list); nil for nobody.
    static func workingLine(_ names: [String]) -> String? {
        workingLineParts(names).map { $0.map(\.text).joined() }
    }
    // The same line in pieces, each name marked so the room can set it bold (the board's <b>).
    static func workingLineParts(_ names: [String]) -> [(text: String, name: Bool)]? {
        guard !names.isEmpty else { return nil }
        var parts: [(text: String, name: Bool)] = []
        for (i, n) in names.enumerated() {
            if i > 0 { parts.append((i == names.count - 1 ? (names.count == 2 ? " and " : ", and ") : ", ", false)) }
            parts.append((n, true))
        }
        parts.append(((names.count == 1 ? " is " : " are ") + workingVerb + "\u{2026}", false))
        return parts
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
        var page = RoomPage(rows: rows, olderCount: max(0, integer(obj["olderCount"]) ?? 0), olderCursor: cursor,
                            held: obj["held"] is [String: Any])
        page.heldUntil = isoDate((obj["held"] as? [String: Any])?["until"] as? String)
        if obj["unanswered"] is [String: Any] { page.silent = silent.mapValues { $0.map(shown) } }
        page.unread = (obj["ok"] as? Bool) == false
        return page
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
        // Stable by time, on one key per row so the order is always consistent: the parsed time (a time kept without
        // milliseconds, "…:00Z", sorts by when it was, not as text; else its raw time parsed), and a row with none takes the time of the row
        // before it, so it keeps its place; ties keep their order.
        var carried = Date.distantPast
        let keyed = merged.enumerated().map { (i, r) -> (Date, Int, RoomRow) in
            if let t = r.at ?? r.atRaw.flatMap({ isoDate($0) }) { carried = t }
            return (carried, i, r)
        }
        return keyed.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }.map { $0.2 }
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
        return (withSilence(mergeRoom(shown, with: page.rows), page.silent), older)
    }

    // The room's silence lines, from a whole-room `unanswered` map, on every post shown: a post above the newest page
    // whose agent has answered since loses its line. Rows are left as they are when the computer sent no map.
    static func withSilence(_ rows: [RoomRow], _ silent: [String: [String]]?) -> [RoomRow] {
        guard let silent else { return rows }
        return rows.map { r in
            guard r.kind == .post else { return r }
            var out = r
            out.unanswered = silent[r.id] ?? []
            return out
        }
    }

    // The react route's answer ({ ok, of, reactions }, server.js roomReact): the post it toggled and its fresh pills,
    // in the room's own shape. Patching that row from it reaches a post above the newest page, which no re-read does.
    static func reacted(_ data: Data) -> (of: String, reactions: [Reaction])? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], isTrue(obj["ok"]),
              let of = obj["of"] as? String, let raw = obj["reactions"] as? [[String: Any]] else { return nil }
        let pills = raw.compactMap { x -> Reaction? in
            guard let e = x["emoji"] as? String, let c = integer(x["count"]), c > 0 else { return nil }
            return Reaction(emoji: e, count: c, mine: isTrue(x["mine"]))
        }
        return (of, pills)
    }

    // Words compared as the board compares them (pjRoomPendingKept): every run of whitespace one space, ends trimmed.
    // The computer stores a post reformatted (engine/chat.js storeText folds double spaces, line-end spaces, runs of
    // blank lines and tabs), so an exact comparison never matches a post with any of those.
    static func flatText(_ s: String) -> String {
        s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
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
            if let r = rows.first(where: { $0.byPerson && $0.kind == .post && flatText($0.text) == flatText(p.text)
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

    // kosmos#7085: the board's @ picker (#312, web/index.html MENTION_TOKEN / mentionMatches / mentionPick). The token
    // being typed: "@" and the key characters after it, at the END of the box (a SwiftUI text field does not say where
    // its cursor is, and on a phone the cursor is almost always there), when the "@" sits on the matcher's boundary, so
    // "admin@mara" never opens the list mid-address. Returns where the "@" is and what follows it, or nil.
    static func mentionToken(_ text: String) -> (at: String.Index, typed: String)? {
        func isName(_ c: Character) -> Bool { c.isASCII && (c.isLetter || c.isNumber || c == "." || c == "_" || c == "-") }
        var i = text.endIndex
        while i > text.startIndex, isName(text[text.index(before: i)]) { i = text.index(before: i) }
        guard i > text.startIndex else { return nil }
        let at = text.index(before: i)
        guard text[at] == "@" else { return nil }
        if at > text.startIndex, isName(text[text.index(before: at)]) { return nil }
        return (at, String(text[i...]))
    }
    // The members the list offers, in the room's member order, by the start of the key or of the shown name, without case.
    static func mentionMatches(_ members: [ProjectMember], typed: String) -> [ProjectMember] {
        let q = typed.lowercased()
        return members.filter { !$0.session.isEmpty && (q.isEmpty || $0.session.lowercased().hasPrefix(q) || $0.name.lowercased().hasPrefix(q)) }
    }
    // A pick replaces the typed token with "@<key> ": the session key, which is what the engine's recipients hold, and a
    // space so the token closes. Nil when the box holds no token (it changed under the list).
    static func mentionPick(_ text: String, key: String) -> String? {
        guard let token = mentionToken(text), !key.isEmpty else { return nil }
        return String(text[..<token.at]) + "@" + key + " "
    }
    // The board's line when nobody matches.
    static let mentionNone = "Nobody on this project matches that."
    // What VoiceOver hears when the list opens.
    static func mentionOpened(_ n: Int) -> String {
        n == 0 ? mentionNone : n == 1 ? "1 agent matches, above the box." : "\(n) agents match, above the box."
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

    // kosmos#7062: the words a post shows beside its files. A post made with no words carries its files' names as its
    // text, and the cards already say them, so that text is hidden (the board's pjWords; the chat's wordsShown).
    // One known difference: a file with no name is "a file" here (parseAttachments) and left out on the board, so a
    // post with an unnamed file can show its words here and not there. The Mac names every file it keeps.
    static func roomWords(_ row: RoomRow) -> String { wordsShown(row.text, files: row.attachments) }

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
            // The board's pjFolderLine: any state but readable (an absent one included) has a line, its own reason or
            // the board's sentence.
            let folderProblem: String? = (folder?["state"] as? String) == "readable" ? nil
                : ((folder?["because"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "we cannot read this folder")
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

    // kosmos#7101: a reply's header, as the board's .msg-replyto: VoiceOver's words for the action that goes to the post
    // it answers, and how long that post flashes (msg-flash, 1800 ms).
    static let replyJumpAction = "Go to the message this answers"
    // What a reply's header quotes of the post it answers (the board's pjReplyGist, through the chat's ports): its first
    // line cut to 80 (replyWords), with an agent's own leading "Name:" dropped, since the header names the sender beside
    // it (#4873; never for the person's post or an outside one, as the board's guard); for a post of files alone, its
    // first file's name; otherwise "a message" (review 3).
    static func replyGist(_ row: RoomRow, shownName: String) -> String {
        let raw = row.kind == .post && !row.byPerson ? dropSelfName(row.text, names: [shownName, row.from ?? ""]) : row.text
        let words = replyWords(raw)
        if !words.isEmpty { return words }
        if let f = row.attachments.first { return f.name.isEmpty ? "a file" : f.name }
        return "a message"
    }
    // The flash's colour, the board's --gold-deep (pinned in the room suite).
    static let replyFlashHex: UInt32 = 0xb88920
    // The header's words for VoiceOver, the board's .msg-replyto aria-label.
    static func replyJumpLabel(who: String, gist: String) -> String { who + ": " + gist + ", the message this answers. Go to it" }
    static let replyJumpFlash: TimeInterval = 1.8

    // kosmos#7093: where a room's waiting files are kept in BoardClient.attached: a key no agent's name can be (a session
    // name has no colon), so a room and an agent never share one.
    static func roomAttachKey(_ project: String) -> String { "room:" + project }
    // The bytes of one file for a project's room (the board's ATTACH_ROOM): PUT /api/project/<id>/attachment.
    static func roomUploadRequest(mac: URL, project: String, name: String, type: String) -> URLRequest? {
        guard isProjectId(project) else { return nil }
        var r = URLRequest(url: URL(string: "/api/project/\(project)/attachment", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "PUT"
        return uploadHeaders(r, name: name, type: type)
    }

    static func roomPostRequest(mac: URL, project: String, text: String, replyTo: String? = nil, attachments: [String] = []) -> URLRequest? {
        let said = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isProjectId(project), !said.isEmpty, said.count <= roomPostMax, attachments.count <= maxFiles,
              attachments.allSatisfy(isAttachmentId) else { return nil }
        var r = URLRequest(url: URL(string: "/api/project/\(project)/room", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["text": said]
        if let replyTo, !replyTo.isEmpty { body["reply_to"] = replyTo }
        if !attachments.isEmpty { body["attachments"] = attachments }
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return r
    }
    // kosmos#7093 review 2: after the answer to a post that carried files (they left the chips at the press). Kept, or
    // not confirmed but already shown kept by a read while it was in the air: they went. Refused, or not confirmed
    // with nothing showing it: they come back to the chips with the words.
    enum RoomFilesAfter: Equatable { case stayOff, comeBack }
    static func roomFilesAfter(_ result: RoomPostResult, settledByRead: Bool) -> RoomFilesAfter {
        switch result {
        case .posted: return .stayOff
        case .unsure: return settledByRead ? .stayOff : .comeBack
        case .refused: return .comeBack
        }
    }
    // What counts toward the ten a post carries: waiting, on their way, and the files of this room's posts still in the
    // air, which come back if refused (review 2: without them, a refused post could leave thirteen).
    static func roomFilesCounted(waiting: Int, uploading: Int, inAir: [[Attached]]) -> Int {
        waiting + uploading + inAir.reduce(0) { $0 + $1.count }
    }

    // A post of files alone carries their names as its words (the board's pjPostSend: "Say something first." is only
    // for a box with neither), after the @name a Reply put there when that is all the box holds.
    static func roomPostWords(_ draft: String, files: [Attached], replyMention: String?) -> String {
        let said = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let onlyMention = isOnlyMention(draft, mention: replyMention)
        guard !files.isEmpty, said.isEmpty || onlyMention else { return draft }
        return (onlyMention ? (replyMention ?? "") : "") + files.map(\.name).joined(separator: ", ")
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

// kosmos#7096: the room's search, as the board's pjRoomFilterRows (web/index.html). It filters the rows already loaded,
// before refusals fold (roomItems), as the board filters before its own fold. A row stays when the words, trimmed and in
// any case, are in who wrote it or in what it says. Who: the person's post is "you"; an agent's post, an outside
// message and a refusal are their writer's name as the board's pjNameOf gives it, else the id (an outside sender
// is shown by its id, and rarely has a name); any other Kosmos line (a note, a valve band) has none. What it says:
// a refusal is what it tried and why, not the sentence drawn for it; any other row its text (a valve band's text is
// already its reason).
extension Board {
    static func roomFilter(_ rows: [RoomRow], name: (String) -> String?, query: String) -> [RoomRow] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty { return rows }
        return rows.filter { r in
            let writer: String? = r.refusal.map { $0.who ?? $0.key ?? "" }
                ?? (r.kind == .kosmos ? nil : r.byPerson ? "you" : r.from.map { name($0) ?? $0 })
            let words = r.refusal.map { ($0.doing.map { $0 + " " } ?? "") + ($0.because ?? "") } ?? r.text
            return (writer ?? "").lowercased().contains(needle) || words.lowercased().contains(needle)
        }
    }
}

extension Board {
    // kosmos#7096: the board's line when a reply's original is hidden by the search (PJ_HIDDEN_BY_SEARCH).
    static let roomHiddenBySearch = "That message is hidden by your search."

    // Whether a reply's jump to `id` is to a post the search hides: searching, the room holds it, and it is not among
    // the kept rows (the board's PJ_ROOM_POSTS.has(id) on a row the filter left out).
    static func roomJumpHidden(_ id: String, shown: [RoomRow], all: [RoomRow], searching: Bool) -> Bool {
        searching && !shown.contains { $0.id == id } && all.contains { $0.id == id }
    }

    // kosmos#7096: the board's line for a read that could not read all of a room (paintRoom on ok false).
    static let roomPartialLine = "We could not read some of this room just now; what is below may be missing recent posts."

    // The rooms whose rows on screen came from a read that could not read all of the room. Each read that lands sets
    // or clears its room (`partial`: the read's ok false, RoomPage.unread). A read that fails never gets here (RoomStore
    // returns first), so the flag stays with the rows still on screen, the last landed read's.
    static func partialRooms(_ rooms: Set<String>, project: String, partial: Bool) -> Set<String> {
        var next = rooms
        if partial { next.insert(project) } else { next.remove(project) }
        return next
    }
}
