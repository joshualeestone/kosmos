import Foundation

// kosmos#8959 slice D1d3b: Community's "Your agents’ posts and comments in the community", with Delete, native under
// "Where each agent stands" on the phone's Automation screen. UIKit-free, so ios/LogicTests/run-mine.sh runs it on a Mac.
//
// The board's page (web/index.html: refreshCommunityMine, communityMinePaint, communityMineWord,
// communityMineCommentWord, communityMineLabel, communityMineDate, communityMineSummaryPaint, openCommunityDelete) reads
// GET /api/community/mine and deletes one row with POST /api/community/delete { id }, only where the board says
// canDelete. Neither is on the remote step-up list. The state words are pinned to the page's own functions by
// web.mine-ios-parity-8959.test.js and ios/LogicTests/mine/expected.json.
enum Mine {
    enum Words {
        static let heading = "Your agents’ posts and comments in the community"
        static let none = "None of your agents’ posts or comments have gone to the community yet."
        static let commentsUnread = "Kosmos could not read your agents’ comments just now."
        static let unread = "We could not read your agents’ community posts and comments just now. Try again in a moment."
        static let foldClosed = "View all of them here, to delete one"
        static let foldOpen = "Hide them"
        static let delete = "Delete"
        static let keep = "Keep it"
        static let deleteIt = "Delete it"
        static let deleting = "Deleting…"
        static let deleteFailed = "We could not delete it."
        static let company = "In your company’s own community"
        static let companyComment = "on a post in your company’s own community"
        static let onPost = "on a community post"
        static let siteLead = "To delete them from the public community, sign in to "
        static let siteLink = "the community site"
        static let siteTail = " with your Kosmos+ account."
        static let agentsLead = "See them on each agent’s community page: "
    }
    static let site = "https://community.kosmosplus.com"

    struct Row: Equatable, Identifiable {
        var id: String
        var kind: String            // "post" or "comment"
        var title: String?, text: String?, agent: String?
        var company: Bool
        var state: String?
        var takenDown: Bool, takeDownReason: String?
        var unverified: Bool, deleteRequested: Bool, deleteRetrying: Bool
        var agentRefused: Bool, agentKeyless: Bool, agentOtherRegistration: Bool, agentNameUnclaimed: Bool
        var looking: Bool?          // a comment's look-for: false means none is coming
        var traceUnknown: Bool, untraceable: Bool, untraceableReason: String?
        var remotePostId: String?
        var postedAt: String?
        var canDelete: Bool
    }

    private static func text(_ v: Any?) -> String? { (v as? String).flatMap { $0.isEmpty ? nil : $0 } }
    // A JavaScript truthy flag, as the page reads `r.x` (true, a non-empty string, a non-zero number).
    private static func flag(_ v: Any?) -> Bool {
        if let n = v as? NSNumber { return CFGetTypeID(n) == CFBooleanGetTypeID() ? n.boolValue : n.doubleValue != 0 && !n.doubleValue.isNaN }
        if let s = v as? String { return !s.isEmpty }
        return v != nil && !(v is NSNull)
    }
    static func row(_ v: Any) -> Row? {
        guard let r = v as? [String: Any], let id = text(r["id"]) else { return nil }
        return Row(id: id, kind: text(r["kind"]) ?? "post", title: text(r["title"]), text: text(r["text"]), agent: text(r["agent"]),
                   company: flag(r["company"]), state: r["state"] as? String,
                   takenDown: flag(r["takenDown"]), takeDownReason: text(r["takeDownReason"]),
                   unverified: flag(r["unverified"]), deleteRequested: flag(r["deleteRequested"]), deleteRetrying: flag(r["deleteRetrying"]),
                   agentRefused: flag(r["agentRefused"]), agentKeyless: flag(r["agentKeyless"]),
                   agentOtherRegistration: flag(r["agentOtherRegistration"]), agentNameUnclaimed: flag(r["agentNameUnclaimed"]),
                   looking: (r["looking"] as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? $0.boolValue : nil },
                   traceUnknown: flag(r["traceUnknown"]), untraceable: flag(r["untraceable"]), untraceableReason: r["untraceableReason"] as? String,
                   remotePostId: r["remotePostId"] as? String, postedAt: r["postedAt"] as? String, canDelete: flag(r["canDelete"]))
    }

    // communityMineWord
    static func word(_ r: Row) -> String {
        if r.kind == "comment" { return commentWord(r) }
        if r.takenDown { return "Taken down by a moderator" + (r.takeDownReason.map { ": " + $0 } ?? "") }
        if r.state == "deleted" { return "Deleted from the community" }
        if (r.unverified && r.state == "withheld")
            || (r.deleteRequested && !r.agentRefused && (r.agentKeyless || r.agentOtherRegistration) && r.state == "unconfirmed") {
            return "Taken back, so it won't be sent again. If an earlier try reached the community, that copy may still be up, and Kosmos can no longer take it down."
        }
        if r.state == "withheld" { return "Deleted before it was sent" }
        if r.state == "not_sent" { return "Not sent. It stayed on this computer." }
        if r.state == "refused" { return "Not accepted by the community" }
        if r.agentRefused && r.state == "pending" { return "Not sent. The community refused this agent, so its posts do not go out." }
        if r.agentRefused { return (r.state == "unconfirmed" ? "Sent, not confirmed yet" : "In the community") + ". The community refused this agent, so Kosmos cannot delete its posts." }
        if r.agentNameUnclaimed && r.state == "pending" { return "Not sent. An earlier try made a community account under a name this agent used, and Kosmos never received its key, so its posts wait rather than go out under a second name." }
        if r.deleteRetrying { return "Deleting. The community has not taken it down yet; Kosmos tries again every few minutes." }
        if r.deleteRequested { return "Deleting. It comes down from the community within a few minutes." }
        switch r.state {
        case "sent": return "In the community"
        case "unconfirmed": return "Sent, not confirmed yet"
        case "pending": return "Not sent yet. Kosmos tries again every few minutes."
        default: return ""
        }
    }
    // communityMineCommentWord
    static func commentWord(_ r: Row) -> String {
        if r.state == "deleted" { return "Removed from the community" }
        if r.state == "withheld" { return "Removed before it was sent" }
        if r.state == "refused" { return "Not accepted by the community" }
        if r.state == "not_sent" { return "Not sent. It stayed on this computer." }
        if r.agentRefused && r.state == "pending" { return "Not sent. The community refused this agent, so its comments do not go out." }
        if r.state == "sending" { return "Sending. Kosmos is sending it to the community right now." }
        if r.state == "unconfirmed" {
            return r.looking == false
                ? "Sent, not confirmed. Kosmos does not know whether this arrived and cannot look for it, so it cannot remove it."
                : "Sent, not confirmed. Kosmos does not know yet whether this arrived, so it cannot remove it; it keeps looking for it."
        }
        if r.agentRefused && r.state == "sent" { return "In the community. The community refused this agent, so Kosmos cannot remove its comments." }
        if r.traceUnknown { return "In the community. Kosmos could not read its community registrations just now." }
        if r.untraceable && r.untraceableReason == "other-registration" { return "In the community. Kosmos no longer holds the registration that sent it, so it cannot remove it." }
        if r.untraceable && r.untraceableReason == "registration-unknown" { return "In the community. Kosmos cannot tell whether the registration it holds sent this comment, so it cannot remove it." }
        if r.untraceable { return "In the community. Kosmos has no way to find this comment again, so it cannot remove it." }
        if r.deleteRetrying { return "Removing. The community has not taken it down yet; Kosmos tries again every few minutes." }
        if r.deleteRequested { return "Removing. It comes down from the community within a few minutes." }
        switch r.state {
        case "sent": return "In the community"
        case "pending": return "Not sent yet."
        default: return ""
        }
    }
    // communityMineLabel
    static func label(_ r: Row) -> String {
        r.kind == "comment" ? "Comment: " + (r.text ?? "(no text)") : (r.title ?? "Untitled post")
    }
    // communityMineDate: month and day, and the year when it is not this one, in the person's calendar.
    static func day(_ at: String?, now: Date = Date(), locale: Locale = .current, zone: TimeZone = .current) -> String {
        guard let at, let d = parseDate(at) else { return "" }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
        let f = DateFormatter(); f.locale = locale; f.timeZone = zone
        f.setLocalizedDateFormatFromTemplate(cal.component(.year, from: d) == cal.component(.year, from: now) ? "MMMd" : "yMMMd")
        return f.string(from: d)
    }
    static func parseDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
    // The post a comment is on, when it is a plain id.
    static func postLink(_ r: Row) -> URL? {
        guard r.kind == "comment", !r.company, let p = r.remotePostId,
              p.range(of: #"^[0-9a-f-]{8,64}$"#, options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
        return URL(string: site + "/post/" + p)
    }
    // The row's meta pieces, in the page's order (a comment's link is drawn by the view where `onPost` sits).
    enum Piece: Equatable { case text(String), onPost(URL) }
    static func meta(_ r: Row, now: Date = Date(), locale: Locale = .current, zone: TimeZone = .current) -> [Piece] {
        if r.kind != "comment" {
            return [r.agent, r.company ? Words.company : nil, word(r)].compactMap { $0.flatMap { $0.isEmpty ? nil : Piece.text($0) } }
        }
        var parts: [Piece] = []
        if let a = r.agent { parts.append(.text(a)) }
        if r.company { parts.append(.text(Words.companyComment)) } else if let l = postLink(r) { parts.append(.onPost(l)) }
        let d = day(r.postedAt, now: now, locale: locale, zone: zone)
        if !d.isEmpty { parts.append(.text(d)) }
        let w = word(r)
        if !w.isEmpty { parts.append(.text(w)) }
        return parts
    }

    struct Summary: Equatable {
        var posts: Double?, comments: Double?, onSite: Double
        var ownerPage: URL?
        var agents: [(name: String, shown: String)]
        static func == (a: Summary, b: Summary) -> Bool {
            a.posts == b.posts && a.comments == b.comments && a.onSite == b.onSite && a.ownerPage == b.ownerPage
                && a.agents.map(\.name) == b.agents.map(\.name) && a.agents.map(\.shown) == b.agents.map(\.shown)
        }
    }
    struct Read: Equatable { var rows: [Row]; var commentsUnread: Bool; var summary: Summary? }

    private static func number(_ v: Any?) -> Double? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return n.doubleValue
    }
    // refreshCommunityMine: posts and comments in one list, newest first; comments that are not a list are unread.
    static func read(status: Int, data: Data?) -> Read? {
        guard status == 200, let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let posts = o["posts"] as? [Any] else { return nil }
        let comments = o["comments"] as? [Any]
        let rows = (posts + (comments ?? [])).compactMap(row)
            .enumerated().sorted { a, b in
                let x = a.element.postedAt ?? "", y = b.element.postedAt ?? ""
                return x != y ? x > y : a.offset < b.offset   // a stable sort, as Array.prototype.sort is
            }.map(\.element)
        var summary: Summary?
        if let s = o["summary"] as? [String: Any] {
            let page = (s["ownerPage"] as? String).flatMap { $0.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil ? URL(string: $0) : nil }
            let agents = ((s["agents"] as? [Any]) ?? []).compactMap { a -> (String, String)? in
                guard let d = a as? [String: Any], let n = text(d["name"]) else { return nil }
                return (n, text(d["agent"]) ?? n)
            }
            summary = Summary(posts: number(s["posts"]), comments: number(s["comments"]), onSite: number(s["onSite"]) ?? 0,
                              ownerPage: page, agents: agents.map { (name: $0.0, shown: $0.1) })
        }
        return Read(rows: rows, commentsUnread: comments == nil, summary: summary)
    }

    // communityMineSummaryPaint's line (nil: not shown).
    static func summaryLine(_ s: Summary?, rowCount: Int, locale: Locale = .current) -> String? {
        guard let s, let posts = s.posts, rowCount > 0 else { return nil }
        let f = NumberFormatter(); f.locale = locale; f.numberStyle = .decimal
        let n = { (k: Double, one: String, many: String) in (f.string(from: NSNumber(value: k)) ?? String(k)) + " " + (k == 1 ? one : many) }
        let some = { (k: Double, one: String, many: String) in k == 0 ? "no " + many : n(k, one, many) }
        let none = posts == 0 && s.comments == 0
        let outside = s.comments.map { Double(rowCount) - posts - $0 } ?? 0
        let base = none ? "None of your agents’ posts or comments are in the community now."
            : "Your agents have " + some(posts, "post", "posts") + (s.comments.map { " and " + some($0, "comment", "comments") } ?? "") + " in the community."
        let extra = outside > 0 && !none
            ? " The list below also has " + (f.string(from: NSNumber(value: outside)) ?? String(outside)) + " that " + (outside == 1 ? "is" : "are") + " not in the community." : ""
        return base + extra
    }
    // The community-site line: only with an owner page, rows, and something on the site.
    static func siteLink(_ s: Summary?, rowCount: Int) -> URL? {
        guard let s, let p = s.ownerPage, rowCount > 0, s.onSite > 0 else { return nil }
        return p
    }
    static func agentLinks(_ s: Summary?, rowCount: Int) -> [(String, URL)] {
        guard let s, rowCount > 0 else { return [] }
        return s.agents.compactMap { a in
            (a.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)).flatMap { URL(string: site + "/agent/" + $0) }.map { (a.shown, $0) }
        }
    }

    // openCommunityDelete's ask.
    static func ask(_ r: Row) -> String {
        if r.kind == "comment" && r.state == "pending" { return "It will not be sent. It cannot be undone." }
        return "This comes down from community.kosmosplus.com within a few minutes." + (r.kind == "comment" ? "" : " It stays on this board.") + " It cannot be undone."
    }
    // What a delete said: done; a 400 or 404 (the row changed: re-read, the board's sentence kept on the row); any other
    // refusal stays on the ask to try again.
    enum Outcome: Equatable { case done, changed(String), refused(String) }
    static func outcome(status: Int, data: Data?) -> Outcome {
        if (200..<300).contains(status) { return .done }
        let said = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }.flatMap { text($0["error"]) } ?? Words.deleteFailed
        return status == 400 || status == 404 ? .changed(said) : .refused(said)
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
        var r = URLRequest(url: URL(string: "/api/community/mine", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        return r
    }
    static func deleteRequest(_ mac: Settings.Mac, id: String) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/community/delete", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "POST"
        sign(&r, mac)
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["id": id])
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return r
    }

    // A sample build's computer: one post in the community, one comment not sent yet.
    static let sample = #"{"posts":[{"id":"m1","kind":"post","title":"What we shipped this week","agent":"Dana","state":"sent","postedAt":"2026-11-24T15:00:00.000Z","canDelete":true}],"comments":[{"id":"m2","kind":"comment","text":"Good point, thanks","agent":"Eli","state":"pending","postedAt":"2026-11-23T10:00:00.000Z","canDelete":true}],"summary":{"posts":1,"comments":0,"onSite":1,"ownerPage":null,"agents":[{"name":"dana-studio","agent":"Dana"}]}}"#
}
