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
        // The sender key a run is grouped by: the person, an agent, an outside sender, or Kosmos (which never groups).
        var sender: String {
            switch kind {
            case .kosmos: return "kosmos|" + id
            case .external: return "external|" + (from ?? "")
            case .post: return byPerson ? "person" : "agent|" + (from ?? "")
            }
        }
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
    static func refusedLine(_ names: [String], doing: String?, because: String?) -> String {
        let who: String
        switch names.count {
        case 0: who = "An agent"
        case 1: who = names[0]
        case 2: who = names[0] + " and " + names[1]
        default: who = names.dropLast().joined(separator: ", ") + " and " + names.last!
        }
        return "\(who) tried to \(doing ?? "post") here and Kosmos stopped it: \(because ?? "no reason recorded")"
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
                // Consecutive refusals for the same reason fold into one line naming everyone (Josh 09-10: "It's just a
                // string of notifications").
                if let last = rows.last, last.kind == .kosmos, last.id.hasPrefix("r|"), last.id.hasSuffix("|" + (because ?? "")),
                   case let names = refusedNames(last.text), let who, !names.contains(who) {
                    rows[rows.count - 1] = RoomRow(id: last.id, atRaw: last.atRaw, at: last.at, kind: .kosmos, from: nil, byPerson: false,
                                                   text: refusedLine(names + [who], doing: doing, because: because))
                    continue
                }
                rows.append(RoomRow(id: "r|" + fallbackId + "|" + (because ?? ""), atRaw: at, at: isoDate(at), kind: .kosmos, from: nil,
                                    byPerson: false, text: refusedLine(who.map { [$0] } ?? [], doing: doing, because: because)))
            default:
                continue   // a kind this build does not know is left out, never drawn as something it is not
            }
        }
        let cursor = (obj["olderCursor"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return RoomPage(rows: rows, olderCount: max(0, integer(obj["olderCount"]) ?? 0), olderCursor: cursor,
                        held: obj["held"] is [String: Any])
    }

    // The names a folded refusal line already carries (it is rebuilt from them when one more joins).
    private static func refusedNames(_ line: String) -> [String] {
        guard let cut = line.range(of: " tried to ") else { return [] }
        let head = String(line[..<cut.lowerBound])
        if head == "An agent" { return [] }
        let parts = head.components(separatedBy: " and ")
        guard parts.count > 1 else { return [head] }
        return parts[0].components(separatedBy: ", ") + [parts[1]]
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
        // Stable by time: rows with no time keep their place relative to each other.
        return merged.enumerated().sorted { a, b in
            switch (a.element.atRaw, b.element.atRaw) {
            case let (x?, y?) where x != y: return x < y
            default: return a.offset < b.offset
            }
        }.map { $0.element }
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
