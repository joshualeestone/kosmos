import Foundation
import UniformTypeIdentifiers
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
        // kosmos#7197: three tries before "not answering", so each waits 8 s, not the session's 15 s (about 30 s in all).
        r.timeoutInterval = 8
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
    // kosmos#7266: a Mac the person chose in the switcher wins while it is usable, connected or not (choosing one that
    // is offline shows its own "not answering" screen, which names it).
    static func pickMac(_ macs: [Mac], remembered: String?, chosen: String? = nil) -> Mac? {
        let all = macs.filter(\.usable).sorted { ($0.lastSeen, $1.address) > ($1.lastSeen, $0.address) }
        if let c = chosen, let m = all.first(where: { $0.address == c }) { return m }
        let open = all.filter { !$0.refusedThisDevice }
        let usable = open.isEmpty ? all : open
        if let r = remembered, let m = usable.first(where: { $0.address == r && $0.connected }) { return m }
        if let m = usable.first(where: { $0.connected }) { return m }
        if let r = remembered, let m = usable.first(where: { $0.address == r }) { return m }
        return usable.first
    }

    // MARK: - The switcher (kosmos#7266)

    struct SwitcherRow: Equatable {
        let name: String
        let address: String
        let online: Bool
        let shown: Bool
        var status: String { online ? "Online" : "Offline" }
    }

    // The computers the switcher lists: the usable ones, by name (then address, so two of one name keep their order),
    // the shown one marked. A retired, held, refused or switched-off Mac is not listed: it cannot be opened.
    static func switcherRows(_ macs: [Mac], shown: String?) -> [SwitcherRow] {
        macs.filter(\.usable)
            .sorted { ($0.name.lowercased(), $0.address) < ($1.name.lowercased(), $1.address) }
            .map { SwitcherRow(name: $0.name, address: $0.address, online: $0.connected, shown: $0.address == shown) }
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
        // kosmos#7341: a restart that failed (disruption.failed), which the board draws as stopped.
        var restartFailed = false
        var hasAvatar = false
        var avatarVer = ""
        // #7004: the card's word and tone as the Mac sends them ready-made (cardWord, cardTone). nil from a Mac that
        // predates them, and then the phone's own table below decides.
        var macWord: String? = nil
        var macTone: Tone? = nil
        // kosmos#7030: why Today shows the agent (needsReason, engine/cardlabel.js reasonOf) and the project its wait
        // names (stateProjectName), ready-made; nil from a Mac older than that, and then Today words it generally. When
        // the wait began (waitingSince, the agent's own report), for Today's order and age; nil when nobody knows.
        var needsReason: String? = nil
        var stateProjectName: String? = nil
        var waitingSince: Date? = nil
        // kosmos#7080: the project the agent's work is attributed to (the card's stateProject), nil when unattributed.
        // The room's working line reads it, as the board's paintRoomBusy does.
        var stateProject: String? = nil
        // kosmos#7120: how full the agent's context is (the board's pctOf(a.context)), nil when not known (a stopped
        // agent carries none), and whether it is over its ceiling (context.overCeiling, the board's "Full").
        var contextPercent: Double? = nil
        var contextFull = false
        // kosmos#7354: the agent's replies the person has not read (dmUnread, server.js withDmUnread), and whether it is
        // the guide, which the Mac's waiting total leaves out of the DM count.
        var dmUnread = 0
        var isGuide = false
        // kosmos#7421: what the desktop's orders read (web/index.html sortAgents): when the person last talked to it, when
        // it was last active, when it was made, and the model it shows; nil when the row does not say.
        var lastTalkedAt: Date? = nil
        var lastActiveAt: Date? = nil
        var createdAt: Date? = nil
        var model: String? = nil
        // The role the person picked on the agent's profile (profile.role), which the desktop's roleLine names before the
        // line parsed from its instructions; and whether its messages are stuck (deliveryStall, #7212), which the
        // desktop's Needs you first ranks with the agents that need the person.
        var profileRole: String? = nil
        var deliveryStall = false
        var id: String { session }
    }

    // kosmos#7354 (Josh 10-27, Mona Lisa's design): the red count on an agent's avatar: one when it needs the person, plus
    // its unread replies; nothing for the guide, which the Mac leaves out of both. This is the Mac's waitingTotal (engine/status.js) agent by
    // agent, so the rows add up to the tab's number less the rooms' unread, which the Projects tab shows.
    static func noticeCount(_ a: Agent) -> Int {
        a.isGuide ? 0 : (a.needsYou ? 1 : 0) + max(0, a.dmUnread)   // the Mac counts nothing of the guide's (server.js countAgents)
    }
    // The count to VoiceOver, which does not see the badge.
    static func noticeWords(_ n: Int) -> String? { n > 0 ? "\(n) waiting" : nil }

    // kosmos#7354: POST /api/agent/<name>/seen, the person has this agent's DM open (server.js dmSeen, the board's
    // own read cursor); its unread replies stop counting. nil for a name the board would refuse.
    static func dmSeenRequest(mac: URL, session: String) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/seen", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
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
                         restartFailed: ((row["disruption"] as? [String: Any])?["failed"] as? Bool) == true,
                         hasAvatar: (row["hasAvatar"] as? Bool) == true,
                         avatarVer: (row["avatarVer"] as? NSNumber)?.stringValue ?? (row["avatarVer"] as? String) ?? "",
                         macWord: (row["cardWord"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                         macTone: Board.tone(named: row["cardTone"] as? String),
                         needsReason: (row["needsReason"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                         stateProjectName: (row["stateProjectName"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                         waitingSince: isoDate(row["waitingSince"] as? String),
                         stateProject: (row["stateProject"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                         contextPercent: Board.contextPercent(row["context"]),
                         contextFull: Board.isRealTrue((row["context"] as? [String: Any])?["overCeiling"]),
                         dmUnread: max(0, (row["dmUnread"] as? NSNumber)?.intValue ?? 0),
                         isGuide: (row["isGuide"] as? Bool) == true,
                         lastTalkedAt: isoDate(row["lastTalkedAt"] as? String),
                         lastActiveAt: isoDate(row["lastActiveAt"] as? String),
                         createdAt: isoDate(row["createdAt"] as? String),
                         model: Board.sortModel(row),
                         profileRole: ((row["profile"] as? [String: Any])?["role"] as? String).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 },
                         deliveryStall: row["deliveryStall"] is [String: Any] || (row["deliveryStall"] as? Bool) == true)
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

    // kosmos#7342 (Josh 10-27, Mona Lisa's design): the Agents list's status is a small pill, only when there is
    // something to see. Idle shows none. Green working, blue a question or a choice waiting for the person, amber held by
    // something outside the agent, red only a real problem, grey when Kosmos cannot tell. The word is still the Mac's
    // own (statusWord); the pill's colour comes from the same state the word does.
    enum Pill: Equatable { case working, asks, held, problem, cantTell }
    // Review: an agent the board counts as needing the person (needsPerson: a reconnect that gave up, a stuck error, a
    // helper that gave up) is red whatever its state, unless it is asking; and when the Mac's own tone says needs you
    // (a word the phone does not map, such as Messages stuck), a pill that would be Working or missing is red too.
    // Grey stays grey (the Mac counts Can't tell as needs you; the design keeps it grey).
    // So a Working pill or no pill never hides what the board counts as needing the person.
    static func pill(_ a: Agent) -> Pill? {
        let p = statePill(a)
        if p == .asks { return p }
        if a.needsYou { return .problem }
        if a.macTone == .needsYou && (p == nil || p == .working) { return .problem }
        return p
    }
    private static func statePill(_ a: Agent) -> Pill? {
        if !a.running && a.state != "restarting" {
            if a.needsTrust { return .asks }
            return a.jobRunningUnseen ? .cantTell : .problem
        }
        if a.crashLooping || a.restartFailed { return .problem }
        switch a.state {
        case "idle": return nil
        case "working": return .working
        case "needs_you": return a.reportedByAgent || a.awaitingApproval ? .asks : .problem
        case "question", "approval", "needs_trust": return .asks
        case "rate_limited", "blocked", "connection_lost", "restarting": return .held
        case "auth_failed", "stopped": return .problem
        default: return .cantTell
        }
    }

    // kosmos#7343: the Agents list's order: the list's own (starred agents, then needs you first, Board.sorted), or by name.
    // kosmos#7421 (Josh 10-27 20:34: "the sort options for agent mobile should mirror the desktop app"): the desktop's
    // eight orders, its keys, its words and its order (web/index.html AGENT_SORTS and agentSortControlHtml), Last
    // talked to first as there. A test reads both lists out of web/index.html so they cannot drift apart.
    enum AgentSort: String, CaseIterable { case talked, model, name, needs, active, newest, project, role }
    static let agentSortDefault = AgentSort.talked
    static func agentSortLabel(_ s: AgentSort) -> String {
        switch s {
        case .talked: return "Last talked to"
        case .model: return "By model"
        case .name: return "Name A to Z"
        case .needs: return "Needs you first"
        case .active: return "Recently active"
        case .newest: return "Newest first"
        case .project: return "By project"
        case .role: return "By role"
        }
    }
    // A saved choice: one of the eight, or the phone's older "board" (its Needs you first), else the default.
    static func agentSort(saved: String) -> AgentSort { saved == "board" ? .needs : AgentSort(rawValue: saved) ?? agentSortDefault }

    // The model line the desktop's order reads (web/index.html sortAgents: tileModelLine over modelLine), ported branch
    // for branch so an agent groups with the same model on both: a stopped agent names the model its job will start on;
    // Codex, Qwen, DeepSeek, Gemini, Grok, Antigravity and Muse carry their provider's words; a Claude name gets "Claude ";
    // an agent known only by an earlier session's model is named by that. nil (sorted last) when the desktop's key is.
    static func sortModel(_ row: [String: Any]) -> String? {
        func text(_ k: String) -> String? { (row[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
        func has(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        let runner = text("runner"), provider = (row["account"] as? [String: Any])?["provider"] as? String
        let earlier = text("earlierModelName")
        guard ["codex", "gemini", "grok", "antigravity", "muse"].contains(runner ?? "") || text("modelName") != nil
                || text("plannedModelName") != nil || earlier != nil else { return nil }
        // The desktop's cardStOf(a).pres off: stopped, or a restart that failed (needs_you with disruption.failed, review 2).
        let notRunning = text("state") == "stopped" || (text("state") == "needs_you" && ((row["disruption"] as? [String: Any])?["failed"] as? Bool) == true)
        let name = (notRunning ? text("plannedModelName") : nil) ?? text("modelName") ?? text("plannedModelName")
        let line: String
        if runner == "codex" && provider == "alibaba" { line = name.map { has($0, "qwen") ? $0 : "Qwen " + $0 } ?? "Qwen" }
        else if runner == "codex" { line = name.map { has($0, "^(gpt|openai|codex)\\b") ? $0 : "OpenAI " + $0 } ?? "OpenAI Codex" }
        else if provider == "deepseek" { line = name.map { has($0, "deepseek") ? $0 : "DeepSeek " + $0 } ?? "DeepSeek" }
        else if runner == "gemini", let n = name, !notRunning, let set = text("settingModelName") { line = n + " (set to " + set + ")" }
        else if runner == "gemini" || runner == "grok" { line = name ?? (runner == "gemini" ? "Gemini" : "Grok") }
        else if runner == "antigravity" { line = name ?? "Gemini (Google subscription)" }
        else if runner == "muse" { line = name ?? "Meta Muse" }
        else if let n = name { line = has(n, "^claude") ? n : "Claude " + n }
        else { line = (row["neverRecorded"] as? Bool) == true ? "Made before Kosmos recorded this" : "Unknown Model" }
        // tileModelLine: an agent with only an earlier session's model is named by it.
        if let e = earlier, text("modelName") == nil, text("plannedModelName") == nil,
           line == "Made before Kosmos recorded this" || line == "Unknown Model" { return has(e, "^claude") ? e : "Claude " + e }
        return line
    }

    // The role as the desktop's roleLine shows it for the order: the first character a capital, the rest as written.
    static func sortRole(_ role: String?) -> String? {
        guard let r = role?.trimmingCharacters(in: .whitespaces), let first = r.first else { return nil }
        return first.uppercased() + r.dropFirst()
    }

    // The desktop's sortAgents: starred agents first in every order (`stars`, by session; nil when not known), then the
    // chosen key, then the name, then the computer's own order. A missing value sorts after every present one.
    // `projects` is each agent's first project name A to Z (by session), for By project.
    static func agentOrder(_ list: [Agent], sort: AgentSort, projects: [String: String] = [:], stars: Set<String>? = nil) -> [Agent] {
        func cmpText(_ a: String?, _ b: String?) -> Int {
            switch (a, b) {
            case (nil, nil): return 0
            case (nil, _): return 1
            case (_, nil): return -1
            case let (x?, y?):
                switch x.compare(y, options: [.caseInsensitive, .diacriticInsensitive], locale: .current) {
                case .orderedAscending: return -1
                case .orderedDescending: return 1
                case .orderedSame: return 0
                }
            }
        }
        func cmpTime(_ a: Date?, _ b: Date?) -> Int {
            switch (a, b) {
            case (nil, nil): return 0
            case (nil, _): return 1
            case (_, nil): return -1
            case let (x?, y?): return x == y ? 0 : (x > y ? -1 : 1)   // newest first
            }
        }
        func needsRank(_ a: Agent) -> Int {
            if a.needsYou || a.deliveryStall { return 0 }
            switch a.state {
            case "blocked": return 1
            case "working", "restarting": return 2
            case "idle": return 3
            default: return 4
            }
        }
        func key(_ a: Agent, _ b: Agent) -> Int {
            switch sort {
            case .name: return 0
            case .model: return cmpText(a.model, b.model)
            case .needs: return needsRank(a) - needsRank(b)
            case .project: return cmpText(projects[a.session], projects[b.session])
            case .role: return cmpText(sortRole(a.profileRole ?? a.role), sortRole(b.profileRole ?? b.role))
            case .active: return cmpTime(a.lastActiveAt, b.lastActiveAt)
            case .newest: return cmpTime(a.createdAt, b.createdAt)
            case .talked: return cmpTime(a.lastTalkedAt, b.lastTalkedAt)
            }
        }
        func starred(_ a: Agent) -> Int { stars?.contains(a.session) == true ? 0 : 1 }
        return list.enumerated().sorted { l, r in
            let s = starred(l.element) - starred(r.element)
            if s != 0 { return s < 0 }
            let k = key(l.element, r.element)
            if k != 0 { return k < 0 }
            let n = cmpText(l.element.name, r.element.name)
            return n != 0 ? n < 0 : l.offset < r.offset
        }.map(\.element)
    }


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
            || jsTruthy(row["deliveryStall"])   // kosmos#7354 review: #7212's stalled delivery, as engine/status.js needsPerson
    }

    // A value as JavaScript's Boolean() reads it: absent, null, false, 0 and "" are false; anything else is true.
    static func jsTruthy(_ v: Any?) -> Bool {
        switch v {
        case nil, is NSNull: return false
        case let n as NSNumber: return n.doubleValue != 0
        case let s as String: return !s.isEmpty
        default: return true
        }
    }

    // Mona Lisa's slice 1 spec (kosmos#6838): each status word has a tone, which sets the dot and the word's colour.
    enum Tone: Equatable { case needsYou, asked, working, quiet }

    // kosmos#7341 (Josh 10-27): the avatar's dot says one thing, whether the agent is there: green while it runs, grey
    // when stopped, hollow when Kosmos cannot tell. Its work state is the word beside it. The board's memberDotClass
    // (web/index.html) with CARD_ST's pres, in its order: a trust prompt is unsure; not running (unless restarting) is
    // off; then the state's own presence, where a failed restart is off (the grid card's cardStOf presence; the
    // member dot alone would keep it green) and a state the phone does not know is unsure.
    enum Presence: Equatable { case on, off, unsure }
    static let presenceOf: [String: Presence] = [
        "working": .on, "needs_you": .on, "question": .on, "rate_limited": .on, "auth_failed": .on,
        "connection_lost": .on, "blocked": .on, "idle": .on, "restarting": .on,
        "stopped": .off, "unknown": .unsure, "needs_trust": .unsure,
    ]
    static func presence(_ a: Agent) -> Presence {
        if a.needsTrust || a.state == "needs_trust" { return .unsure }
        if !a.running && a.state != "restarting" { return .off }
        if a.state == "needs_you" && a.restartFailed { return .off }   // the board's CARD_ST_FAILED_RESTART
        return presenceOf[a.state] ?? .unsure
    }
    // Review: the dot is colour (and fill) only, so VoiceOver hears what it says when the status word does not already.
    static func presenceWords(_ p: Presence, word: String) -> String? {
        switch p {
        case .on: return nil
        case .off: return word == "Not running" ? nil : "not running"
        case .unsure: return word == "Can't tell" ? nil : "Kosmos can't tell if it is running"
        }
    }

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
    // order). Set when the list appears and on pull to refresh only. #7034: the person's starred agents first.
    static func sorted(_ agents: [Agent], stars: Set<String>? = nil) -> [Agent] {
        func rank(_ a: Agent) -> Int { switch tone(a) { case .needsYou, .asked: return 0; case .working: return 1; case .quiet: return 2 } }
        let ordered = agents.sorted { (rank($0), $0.name.lowercased(), $0.session) < (rank($1), $1.name.lowercased(), $1.session) }
        return starredFirst(ordered, stars: stars)
    }

    // A live update changes rows in place and never moves them under the person's thumb: the shown order is kept,
    // a row that is gone is dropped, and a new agent joins at the end (new ones sorted among themselves).
    // kosmos#7421 review 2: the newcomers at the end are put in the chosen order among themselves (sort nil: the older
    // status order, for callers that pick none).
    static func keepingOrder(_ shown: [Agent], with fresh: [Agent], stars: Set<String>? = nil, sort: AgentSort? = nil,
                             projects: [String: String] = [:]) -> [Agent] {
        let byKey = Dictionary(fresh.map { ($0.session, $0) }, uniquingKeysWith: { a, _ in a })
        let kept = shown.compactMap { byKey[$0.session] }
        let known = Set(shown.map(\.session))
        let newcomers = fresh.filter { !known.contains($0.session) }
        return kept + (sort.map { agentOrder(newcomers, sort: $0, projects: projects, stars: stars) } ?? sorted(newcomers, stars: stars))
    }

    // #7034 (#6719 on the phone): the person's starred agents, by session name, as the board keeps them
    // (GET /api/agent-stars answers { names, ok }).
    // The list waits for this read on a re-sort, so it gives up sooner than the session's 15 s.
    static let starsTimeout: TimeInterval = 4
    static func starsRequest(mac: URL) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/agent-stars", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.timeoutInterval = starsTimeout
        return r
    }

    // kosmos#7034 (Josh 10-27 20:38: "Where do I star them on the phone"): star or unstar one agent, as the board's own
    // star does (PUT /api/agent-stars { name, on }); the answer is the whole list as now saved ({ names, ok }).
    static func starWriteRequest(mac: URL, name: String, on: Bool) -> URLRequest? {
        guard let body = try? JSONSerialization.data(withJSONObject: ["name": name, "on": on]) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent-stars", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "PUT"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.httpBody = body
        r.timeoutInterval = starsTimeout
        return r
    }

    // The board's words when a star does not save (web/index.html STAR_MSG and saveStar), by its answer: a refusal no
    // retry fixes says so; anything else asks to try again.
    static func starFailure(on: Bool, status: Int, data: Data?) -> String {
        let error = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["error"] as? String
        if status == 400 { return error == "too many starred agents" ? "That star could not be saved: 500 agents are starred already. Unstar one first." : "That agent cannot be starred." }
        if status == 500, error == "we could not save that star" { return "Stars cannot be changed right now: Kosmos cannot read or save its list of starred agents." }
        return on ? "That star could not be saved. Try again in a moment." : "That star could not be removed. Try again in a moment."
    }

    // nil for an answer the board could not read its list for (`ok` false) or one not in that shape: then no order
    // changes.
    static func parseStars(_ data: Data) -> Set<String>? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              obj["ok"] as? Bool == true,
              let names = obj["names"] as? [String]
        else { return nil }
        return Set(names)
    }

    // Starred agents first, each group in the order it was given (the board's rule, web/index.html #6719). No stars,
    // or none known, leaves the order as it is.
    static func starredFirst(_ agents: [Agent], stars: Set<String>?) -> [Agent] {
        guard let stars, !stars.isEmpty else { return agents }
        return agents.filter { stars.contains($0.session) } + agents.filter { !stars.contains($0.session) }
    }

    // The agent's picture on its Mac (server.js /api/agent/<name>/avatar, keyed by the agent's session name).
    static func avatarRequest(mac: URL, session: String) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/avatar", relativeTo: mac)!.absoluteURL)
        r.setValue("image/*", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // kosmos#7266 slice B: the person on this Mac, for the Settings tab's picture and the profile page. GET /api/you
    // answers { state, you: { name, ... } } (engine/you.js read); GET /api/you/avatar answers 200 with the picture, or
    // 204 when there is none.
    static let youEvery: TimeInterval = 300
    // Review 1: the picture is the big read (up to 5 MB, served no-store, with no version), so it is read on the first list
    // and then every 30 minutes, not with every name read.
    static let youPictureEvery: TimeInterval = 1800
    // Review 4: a read that learns nothing (the Mac's startup sign-in window, the gate's page, a 5xx, no answer) is tried
    // again after 30 seconds, not after the full wait, so a fresh launch does not show the gear and You for 5 minutes.
    static let youRetry: TimeInterval = 30
    static func youRequest(mac: URL) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/you", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
    static func youPictureRequest(mac: URL) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/you/avatar", relativeTo: mac)!.absoluteURL)
        r.setValue("image/*", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
    // Mona Lisa's review: a person with no picture shows their letter on the avatar cream, as an agent with none does
    // (its name's first letter, upper-cased). nil while the name is not known, so a wrong letter is never shown.
    static func youLetter(_ name: String?) -> String? {
        guard let first = name?.trimmingCharacters(in: .whitespacesAndNewlines).first else { return nil }
        return String(first).uppercased()
    }

    // The saved name, trimmed; nil when the board has none (absent, unreadable, or blank).
    static func parseYouName(_ data: Data) -> String? {
        if case .name(let n) = youName(data) { return n }
        return nil
    }
    // Review 1: what the name read means. Only the board saying there is no record (absent) or a saved blank name
    // clears it; an answer that is not the record (the gate's sign-in page at 200, the board's own "unknown" while the
    // file is mid-write) learns nothing and keeps what was shown, as the picture read does.
    enum YouName: Equatable { case name(String), none, unknown }
    static func youName(_ data: Data) -> YouName {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let state = obj["state"] as? String
        else { return .unknown }
        if state == "absent" { return .none }
        guard state == "saved", let you = obj["you"] as? [String: Any] else { return .unknown }
        let name = (you["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? .none : .name(name)
    }

    // What the picture read means: a picture, none (204, or a 404 from an older board without the route), or nothing
    // learned (no answer, the gate's sign-in page, a 5xx), which keeps what was shown.
    enum YouPicture: Equatable { case picture(Data), none, unknown }
    static func youPicture(status: Int?, contentType: String?, data: Data?) -> YouPicture {
        guard let status else { return .unknown }
        if status == 204 || status == 404 { return .none }
        if (200...299).contains(status), (contentType ?? "").lowercased().hasPrefix("image/"), let data, !data.isEmpty { return .picture(data) }
        return .unknown
    }

    // The same agent-name characters a notification tap accepts.
    static func isAgentSession(_ s: String) -> Bool { PushBridge.isAgentSession(s) }

    // kosmos#7075: every request the app sends to a Mac says it is the board's own (Sec-Fetch-Site: same-origin), as a
    // browser and the board in the app's web view do. Through Kosmos+, the tunnel adds the Mac's board token only to a
    // request that says so (kosmos-relay proxy.rs board_token_allowed: none is refused, fail closed), and a real Mac
    // refuses every /api/ request without its token; the Mac's isViaScreen reads it too, to tell the person's screen
    // from a process. The tunnel withholds the token otherwise so another website cannot use a browser's tunnel cookie;
    // the app's cookie jar is its own and no website can make it send a request. Agents are told apart by their own
    // agent token, which the app never sends. Requests to Kosmos+ itself (the coordinator) are left as they are.
    // ⚠️ The header is a claim, not a credential: what keeps this safe is the session cookie in the app's own jar, and
    // that every request's host and path are the app's own (the Mac's address, fixed routes, attachment ids checked).
    // A change that let what a Mac or a message says choose a request's host or path would send it with the token, as
    // the person's own act; keep request paths the app's own.
    static let fetchSiteHeader = "Sec-Fetch-Site"
    static func forMac(_ request: URLRequest, coordinator: URL) -> URLRequest {
        guard let host = request.url?.host?.lowercased(), host != coordinator.host?.lowercased() else { return request }
        var r = request
        r.setValue("same-origin", forHTTPHeaderField: fetchSiteHeader)
        return r
    }

    // MARK: - One agent's conversation (kosmos#7008, slice 3a)

    // The conversation the board's own chat reads (GET /api/agent/<name>/thread).
    static func threadRequest(mac: URL, session: String) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/thread", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // A link in an agent's message is kept only when it opens a web page (http or https, with a host).
    static func isWebLink(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
        return !(url.host ?? "").isEmpty
    }

    // A message's text as a bubble draws it: what iOS reads as inline Markdown, with the message's own line breaks kept,
    // and plain web links made tappable (links only: not phone numbers or dates).
    static func messageText(_ s: String) -> AttributedString {
        var out = (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
        // A Markdown link can put any address behind friendly words (a phone call, another app), so only web addresses
        // stay links; the words stay as text.
        let hidden = out.runs.compactMap { run in run.link.flatMap { isWebLink($0) ? nil : run.range } }
        for range in hidden { out[range].link = nil }
        let plain = String(out.characters)
        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) {
            for match in detector.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
                guard let url = match.url, isWebLink(url), let range = Range(match.range, in: plain),
                      let lower = AttributedString.Index(range.lowerBound, within: out),
                      let upper = AttributedString.Index(range.upperBound, within: out),
                      out[lower..<upper].link == nil else { continue }
                out[lower..<upper].link = url
            }
        }
        return out
    }

    // The links a message's bubble shows, in order, for VoiceOver's actions.
    static func messageLinks(_ s: String) -> [URL] { links(in: messageText(s)) }

    // One link split into runs by its styling counts once. Foundation's Markdown leaves addresses and link words
    // unstyled today (measured), so no message reaches this yet; it holds if that changes.
    static func links(in text: AttributedString) -> [URL] {
        var out: [URL] = []
        var last: URL?
        for run in text.runs {
            if let url = run.link, url != last { out.append(url) }
            last = run.link
        }
        return out
    }

    // The board's own longest message (engine/chat.js MAX_MESSAGE), counted as it counts: UTF-16 units of the message
    // with its runs of spaces and line breaks made single spaces (cleanMessage).
    static let maxMessage = 10000
    static func fitsBoard(_ text: String) -> Bool {
        let said = sameWords(text)
        return !said.isEmpty && said.utf16.count <= maxMessage
    }

    // kosmos#7346 review: with no send arrow to grey out, a Send key that cannot send says why. Nil when nothing stops
    // it, or when there is nothing to send (an empty box says nothing). `said` is sendWords: the words, or the files' names.
    static let tooLongLine = "This message is too long to send. Shorten it or send it in two."
    static let sendWaitWords = "Waiting for the last words."
    static let sendStopDictating = "Stop dictating first."
    static func dmSendBlocked(said: String, files: Int, uploading: Int, dictating: Bool, finishing: Bool) -> String? {
        guard !sameWords(said).isEmpty else { return nil }
        if finishing { return sendWaitWords }
        if dictating { return sendStopDictating }
        if files > 0 && uploading > 0 { return stillAddingLine }
        if !fitsBoard(said) { return tooLongLine }
        return nil
    }
    static let roomNotReadLine = "The room is still loading. Try again in a moment."
    static let roomOnlyMentionLine = "Add your words after the @name."
    static func roomPostBlocked(words: String, mentionOnly: Bool, read: Bool, files: Int, uploading: Int,
                                dictating: Bool, finishing: Bool) -> String? {
        guard !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        if finishing { return sendWaitWords }
        if dictating { return sendStopDictating }
        if files > 0 && uploading > 0 { return stillAddingLine }
        if !read { return roomNotReadLine }
        if mentionOnly { return roomOnlyMentionLine }
        if files > maxFiles { return uploadRefusal(size: nil, waiting: maxFiles) }
        return nil
    }

    // A message's words with every run of whitespace one space and the ends trimmed: how the board compares and counts
    // (cleanMessage), and how a sent message is matched to the row the Mac kept (which keeps line breaks but tidies them).
    static func sameWords(_ s: String) -> String {
        s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    // A message, as the board's own composer posts it ({text}, and `attachments` with the ids of the files it carries,
    // kosmos#7071). nil for a name the app does not accept, a message the board would not take, or more files than a
    // message can carry.
    static func sendRequest(mac: URL, session: String, text: String, attachments: [String] = [], replyTo: String? = nil) -> URLRequest? {
        let said = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isAgentSession(session), fitsBoard(said), attachments.count <= maxFiles,
              attachments.allSatisfy(isAttachmentId) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/thread", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["text": said]
        if !attachments.isEmpty { body["attachments"] = attachments }
        // kosmos#7083: the message this answers, by its `at` (the board's own form, #4256).
        if let replyTo, !replyTo.isEmpty { body["reply_to"] = replyTo }
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return r
    }

    struct ChatRow: Equatable, Identifiable {
        enum Who: Equatable { case person, agent, kosmos }
        // What this first part does not draw, so the chat shows Mona Lisa's way-through row in its place
        // (slice 3a spec, "The way through").
        // A question stays marked .question / .permission even where the chat now draws its buttons (#7016): the chat
        // keys its buttons on it, and a notification's Reply reads it to refuse while a question is up (#7017,
        // NotificationAction.standingQuestion), so the marking is load-bearing for both.
        enum WayThrough: Equatable { case question, permission, attachment, draft }
        let id: String
        // The Mac's own time for the row, as it sent it: a sent message is matched to its row by it.
        let atRaw: String?
        let at: Date?
        let text: String
        let who: Who
        // Under a message of the person's, the Mac's verdict when it is not "reached the agent": "Message failed to
        // deliver" (it could not deliver it; the board's dmFailedLine, kosmos#7136), "Not sent" (a copy the Mac kept as
        // one, duplicateOf), "Waiting to send" (it holds it and sends it itself), or "Not confirmed" (it may have arrived:
        // the board's "could not confirm", where sending again may duplicate it). nil when it reached the agent.
        var notSent: String? = nil
        var wayThrough: WayThrough? = nil
        // The Mac's own reason. Under a failed message it is only heard (the board keeps it to the line's tooltip, #6720).
        var because: String? = nil
        // A message the Mac could not deliver: not a copy the Mac already marked as one (duplicateOf), and not a menu
        // answer (its words are not what was typed).
        var resendable = false
        // kosmos#7136: the Mac keeps `retryable` on a row it will take back through retry_of, and serves `retrying` while
        // one is being sent again.
        var retryable = false
        var retrying = false
        // Sent again only as the board does (dmFailedLine): the same row, through retry_of, which the Mac takes only for
        // plain words, so never a reply or a message with files. The newest-only half needs the thread (failedLine).
        var canSendAgain: Bool {
            who == .person && notSent == Board.failedWords && resendable && retryable && replyTo == nil && attachments.isEmpty
                && wayThrough != .attachment && !(atRaw ?? "").isEmpty
        }
        // kosmos#7016: the Mac's reading of a permission prompt on a question row, and whether a question is the agent's
        // own reported words (which take no buttons, as on the board).
        var permission: Permission? = nil
        var reported = false
        // kosmos#7016 part 2: the files on the row, in the order sent (the board's pjFiles).
        var attachments: [Attachment] = []
        // kosmos#7083: the `at` of the message this one answers (the board's DM reply, #4256), and the reaction pills on
        // it (#3650).
        var replyTo: String? = nil
        var reactions: [ChatReaction] = []
        // Who sent it, as the Mac names it (nil: the person, or Kosmos's own line).
        var from: String? = nil
        // Reply and reactions only on this agent's own messages, not a question (server.js: a reply_to must be the
        // agent's or the person's, never a question; chat.reactDirect: only `from === name`), as the board's hover bar.
        func answerable(by session: String) -> Bool {
            who == .agent && from == session && atRaw != nil && wayThrough != .question && wayThrough != .permission
        }
    }

    // A reaction pill on a chat message: the room's Board.Reaction shape (BoardRoom.swift), kept here because not every
    // suite that compiles the chat compiles the room.
    struct ChatReaction: Equatable {
        let emoji: String
        let count: Int
        let mine: Bool
    }

    // The Mac's pills (`{emoji, count, who, mine}`), from a read or a react answer.
    static func parseReactions(_ raw: Any?) -> [ChatReaction] {
        (raw as? [Any] ?? []).compactMap { $0 as? [String: Any] }.compactMap { x in
            guard let e = x["emoji"] as? String, !e.isEmpty else { return nil }
            return ChatReaction(emoji: e, count: max(1, integer(x["count"]) ?? 1), mine: isTrue(x["mine"]))
        }
    }

    // The three the long-press offers (the native room's menu); a pill already on a message toggles any other.
    static let quickReactions = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F525}"]

    // MARK: Replying and reacting (kosmos#7083; the board's DM reply #4256 and reactions #3650)

    // POST /api/agent/<name>/thread/react {at, emoji}: toggles the person's reaction on one of the agent's messages.
    static func reactRequest(mac: URL, session: String, at: String, emoji: String) -> URLRequest? {
        guard isAgentSession(session), !at.isEmpty, !emoji.isEmpty else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/thread/react", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["at": at, "emoji": emoji])
        return r
    }

    enum ReactResult: Equatable { case reacted(at: String, pills: [ChatReaction]), refused(String) }

    // `{ok, at, reactions}`, or the Mac's reason (`because`, or `error` from the route), else the board's sentence.
    static func reactResult(status: Int, body: Data?) -> ReactResult {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if (200...299).contains(status), isTrue(obj?["ok"]), let at = obj?["at"] as? String {
            return .reacted(at: at, pills: parseReactions(obj?["reactions"]))
        }
        if status != 0, let why = (obj?["because"] as? String) ?? (obj?["error"] as? String), !why.isEmpty { return .refused(sentence(why)) }
        return .refused("We could not react to that just now.")
    }

    // A react answer's pills put on the one row they belong to (by its `at`), so the chat repaints that row at once.
    static func withReactions(_ rows: [ChatRow], at: String, pills: [ChatReaction]) -> [ChatRow] {
        rows.map { r in
            guard r.atRaw == at, r.who == .agent else { return r }
            var changed = r
            changed.reactions = pills
            return changed
        }
    }
    static func withReactions(_ thread: Thread, at: String, pills: [ChatReaction]) -> Thread {
        Thread(rows: withReactions(thread.rows, at: at, pills: pills), olderCount: thread.olderCount, choices: thread.choices)
    }

    // pjReplyWords: the first non-empty line, at most two marks on a letter, cut to 80 code points with an ellipsis.
    static func replyWords(_ text: String) -> String {
        // JavaScript's trim: whitespace, line ends (a \r of CRLF) and the byte-order mark.
        let trim = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{FEFF}"))
        let line = text.components(separatedBy: "\n").map { $0.trimmingCharacters(in: trim) }.first { !$0.isEmpty } ?? ""
        var scalars: [Unicode.Scalar] = []
        var marks = 0
        for u in line.unicodeScalars {
            let isMark = [.nonspacingMark, .spacingMark, .enclosingMark].contains(u.properties.generalCategory)
            marks = isMark ? marks + 1 : 0
            if isMark && marks > 2 { continue }
            scalars.append(u)
        }
        guard scalars.count > 80 else { return String(String.UnicodeScalarView(scalars)) }
        let cut = String(String.UnicodeScalarView(scalars.prefix(80)))
        return cut.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) + "\u{2026}"
    }

    // pjDropSelfName: an agent's own name at the start of its message ("Dana: ...", "**Dana**: ...", "Dana - ..."), which
    // the strip and the header already say beside the gist. Exact case, longest name first; kept when nothing follows.
    static func dropSelfName(_ words: String, names: [String]) -> String {
        let sorted = names.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.sorted { $0.count > $1.count }
        // [0-9], not \\d: ICU's \\d is any digit, JavaScript's only ASCII.
        let sep = "(?:[ \\t]*:(?![/0-9])|[ \\t]+[\u{2013}\u{2014}-](?=[ \\t]))"
        for name in sorted {
            let q = NSRegularExpression.escapedPattern(for: name)
            // The board's one pattern, in two (ICU does not match a backreference to a group that took no part).
            let patterns = ["^[ \\t]*" + q + sep + "[ \\t]*", "^[ \\t]*(\\*\\*|__)" + q + "(?:" + sep + "[ \\t]*\\1|\\1" + sep + ")[ \\t]*"]
            for pattern in patterns {
                guard let re = try? NSRegularExpression(pattern: pattern),
                      let m = re.firstMatch(in: words, range: NSRange(words.startIndex..., in: words)),
                      let r = Range(m.range, in: words) else { continue }
                let rest = String(words[r.upperBound...]).replacingOccurrences(of: "^(?:[ \\t]*\\r?\\n)+", with: "", options: .regularExpression)
                if !rest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return rest }
            }
        }
        return words
    }

    // pjReplyGist: what a reply strip and header say of a message: its first line (an agent's own leading name dropped),
    // else its first file's name, else "a message".
    static func replyGist(_ row: ChatRow, agentName: String = "", session: String = "") -> String {
        let raw = row.who == .agent ? dropSelfName(row.text, names: [agentName, session]) : row.text
        let words = replyWords(raw)
        if !words.isEmpty { return words }
        return row.attachments.first.map(\.name) ?? "a message"
    }

    // dmReplyAdjacency (#3745): a reply right under the message it answers, or right under another reply to the same
    // message whose header was left out, already reads that way, so its header is left out on screen (VoiceOver still
    // hears it). The ids of the rows whose header is left out.
    static func repliesUnderOriginal(_ rows: [ChatRow]) -> Set<String> {
        var hidden = Set<String>()
        var prevHid = false
        let ats = Set(rows.compactMap(\.atRaw))
        for (i, row) in rows.enumerated() {
            guard let target = row.replyTo, i > 0 else { prevHid = false; continue }
            let prev = rows[i - 1]
            let adjacent = prev.atRaw == target || (prev.replyTo == target && prevHid)
            if adjacent { hidden.insert(row.id) }
            // The board's DM_ROWS.has: always true here once adjacent (the original or a hidden reply to it is just above),
            // kept so the rule reads as the board's.
            prevHid = adjacent && ats.contains(target)
        }
        return hidden
    }

    // The Mac's two refusals that ask for the reply to go as a new message (server.js: its original gone, or a
    // conversation this computer does not keep); only these offer "Send as a new message".
    static func replyRefusedForGood(_ reason: String?) -> Bool {
        guard let reason else { return false }
        return reason.hasPrefix("That message is no longer in this conversation")
            || reason.hasPrefix("This conversation is not kept on this computer, so there is no message to reply to")
    }

    // The board's Press x (its reply strip), for a bubble that offers its own "Send as a new message" instead.
    static func withoutStripInstruction(_ reason: String) -> String {
        reason.replacingOccurrences(of: " Press \u{00D7} to send this as a new message.", with: "")
            .replacingOccurrences(of: "Press \u{00D7} to send this as a new message.", with: "")
    }

    // dmReplyAdjacency's `next`: pending replies, in order after the shown rows, whose header is left out (right under
    // their original, or under another left-out reply to it).
    static func pendingRepliesUnderOriginal(_ pending: [PendingSend], after rows: [ChatRow]) -> Set<String> {
        var hidden = Set<String>()
        let ats = Set(rows.compactMap(\.atRaw))
        var prevAt = rows.last?.atRaw
        var prevReplyTo = rows.last?.replyTo
        var prevHid = rows.last.map { repliesUnderOriginal(rows).contains($0.id) } ?? false
        for p in pending {
            guard let target = p.replyTo else { prevAt = nil; prevReplyTo = nil; prevHid = false; continue }
            let adjacent = prevAt == target || (prevReplyTo == target && prevHid)
            if adjacent { hidden.insert(p.id) }
            prevHid = adjacent && ats.contains(target)
            prevAt = nil
            prevReplyTo = target
        }
        return hidden
    }

    // dmReplyHead: what a message that answers another says about it. `olderLeft` is how many older messages are not
    // shown (the latest read's olderCount, or the earlier pages' remaining count once they are open).
    enum ReplyHead: Equatable { case answers(who: String, gist: String), furtherBack, unavailable }
    static func replyHead(to target: String?, in rows: [ChatRow], agentName: String, session: String = "", olderLeft: Int) -> ReplyHead? {
        guard let target else { return nil }
        if let orig = rows.first(where: { $0.atRaw == target }) {
            return .answers(who: orig.who == .person ? "You" : agentName, gist: replyGist(orig, agentName: agentName, session: session))
        }
        // "Further back" only when older messages are left out and the original is older than the oldest one here.
        let oldest = rows.compactMap(\.atRaw).min()
        if olderLeft > 0, let oldest, target < oldest { return .furtherBack }
        return .unavailable
    }

    // MARK: Files (kosmos#7016 part 2; the board's pjFiles, pjAttachmentCard, pjFileWord, pjSize)

    struct Attachment: Equatable {
        let id: String
        let name: String
        let type: String
        let size: Int?
        // image, pdf, text or other (anything else the Mac says is other).
        let kind: String
        // The Mac's own address for the file and for its first-page picture, only ever under /api/.
        let url: String
        let preview: String?
    }

    // `attachments` when it has any, else `attachment`; a file whose address is not under /api/ is dropped (the board
    // takes only its own routes, so a row can never point the phone at another host or path).
    static func parseAttachments(_ row: [String: Any]) -> [Attachment] {
        let many = (row["attachments"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
        let list = many.isEmpty ? [row["attachment"] as? [String: Any]].compactMap { $0 } : many
        return list.compactMap { a in
            // The file's own route and nothing else: /api/attachment/<24 hex>, its id taken from it (as the board's
            // PV_ATTS does), and its picture only at that id's /preview.
            guard let url = a["url"] as? String, let id = attachmentId(url) else { return nil }
            let name = (a["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let kind = a["kind"] as? String ?? "other"
            let preview = (a["preview"] as? String).flatMap { $0 == url + "/preview" ? $0 : nil }
            return Attachment(id: id, name: (name?.isEmpty == false ? name! : "a file"),
                              type: a["type"] as? String ?? "", size: integer(a["size"]),
                              kind: ["image", "pdf", "text"].contains(kind) ? kind : "other", url: url, preview: preview)
        }
    }

    // The id in a file's route, only when the route is exactly /api/attachment/<24 lowercase hex>.
    static func attachmentId(_ url: String) -> String? {
        let prefix = "/api/attachment/"
        guard url.hasPrefix(prefix) else { return nil }
        let id = String(url.dropFirst(prefix.count))
        return id.count == 24 && id.allSatisfy({ "0123456789abcdef".contains($0) }) ? id : nil
    }

    // One of the board's own routes: starts /api/, and no "..", no "//", no scheme (it is joined to the Mac's address).
    static func isBoardPath(_ s: String) -> Bool {
        s.hasPrefix("/api/") && !s.contains("..") && !s.contains("//") && !s.contains("\\") && URL(string: s)?.scheme == nil
    }

    // What a business person calls the file (pjFileWord).
    static func fileWord(type: String, name: String, kind: String) -> String {
        let t = type.lowercased()
        let ext = name.range(of: #"\.([A-Za-z0-9]+)$"#, options: .regularExpression).map { String(name[$0].dropFirst()).lowercased() } ?? ""
        if t == "application/pdf" || ext == "pdf" { return "PDF" }
        if t.range(of: "wordprocessingml|msword", options: .regularExpression) != nil || ["doc", "docx"].contains(ext) { return "Word document" }
        if t.range(of: "spreadsheetml|ms-excel", options: .regularExpression) != nil || ["xls", "xlsx"].contains(ext) { return "Excel spreadsheet" }
        if t.range(of: "presentationml|ms-powerpoint", options: .regularExpression) != nil || ["ppt", "pptx"].contains(ext) { return "PowerPoint" }
        if t.hasPrefix("image/") || kind == "image" { return "Image" }
        if ext == "csv" { return "CSV" }
        if ext == "md" || t == "text/markdown" { return "Text" }
        if t.hasPrefix("text/") || kind == "text" { return "Text" }
        if !ext.isEmpty { return ext.uppercased() + " file" }
        return "File"
    }

    // pjSize.
    static func sizeText(_ bytes: Int?) -> String {
        guard let n = bytes, n >= 0 else { return "" }
        if n < 1024 { return "\(n) B" }
        if n < 1024 * 1024 { return "\(Int((Double(n) / 1024).rounded())) KB" }
        return String(format: "%.1f MB", Double(n) / (1024 * 1024))
    }

    // "PDF · 2.4 MB".
    static func attachmentMeta(_ a: Attachment) -> String {
        [fileWord(type: a.type, name: a.name, kind: a.kind), sizeText(a.size)].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
    }

    // A post made with no words carries the file names as its text; the cards say them, so the text is not drawn too
    // (pjWords).
    static func wordsShown(_ text: String, files: [Attachment]) -> String { wordsShown(text, names: files.map(\.name)) }
    // kosmos#7071: the same for a message still on its way, by the names of the files it carries.
    static func wordsShown(_ text: String, names: [String]) -> String {
        !names.isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines) == names.joined(separator: ", ") ? "" : text
    }

    // A file Quick Look would draw as a web page or a markup document, which can load from elsewhere. Judged by its name
    // as well as its type: the Mac keeps whatever type the sender gave (engine/attachments.js), and Quick Look picks
    // its viewer by the extension. Such a file is opened on the board, never here.
    // Judged on the name the file is saved under (savedName), since that is what Quick Look sees: "page.html." is saved
    // as "page.html" (#7016 review 3).
    static func isWebDocument(name: String, type: String) -> Bool {
        let ext = (savedName(name, type: type) as NSString).pathExtension.lowercased()
        let named = ["html", "htm", "xhtml", "shtml", "svg", "svgz", "xml", "webarchive", "mht", "mhtml"].contains(ext)
        let types = [UTType(mimeType: type.lowercased()), ext.isEmpty ? nil : UTType(filenameExtension: ext)].compactMap { $0 }
        let markup = types.contains { $0.conforms(to: .html) || $0.conforms(to: .xml) || $0.conforms(to: .svg) || $0.conforms(to: .webArchive) }
        return named || markup
    }

    // The picture on the card: only an image or a PDF with a preview from the Mac (pjAttachmentCard). An image's preview
    // is the whole image (the Mac's previewFile), so a large one draws the symbol instead of costing megabytes on
    // cellular for a 64 pt square; a PDF's is a drawn first page.
    static let thumbnailMaxImageBytes = 3 * 1024 * 1024
    static func hasThumbnail(_ a: Attachment) -> Bool {
        guard a.preview != nil else { return false }
        if a.kind == "pdf" { return true }
        return a.kind == "image" && (a.size ?? Int.max) <= thumbnailMaxImageBytes
    }

    // The symbol when there is no picture (Mona Lisa's spec, section 3).
    static func fileSymbol(_ a: Attachment) -> String {
        switch a.kind {
        case "pdf": return "doc.richtext"
        case "text": return "doc.text"
        case "image": return "photo"
        default: return "doc"
        }
    }

    // MARK: Sending files (kosmos#7071; the board's attachUpload, ATTACH_AGENT, ATTACH_MAX, ATTACH_MAX_BYTES)

    // A file added to the composer: the Mac has it, and the message that carries it names it by this id.
    struct Attached: Equatable, Identifiable {
        let id: String
        let name: String
    }

    static let maxFiles = 10
    static let maxFileBytes = 100 * 1024 * 1024
    // #6734: a file this large may outlast the Mac's or a relay's wait on a slow connection.
    static let slowFileBytes = 25 * 1024 * 1024
    static let uploadTimeout: TimeInterval = 300

    static func isAttachmentId(_ id: String) -> Bool { attachmentId("/api/attachment/" + id) == id }

    // encodeURIComponent, as the board names the file in its header (the Mac decodes it with decodeURIComponent).
    static func headerName(_ name: String) -> String {
        var allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        allowed.insert(charactersIn: "-_.!~*'()")
        return name.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }

    // The bytes of one file for an agent's conversation: PUT /api/agent/<name>/attachment with its type and name.
    static func uploadRequest(mac: URL, session: String, name: String, type: String) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/attachment", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "PUT"
        return uploadHeaders(r, name: name, type: type)
    }
    // kosmos#7093: the headers and wait, shared with a project's room (BoardRoom's roomUploadRequest). Each request names
    // its own route in place, so the route check (server.ios-routes-6838) reads it.
    static func uploadHeaders(_ request: URLRequest, name: String, type: String) -> URLRequest {
        var r = request
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue(type.isEmpty ? "application/octet-stream" : type, forHTTPHeaderField: "Content-Type")
        r.setValue(headerName(name), forHTTPHeaderField: "X-Attachment-Name")
        // The Mac reads an office file or a PDF before it answers (engine/attachtext.js, up to 30 s), and a large file
        // takes a while to go: this request is given the Mac's own five minutes (#6734), not the 15 s other calls get.
        r.timeoutInterval = uploadTimeout
        return r
    }

    // Said before a byte is sent, as the board does: too large, or already as many as a message carries (counting
    // files still on their way).
    static func uploadRefusal(size: Int?, waiting: Int) -> String? {
        if let size, size > maxFileBytes { return "That file is over \(maxFileBytes / 1048576) MB, which is the most a message can carry." }
        if waiting >= maxFiles { return "A message can carry \(maxFiles) files; send these first." }
        return nil
    }

    enum UploadResult: Equatable { case added(Attached), refused(String) }

    // The Mac's answer to an upload (status 0: no answer came), in the board's own sentences.
    static func uploadResult(status: Int, body: Data?, name: String, size: Int?) -> UploadResult {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let slow = (size ?? 0) > slowFileBytes
        let notReached = slow
            ? "We could not reach Kosmos to add \(name). If your connection is slow, a file this large can take longer than Kosmos waits for one."
            : "We could not reach Kosmos to add that file."
        if status == 0 { return .refused(notReached) }
        if (200...299).contains(status), let a = obj?["attachment"] as? [String: Any], let id = a["id"] as? String, isAttachmentId(id) {
            let said = (a["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return .added(Attached(id: id, name: said.isEmpty ? name : said))
        }
        if status == 408 { return .refused("We could not finish adding \(name): it took too long to arrive. Try again on a faster connection.") }
        if let error = obj?["error"] as? String, !error.isEmpty { return .refused(error) }
        if (status == 502 || status == 504) && slow { return .refused(notReached) }
        return .refused("We could not add that file (status \(status)).")
    }

    // A pick made ready to send: the client's own copy (in a folder of its own under `root`), its name, type and size;
    // or the sentence for why it cannot go.
    enum Prepared: Equatable {
        case ready(file: URL, name: String, type: String, size: Int)
        case refused(String)
    }

    // A file from Files: its size and kind checked first, so nothing too large and no folder is ever copied, then
    // copied, so the person's own file is never the one removed. Reads it under its security scope (a picked file
    // outside the app's own folders needs it). Off the main thread: a copy can be 100 MB.
    static func prepareUpload(from url: URL, root: URL) -> Prepared {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        let facts = try? url.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey, .isPackageKey])
        if facts?.isDirectory == true || facts?.isPackage == true {
            return .refused("\(name) is a folder, so it cannot go in a message. Add the files inside it, or a zip of it.")
        }
        if let refusal = uploadRefusal(size: facts?.fileSize, waiting: 0) { return .refused(refusal) }
        guard let folder = uploadFolder(root) else { return .refused("We could not read \(name).") }
        let file = folder.appendingPathComponent(savedName(name))
        // Read through a file coordinator, so a file Files still holds only in the cloud (iCloud Drive, another
        // provider) is fetched first rather than copied as a placeholder.
        var copied = false
        var coordinated: NSError?
        var tooLarge: String?
        NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinated) { readable in
            // Measured again here, where the file is really on the phone (the size Files gave first may have been a
            // cloud placeholder's, or none), so nothing too large is ever copied.
            if let refusal = uploadRefusal(size: (try? readable.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, waiting: 0) {
                tooLarge = refusal
                return
            }
            copied = (try? FileManager.default.copyItem(at: readable, to: file)) != nil
        }
        if let tooLarge { try? FileManager.default.removeItem(at: folder); return .refused(tooLarge) }
        guard copied, coordinated == nil,
              let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize else {
            try? FileManager.default.removeItem(at: folder)
            return .refused("We could not read \(name).")
        }
        return .ready(file: file, name: name, type: mimeType(forName: name), size: size)
    }

    // A photo's bytes, written to a file of their own.
    static func prepareUpload(data: Data, name: String, root: URL) -> Prepared {
        if let refusal = uploadRefusal(size: data.count, waiting: 0) { return .refused(refusal) }
        guard let folder = uploadFolder(root) else { return .refused("We could not read that photo.") }
        let file = folder.appendingPathComponent(savedName(name))
        guard (try? data.write(to: file)) != nil else {
            try? FileManager.default.removeItem(at: folder)
            return .refused("We could not read that photo.")
        }
        return .ready(file: file, name: name, type: mimeType(forName: name), size: data.count)
    }

    private static func uploadFolder(_ root: URL) -> URL? {
        let folder = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        return (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil ? folder : nil
    }

    // The type the Mac is told, from the name (it keeps whatever it is given, and judges a file by it).
    static func mimeType(forName name: String) -> String {
        let ext = (name as NSString).pathExtension
        return (ext.isEmpty ? nil : UTType(filenameExtension: ext)?.preferredMIMEType) ?? "application/octet-stream"
    }

    // A photo has no name of its own: "Photo 2026-10-24 at 18.30.05.jpg", in the phone's own time, and " (2)" on the
    // second of one pick.
    static func photoName(at date: Date, ext: String, number: Int = 1, zone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        return "Photo \(f.string(from: date))\(number > 1 ? " (\(number))" : "").\(ext)"
    }

    // The image type the bytes themselves say, so the name never claims JPEG for a PNG the picker kept as it was.
    static func imageExtension(_ data: Data) -> String? {
        let b = [UInt8](data.prefix(12))
        if b.count >= 3, b[0] == 0xFF, b[1] == 0xD8, b[2] == 0xFF { return "jpg" }
        if b.count >= 8, b[0..<8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] { return "png" }
        if b.count >= 6, String(bytes: b[0..<6], encoding: .ascii).map({ $0 == "GIF87a" || $0 == "GIF89a" }) == true { return "gif" }
        if b.count >= 12, String(bytes: b[0..<4], encoding: .ascii) == "RIFF", String(bytes: b[8..<12], encoding: .ascii) == "WEBP" { return "webp" }
        if b.count >= 12, String(bytes: b[4..<8], encoding: .ascii) == "ftyp" {
            let brand = String(bytes: b[8..<12], encoding: .ascii) ?? ""
            if ["heic", "heix", "heim", "heis", "mif1", "msf1"].contains(brand) { return "heic" }
        }
        return nil
    }

    // What VoiceOver says for a row of files (kosmos#7071), as a text bubble says "You, 6:30 PM: ...": who, when, the
    // words if any, how many files, and the Mac's word for one not sent.
    static func filesRowSpoken(who: String, at: Date?, text: String, count: Int, notSent: String?) -> String {
        var said = who + (at.map { ", " + $0.formatted(date: .omitted, time: .shortened) } ?? "") + ": "
        said += text.isEmpty ? "" : text + ", "
        said += count == 1 ? "1 file" : "\(count) files"
        if let notSent { said += ", " + notSent.lowercased() }
        return said
    }

    static let stillAddingLine = "A file is still being added. Send again when it is done."

    // "1 file: a.pdf" / "2 files: a.pdf, b.png", for VoiceOver on a message still on its way.
    static func filesSpoken(_ names: [String]) -> String {
        (names.count == 1 ? "1 file: " : "\(names.count) files: ") + names.joined(separator: ", ")
    }

    // The words a message goes with: what was typed, or with nothing typed, the names of its files (the board's
    // attachment-only send, which wordsShown then leaves undrawn).
    static func sendWords(_ text: String, files: [Attached]) -> String {
        let said = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return said.isEmpty ? files.map(\.name).joined(separator: ", ") : said
    }

    // A GET for one of the Mac's file routes, through the client's own session.
    static func attachmentRequest(mac: URL, path: String) -> URLRequest? {
        guard isBoardPath(path), let url = URL(string: path, relativeTo: mac)?.absoluteURL, url.host == mac.host else { return nil }
        var r = URLRequest(url: url)
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // The name the file is saved under for Quick Look: its own name, never a path, never hidden, never empty, and with
    // an extension Quick Look can pick a viewer by (from its type, when the name has none).
    static func savedName(_ name: String, type: String = "") -> String {
        // No control or format characters (a NUL ends a path where it stands, so "page.html\u{0}" would be written as
        // page.html), as the Mac's own safeName strips them.
        let visible = String(String.UnicodeScalarView(name.unicodeScalars.filter {
            // Joiners (U+200C, U+200D) are kept: emoji and some scripts are spelled with them.
            $0.properties.generalCategory != .control && ($0.properties.generalCategory != .format || $0.value == 0x200C || $0.value == 0x200D)
        }))
        let cleaned = visible.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespacesAndNewlines))
        // Cut, then trimmed again, so the cut can never leave a trailing dot or space (review 5).
        // A file name on iOS is at most 255 bytes of UTF-8, so the cut is by bytes (200, leaving room for an added
        // extension), at a whole character: a 100-character Japanese name is about 300 bytes (review 6).
        // The extension is kept whole (Quick Look picks its viewer by it); the rest is cut to fit.
        let ext = (cleaned as NSString).pathExtension
        let keepExt = !ext.isEmpty && ext.utf8.count <= 16
        let stem = keepExt ? (cleaned as NSString).deletingPathExtension : cleaned
        let room = 200 - (keepExt ? ext.utf8.count + 1 : 0)
        var kept = ""
        for ch in stem {
            if kept.utf8.count + String(ch).utf8.count > room { break }
            kept.append(ch)
        }
        let cut = keepExt ? (kept.isEmpty ? "file" : kept) + "." + ext : kept
            .trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespacesAndNewlines))
        var base = cut.isEmpty ? "file" : cut
        // No extension, or one no app knows ("Q3.final", "v1.2 report"): Apple's lookup makes up a dynamic type for those.
        let known = UTType(filenameExtension: (base as NSString).pathExtension).map { !$0.isDynamic } ?? false
        if (base as NSString).pathExtension.isEmpty || !known,
           let ext = UTType(mimeType: type.lowercased())?.preferredFilenameExtension { base += "." + ext }
        return base
    }

    struct Thread: Equatable {
        let rows: [ChatRow]
        // Older messages kept on the Mac that this read did not bring (the chat says so and links to the board).
        let olderCount: Int
        // The question's buttons, when the Mac says they can be pressed now (#7016).
        var choices: Choices? = nil
    }

    // MARK: Answering a question (kosmos#7016; the board's dmChoicesFrom, dmChoicesHtml and dmChoicePress)

    struct ChoiceOption: Equatable { let n: Int; let label: String; let lasting: Bool }

    struct Choices: Equatable {
        let options: [ChoiceOption]
        // The question's identity, sent back with a press; the Mac answers only the question it names.
        let asked: String
        // The question, its header lines and its options as one value: a question repeated word for word with other
        // choices, or another header, is a new question (dmChoiceSig, dmChoiceHead), so an armed or answered state for
        // the old one never carries over.
        let key: String
        // kosmos#7020: a permission card's request (chat.permissionRequestId, on the live question row), sent with a
        // press so the Mac types it only at that same request. Part of `key`: two prompts can share `asked`.
        var request: String? = nil
    }

    struct Permission: Equatable {
        let kind: String
        let says: String?
        let target: String?
        let detail: String?
        let reason: String?
        let allow: Int
        let deny: Int
    }

    // dmChoicesFrom: buttons only where the agent asks now (`asking`), the Mac named the question (`asked`), and its
    // composer is not closed (presence off: it cannot be typed into).
    static func parseChoices(_ obj: [String: Any]) -> Choices? {
        let opts: [ChoiceOption] = (obj["options"] as? [[String: Any]] ?? []).compactMap { o in
            guard let n = integer(o["n"]), let label = o["label"] as? String else { return nil }
            return ChoiceOption(n: n, label: label, lasting: isTrue(o["lasting"]))
        }
        guard !opts.isEmpty, isTrue(obj["asking"]), let asked = obj["asked"] as? String, !asked.isEmpty,
              obj["presence"] as? String != "off" else { return nil }
        let question = (obj["question"] as? [String: Any])?["text"] as? String ?? ""
        let sig = opts.map { "\($0.n)\u{1}\($0.label)" }.joined(separator: "\u{2}")
        let request = permissionRequest(obj["messages"])
        return Choices(options: opts, asked: asked,
                       key: asked + "\u{3}" + choiceHead(question, asked: asked) + "\u{3}" + sig + "\u{3}" + (request ?? ""),
                       request: request)
    }

    // The board's dmChoicesFrom: the last unreported question row's permission.request, only a value the Mac makes
    // (64 lowercase hex).
    static func permissionRequest(_ messages: Any?) -> String? {
        let rows = messages as? [[String: Any]] ?? []
        guard let row = rows.last(where: { $0["kind"] as? String == "question" && !isTrue($0["reported"]) && $0["permission"] is [String: Any] }),
              let request = (row["permission"] as? [String: Any])?["request"] as? String,
              request.utf8.count == 64, request.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
        else { return nil }
        return request
    }

    // dmChoiceHead: the question's lines up to the line that holds `asked` (the option lines below it carry a highlight
    // that moves without the question changing).
    static func choiceHead(_ question: String, asked: String) -> String {
        let lines = question.components(separatedBy: "\n")
        let at = lines.firstIndex { $0.trimmingCharacters(in: .whitespaces) == asked } ?? lines.lastIndex { $0.contains(asked) }
        guard let at else { return "" }
        return lines[...at].map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
    }

    // JSONSerialization answers `as? Int` for true and `as? Bool` for 1; the board takes only a whole number
    // (Number.isInteger) and only `=== true`, so these do too.
    static func integer(_ any: Any?) -> Int? {
        guard let num = any as? NSNumber, CFGetTypeID(num) != CFBooleanGetTypeID() else { return nil }
        let d = num.doubleValue
        return d == d.rounded() && abs(d) < 1e9 ? Int(d) : nil
    }
    static func isTrue(_ any: Any?) -> Bool {
        guard let num = any as? NSNumber, CFGetTypeID(num) == CFBooleanGetTypeID() else { return false }
        return num.boolValue
    }

    // kosmos#7137: the board's fedGateMode (web/index.html): whether the shared-room UI shows ("show"), is gated behind
    // Kosmos+ ("signup"), or is off ("hidden"), from the status poll's sourceChannel, federationLive and kosmos_plus.
    // Only a real JSON true counts as true, and only a real JSON false as false (an absent or odd kosmos_plus is
    // "unknown"), as the board's === checks.
    static func fedGateMode(sourceChannel: Any?, federationLive: Any?, kosmosPlus: Any?) -> String {
        let staging = (sourceChannel as? String) == "staging"
        if !(isTrue(federationLive) || staging) { return "hidden" }
        if isTrue(kosmosPlus) { return "show" }
        let plusFalse = (kosmosPlus as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() && !$0.boolValue } ?? false
        if staging && !plusFalse { return "show" }
        return "signup"
    }
    // The board's fedShow(), read off one /api/status answer.
    static func fedShown(fromStatus data: Data) -> Bool {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return fedGateMode(sourceChannel: obj["sourceChannel"], federationLive: obj["federationLive"], kosmosPlus: obj["kosmos_plus"]) == "show"
    }

    static func parsePermission(_ any: Any?) -> Permission? {
        guard let p = any as? [String: Any], let allow = integer(p["allow"]), let deny = integer(p["deny"]) else { return nil }
        func text(_ k: String) -> String? { (p[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
        return Permission(kind: p["kind"] as? String ?? "other", says: text("says"), target: text("target"), detail: text("detail"),
                          reason: text("reason"), allow: allow, deny: deny)
    }

    // A question row takes the buttons only when it is not the agent's own reported words (dmChoicesHtml).
    static func choices(for row: ChatRow, in thread: Thread) -> Choices? {
        row.wayThrough == .question || row.wayThrough == .permission ? (row.reported ? nil : thread.choices) : nil
    }

    // DM_PERM_DOES.
    static func permissionDoes(_ kind: String) -> String {
        switch kind {
        case "delete": return "run a command that deletes files"
        case "command": return "run a command"
        case "create": return "create a file"
        case "edit": return "change a file"
        case "fetch": return "fetch something from the web"
        default: return "do something that needs your permission"
        }
    }

    // "Wants to <what>: <target>." (dmPermissionHtml); the what-words are drawn in the danger colour for a delete.
    static func permissionAsk(_ p: Permission) -> String {
        "Wants to " + permissionDoes(p.kind) + (p.target.map { ": " + $0 } ?? "") + "."
    }

    // The card's buttons: Allow then Deny (the prompt's own options by number), and every other option for Show
    // details. No card at all unless both Allow and Deny are among the options (dmChoicesHtml review 5).
    static func cardButtons(_ c: Choices, _ p: Permission) -> (allow: ChoiceOption, deny: ChoiceOption, more: [ChoiceOption])? {
        guard p.allow != p.deny, let allow = c.options.first(where: { $0.n == p.allow }),
              let deny = c.options.first(where: { $0.n == p.deny }) else { return nil }
        return (allow, deny, c.options.filter { $0.n != p.allow && $0.n != p.deny }.sorted { $0.n < $1.n })
    }

    // pjSentence: the Mac's words as a sentence.
    static func sentence(_ s: String?) -> String {
        let said = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = said.first else { return "" }
        let tail = said.dropFirst()
        return first.uppercased() + tail + (".!?".contains(said.last!) ? "" : ".")
    }

    static let choiceUnsure = "We could not confirm that it went (pressing again may answer twice)."
    static let choiceArmNote = "This one changes what the agent may do from now on. Press it again to choose it."
    static let choiceWaitLine = "Still sending your choice. Try again in a moment."

    // The option's digit is the key typed; its words are checked against the screen; `lasting` confirms a lasting choice;
    // `request` (#7020) names the permission request the card was drawn for.
    static func pressRequest(mac: URL, session: String, option: ChoiceOption, asked: String, request: String? = nil) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/thread", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["text": String(option.n), "chose": option.label, "asked": asked]
        if let request { body["request"] = request }
        if option.lasting { body["lasting"] = true }
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return r
    }

    enum PressResult: Equatable {
        case sent
        // It may have gone: the buttons stay off for the answered lock, and the line says pressing again may answer twice.
        case notSure(String)
        // Nothing was typed: the buttons come back, with the Mac's reason.
        case refused(String)
        var mayHaveSent: Bool { if case .refused = self { return false }; return true }
    }

    // dmChoicePress's reading: only `placed` is sent; `could_not` typed nothing; a 5xx, no answer, or a 200 with any
    // other verdict may have sent the key.
    static func pressResult(status: Int, body: Data?) -> PressResult {
        if status == 0 || status >= 500 { return .notSure(choiceUnsure) }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        guard (200...299).contains(status) else { return .refused(sentence((obj?["error"] as? String) ?? "that did not go; try again")) }
        let d = obj?["delivery"] as? [String: Any]
        let state = d?["state"] as? String
        let because = (d?["because"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        if state == "placed" { return .sent }
        if state == "could_not" { return .refused(sentence(because ?? "that did not go; try again")) }
        return .notSure(choiceUnsure + (because.map { " " + sentence($0) } ?? ""))
    }

    // What a question's buttons show now (dmChoicesHtml): off while a press or a typed send is in the air or the
    // question was just answered, and the line under them. On a card, Sending…, Allowed. / Denied. and the not-sure
    // line go under Allow and Deny (.main), and the arm note goes with whichever part holds the armed choice.
    struct ChoicesState: Equatable {
        var off = false
        var armedN: Int?
        var note: String?
        // The line is the danger colour: it may have gone.
        var danger = false
        // A sure press on a card: "Allowed." or "Denied." stands in place of Allow and Deny (the spec).
        var settled = false
    }
    enum ChoicesPart: Equatable { case plain, main(allow: Int, deny: Int), more }
    static func choicesState(_ part: ChoicesPart, pressing: Bool, typing: Bool, answered: (sure: Bool, n: Int)?,
                             armedN: Int?, unsure: Bool) -> ChoicesState {
        var s = ChoicesState(off: pressing || typing || answered != nil, armedN: armedN)
        if pressing {
            if part != .more { s.note = "Sending\u{2026}" }
            return s
        }
        if let a = answered, a.sure {
            guard case .main(let allow, let deny) = part else {
                if part == .plain { s.note = "Sent." }
                return s
            }
            s.note = a.n == allow ? "Allowed." : a.n == deny ? "Denied." : "Sent."
            s.settled = a.n == allow || a.n == deny
            return s
        }
        // armedN is only ever one of this part's own options, so the note sits with the armed button (the board's armedHere).
        if armedN != nil, answered == nil {
            s.note = choiceArmNote
            return s
        }
        if unsure, part != .more { s.note = choiceUnsure; s.danger = true }
        return s
    }

    // #6172 arm and confirm: a lasting choice's first press arms it; a second press on the same option of the same
    // question within 15 s sends it; one sooner than 0.6 s is the same gesture (a double-tap) and does nothing.
    struct Armed: Equatable { let key: String; let n: Int; let at: Date }
    static let armWindow: TimeInterval = 15
    static let armFloor: TimeInterval = 0.6
    enum ArmStep: Equatable { case send, arm(Armed), ignore }
    static func armStep(_ armed: Armed?, option: ChoiceOption, key: String, now: Date) -> ArmStep {
        guard option.lasting else { return .send }
        if let a = armed, a.key == key, a.n == option.n, now.timeIntervalSince(a.at) < armWindow {
            return now.timeIntervalSince(a.at) < armFloor ? .ignore : .send
        }
        return .arm(Armed(key: key, n: option.n, at: now))
    }
    static func isArmed(_ armed: Armed?, n: Int, key: String, now: Date) -> Bool {
        guard let a = armed else { return false }
        return a.key == key && a.n == n && now.timeIntervalSince(a.at) < armWindow
    }

    static func isoDate(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    // `{messages:[{at,text,from,kind,delivery,attachment(s),permission}], olderCount}`. A row with no `from` is the
    // person's (engine/chat.js: absent means the operator), `kind: 'kosmos'` is Kosmos's own line, `kind: 'question'`
    // the agent asking; anything else with a `from` is the agent's.
    static func parseThread(_ data: Data) -> Thread? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["messages"] as? [[String: Any]]
        else { return nil }
        let parsed = parseRows(rows, idPrefix: "")
        let older = (obj["olderCount"] as? NSNumber)?.intValue ?? 0
        return Thread(rows: parsed, olderCount: max(0, older), choices: parseChoices(obj))
    }

    // The rows of a read. `idPrefix` keeps an earlier page's ids apart from the latest read's and from each other.
    static func parseRows(_ rows: [[String: Any]], idPrefix: String) -> [ChatRow] {
        var seen: [String: Int] = [:]
        return rows.compactMap { row in
            guard let text = row["text"] as? String else { return nil }
            let at = row["at"] as? String
            let kind = row["kind"] as? String
            let from = (row["from"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let who: ChatRow.Who = kind == "kosmos" ? .kosmos : (kind == "question" || from != nil) ? .agent : .person
            // The Mac's own id where it gives one; otherwise a stable one from the row (two rows can share a time).
            let base = (row["id"] as? String).flatMap { $0.isEmpty ? nil : "id|" + $0 } ?? ((at ?? "") + "|" + (from ?? "") + "|" + (kind ?? ""))
            let n = seen[base, default: 0]
            seen[base] = n + 1
            var notSent: String? = nil
            var because: String? = nil
            var resendable = false
            var retryable = false
            var retrying = false
            if who == .person, let d = row["delivery"] as? [String: Any], let state = d["state"] as? String, state != "placed" {
                let failed = state == "could_not" && d["duplicateOf"] == nil
                notSent = state == "held" ? "Waiting to send" : state == "unconfirmed" ? "Not confirmed" : failed ? Board.failedWords : "Not sent"
                because = (d["because"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let wire = (row["wire"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                resendable = failed && wire == nil
                retryable = (d["retryable"] as? Bool) == true
                retrying = (d["retrying"] as? Bool) == true
            }
            // A permission is read only on a question row (the board's m.kind === 'question' && m.permission).
            let permission = kind == "question" ? parsePermission(row["permission"]) : nil
            // Marked a permission prompt whenever the Mac says it is one; the card itself needs Allow and Deny it can read.
            let isPermission = kind == "question" && row["permission"] is [String: Any]
            let way: ChatRow.WayThrough? = (row["draft"] as? Bool) == true ? .draft : isPermission ? .permission
                : kind == "question" ? .question
                : (row["attachment"] != nil || (row["attachments"] as? [Any])?.isEmpty == false) ? .attachment : nil
            return ChatRow(id: idPrefix + base + "#\(n)", atRaw: at, at: isoDate(at), text: text, who: who, notSent: notSent, wayThrough: way,
                           because: because, resendable: resendable, retryable: retryable, retrying: retrying,
                           permission: permission, reported: isTrue(row["reported"]), attachments: parseAttachments(row),
                           replyTo: (row["replyTo"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                           reactions: parseReactions(row["reactions"]), from: from)
        }
    }

    // MARK: Earlier messages (kosmos#7016 part 3; the board's EARLIER, earlierFetch, earlierMore, earlierFillGap)

    // A page of up to 200 messages ending just before `before`, which counts from the OLDEST message, so a send
    // cannot shift a page.
    static func olderRequest(mac: URL, session: String, before: Int) -> URLRequest? {
        guard isAgentSession(session), before > 0, before < 1_000_000_000 else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/thread/older?before=\(before)", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    enum OlderRead: Equatable {
        // The rows asked for, oldest first, each one's position counted from the oldest message, and the count still
        // before them. Positions come from the Mac's rows, so a row the phone cannot draw (no text) shifts nothing.
        case page(rows: [ChatRow], positions: [Int], olderCount: Int)
        // The answer was not the range asked for: the conversation changed under the page.
        case moved
        // The Mac's own words, or the board's sentence when it gave none.
        case failed(String)
    }

    static let olderFailed = "We could not read the earlier messages."

    // earlierFetch: the answer must be exactly the range asked for (a page ending at `before`); a thread that shrank
    // in between answers a clamped range, which prepended here would be wrong or doubled rows.
    static func readOlder(status: Int, data: Data?, before: Int) -> OlderRead {
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        guard (200...299).contains(status), let rows = obj?["messages"] as? [[String: Any]] else {
            let said = (obj?["error"] as? String).flatMap { $0.isEmpty ? nil : sentence($0) }
            return .failed(status == 0 ? olderFailed : said ?? olderFailed)
        }
        let olderCount = integer(obj?["olderCount"]) ?? 0
        guard olderCount >= 0, olderCount + rows.count == before else { return .moved }
        // An empty page would make no progress and be asked again on every read (review 4).
        guard !rows.isEmpty else { return .failed(olderFailed) }
        // Ids by position from the oldest message: stable across pages and reads, never shared with the latest read.
        let parsed = parseRows(rows, idPrefix: "older|\(olderCount)|")
        // The position of each row kept, by the same rule parseRows keeps it (it has text).
        let positions = rows.indices.filter { rows[$0]["text"] is String }.map { olderCount + $0 }
        return .page(rows: parsed, positions: positions, olderCount: olderCount)
    }

    // The earlier messages shown in one open chat, and where they reach.
    struct Earlier: Equatable {
        var open = false
        // The position of the oldest row loaded (0: the first message is loaded).
        var before = 0
        // The position just after the newest earlier row.
        var end = 0
        var rows: [ChatRow] = []
        var loading = false
        var filling = false
        // A failed load: the line says so until Try again, and nothing loads by itself meanwhile.
        var because: String?
        // "The thread changed under the page" answers in a row.
        var moved = 0
        // The failure is that the thread kept moving, so Try again starts from the latest read (the board's handler).
        var movedOut = false
        // Bumped by every reset (the board's EARLIER.opening): an answer that comes back for an older one is dropped.
        var opening = 0
    }

    // earlierNearTop: whether reaching the top should load the page before it.
    static func shouldLoadEarlier(_ e: Earlier, olderCount: Int) -> Bool {
        if e.loading { return false }
        if e.open { return e.before > 0 && e.because == nil }
        return olderCount > 0
    }

    // The chat's gate: only once the first scroll to the newest message has settled (or the chat is too short to
    // scroll), only with the top on screen, and only when shouldLoadEarlier allows.
    static func shouldAsk(settled: Bool, topVisible: Bool, earlier: Earlier, olderCount: Int) -> Bool {
        settled && topVisible && shouldLoadEarlier(earlier, olderCount: olderCount)
    }

    // The state as a load starts (opening it at the read's olderCount the first time).
    static func startLoad(_ e: Earlier, olderCount: Int) -> Earlier {
        var next = e.open ? e : Earlier(open: true, before: olderCount, end: olderCount, moved: e.moved, opening: e.opening + 1)
        next.loading = true
        next.because = nil
        return next
    }

    // earlierMore's outcome: rows prepended; the thread moved (start again once, then a failure); or failed.
    // An answer for an older opening than the state's is dropped: nil.
    static func finishLoad(_ e: Earlier, with read: OlderRead, opening: Int) -> Earlier? {
        guard opening == e.opening, e.loading else { return nil }
        var next = e
        next.loading = false
        switch read {
        case .page(let rows, _, let olderCount):
            next.rows = rows + e.rows
            next.before = olderCount
            next.moved = 0
        case .moved:
            next.moved = e.moved + 1
            if next.moved < 2 { return Earlier(moved: next.moved, opening: e.opening + 1) }
            next.because = olderFailed
            next.movedOut = true
        case .failed(let why):
            next.because = why
        }
        return next
    }

    // Try again: the failure is cleared and the moved count starts over. After a thread that kept moving, it starts
    // again from the latest read (closed, so the next load opens at its olderCount), as the board's Try again does.
    static func retryEarlier(_ e: Earlier) -> Earlier {
        if e.movedOut { return Earlier(opening: e.opening + 1) }
        var next = e
        next.because = nil
        next.moved = 0
        return next
    }

    // A moved answer during a gap fill: start again, as earlierFillGap does.
    static func resetEarlier(_ e: Earlier) -> Earlier { Earlier(moved: e.moved, opening: e.opening + 1) }

    // earlierFillGap: messages that left the latest 200 while the chat was open sit at [end, olderCount).
    static func hasGap(end: Int, olderCount: Int) -> Bool { olderCount > end }

    // The rows a gap page brings: only those at or after `end` (the page may reach further back than the gap), by
    // their positions, so a row the phone dropped shifts nothing.
    static func gapRows(_ rows: [ChatRow], positions: [Int], end: Int) -> [ChatRow] {
        zip(rows, positions).filter { $0.1 >= end }.map(\.0)
    }

    // The item kept in place when a page lands above: the first message row on screen. Never a day line: its id is
    // built from the first row of its day, so a page ending on that same day takes the line (and its id) away, and
    // nothing would be kept (review 6).
    static func anchorItem(_ items: [ChatItem], onScreen: Set<String>) -> String? {
        items.first { item in
            if case .row = item.kind { return onScreen.contains(item.id) }
            return false
        }?.id
    }

    // What the chat draws: the earlier rows, then the latest read's.
    static func shownRows(_ e: Earlier, thread: Thread) -> [ChatRow] { e.open ? e.rows + thread.rows : thread.rows }

    // kosmos#7265 (Josh 10-27): a read that slid the latest window (a new message pushes the oldest out) took those rows
    // off the top of an open chat, and a scroll view keeps its offset, so the conversation the person was reading jumped.
    // The rows that left are kept in the loaded earlier rows from the previous read itself: only when the two reads
    // overlap by id (the fresh window's first row is the previous one's row at the same position), and not while a page
    // or a gap fill is in flight (they write the same rows). Otherwise unchanged, and fillGap fetches them as before.
    static func carryDropped(_ e: Earlier, previous: Thread?, fresh: Thread) -> Earlier {
        guard let previous, !e.loading, !e.filling else { return e }
        let shift = fresh.olderCount - previous.olderCount
        guard shift > 0, shift < previous.rows.count, let first = fresh.rows.first, previous.rows[shift].id == first.id else { return e }
        let dropped = Array(previous.rows[..<shift])   // positions previous.olderCount ..< fresh.olderCount
        var next = e
        if !e.open {
            next.open = true
            next.rows = dropped
            next.before = previous.olderCount
            next.end = fresh.olderCount
            return next
        }
        // Open: only what lies at or after the loaded rows' end, and only when they reach the previous window.
        guard e.end >= previous.olderCount, e.end < fresh.olderCount else { return e }
        let known = Set(e.rows.map(\.id))
        next.rows = e.rows + dropped[(e.end - previous.olderCount)...].filter { !known.contains($0.id) }
        next.end = fresh.olderCount
        return next
    }

    // kosmos#7348 (Josh 10-27): the box filled back with exactly the text just sent, within a few seconds of the send (the
    // keyboard's dictation or Writing Tools finishing after the box was cleared): one more tap would post it twice.
    static let sentRefillWindow: TimeInterval = 5
    // Only a jump from an empty box straight to the whole text (review: typing "okay" after sending "ok" passes through
    // "ok" one letter at a time and must not be wiped).
    static func refilledWithSent(_ box: String, was: String, sent: String?, sentAt: Date?, now: Date) -> Bool {
        guard was.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        guard let sent, let sentAt, now.timeIntervalSince(sentAt) <= sentRefillWindow else { return false }
        let b = box.trimmingCharacters(in: .whitespacesAndNewlines)
        return !b.isEmpty && b == sent.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // kosmos#7265: where the eager newest rows begin, kept by the row's id from the chat's opening, so a new message
    // never moves a row from the eager stack back to the lazy rows above the reader (its height would be estimated
    // again and the conversation jump). `from` nil, or a row no longer shown: the last `eager` rows, as at opening.
    static func eagerStart(_ items: [ChatItem], from: String?, eager: Int) -> Int {
        if let from, let at = items.firstIndex(where: { $0.id == from }) { return at }
        return max(0, items.count - eager)
    }

    // A read of the conversation: the conversation, the Mac's own reason it could not give one (a name it refuses, a
    // history it could not read), or no answer at all.
    enum ThreadRead: Equatable { case thread(Thread), refused(String), noAnswer }

    static func readThread(status: Int, data: Data?) -> ThreadRead {
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if (200...299).contains(status) {
            // A conversation the Mac cannot file says so (historyUnfilable), rather than reading as an empty one. Its
            // messages sent from here stay under the reason as they are (ChatView draws pending ones with no thread):
            // one the Mac took shows as sent, since no row will ever come to settle it.
            if obj?["historyUnfilable"] as? Bool == true, let why = obj?["historyBecause"] as? String, !why.isEmpty { return .refused(why) }
            if let data, let t = parseThread(data) { return .thread(t) }
            if let why = obj?["historyBecause"] as? String, !why.isEmpty { return .refused(why) }
            return .noAnswer
        }
        if (400...499).contains(status), let error = obj?["error"] as? String, !error.isEmpty { return .refused(error) }
        return .noAnswer
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

    // What changes when a new message arrives, for following it down: not the count alone (the Mac sends at most the
    // last 200, so a long conversation keeps its count as it moves) and not the last row alone (the Mac puts its live
    // question row last, with no time). The count with the last row that has the Mac's time.
    static func followKey(_ thread: Thread) -> String {
        "\(thread.rows.count)|" + (thread.rows.last(where: { $0.atRaw != nil })?.id ?? "")
    }

    // MARK: Sending

    // A message the person sent from this chat, shown until the conversation holds the row the Mac kept for it.
    struct PendingSend: Equatable, Identifiable {
        enum State: Equatable {
            case sending
            // The Mac delivered it and kept a row for it at this time: shown as sent, full strength, until a read brings
            // that row.
            case kept(at: String)
            // The Mac kept a row for it at this time but did not deliver it: held (it sends it itself) or not (the row
            // will say Not sent, and is sent again from there). Shown faded with the same words the row will have, never
            // as sent, and with nothing to tap (the row it becomes is the one place to send it again).
            case keptUndelivered(at: String, note: String)
            // The Mac took it but kept no row (or did not say when): shown as sent until a read holds the same words.
            case taken
            // Not taken: the Mac's own reason when it gave one, or nil when no answer came (it may have arrived; a read
            // that holds the same words, written after it was sent, clears it).
            case failed(reason: String?)
            // The Mac could not confirm it arrived and kept no row: it may have. "Not confirmed", nothing to tap (a second
            // copy may duplicate it); a read holding the same words clears it.
            case unconfirmed
        }
        let id: String
        let text: String
        let at: Date
        var state: State = .sending
        // The newest row time the conversation had already shown when it was sent: a row that clears it must be newer,
        // so an earlier "ok" never stands in for one that was never sent.
        var after: String? = nil
        // kosmos#7071: the files it carries, sent again with it by a retry.
        var files: [Attached] = []
        // kosmos#7083: the `at` of the message it answers, sent again with it by a retry.
        var replyTo: String? = nil
        var failed: Bool { if case .failed = state { return true } else { return false } }
        var shownAsSent: Bool { switch state { case .kept, .taken: return true; default: return false } }
        // What the person can do with it by hand: delete one that failed, or one taken that no read has matched yet.
        var deletable: Bool { switch state { case .failed, .taken, .unconfirmed: return true; default: return false } }
    }

    // The Mac's answer to a send. POST /api/agent/<name>/thread answers 200 with `delivery` (its `at` is the row it
    // kept) and `recorded` (whether it kept one); a refusal answers 4xx with `{error}`.
    enum SendResult: Equatable { case kept(at: String), keptUndelivered(at: String, note: String), taken, unconfirmed, refused(String?), noAnswer }

    static func sendResult(status: Int, body: Data?) -> SendResult {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if (200...299).contains(status), let d = obj?["delivery"] as? [String: Any], let state = d["state"] as? String {
            if obj?["recorded"] as? Bool == true, let at = d["at"] as? String, !at.isEmpty {
                return state == "placed" ? .kept(at: at)
                    // kosmos#7136: the words its row will have once read (failedWords, or "Not sent" for a kept copy).
                    : .keptUndelivered(at: at, note: state == "held" ? "Waiting to send" : state == "unconfirmed" ? "Not confirmed"
                        : d["duplicateOf"] == nil ? Board.failedWords : "Not sent")
            }
            if state == "placed" { return .taken }
            if state == "unconfirmed" { return .unconfirmed }
            return .refused((d["because"] as? String).flatMap { $0.isEmpty ? nil : $0 })
        }
        // A 5xx may come from the relay or tunnel after the Mac took the message, so it is no answer (a retry reads
        // first), even when it carries words. The board's refusals are 4xx; its one 500 (a request it could not read,
        // server.js thread POST) sent nothing, which the read before a retry finds.
        if status == 0 || status >= 500 { return .noAnswer }
        return .refused((obj?["error"] as? String).flatMap { $0.isEmpty ? nil : $0 })
    }

    static func pendingState(after result: SendResult) -> PendingSend.State {
        switch result {
        case .kept(let at): return .kept(at: at)
        case .keptUndelivered(let at, let note): return .keptUndelivered(at: at, note: note)
        case .taken: return .taken
        case .unconfirmed: return .unconfirmed
        case .refused(let why): return .failed(reason: why)
        case .noAnswer: return .failed(reason: nil)
        }
    }

    // The pending messages still to show once a read of the conversation is in. One the Mac kept a row for goes when the
    // read holds that row (by the Mac's own time). One taken without a row, or one that got no answer, goes when the
    // read holds a message of the person's with the same words (sameWords) written no earlier than a minute before it
    // was sent (the clocks can differ). Each thread row stands for one pending message at most. One still sending,
    // or refused with the Mac's reason (which kept no row), stays.
    static func settled(_ pending: [PendingSend], with thread: Thread) -> [PendingSend] {
        var unused = thread.rows.filter { $0.who == .person }
        var gone = Set<String>()
        // First the messages the Mac named a row for (by its own time), so a match by words can never take their row.
        for p in pending {
            switch p.state {
            case .kept(let at), .keptUndelivered(let at, _):
                if let i = unused.firstIndex(where: { $0.atRaw == at }) { unused.remove(at: i); gone.insert(p.id) }
            default: break
            }
        }
        // Then the ones matched by words, against the rows left.
        for p in pending {
            switch p.state {
            case .taken, .unconfirmed, .failed(reason: nil):
                let words = sameWords(p.text)
                func newer(_ r: ChatRow) -> Bool {
                    if let after = p.after { return (r.atRaw.flatMap(isoDate) ?? .distantPast) > (isoDate(after) ?? .distantFuture) }
                    return r.at.map { $0 >= p.at.addingTimeInterval(-60) } ?? true
                }
                if let i = unused.firstIndex(where: { sameWords($0.text) == words && newer($0) }) { unused.remove(at: i); gone.insert(p.id) }
                // Delivered but never written down (the Mac said so: recorded false): once a read holds a row newer than
                // the send and still not this one, it never will. It goes, as it is absent from the board's own chat too,
                // rather than sitting under every later reply.
                else if p.state == .taken, p.after != nil, thread.rows.contains(where: newer) { gone.insert(p.id) }
            default: break
            }
        }
        return pending.filter { !gone.contains($0.id) }
    }

    // The line under a message that was not taken (the spec's wording), decided when it is drawn: an agent that is not
    // running cannot take it, so there is nothing to try again until it is.
    static func notSentLine(agentRunning: Bool, name: String) -> (text: String, canRetry: Bool) {
        agentRunning ? ("Not sent. Tap to try again.", true) : ("Not sent. \(name) isn't running on your computer.", false)
    }
}

// kosmos#7136: a message the Mac could not deliver, as the board's dmFailedLine (web/index.html, kosmos#6720) draws it:
// one quiet line under the bubble, "Message failed to deliver, try again." where it can be sent again, else "Message
// failed to deliver.", "sending…" while it goes, and the reason only heard. Try again sends the same words into the same
// row (retry_of), so it stays one message.
extension Board {
    static let failedWords = "Message failed to deliver"

    struct FailedLine: Equatable {
        // "try again", "sending…", or nil where it cannot be sent again.
        let button: String?
        let canRetry: Bool
        // The Mac's reason as a sentence, heard as the line's hint (the board's tooltip).
        let because: String
        var text: String { failedWords + (button.map { ", " + $0 + "." } ?? ".") }
    }

    // The `at` of the person's newest message in the thread (the board's DM_NEWEST_MINE_AT): sent again behind a newer one
    // it would arrive out of order, so only that one is offered.
    static func newestMineAt(_ rows: [ChatRow]) -> String? {
        rows.last { $0.who == .person && !($0.atRaw ?? "").isEmpty }?.atRaw
    }

    // nil for a row that does not get the line. `flying`: this phone is sending it again now.
    static func failedLine(_ row: ChatRow, newestMineAt: String?, flying: Bool) -> FailedLine? {
        guard row.who == .person, row.notSent == failedWords || (row.retrying && flying) else { return nil }
        let newest = newestMineAt == nil || newestMineAt == row.atRaw
        let canRetry = row.canSendAgain && newest
        let button = flying && (canRetry || row.retrying) ? "sending\u{2026}" : canRetry ? "try again" : nil
        return FailedLine(button: button, canRetry: canRetry && !flying, because: sentence(row.because ?? "we could not reach them"))
    }

    // POST /api/agent/<name>/thread {text, retry_of}: the board's dmRetrySend. The words go exactly as the row holds them
    // (the Mac takes the retry only with these words).
    static func retryRequest(mac: URL, session: String, text: String, retryOf at: String) -> URLRequest? {
        guard isAgentSession(session), !at.isEmpty else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/thread", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text, "retry_of": at])
        return r
    }

    // What the board says after Try again (dmRetrySend): a refusal, said under the box as well; otherwise what happened,
    // only heard.
    struct RetrySaid: Equatable { let said: String; let refused: Bool }
    static let retryNoAnswer = "We could not reach Kosmos, so we cannot tell whether it went. Look at the conversation before trying again."

    static func retryResult(status: Int, body: Data?) -> RetrySaid {
        if status == 0 { return RetrySaid(said: retryNoAnswer, refused: true) }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        guard (200...299).contains(status) else {
            let why = (obj?["error"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "we could not send it again"
            return RetrySaid(said: sentence(why), refused: true)
        }
        let state = (obj?["delivery"] as? [String: Any])?["state"] as? String
        return RetrySaid(said: state == "placed" ? "Sent."
            : state == "unconfirmed" ? "We could not confirm it went. Check its window before sending it again."
            : failedWords + ".", refused: false)
    }
}

// kosmos#7089: the chat's search, as the board's talkFilterRows and pjNoMatchSentence (web/index.html). It filters the
// rows already loaded, on the phone, with no new read. A row stays when the words, trimmed and in any case, are in who
// said it or in its text. An agent's row is named by this chat's agent, as the phone names every such row; a person's row
// by nothing (the board's dmWho gives "" with no `from`), so a person's row, like a Kosmos line, matches by its text only.
extension Board {
    static func chatSearching(_ query: String) -> Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    static func chatFilter(_ rows: [ChatRow], agentName: String, query: String) -> [ChatRow] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty { return rows }
        let who = agentName.lowercased()
        return rows.filter { ($0.who == .agent && who.contains(needle)) || $0.text.lowercased().contains(needle) }
    }

    static let chatSentWhileSearching = "Once it arrives, your message shows only if it matches the search."

    static func chatNoMatch(_ query: String) -> String {
        "Nothing here matches \"\(query.trimmingCharacters(in: .whitespacesAndNewlines))\". Clearing the search brings the conversation back."
    }
}

// kosmos#7120: the context gauge, as the board's pctOf and memBand (web/index.html) and its memPrint words.
extension Board {
    enum MemBand: Equatable { case ok, warn, high }
    static let memoryWarm = 60.0          // the board's WARM: amber from here
    static let memoryNearlyFull = 80.0    // the board's NEARLY_FULL: red from here

    // context.percent when it is a finite number (never a true or false), else unknown; held to 0...100 (the engine
    // caps it at 100), so nothing downstream meets a value no ring or word can show.
    static func contextPercent(_ raw: Any?) -> Double? {
        guard let ctx = raw as? [String: Any], let n = ctx["percent"] as? NSNumber,
              CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return min(max(n.doubleValue, 0), 100)
    }

    // A real JSON true, not a 1 (the board's `=== true`: a shape it does not understand is not evidence).
    static func isRealTrue(_ raw: Any?) -> Bool {
        guard let n = raw as? NSNumber else { return false }
        return CFGetTypeID(n) == CFBooleanGetTypeID() && n.boolValue
    }

    static func memBand(_ pct: Double?) -> MemBand? {
        guard let pct else { return nil }
        return pct >= memoryNearlyFull ? .high : pct >= memoryWarm ? .warn : .ok
    }

    // What VoiceOver hears for the gauge, in the board's words (memPrint): "memory Full" or "memory 82%"; nothing
    // when the percent is unknown (the ring is not drawn then either).
    static func memoryWords(_ pct: Double?, full: Bool) -> String? {
        guard let pct else { return nil }
        if full { return "memory Full" }
        let shown = pct.rounded() == pct ? String(Int(pct)) : String(format: "%.1f", pct)
        return "memory \(shown)%"
    }
}

// kosmos#7197 (review 3): which Mac a "not answering" line names. A shown list, and a chat opened from it, belong to
// the Mac they came from, even after the app has moved on to another Mac (a reconnect can pick the account's other
// one while it waits for Allow), so the shown Mac comes first; the phase's Mac only when nothing was shown.
extension Board {
    static func failingMacName(shown: String?, phase: String?) -> String? {
        if let s = shown, !s.isEmpty { return s }
        return phase
    }
}

// kosmos#7280: here, not in AgentInfoLogic.swift, because BoardClient.chatURL calls it and every LogicTests runner
// that compiles BoardClient.swift compiles this file.
extension Board {
    // kosmos#7280: the board's agent deep link with a section (?tab=detail&agent=<n>&sec=model opens AI Settings). A
    // board without #7280 ignores sec and lands on the conversation, as before. Only the board's own section names.
    static let boardSections: Set<String> = ["profile", "model"]
    static func withBoardSection(_ url: URL, _ sec: String) -> URL? {
        guard boardSections.contains(sec), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.queryItems?.contains(where: { $0.name == "tab" && $0.value == "detail" }) == true else { return nil }
        parts.queryItems = (parts.queryItems ?? []).filter { $0.name != "sec" } + [URLQueryItem(name: "sec", value: sec)]
        return parts.url
    }
}
