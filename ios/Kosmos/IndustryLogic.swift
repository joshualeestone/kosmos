import Foundation

// kosmos#8959 slice D1d2a: Community's kind of business, native under the Community box on the phone's Automation screen.
// UIKit-free, so ios/LogicTests/run-industry.sh runs it on a Mac.
//
// The board's page (web/index.html: industryPaint, refreshIndustry, industryChange) reads and writes GET and PUT
// /api/community-industry, which answers { industry, ok, industries: [{ key, label, display }], unreachable,
// picturesStuck, picturesUnsendable, picturesToFit }. Neither route is on the remote step-up list. The page also refits
// old pictures (picturesToFit) in the background; the phone leaves that to the page and only says what the board reports.
enum Industry {
    enum Words {
        static let label = "Your kind of business, shown on your agents’ public profiles"
        static let hint = "Optional. A profile reads “Works for” and what you pick; with none picked it leaves the line out."
        static let none = "None: profiles leave it out"
        static let unknown = "Could not be read just now"
        static let unreadWithList = "We could not read which business your profiles show just now. Pick one, or None, to set it again."
        static let unreadNoList = "We could not read which business your profiles show just now. Try again in a moment."
        static let saveFailed = "We could not save that setting."
        static let savedUnread = "Saved, but we could not read it back just now."
        static let savedShown = "Saved. While Community is on, your agents’ public profiles show it."
        static let savedLater = "Saved. Kosmos takes it off your agents’ public profiles once it can send to the community again."
        static func savedOff(unreachable n: Int) -> String {
            "Saved. Kosmos takes it off your agents’ public profiles, even with Community off"
                + (n > 0 ? ", except \(n)" + (n == 1 ? " agent" : " agents") + " the community has shut out, whose profile Kosmos can no longer change." : ".")
        }
        static func stuck(_ n: Int) -> String {
            (n == 1 ? "One agent’s picture" : "\(n) agents’ pictures") + " may still show in the community. The community shut "
                + (n == 1 ? "that agent" : "those agents") + " out, so Kosmos can no longer take " + (n == 1 ? "it" : "them") + " down."
        }
        static func unsendable(_ n: Int) -> String {
            (n == 1 ? "One agent’s picture" : "\(n) agents’ pictures") + " cannot go to the community as " + (n == 1 ? "it is" : "they are")
                + ". Choose a different picture, or the same one again, on the agent’s page and Kosmos will fit it if it can."
        }
    }

    struct Choice: Equatable, Identifiable { var key: String, text: String; var id: String { key } }
    static let noneKey = ""
    static let unknownKey = "__unknown"

    struct State: Equatable {
        var industry: String?          // the key the profiles show; nil for none
        var unread: Bool               // the setting could not be read: no choice is drawn as made
        var list: [Choice]             // the board's industries, as it dresses them (display, else label)
        var unreachable: Int?          // agents the community shut out; nil when the board cannot tell
        var picturesStuck: Int
        var picturesUnsendable: Int
    }

    // The board's answer; nil when there is none (the page's industryPaint(null)).
    static func read(status: Int, data: Data?) -> State? {
        guard status == 200, let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let raw = o["industries"] as? [Any]
        let list = (raw ?? []).compactMap { x -> Choice? in
            guard let i = x as? [String: Any], let k = i["key"] as? String, !k.isEmpty else { return nil }
            let text = (i["display"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (i["label"] as? String) ?? ""
            return Choice(key: k, text: text)
        }
        // Number.isInteger and > 0, as the page: a JSON true is not a count.
        let count = { (k: String) -> Int in
            guard let n = o[k] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue == n.doubleValue.rounded() else { return 0 }
            return max(0, n.intValue)
        }
        return State(industry: (o["industry"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                     unread: o["ok"] as? Bool != true || raw == nil, list: list,
                     // null or missing: the board cannot tell, so the save promises nothing about shut-out agents.
                     unreachable: (o["unreachable"] as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? nil : $0.intValue },
                     picturesStuck: count("picturesStuck"), picturesUnsendable: count("picturesUnsendable"))
    }

    // industryPaint's choices: the unread entry first when unread (never saved), None, then the board's list. With no
    // answer at all, the list the screen last had is kept, as the page keeps sel.__industries.
    static func choices(_ s: State?, kept: [Choice]) -> [Choice] {
        var list = s?.list.isEmpty == false ? s!.list : kept
        let unread = s?.unread ?? true
        // A saved key the board's list no longer has is still the one chosen: it stays a choice, so it is not shown blank.
        if let k = s?.industry, !unread, !list.contains(where: { $0.key == k }) { list.append(Choice(key: k, text: k)) }
        return (unread ? [Choice(key: unknownKey, text: Words.unknown)] : []) + [Choice(key: noneKey, text: Words.none)] + list
    }
    static func selected(_ s: State?) -> String {
        guard let s, !s.unread else { return unknownKey }
        return s.industry ?? noneKey
    }
    // The line under the picker after a read: nothing when read, else the unread sentence (with or without a list).
    static func readSaid(_ s: State?, kept: [Choice]) -> String? {
        if let s, !s.unread { return nil }
        let hasList = (s?.list.isEmpty == false) || !kept.isEmpty
        return hasList ? Words.unreadWithList : Words.unreadNoList
    }
    // industryChange's sentence after a save the board answered 200.
    static func savedSaid(_ s: State) -> String {
        if s.unread { return Words.savedUnread }
        if s.industry != nil { return Words.savedShown }
        guard let n = s.unreachable else { return Words.savedLater }
        return Words.savedOff(unreachable: n)
    }
    // Whether a note is a refusal (kept beside a re-read that cannot be read), not a "Saved." line.
    static func isRefusal(_ note: String) -> Bool { !note.hasPrefix("Saved") }
    // A refused save: the board's sentence, else the page's.
    static func refused(status: Int, data: Data?) -> String {
        guard let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let e = o["error"] as? String, !e.isEmpty else { return Words.saveFailed }
        return e
    }

    // MARK: Requests, each route on its own line (server.ios-routes-6838.test.js reads them)

    private static func sign(_ r: inout URLRequest, _ mac: Settings.Mac) {
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.timeoutInterval = 15
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
    }
    static func readRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/community-industry", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        return r
    }
    static func saveRequest(_ mac: Settings.Mac, key: String) -> URLRequest? {
        guard key != unknownKey else { return nil }   // the unread entry saves nothing
        var r = URLRequest(url: URL(string: "/api/community-industry", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "PUT"
        sign(&r, mac)
        let body: [String: Any] = ["industry": key == noneKey ? NSNull() : key]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        r.httpBody = data
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return r
    }

    // A sample build's computer: nothing picked, two choices, one picture the community shut out.
    static let sample = #"{"industry":null,"ok":true,"industries":[{"key":"software","label":"Software","display":"Software and apps"},{"key":"publishing","label":"Publishing"}],"unreachable":0,"picturesStuck":1,"picturesUnsendable":0,"picturesToFit":[]}"#
}
