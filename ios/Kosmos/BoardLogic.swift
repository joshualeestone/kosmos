import Foundation
import CryptoKit

// kosmos#6838 slice 1: the native Agents tab's decisions, kept free of UIKit and
// SwiftUI so ios/LogicTests proves them on a Mac (#718). BoardClient and
// AgentsView are thin callers of what is here.
//
// The path to a Mac without a web page: the Kosmos+ session (the one the sign-in
// page hands over, kept in SessionKeychain) lists the account's Macs and mints a
// short-lived handoff token for one; the Mac's tunnel gate turns that token into
// its session cookie; the board's own routes then answer through the tunnel.
enum Board {

    // MARK: - Requests

    static func macsRequest(coordinator: URL, session: String) -> URLRequest {
        var r = URLRequest(url: URL(string: "/v1/account/macs", relativeTo: coordinator)!.absoluteURL)
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.httpShouldHandleCookies = false
        return r
    }

    static func handoffRequest(coordinator: URL, session: String, address: String) -> URLRequest {
        var r = URLRequest(url: URL(string: "/v1/account/handoff", relativeTo: coordinator)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["address": address])
        r.httpShouldHandleCookies = false
        return r
    }

    // The gate's own page posts {token} as JSON. No Origin header is set: the
    // gate's cross-site guard refuses only a foreign one.
    static func sessionRequest(mac: URL, handoffToken: String) -> URLRequest {
        var r = URLRequest(url: URL(string: "/_kosmos/session", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["token": handoffToken])
        return r
    }

    // Accept JSON, or the gate answers an ended session with its sign-in page at 200 instead of a 401
    // (kosmos-relay gate.rs is_a_script_fetch).
    static func statusRequest(mac: URL) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/status", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // A Mac's address as the board's origin, only for a single label under the
    // relay domain (the same rule a notification tap obeys).
    static func macURL(address: String, coordinator: URL) -> URL? {
        let host = address.lowercased()
        guard host.unicodeScalars.allSatisfy({ $0.isASCII }),
              PushBridge.isMacHost(host, coordinator: coordinator)
        else { return nil }
        var parts = URLComponents()
        parts.scheme = "https"
        parts.host = host
        parts.path = "/"
        return parts.url
    }

    // MARK: - The account's Macs

    struct Mac: Equatable {
        let name: String
        let address: String
        let usable: Bool
        var connected: Bool = true
        var lastSeen: Double = 0
        // Kosmos+ says this Mac refused this iPhone (`this_device` "denied").
        var refusedThisDevice = false
    }

    // `{macs:[{name,address,last_seen,retired_at,remote_off,not_connected,held,refused}]}`.
    // A retired, held, refused or switched-off Mac is listed but not usable.
    static func parseMacs(_ data: Data) -> [Mac]? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["macs"] as? [[String: Any]]
        else { return nil }
        return rows.compactMap { row in
            guard let address = row["address"] as? String, !address.isEmpty else { return nil }
            let name = (row["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? address
            let off = (row["retired_at"] is NSNumber)
                || (row["remote_off"] as? Bool ?? false)
                || (row["held"] as? Bool ?? false)
                || (row["refused"] as? Bool ?? false)
            return Mac(name: name, address: address, usable: !off,
                       // A Mac in the middle of an update (updating_until) is ranked like one not connected.
                       connected: !(row["not_connected"] as? Bool ?? false) && !(row["updating_until"] is NSNumber),
                       lastSeen: (row["last_seen"] as? NSNumber)?.doubleValue ?? 0,
                       refusedThisDevice: (row["this_device"] as? String) == "denied")
        }
    }

    // Only Macs whose address the app may open (macURL): one bad row from Kosmos+ never hides a good Mac.
    static func reachableMacs(_ macs: [Mac], coordinator: URL) -> [Mac] {
        macs.filter { macURL(address: $0.address, coordinator: coordinator) != nil }
    }

    // The Mac remembered from last time while it is usable and connected; else a connected usable one, most
    // recently seen first; else the remembered or most recently seen usable one. A Mac that refused this iPhone is
    // picked only when there is no other.
    static func pickMac(_ macs: [Mac], remembered: String?) -> Mac? {
        let all = macs.filter(\.usable).sorted { ($0.lastSeen, $1.address) > ($1.lastSeen, $0.address) }
        let open = all.filter { !$0.refusedThisDevice }
        let usable = open.isEmpty ? all : open
        if let r = remembered, let m = usable.first(where: { $0.address == r && $0.connected }) { return m }
        if let m = usable.first(where: { $0.connected }) { return m }
        if let r = remembered, let m = usable.first(where: { $0.address == r }) { return m }
        return usable.first
    }

    static func parseHandoffToken(_ data: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = obj["token"] as? String, !token.isEmpty
        else { return nil }
        return token
    }

    // MARK: - The Mac's answer to the session request

    enum SessionAnswer: Equatable {
        case admitted
        // The Mac is showing Allow; ask again in 3 s. `code` is the match code it shows.
        case pending(code: String?)
        case denied
        // A slow network cut the request short while waiting; ask again.
        case retry
        case refused(because: String?)
    }

    // The gate page's own rules (kosmos-relay crates/tunnel/src/gate.html).
    static func classifySession(status: Int, body: Data?, waiting: Bool) -> SessionAnswer {
        if (200...299).contains(status) { return .admitted }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if status == 403, obj?["denied"] as? Bool == true { return .denied }
        if status == 403, obj?["pending"] as? Bool == true {
            let code = (obj?["code"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return .pending(code: code)
        }
        if waiting && status == 400 { return .retry }
        return .refused(because: obj?["because"] as? String)
    }

    // The Mac's session ended: a 401, or the gate's sign-in page (HTML) where the board's JSON should be. A 2xx JSON
    // body that is not the list (a board still starting) is not an ended session, only a missed refresh.
    static func sessionEnded(status: Int, contentType: String?) -> Bool {
        if status == 401 { return true }
        return (200...299).contains(status) && (contentType?.lowercased().contains("text/html") ?? false)
    }

    // MARK: - The Mac's session, kept between launches

    // The Mac last admitted, by address (UserDefaults; not a secret). A sign-out clears it.
    static let rememberedMacKey = "nativeBoardMac"

    // The gate's session cookie (kosmos-relay crates/tunnel/src/gate.rs COOKIE_NAME).
    static let macCookieName = "__Host-kosmos_tunnel_session"

    // Kept in the Keychain so a launch reuses the Mac's session instead of opening a new one each time (the gate keeps
    // at most 16 per device, dropping the least recently used, and this app shares its device with the board's web tabs). `owner` is a
    // fingerprint of the Kosmos+ session it was opened under, never the session itself.
    struct SavedMacSession: Codable, Equatable {
        let name: String
        let address: String
        let cookie: String
        let owner: String
    }

    static func owner(of session: String) -> String {
        SHA256.hash(data: Data(session.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func encode(_ saved: SavedMacSession) -> String? {
        (try? JSONEncoder().encode(saved)).flatMap { String(data: $0, encoding: .utf8) }
    }

    // The saved session, only while it belongs to the Kosmos+ session signed in now and names a Mac under the relay.
    static func usableSaved(_ stored: String?, session: String?, coordinator: URL) -> SavedMacSession? {
        guard let stored, let session,
              let saved = try? JSONDecoder().decode(SavedMacSession.self, from: Data(stored.utf8)),
              saved.owner == owner(of: session), !saved.cookie.isEmpty,
              macURL(address: saved.address, coordinator: coordinator) != nil
        else { return nil }
        return saved
    }

    // MARK: - The agents

    struct Agent: Equatable, Identifiable {
        let session: String
        let name: String
        let role: String?
        let state: String
        let task: String?   // not shown in the Agents list; kept for the Today screen ("who is working on what")
        let needsYou: Bool
        var awaitingApproval = false
        var reportedByAgent = false
        var running = true
        var crashLooping = false
        var reconnecting = false
        var needsTrust = false
        var jobRunningUnseen = false
        var restartTimedOut = false
        var hasAvatar = false
        var avatarVer = ""
        // #7004: the card's word and tone as the Mac sends them ready-made (cardWord, cardTone). nil from a Mac that
        // predates them, and then the phone's own table below decides.
        var macWord: String? = nil
        var macTone: Tone? = nil
        var id: String { session }
    }

    // `/api/status`'s `agents`: one row per agent, keyed by `sessionName`.
    static func parseAgents(_ data: Data) -> [Agent]? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["agents"] as? [[String: Any]]
        else { return nil }
        return rows.compactMap { row in
            guard let session = row["sessionName"] as? String, !session.isEmpty else { return nil }
            let name = (row["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? session
            let state = row["state"] as? String ?? "unknown"
            let approval = row["awaitingApproval"] as? Bool ?? false
            let phase = (row["reconnect"] as? [String: Any])?["phase"] as? String
            return Agent(session: session,
                         name: name,
                         role: (row["role"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                         state: state,
                         task: (row["task"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                         needsYou: Board.needsPerson(row),
                         awaitingApproval: approval,
                         reportedByAgent: (row["stateReportedBy"] as? String) == "agent",
                         running: (row["running"] as? Bool) != false,
                         crashLooping: ((row["crashLoop"] as? [String: Any])?["looping"] as? Bool) == true,
                         reconnecting: state == "connection_lost" && (phase == "waiting" || phase == "retried"),
                         needsTrust: (row["needsTrust"] as? Bool) == true,
                         jobRunningUnseen: (row["jobRunningUnseen"] as? Bool) == true,
                         restartTimedOut: ((row["disruption"] as? [String: Any])?["timedOut"] as? Bool) == true,
                         hasAvatar: (row["hasAvatar"] as? Bool) == true,
                         avatarVer: (row["avatarVer"] as? NSNumber)?.stringValue ?? (row["avatarVer"] as? String) ?? "",
                         macWord: (row["cardWord"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                         macTone: Board.tone(named: row["cardTone"] as? String))
        }
    }

    // The card's words, from engine/cardlabel.js labelOf and its STATE_COPY (the board page's own copy). The checks
    // follow labelOf's order except that restarting comes after the question, permission and reconnecting checks; those
    // states cannot coincide, so the answers are the same.
    // Used only for a Mac that predates #7004: a newer Mac sends its word ready-made (cardWord), which wins. Kept equal
    // to engine/cardlabel.js STATE_COPY by server.statusword-7004.test.js. Not copied: restartingLabel's causes ("Switching
    // model" and the like), which read "Restarting agent" from an older Mac. Its ", not back yet" is copied.
    static let stateCopy: [String: String] = [
        "working": "Working", "needs_you": "Issue", "rate_limited": "Rate Limit",
        "auth_failed": "Sign-in Issue", "connection_lost": "Connection lost", "blocked": "Waiting",
        "idle": "Idle", "restarting": "Restarting agent", "stopped": "Not running", "unknown": "Can't tell",
        "needs_trust": "Waiting on a trust prompt", "question": "Question", "approval": "Needs permission",
    ]

    static func statusWord(_ agent: Agent) -> String {
        if let word = agent.macWord { return word }
        if !agent.running && agent.state != "restarting" {
            if agent.needsTrust { return "Waiting on a trust prompt" }
            return agent.jobRunningUnseen ? "Can't tell" : "Not running"
        }
        if agent.crashLooping { return "Keeps stopping" }
        if agent.state == "needs_you" && agent.reportedByAgent { return "Question" }
        if agent.state == "needs_you" && agent.awaitingApproval { return "Needs permission" }
        if agent.reconnecting { return "Reconnecting\u{2026}" }
        if agent.state == "restarting" { return agent.restartTimedOut ? "Restarting agent, not back yet" : "Restarting agent" }
        return stateCopy[agent.state] ?? "Can't tell"
    }

    // The board's own "needs the person" (engine/status.js needsPerson, which web/index.html agentNeedsAttention
    // matches): needs_you, needs_trust, a connection Kosmos gave up reconnecting, a crash loop, an error it is stuck
    // on, and a helper that gave up. Listed first, in the needs-you tone (see tone below), as the board lists them as
    // an Issue.
    static func needsPerson(_ row: [String: Any]) -> Bool {
        let state = row["state"] as? String
        func flag(_ key: String, _ field: String) -> Bool { ((row[key] as? [String: Any])?[field] as? Bool) == true }
        return state == "needs_you" || state == "needs_trust"
            || (state == "connection_lost" && ((row["reconnect"] as? [String: Any])?["phase"] as? String) == "gave_up")
            || flag("crashLoop", "looping") || flag("stuckError", "stuck") || flag("ownBound", "raised")
    }

    // Mona Lisa's slice 1 spec (kosmos#6838): each status word has a tone, which sets the dot and the word's colour.
    enum Tone: Equatable { case needsYou, asked, working, quiet }

    // The Mac's cardTone (engine/cardlabel.js toneOf). A name the phone does not know is nil, and the phone's own rule
    // decides, so a tone the Mac adds later never shows as something it is not.
    static func tone(named name: String?) -> Tone? {
        switch name {
        case "needs_you": return .needsYou
        case "asked": return .asked
        case "working": return .working
        case "quiet": return .quiet
        default: return nil
        }
    }

    // The board's words that mean "needs you" (the spec's table), engine/cardlabel.js NEEDS_YOU_WORDS (kept equal by
    // server.statusword-7004.test.js).
    static let needsYouWords: Set<String> = ["Needs permission", "Issue", "Rate Limit", "Sign-in Issue",
                                             "Connection lost", "Waiting", "Not running", "Can't tell"]

    // Question is asked; the needs-you words, or any agent the board itself counts as needing the person
    // (needsPerson: a crash loop and the like, whose words the table does not list), are needs you; Working is
    // working; anything else, including a word the phone does not know, is quiet.
    static func tone(_ agent: Agent) -> Tone {
        if let tone = agent.macTone { return tone }
        // A state the phone does not know yet (one the Mac adds later) is quiet, never red at the top, unless the
        // board itself counts the agent as needing the person. A real "unknown" state is in the table.
        if agent.running && !agent.crashLooping && !agent.needsYou && stateCopy[agent.state] == nil { return .quiet }
        let word = statusWord(agent)
        if word == "Question" { return .asked }
        if needsYouWords.contains(word) || agent.needsYou { return .needsYou }
        if word == "Working" { return .working }
        return .quiet
    }

    // Needs you and asked first, then working, then quiet; by name within each (then by key, so equal names keep one
    // order). Set when the list appears and on pull to refresh only.
    static func sorted(_ agents: [Agent]) -> [Agent] {
        func rank(_ a: Agent) -> Int { switch tone(a) { case .needsYou, .asked: return 0; case .working: return 1; case .quiet: return 2 } }
        return agents.sorted { (rank($0), $0.name.lowercased(), $0.session) < (rank($1), $1.name.lowercased(), $1.session) }
    }

    // A live update changes rows in place and never moves them under the person's thumb: the shown order is kept,
    // a row that is gone is dropped, and a new agent joins at the end (new ones sorted among themselves).
    static func keepingOrder(_ shown: [Agent], with fresh: [Agent]) -> [Agent] {
        let byKey = Dictionary(fresh.map { ($0.session, $0) }, uniquingKeysWith: { a, _ in a })
        let kept = shown.compactMap { byKey[$0.session] }
        let known = Set(shown.map(\.session))
        return kept + sorted(fresh.filter { !known.contains($0.session) })
    }

    // The agent's picture on its Mac (server.js /api/agent/<name>/avatar, keyed by the agent's session name).
    static func avatarRequest(mac: URL, session: String) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/avatar", relativeTo: mac)!.absoluteURL)
        r.setValue("image/*", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // The same agent-name characters a notification tap accepts.
    static func isAgentSession(_ s: String) -> Bool { PushBridge.isAgentSession(s) }

    // MARK: - One agent's conversation (kosmos#7008, slice 3a)

    // The conversation the board's own chat reads (GET /api/agent/<name>/thread).
    static func threadRequest(mac: URL, session: String) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/thread", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // The board's own longest message (engine/chat.js MAX_MESSAGE); its composer stops there too.
    static let maxMessage = 10000

    // A plain message, as the board's own composer posts it ({text}). nil for a name the app does not accept, an
    // empty message, or one longer than the board takes.
    static func sendRequest(mac: URL, session: String, text: String) -> URLRequest? {
        let said = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isAgentSession(session), !said.isEmpty, said.count <= maxMessage else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/thread", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["text": said])
        return r
    }

    struct ChatRow: Equatable, Identifiable {
        enum Who: Equatable { case person, agent, kosmos }
        // What this first part does not draw, so the chat shows Mona Lisa's way-through row in its place
        // (slice 3a spec, "The way through").
        enum WayThrough: Equatable { case question, permission, attachment }
        let id: String
        let at: Date?
        let text: String
        let who: Who
        // Under a message of the person's: why it did not reach the agent, or nil when it did.
        var notSent: String? = nil
        var wayThrough: WayThrough? = nil
    }

    struct Thread: Equatable {
        let rows: [ChatRow]
        // Older messages kept on the Mac that this read did not bring (the chat says so and links to the board).
        let olderCount: Int
        // The agent is asking something on its screen right now (answered on the board in this first part).
        let asking: Bool
    }

    static func isoDate(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    // `{messages:[{at,text,from,kind,delivery,attachment(s),permission}], olderCount, question}`. A row with no
    // `from` is the person's (engine/chat.js: absent means the operator), `kind: 'kosmos'` is Kosmos's own line,
    // `kind: 'question'` the agent asking; anything else with a `from` is the agent's.
    static func parseThread(_ data: Data) -> Thread? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["messages"] as? [[String: Any]]
        else { return nil }
        var seen: [String: Int] = [:]
        let parsed: [ChatRow] = rows.compactMap { row in
            guard let text = row["text"] as? String else { return nil }
            let at = row["at"] as? String
            let kind = row["kind"] as? String
            let from = (row["from"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let who: ChatRow.Who = kind == "kosmos" ? .kosmos : (kind == "question" || from != nil) ? .agent : .person
            // Two rows can share a time; the id stays unique and stable across reads.
            let base = (at ?? "") + "|" + (from ?? "") + "|" + (kind ?? "")
            let n = seen[base, default: 0]
            seen[base] = n + 1
            var notSent: String? = nil
            if who == .person, let d = row["delivery"] as? [String: Any], let state = d["state"] as? String,
               state != "placed", state != "unconfirmed" {
                notSent = state == "held" ? "Waiting to send" : "Not sent"
            }
            let way: ChatRow.WayThrough? = row["permission"] != nil ? .permission
                : kind == "question" ? .question
                : (row["attachment"] != nil || (row["attachments"] as? [Any])?.isEmpty == false) ? .attachment : nil
            return ChatRow(id: base + "#\(n)", at: isoDate(at), text: text, who: who, notSent: notSent, wayThrough: way)
        }
        let older = (obj["olderCount"] as? NSNumber)?.intValue ?? 0
        let asking = obj["question"] is [String: Any]
        return Thread(rows: parsed, olderCount: max(0, older), asking: asking)
    }

    // MARK: Laying the conversation out (Mona Lisa's slice 3a spec: runs, times, day lines)

    struct ChatItem: Equatable, Identifiable {
        enum Kind: Equatable {
            case day(String)
            // A bubble's time and tail go on the last of a run; the spacing above it is the run's.
            case row(ChatRow, firstOfRun: Bool, lastOfRun: Bool)
        }
        let id: String
        let kind: Kind
    }

    // A day line whenever the day changes between messages. A run is consecutive messages from the same side on the
    // same day; Kosmos's lines and way-through rows stand alone.
    static func chatItems(_ rows: [ChatRow], now: Date, calendar: Calendar) -> [ChatItem] {
        func inRun(_ r: ChatRow) -> Bool { r.who != .kosmos && r.wayThrough == nil }
        func together(_ a: ChatRow?, _ b: ChatRow) -> Bool {
            guard let a, inRun(a), inRun(b), a.who == b.who else { return false }
            if let x = a.at, let y = b.at { return calendar.isDate(x, inSameDayAs: y) }
            return true
        }
        var out: [ChatItem] = []
        var shownDay: Date?
        for (i, r) in rows.enumerated() {
            if let at = r.at, shownDay.map({ !calendar.isDate(at, inSameDayAs: $0) }) ?? true {
                out.append(ChatItem(id: "day|" + r.id, kind: .day(dayLine(at, now: now, calendar: calendar))))
                shownDay = at
            }
            let prev = i > 0 ? rows[i - 1] : nil
            let next = i + 1 < rows.count ? rows[i + 1] : nil
            out.append(ChatItem(id: r.id, kind: .row(r, firstOfRun: !together(prev, r), lastOfRun: next.map { !together(r, $0) } ?? true)))
        }
        return out
    }

    // "Today", "Yesterday", then "Monday 21 October" (with the year when it is not this year).
    static func dayLine(_ day: Date, now: Date, calendar: Calendar) -> String {
        if calendar.isDate(day, inSameDayAs: now) { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(day, inSameDayAs: yesterday) { return "Yesterday" }
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = calendar.locale ?? Locale(identifier: "en_GB")
        f.dateFormat = calendar.component(.year, from: day) == calendar.component(.year, from: now) ? "EEEE d MMMM" : "EEEE d MMMM yyyy"
        return f.string(from: day)
    }

    // A message the person sent from this chat that the thread does not hold yet: sending, or not sent.
    struct PendingSend: Equatable, Identifiable {
        let id: String
        let text: String
        let at: Date
        // nil while it sends; the line under the bubble once it was not accepted.
        var failed: String? = nil
        var canRetry = true
        // The Mac took it; shown (full strength, with its time) until a read of the conversation holds it.
        var accepted = false
    }

    // The pending messages still to show once a read of the conversation is in: an accepted one goes when the thread
    // holds a message of the person's with the same words, written no earlier than a minute before it was sent (the
    // Mac's clock and the phone's can differ). Each thread row stands for one pending message at most.
    static func settled(_ pending: [PendingSend], with thread: Thread) -> [PendingSend] {
        var unused = thread.rows.filter { $0.who == .person }
        let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        return pending.filter { p in
            guard p.accepted else { return true }
            if let i = unused.firstIndex(where: { trim($0.text) == trim(p.text) && ($0.at.map { $0 >= p.at.addingTimeInterval(-60) } ?? true) }) {
                unused.remove(at: i)
                return false
            }
            return true
        }
    }

    // The line under a message that was not accepted (the spec's wording). An agent that is not running cannot take it,
    // so there is nothing to retry until its status changes.
    static func notSentLine(agentRunning: Bool, name: String) -> (text: String, canRetry: Bool) {
        agentRunning ? ("Not sent. Tap to try again.", true) : ("Not sent. \(name) isn't running on your computer.", false)
    }

    enum SendOutcome: Equatable { case sent, notSent(String) }

    // POST /api/agent/<name>/thread answers 200 with `delivery`; only `placed` (and `unconfirmed`, which the board
    // shows as sent) reached the agent. A refusal answers 4xx with `{error}`, said as it is.
    static func sendOutcome(status: Int, body: Data?) -> SendOutcome {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if (200...299).contains(status), let d = obj?["delivery"] as? [String: Any], let state = d["state"] as? String {
            if state == "placed" || state == "unconfirmed" { return .sent }
            if state == "held" { return .notSent("Waiting to send. It goes once the agent can take it.") }
            return .notSent((d["because"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Not sent.")
        }
        if let error = obj?["error"] as? String, !error.isEmpty { return .notSent(error) }
        return status == 0 ? .notSent("Your Mac isn't answering, so it was not sent.") : .notSent("Not sent.")
    }
}
