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
    // to engine/cardlabel.js STATE_COPY by statusword-7004.test.js. Not copied: restartingLabel's causes ("Switching
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
    // statusword-7004.test.js).
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
}
