import Foundation

// kosmos#7010 (slice 10 of #6838): what the native Settings tab reads and writes. UIKit-free, so
// ios/LogicTests/run-settings.sh runs it on a Mac.
//
// The phone switches are the computer's own setting (engine/phonenotify.js, GET and PUT /api/phone-notify), the
// same the board's Settings shows, so phone and computer can never disagree. The request goes to the computer this
// phone already shows, with the sign-in the app keeps for it (SessionKeychain.macSession, as the notification
// extension does), and only when that sign-in belongs to the Kosmos+ account signed in now.
enum Settings {
    // The board's own words for each switch (web/index.html #phone-notify), in its order.
    enum Kind: String, CaseIterable, Equatable {
        case needsYou, replied, postedMention, ready, postedRoom

        var label: String {
            switch self {
            case .needsYou: return "When an agent needs me"
            case .replied: return "When an agent answers me"
            case .postedMention: return "When an agent replies to a post of mine"
            case .ready: return "When work is ready for my check"
            case .postedRoom: return "When anyone posts in a project room I am on"
            }
        }

        // Only the busy-room switch carries a line under it on the board.
        var hint: String? {
            self == .postedRoom ? "Off to start with, so a busy room does not fill your phone. At most one buzz per room every few minutes." : nil
        }
    }

    static let masterLabel = "Buzz my phone about my agents"

    // What GET /api/phone-notify answers (engine/phonenotify.js status()). Never a token.
    struct PhoneNotify: Decodable, Equatable {
        let available: Bool
        let on: Bool
        let connected: Bool
        let kinds: [String: Bool]
        let offByChoice: Bool?
        let defaultBecause: String?

        func isOn(_ kind: Kind) -> Bool { kinds[kind.rawValue] ?? false }
    }

    // The kept sign-in for the computer this phone shows, only when it belongs to the account signed in now
    // (BoardClient keeps it the same way; another account's computer is never asked).
    struct Mac: Equatable {
        let name: String
        let url: URL
        let cookie: String
    }

    static func keptMac(stored: String?, session: String?, coordinator: URL) -> Mac? {
        guard let saved = Board.usableSaved(stored, session: session, coordinator: coordinator),
              let url = Board.macURL(address: saved.address, coordinator: coordinator)
        else { return nil }
        return Mac(name: saved.name, url: url, cookie: saved.cookie)
    }

    private static func request(_ mac: Mac, method: String, body: Data? = nil) -> URLRequest? {
        guard let url = URL(string: "/api/phone-notify", relativeTo: mac.url)?.absoluteURL else { return nil }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        r.httpMethod = method
        // The cookie goes by hand on this one request; nothing here keeps a cookie jar.
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            r.httpBody = body
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    static func readRequest(_ mac: Mac) -> URLRequest? { request(mac, method: "GET") }

    // nil kind: the master switch ({ on }); a kind: that one switch ({ kind, on }), as the board sends them.
    static func writeRequest(_ mac: Mac, kind: Kind?, on: Bool) -> URLRequest? {
        var body: [String: Any] = ["on": on]
        if let kind { body["kind"] = kind.rawValue }
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return nil }
        return request(mac, method: "PUT", body: data)
    }

    // The setting, from a 200 JSON answer; nil for anything else.
    static func phoneNotify(status: Int, data: Data) -> PhoneNotify? {
        guard status == 200 else { return nil }
        return try? JSONDecoder().decode(PhoneNotify.self, from: data)
    }

    // A sentence from the computer's words: a capital to start and a full stop to end.
    static func sentence(_ said: String) -> String {
        let t = said.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = t.first else { return "" }
        let end = t.last.map { ".!?".contains($0) } ?? false
        return first.uppercased() + t.dropFirst() + (end ? "" : ".")
    }

    // Why a read or a write did not work: the computer's own reason (its `error`), or a plain one for what happened.
    // A 401 can also be the few seconds after the computer restarts, so it is not worded as final.
    static func refusal(status: Int, data: Data, writing: Bool) -> String {
        if status == 401 || status == 403 {
            return "Your computer did not let this phone in just now. Try again in a moment, or open the Agents tab to connect again."
        }
        if let any = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let said = any["error"] as? String, !said.trimmingCharacters(in: .whitespaces).isEmpty {
            return sentence(said)
        }
        if status == 0 { return "Your computer is not answering. Try again in a moment." }
        return writing ? "That did not save. Try again in a moment." : "Your computer did not send these settings. Try again in a moment."
    }

    // What the master row says under the switch. The board says the same (web/index.html #phone-notify).
    static func masterNote(_ s: PhoneNotify) -> String {
        if !s.available { return "Phone notifications are not available on this computer yet." }
        if !s.connected { return "This computer is not connected to Kosmos+, so nothing can reach your phone." }
        if s.on { return "Kosmos+ is told the agent's name, its project and the time, never what they said." }
        // As the board says it (web/index.html, "Not on yet."), and always a whole sentence.
        if let why = s.defaultBecause, !why.trimmingCharacters(in: .whitespaces).isEmpty { return "Not on yet. " + sentence(why) }
        return "Off. Nothing about your agents leaves your computer."
    }

    // The master switch can be pressed only when the computer could act on it.
    static func masterEnabled(_ s: PhoneNotify) -> Bool { s.available && (s.connected || s.on) }

    // The per-kind switches show only while the board shows them (web/index.html paintKinds): on, available and
    // connected, since otherwise nothing is sent whatever they say.
    static func kindsShown(_ s: PhoneNotify) -> Bool { s.available && s.connected && s.on }

    // Kosmos+'s own pages, opened in the app's web view: the account page (where the person signs out) and the
    // delete-account flow (coordinator lib.rs serves both). Neither is called from here: the sign-out route accepts
    // only the sign-in page itself, and deleting an account takes its own confirmed steps.
    static func accountURL(coordinator: URL) -> URL { URL(string: "/account", relativeTo: coordinator)!.absoluteURL }
    static func deleteAccountURL(coordinator: URL) -> URL { URL(string: "/delete-account", relativeTo: coordinator)!.absoluteURL }
}
