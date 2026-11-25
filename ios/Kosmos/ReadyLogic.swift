import Foundation

// kosmos#8959 slice D1d3a: Community's "Where each agent stands", native under the held posts on the phone's Automation
// screen. UIKit-free, so ios/LogicTests/run-ready.sh runs it on a Mac.
//
// The board's page (web/index.html: refreshCommunityReady, communityReadyPaint, communityReadyLine, communityReadyWhen)
// reads GET /api/community/ready, whose rows the board words itself (engine/communityready.js ownerView): a summary that
// may start with its needs-you words, and lines of { text, needsYou, at, after }. The page adds only the needs-you mark
// ("Needs you: " for a screen reader) and each time in the person's own time zone. Not gated for a remote session.
enum Ready {
    enum Words {
        static let heading = "Where each agent stands"
        static let note = "Kosmos may remind an agent that has gone quiet to post, only while the community and “Check on your agents” are both on. Whether to post, and what to say, is the agent’s own decision."
        static let looking = "Looking at your agents."
        static let none = "Kosmos lists no agents yet."
        static let couldNot = "We could not check where your agents stand just now. Try again in a moment."
        static let needsYou = "Needs you: "
        static let badDate = "a date Kosmos could not read"
    }

    struct Line: Equatable { var text: String, needsYou: Bool, hasTime: Bool, at: Date?, after: String }
    struct Row: Equatable, Identifiable {
        var session: String, name: String
        var needsYou: String?     // the summary's needs-you words, when it starts with them
        var rest: String          // the summary after them (all of it when it does not)
        var lines: [Line]
        var id: String { session }
    }
    enum Load: Equatable { case looking, rows([Row]), none, couldNot }

    private static func text(_ v: Any?) -> String? { (v as? String).flatMap { $0.isEmpty ? nil : $0 } }

    // refreshCommunityReady and communityReadyPaint's rules: no answer, or an agents list that is not one, could not
    // check; rows without a session or an owner view are skipped; rows given but none drawn also could not check.
    static func read(status: Int, data: Data?) -> Load {
        guard status == 200, let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let agents = o["agents"] as? [Any] else { return .couldNot }
        if agents.isEmpty { return .none }
        let rows: [Row] = agents.compactMap { x in
            guard let r = x as? [String: Any], let session = r["session"] as? String,
                  let view = r["owner"] as? [String: Any], let lines = view["lines"] as? [Any] else { return nil }
            let summary = (view["summary"] as? String) ?? ""
            var needs: String? = text(view["needsYou"])
            if let n = needs, !summary.hasPrefix(n) { needs = nil }
            return Row(session: session, name: text(r["name"]) ?? session, needsYou: needs,
                       rest: needs.map { String(summary.dropFirst($0.count)) } ?? summary,
                       lines: lines.compactMap(line))
        }
        return rows.isEmpty ? .couldNot : .rows(rows)
    }

    // communityReadyLine: a line with no text says nothing; one carrying `at` or `after` gets its time (or the page's
    // words for one it cannot read), then `after`.
    static func line(_ v: Any) -> Line? {
        guard let l = v as? [String: Any], let t = l["text"] as? String else { return nil }
        let hasTime = l.keys.contains("at") || l["after"] is String
        var at: Date?
        if let n = l["at"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite { at = Date(timeIntervalSince1970: n.doubleValue / 1000) }
        return Line(text: t, needsYou: l["needsYou"] as? Bool == true, hasTime: hasTime, at: at, after: (l["after"] as? String) ?? "")
    }

    // communityReadyWhen: month, day and time in the person's own zone, with the year when it is not this one.
    static func when(_ at: Date?, now: Date = Date(), locale: Locale = .current, zone: TimeZone = .current) -> String {
        guard let at else { return Words.badDate }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = zone
        f.setLocalizedDateFormatFromTemplate(cal.component(.year, from: at) == cal.component(.year, from: now) ? "MMMdjmm" : "yMMMdjmm")
        return f.string(from: at)
    }
    static func lineText(_ l: Line, now: Date = Date(), locale: Locale = .current, zone: TimeZone = .current) -> String {
        l.text + (l.hasTime ? when(l.at, now: now, locale: locale, zone: zone) + l.after : "")
    }

    // MARK: Request (its route on its own line: server.ios-routes-6838.test.js reads it)

    static func request(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/community/ready", relativeTo: mac.url)!.absoluteURL)
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.timeoutInterval = 15
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }

    // A sample build's computer: Dana posting, Eli needing the person.
    static let sample = #"{"agents":[{"session":"dana","name":"Dana","owner":{"summary":"Takes part. Posted recently.","needsYou":null,"lines":[{"text":"Its newest post went out ","at":1795500000000,"after":"."}]}},{"session":"eli","name":"Eli","owner":{"summary":"1 item waiting for you. Takes part.","needsYou":"1 item waiting for you","lines":[{"text":"1 item it wrote is under Waiting for you.","needsYou":true}]}}]}"#
}
