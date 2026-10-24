import Foundation

// kosmos#7017 (slice 8 of #6838): answering from the notification. UIKit-free, so ios/LogicTests/run-actions.sh runs
// it on a Mac.
//
// Allow and Deny (part 2): on a permission prompt's notice, the prompt's own Yes or No goes to that agent's chat as the
// chat's own press (Board.pressRequest), only after a fresh read shows the very request the notice named is still up.
//
// Reply: a text typed on the notification goes to that agent's chat through the request the native chat uses
// (Board.sendRequest, Board.sendResult), to the computer the notification came from, with the sign-in the app keeps
// for it, and only when that sign-in belongs to the Kosmos+ account signed in now. Nothing is ever sent twice: a reply
// that may have gone is never retried here; the person is told to look in the chat.
enum NotificationAction {
    // The category and action are NotificationCategories' (every LogicTests suite compiles that file).
    static var replyCategory: String { NotificationCategories.replyCategory }
    static var replyAction: String { NotificationCategories.replyAction }

    // The kept computer and agent a notice came from, or nil: no agent named, an address that is not the kept
    // computer's, or no kept sign-in for this account.
    private static func target(_ userInfo: [AnyHashable: Any], stored: String?, session: String?, coordinator: URL) -> (mac: URL, cookie: String, agent: String)? {
        guard let agent = userInfo["session"] as? String, Board.isAgentSession(agent),
              let address = (userInfo["address"] as? String)?.lowercased(),
              let saved = Board.usableSaved(stored, session: session, coordinator: coordinator),
              saved.address.lowercased() == address,
              let mac = Board.macURL(address: saved.address, coordinator: coordinator)
        else { return nil }
        return (mac, saved.cookie, agent)
    }

    private static func signed(_ request: URLRequest?, cookie: String, idle: TimeInterval) -> URLRequest? {
        guard var r = request else { return nil }
        // The cookie goes by hand on this one request; nothing here keeps a cookie jar.
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(cookie)", forHTTPHeaderField: "Cookie")
        // The read and the send each have a hard total limit (PushNotificationManager's sessions, 8 s and 14 s), together
        // inside the short time iOS gives a notification action; this idle limit sits just under each, so a slow send
        // that did go is not cut off early and reported as "may not have gone".
        r.timeoutInterval = idle
        return r
    }

    // The chat's read, made before a reply is sent (see verdict).
    static func checkRequest(userInfo: [AnyHashable: Any], stored: String?, session: String?, coordinator: URL) -> URLRequest? {
        guard let t = target(userInfo, stored: stored, session: session, coordinator: coordinator) else { return nil }
        return signed(Board.threadRequest(mac: t.mac, session: t.agent), cookie: t.cookie, idle: 7)
    }

    // The request for a reply, or nil when there is nothing to send to, or text the board would refuse.
    static func replyRequest(userInfo: [AnyHashable: Any], text: String, stored: String?, session: String?, coordinator: URL) -> URLRequest? {
        guard let t = target(userInfo, stored: stored, session: session, coordinator: coordinator) else { return nil }
        return signed(Board.sendRequest(mac: t.mac, session: t.agent, text: text), cookie: t.cookie, idle: 13)
    }

    // Whether a reply may go, from the chat read just before it (GET /api/agent/<name>/thread).
    enum ReadVerdict: Equatable { case go, asking, unreadable(String) }

    // The board says `asking: true` whenever the agent's card is waiting on the person (server.js thread GET), whether
    // or not it could also serve the question's row: a question the agent reported itself is dated and placed among
    // the rows, and a menu the board cannot read gives no row at all. While it is asking, a reply could answer or close
    // a menu the person never saw (a bare digit is taken as its key), so nothing is sent. An older board without the
    // field: its live question row (last, no time) is the only sign there is. A question that appears between this
    // read and the send is not seen (only a check on the board could close that).
    static func verdict(status: Int, data: Data?, agent: String) -> ReadVerdict {
        let who = agent.isEmpty ? "your agent" : agent
        guard status == 200, let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            if status == 0 { return .unreadable("Kosmos could not reach your computer, so your reply to \(who) was not sent. Open the chat to send it.") }
            if status == 401 || status == 403 {
                return .unreadable("Your computer did not let this phone in just now, so your reply to \(who) was not sent. Open the chat to send it.")
            }
            return .unreadable("Kosmos could not read your chat with \(who) just now, so your reply was not sent. Open the chat to send it.")
        }
        if let asking = obj["asking"] as? Bool { return asking ? .asking : .go }
        // An older board's answer that cannot be read as a chat fails closed: nothing is sent blind.
        guard let thread = Board.parseThread(data) else {
            return .unreadable("Kosmos could not read your chat with \(who) just now, so your reply was not sent. Open the chat to send it.")
        }
        if let last = thread.rows.last, last.atRaw == nil, last.wayThrough == .question || last.wayThrough == .permission { return .asking }
        return .go
    }

    static func askingNotice(agent: String) -> String {
        "\(agent.isEmpty ? "Your agent" : agent) is asking you something right now, so your reply was not sent. Open the chat to see it and answer."
    }

    // The board's own reason on a 200 that did not type (delivery.because), which Board.sendResult does not carry.
    static func because(_ body: Data?) -> String? {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let why = (obj?["delivery"] as? [String: Any])?["because"] as? String
        return why.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
    }

    // What the person is told after a reply, or nil only when it went or is held to go (the chat shows it waiting).
    // `body` is the board's answer, for its reason when it kept the reply but did not type it.
    static func notice(after result: Board.SendResult, agent: String, body: Data? = nil) -> String? {
        let who = agent.isEmpty ? "your agent" : agent
        switch result {
        case .kept, .taken:
            return nil
        case .keptUndelivered(_, let note):
            if note == "Waiting to send" { return nil }   // held: it goes by itself once the agent is ready
            if note == "Not confirmed" {
                return "Kosmos could not confirm your reply to \(who) went. Open the chat to check before sending it again."
            }
            return notice(after: .refused(because(body)), agent: agent)
        case .unconfirmed:
            return "Kosmos could not confirm your reply to \(who) went. Open the chat to check before sending it again."
        case .noAnswer:
            return "Your computer did not answer, so your reply to \(who) may not have gone. Open the chat to check."
        case .refused(let why):
            if let why, !why.trimmingCharacters(in: .whitespaces).isEmpty {
                return "Kosmos could not send your reply to \(who): \(why.trimmingCharacters(in: .whitespaces))\(why.hasSuffix(".") ? "" : ".")"
            }
            return "Kosmos could not send your reply to \(who). Open the chat to try again."
        }
    }

    // The follow-up notice's tap target: only the original notice's address and agent, nothing else carried over.
    static func followUpInfo(_ userInfo: [AnyHashable: Any]) -> [AnyHashable: Any] {
        var out: [AnyHashable: Any] = [:]
        if let a = userInfo["address"] as? String { out["address"] = a }
        if let s = userInfo["session"] as? String { out["session"] = s }
        return out
    }

    // MARK: kosmos#7017 part 2: Allow and Deny

    static var permissionCategory: String { NotificationCategories.permissionCategory }
    static var allowAction: String { NotificationCategories.allowAction }
    static var denyAction: String { NotificationCategories.denyAction }

    // What the extension put on the notice (PhoneNotice.permissionInfo), read back: the pressed option and what it checks.
    struct PermissionPress: Equatable {
        let n: Int
        let label: String
        let asked: String
        let request: String
        let allow: Bool
    }

    static func permissionPress(_ userInfo: [AnyHashable: Any], action: String) -> PermissionPress? {
        guard action == allowAction || action == denyAction,
              let p = userInfo[NotificationCategories.permissionInfoKey] as? [String: Any],
              let asked = p["asked"] as? String, !asked.isEmpty,
              let request = p["request"] as? String, request.count == 64, request.allSatisfy({ $0.isHexDigit })
        else { return nil }
        let allow = action == allowAction
        guard let n = p[allow ? "allowN" : "denyN"] as? Int, (1...9).contains(n),
              let label = p[allow ? "allowLabel" : "denyLabel"] as? String, !label.isEmpty
        else { return nil }
        return PermissionPress(n: n, label: label, asked: asked, request: request, allow: allow)
    }

    // The chat's read just before an Allow or Deny goes (GET /api/agent/<name>/thread). A notice can be minutes old, so
    // the press goes only while the agent is still asking the same question (`asked`, the whole box, which the board
    // checks again on the press) AND the board's card carries the notice's fingerprint (`request`), a second check on
    // the card's reading of the request. A prompt still up whose buttons the board will not draw just now (`asked` null)
    // cannot be answered from here; nothing is sent either way.
    enum PermissionVerdict: Equatable { case go, changed, unreadable(String) }

    static func permissionVerdict(status: Int, data: Data?, press: PermissionPress, agent: String) -> PermissionVerdict {
        let who = agent.isEmpty ? "your agent" : agent
        let verb = press.allow ? "allowed" : "denied"
        guard status == 200, let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            if status == 0 { return .unreadable("Kosmos could not reach your computer, so nothing was \(verb) for \(who). Open the chat to answer.") }
            if status == 401 || status == 403 {
                return .unreadable("Your computer did not let this phone in just now, so nothing was \(verb) for \(who). Open the chat to answer.")
            }
            return .unreadable("Kosmos could not read your chat with \(who) just now, so nothing was \(verb). Open the chat to answer.")
        }
        guard obj["asking"] as? Bool == true else { return .changed }
        // Still asking, but the board offers no buttons for it just now (`asked` null: its box top scrolled off, say).
        guard let askedNow = obj["asked"] as? String else {
            return .unreadable("Kosmos cannot answer \(who) from here just now, so nothing was \(verb). Open the chat to answer.")
        }
        guard askedNow == press.asked else { return .changed }
        // Still asking the same question, but the computer could not read the chat's rows (messages null): the card
        // cannot be compared, which is not the same as it having changed.
        guard let rows = obj["messages"] as? [[String: Any]] else {
            return .unreadable("Kosmos could not read your chat with \(who) just now, so nothing was \(verb). Open the chat to answer.")
        }
        let cards = rows.compactMap { ($0["kind"] as? String) == "question" ? $0["permission"] as? [String: Any] : nil }
        // The same question still up, but no card with this fingerprint: its reading of the request differs from the
        // notice's. Not "it changed" (the question did not): it cannot be answered from here now.
        guard cards.contains(where: { $0["request"] as? String == press.request }) else {
            return .unreadable("Kosmos cannot answer \(who) from here just now, so nothing was \(verb). Open the chat to answer.")
        }
        return .go
    }

    // The request for an Allow or Deny: exactly the chat's press (Board.pressRequest), never a lasting choice, to the kept
    // computer the notice came from, or nil when there is nothing to send to.
    static func pressRequest(userInfo: [AnyHashable: Any], press: PermissionPress, stored: String?, session: String?, coordinator: URL) -> URLRequest? {
        guard let t = target(userInfo, stored: stored, session: session, coordinator: coordinator) else { return nil }
        let option = Board.ChoiceOption(n: press.n, label: press.label, lasting: false)
        return signed(Board.pressRequest(mac: t.mac, session: t.agent, option: option, asked: press.asked), cookie: t.cookie, idle: 13)
    }

    // What the person is told after an Allow or Deny (Board.pressResult). Never nothing: iOS takes the notice away on
    // the press, so silence would read the same as a press that was lost. A sure press says so quietly ("Allowed for
    // Ada."). A refusal carries the board's own reason, whatever it is: the board refuses a press for many reasons (quiet
    // hours, the usage cap, another press in the air, a screen it could not read, the question having changed), so no
    // one sentence here can stand in for them.
    static func pressNotice(after result: Board.PressResult, agent: String, allow: Bool) -> String {
        let who = agent.isEmpty ? "your agent" : agent
        let verb = allow ? "allowed" : "denied"
        switch result {
        case .sent:
            return "\(allow ? "Allowed" : "Denied") for \(who)."
        case .notSure:
            return "Kosmos could not confirm that was \(verb) for \(who). Open the chat to check before pressing again."
        case .refused(let why):
            let w = why.trimmingCharacters(in: .whitespaces)
            return w.isEmpty ? "Nothing was \(verb) for \(who). Open the chat to answer."
                : "Nothing was \(verb) for \(who). \(w)\(w.hasSuffix(".") || w.hasSuffix("!") || w.hasSuffix("?") ? "" : ".")"
        }
    }

    static func changedNotice(agent: String, allow: Bool) -> String {
        "\(agent.isEmpty ? "Your agent" : agent) is no longer asking that, or is asking something else now, so nothing was \(allow ? "allowed" : "denied"). Open the chat to see what it is asking."
    }

    // When an Allow or Deny could not even be made (no kept computer, or a notice without the computer's permission).
    static func cannotPress(agent: String) -> String {
        "Kosmos could not answer \(agent.isEmpty ? "your agent" : agent) from here, so nothing was allowed or denied. Open the chat to answer."
    }

    // When the reply could not even be made (no kept computer for this notification, or nothing typed).
    static func cannotSend(agent: String) -> String {
        "Kosmos could not send your reply to \(agent.isEmpty ? "your agent" : agent) from here. Open the chat to send it."
    }
}
