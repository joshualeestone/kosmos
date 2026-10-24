import Foundation

// kosmos#7017 (slice 8 of #6838): answering from the notification. UIKit-free, so ios/LogicTests/run-actions.sh runs
// it on a Mac.
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

    private static func signed(_ request: URLRequest?, cookie: String) -> URLRequest? {
        guard var r = request else { return nil }
        // The cookie goes by hand on this one request; nothing here keeps a cookie jar.
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(cookie)", forHTTPHeaderField: "Cookie")
        // An answer well inside the short time iOS gives a notification action; past it, the reply is "no answer".
        r.timeoutInterval = 20
        return r
    }

    // The chat's read, made before a reply is sent (see standingQuestion).
    static func checkRequest(userInfo: [AnyHashable: Any], stored: String?, session: String?, coordinator: URL) -> URLRequest? {
        guard let t = target(userInfo, stored: stored, session: session, coordinator: coordinator) else { return nil }
        return signed(Board.threadRequest(mac: t.mac, session: t.agent), cookie: t.cookie)
    }

    // The request for a reply, or nil when there is nothing to send to, or text the board would refuse.
    static func replyRequest(userInfo: [AnyHashable: Any], text: String, stored: String?, session: String?, coordinator: URL) -> URLRequest? {
        guard let t = target(userInfo, stored: stored, session: session, coordinator: coordinator) else { return nil }
        return signed(Board.sendRequest(mac: t.mac, session: t.agent, text: text), cookie: t.cookie)
    }

    // Whether the agent has a question or a permission prompt up right now: the Mac puts its live question row last,
    // with no time (Board.followKey). A reply then could answer or close a menu the person never saw (a bare digit is
    // taken as that menu's key), so the reply is not sent and the person is sent to the chat.
    static func standingQuestion(_ thread: Board.Thread) -> Bool {
        guard let last = thread.rows.last, last.atRaw == nil else { return false }
        return last.wayThrough == .question || last.wayThrough == .permission
    }

    static func questionUp(agent: String) -> String {
        let who = agent.isEmpty ? "Your agent" : agent
        return "\(who) is asking you something right now, so your reply was not sent. Open the chat to see it and answer."
    }

    static func couldNotCheck(agent: String) -> String {
        "Kosmos could not reach your computer, so your reply to \(agent.isEmpty ? "your agent" : agent) was not sent. Open the chat to send it."
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

    // When the reply could not even be made (no kept computer for this notification, or nothing typed).
    static func cannotSend(agent: String) -> String {
        "Kosmos could not send your reply to \(agent.isEmpty ? "your agent" : agent) from here. Open the chat to send it."
    }
}
