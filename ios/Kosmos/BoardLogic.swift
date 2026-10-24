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

    // A message's words with every run of whitespace one space and the ends trimmed: how the board compares and counts
    // (cleanMessage), and how a sent message is matched to the row the Mac kept (which keeps line breaks but tidies them).
    static func sameWords(_ s: String) -> String {
        s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    // A plain message, as the board's own composer posts it ({text}). nil for a name the app does not accept or a
    // message the board would not take.
    static func sendRequest(mac: URL, session: String, text: String) -> URLRequest? {
        let said = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isAgentSession(session), fitsBoard(said) else { return nil }
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
        // Under a message of the person's, the Mac's verdict when it is not "reached the agent": "Not sent" (it could not
        // deliver it), "Waiting to send" (it holds it and sends it itself), or "Not confirmed" (it may have arrived: the
        // board's "could not confirm", where sending again may duplicate it). nil when it reached the agent.
        var notSent: String? = nil
        var wayThrough: WayThrough? = nil
        // The Mac's own reason, shown under the verdict as the board shows it.
        var because: String? = nil
        // Only a plain message the Mac could not deliver is offered again: not a copy the Mac already marked as one
        // (duplicateOf), and not a menu answer (its words are not what was typed).
        var resendable = false
        var canSendAgain: Bool { who == .person && notSent == "Not sent" && resendable }
        // kosmos#7016: the Mac's reading of a permission prompt on a question row, and whether a question is the agent's
        // own reported words (which take no buttons, as on the board).
        var permission: Permission? = nil
        var reported = false
        // kosmos#7016 part 2: the files on the row, in the order sent (the board's pjFiles).
        var attachments: [Attachment] = []
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
    static func wordsShown(_ text: String, files: [Attachment]) -> String {
        let names = files.map(\.name)
        return !names.isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines) == names.joined(separator: ", ") ? "" : text
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
            if who == .person, let d = row["delivery"] as? [String: Any], let state = d["state"] as? String, state != "placed" {
                notSent = state == "held" ? "Waiting to send" : state == "unconfirmed" ? "Not confirmed" : "Not sent"
                because = (d["because"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let wire = (row["wire"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                resendable = state == "could_not" && d["duplicateOf"] == nil && wire == nil
            }
            // A permission is read only on a question row (the board's m.kind === 'question' && m.permission).
            let permission = kind == "question" ? parsePermission(row["permission"]) : nil
            // Marked a permission prompt whenever the Mac says it is one; the card itself needs Allow and Deny it can read.
            let isPermission = kind == "question" && row["permission"] is [String: Any]
            let way: ChatRow.WayThrough? = (row["draft"] as? Bool) == true ? .draft : isPermission ? .permission
                : kind == "question" ? .question
                : (row["attachment"] != nil || (row["attachments"] as? [Any])?.isEmpty == false) ? .attachment : nil
            return ChatRow(id: idPrefix + base + "#\(n)", atRaw: at, at: isoDate(at), text: text, who: who, notSent: notSent, wayThrough: way,
                           because: because, resendable: resendable,
                           permission: permission, reported: isTrue(row["reported"]), attachments: parseAttachments(row))
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
                    : .keptUndelivered(at: at, note: state == "held" ? "Waiting to send" : state == "unconfirmed" ? "Not confirmed" : "Not sent")
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
