import Foundation

// kosmos#8959 slice D1d2b: Community's held posts ("Waiting for you"), native under the Community box on the phone's
// Automation screen. UIKit-free, so ios/LogicTests/run-held.sh runs it on a Mac.
//
// The board's page (web/index.html: refreshCommunityHeld, communityHeldPaint, communityHeldTitle, communityHeldReason,
// communityHeldRelease, openCommunityDiscard) reads GET /api/community/moderation?status=held and ?status=quarantined
// (limit 200 each, the releasable rows first), and releases or discards one row with POST /api/community/release and
// /api/community/discard { id }. Both writes are person-only by the board's isViaScreen, which the phone's header passes
// (measured in slice D1a); neither is on the remote step-up list. Releasing is public and cannot be taken back, so the
// phone keeps every sentence the page puts around it, and the page's own ask in front of Discard.
enum Held {
    enum Words {
        static let heading = "Waiting for you"
        static let empty = "Nothing is waiting for you."
        static let unread = "We could not read what is waiting for you just now. Try again in a moment."
        static let release = "Release"
        static let discard = "Discard"
        static let releasing = "Releasing…"
        static let discarding = "Discarding…"
        static let releaseFailed = "We could not release it."
        static let discardFailed = "We could not discard it."
        static let finishFailed = "Kosmos could not finish that."
        static let whereNow = " The list below shows where it stands now."
        static let askPost = "It never goes to the community, and it cannot be brought back. Any comments on it go with it."
        static let askComment = "It never goes to the community, and it cannot be brought back."
        static let keep = "Keep it"
        static let discardIt = "Discard it"
        static let show = "Show what it said"
        static let hide = "Hide what it said"
        static let readAll = "Read all"
        static let readLess = "Read less"
        static let seePost = "See the post it answers"
        static let stoppedState = "Stopped by the safety check"
        static let waiting = "Waiting for you"
        static let waitingRelease = "Waiting for you to release it"
        static let underStopped = ". Its post was stopped by the safety check, so this comment can only be discarded; discarding the post takes it too."
        static let underHeld = ". Its post is waiting in this list too: release the post first, then this comment."
        static let notSent = ". Its agent was deleted, so releasing it never sends it to the public community."
        static let policyKept = ". Releasing it keeps it on this computer: it is not sent to the community, now or later."
        static let remoteComment = ". Releasing it while Community is on sends it to the public community. Once sent, it can be removed from the list below only if the community answered the send. Released while Community is off, it is never sent."
        static let commentsNotSent = ". Comments are not sent to the community yet."
        static let heldOff = "The community switch is off, so a post or comment you release now stays on this computer and is not sent to the community, even after you turn it on."
        static func heldPolicy(_ stopped: String) -> String { "A post or comment you release now stays on this computer and is not sent to the community. " + stopped }
        static func onlyOldest(held: Bool, stopped: Bool) -> String {
            let which = held && stopped ? "waiting and the oldest \(max) stopped" : held ? "waiting" : "stopped"
            return "Only the oldest \(max) " + which + " are shown. There may be more; they show here as you release or discard these."
        }
    }
    static let max = 200            // COMMUNITY_HELD_MAX
    static let readAllChars = 240   // COMMUNITY_HELD_READ_ALL_CHARS: past this, the words are clamped with Read all
    static let clampLines = 4       // COMMUNITY_HELD_CLAMP_LINES
    static let labelChars = 40      // COMMUNITY_HELD_LABEL_CHARS
    static let site = "https://community.kosmosplus.com"   // COMMUNITY_SITE

    struct Row: Equatable, Identifiable {
        var id: String
        var status: String          // "held" or "quarantined"
        var entry: String?          // "post" or "comment"; an older board leaves it out
        var postId: String?, remotePostId: String?
        var author: String?, agent: String?
        var topic: String?, body: String?
        var findings: [String]      // each finding's cls
        var notSent: Bool
        var stopped: Bool { status == "quarantined" }
        // communityHeldIsComment: the entry, else (an older board) a comment's routing fields.
        var isComment: Bool { entry.map { $0 == "comment" } ?? (postId != nil || remotePostId != nil) }
        var who: String { author.flatMap { $0.isEmpty ? nil : $0 } ?? agent ?? "" }
    }

    private static func text(_ v: Any?) -> String? { (v as? String).flatMap { $0.isEmpty ? nil : $0 } }
    static func queue(status: Int, data: Data?) -> [Row]? {
        guard status == 200, let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let q = o["queue"] as? [Any] else { return nil }
        return q.compactMap { x in
            guard let r = x as? [String: Any], let id = text(r["id"]), let st = text(r["status"]) else { return nil }
            return Row(id: id, status: st, entry: text(r["entry"]), postId: text(r["postId"]), remotePostId: text(r["remotePostId"]),
                       author: text((r["author"] as? [String: Any])?["name"]), agent: text(r["agent"]),
                       topic: r["topic"] as? String, body: r["body"] as? String,
                       findings: ((r["findings"] as? [Any]) ?? []).compactMap { ($0 as? [String: Any]).flatMap { text($0["cls"]) } },
                       notSent: r["notSent"] as? Bool == true)
        }
    }
    // refreshCommunityHeld: both reads must answer; the releasable rows first.
    struct Read: Equatable { var rows: [Row]; var fullHeld: Bool; var fullStopped: Bool }
    static func read(held: [Row]?, stopped: [Row]?) -> Read? {
        guard let held, let stopped else { return nil }
        return Read(rows: held + stopped, fullHeld: held.count >= max, fullStopped: stopped.count >= max)
    }

    // communityHeldReason
    static func reason(_ findings: [String]) -> String {
        let said: [String: String] = [
            "secret_token": "what looks like a password or key", "high_entropy": "what looks like a password or key",
            "email": "an email address", "phone": "a phone number", "ssn": "an ID number", "card": "a card number",
            "home_path": "a folder path that names someone on this computer", "financial": "an amount of money",
            "human_name": "a person’s name", "bad_link": "a link Kosmos does not allow",
        ]
        var seen: [String] = []
        for f in findings { if let w = said[f], !seen.contains(w) { seen.append(w) } }
        let next = " Discard it, and the agent can write it again without that."
        if seen.isEmpty { return "Kosmos stopped this because it did not pass the safety check, so it cannot be released." + next }
        let list = seen.count == 1 ? seen[0] : seen.dropLast().joined(separator: ", ") + " and " + seen.last!
        return "Kosmos stopped this because it contains " + list + ", so it cannot be released." + next
    }

    // communityHeldTitle
    static func title(_ r: Row) -> String {
        if r.stopped { return (r.isComment ? "A comment" : "A post") + (r.who.isEmpty ? "" : " by " + r.who) }
        if r.isComment { return r.who.isEmpty ? "A comment" : "A comment by " + r.who }
        return r.topic.flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled post"
    }

    // One row as the page draws it.
    struct Shown: Equatable, Identifiable {
        var id: String
        var title: String
        var label: String           // what the buttons name it as (a stopped row by its place, never its words)
        var words: String           // its words (a stopped post's topic first); hidden until asked for when stopped
        var meta: String            // the agent and the state line
        var why: String?            // a stopped row's reason
        var canRelease: Bool
        var isComment: Bool
        var stopped: Bool
        var postLink: URL?          // a comment on a community post: "See the post it answers"
        var long: Bool              // over the clamp: Read all
    }
    static func shown(_ rows: [Row], policyStopped: String?) -> [Shown] {
        let heldPosts = Set(rows.filter { $0.status == "held" && !$0.isComment }.map(\.id))
        let stoppedPosts = Set(rows.filter { $0.status == "quarantined" && !$0.isComment }.map(\.id))
        return rows.enumerated().map { at, r in
            let name = title(r)
            let said = (r.body ?? "").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            let label = r.stopped ? name + " (row \(at + 1))"
                : r.isComment && !said.isEmpty ? name + ": " + (said.count > labelChars ? String(said.prefix(labelChars)) + "…" : said) : name
            let underHeld = r.isComment && !r.stopped && r.postId.map(heldPosts.contains) == true
            let underStopped = r.isComment && !r.stopped && r.postId.map(stoppedPosts.contains) == true
            let state = r.stopped ? Words.stoppedState : (underStopped || underHeld) ? Words.waiting : Words.waitingRelease
            var meta = [r.who, state].filter { !$0.isEmpty }.joined(separator: " · ")
            if underStopped { meta += Words.underStopped }
            else if underHeld { meta += Words.underHeld }
            else if r.notSent && !r.stopped { meta += Words.notSent }
            else if policyStopped != nil && !r.stopped { meta += Words.policyKept }
            else if r.isComment && !r.stopped && r.postId == nil, let rp = r.remotePostId, !rp.isEmpty { meta += Words.remoteComment }
            else if r.isComment && !r.stopped { meta += Words.commentsNotSent }
            let words = (r.stopped && !r.isComment && !(r.topic ?? "").isEmpty ? r.topic! + "\n" : "") + (r.body ?? "")
            var link: URL?
            if r.postId == nil, let rp = r.remotePostId, rp.range(of: #"^[0-9a-f-]{8,64}$"#, options: [.regularExpression, .caseInsensitive]) != nil {
                link = URL(string: site + "/post/" + (rp.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? rp))
            }
            return Shown(id: r.id, title: name, label: label, words: words, meta: meta, why: r.stopped ? reason(r.findings) : nil,
                         canRelease: !r.stopped && !underHeld && !underStopped, isComment: r.isComment, stopped: r.stopped,
                         // As the page: Read all past 240 characters OR past the clamp's 4 lines, so no words are
                         // ever cut off unseen above a Release that cannot be taken back.
                         postLink: link, long: words.count > readAllChars || words.split(separator: "\n", omittingEmptySubsequences: false).count > clampLines)
        }
    }

    // The list's own lines: the off or policy line (communityPaint), and "Only the oldest ..." under a full read.
    static func offLine(on: Bool?, policyStopped: String?) -> String? {
        if let p = policyStopped { return Words.heldPolicy(p) }
        return on == false ? Words.heldOff : nil
    }
    static func listLine(_ r: Read?) -> String? {
        guard let r else { return Words.unread }
        if r.fullHeld || r.fullStopped { return Words.onlyOldest(held: r.fullHeld, stopped: r.fullStopped) }
        return r.rows.isEmpty ? Words.empty : nil
    }

    // What a release or discard said. A 5xx is the page's "could not finish", said where the list says things, and
    // the list is read again; another refusal is the board's sentence on the row.
    enum Outcome: Equatable { case done, refused(String), unfinished(String) }
    static func outcome(status: Int, data: Data?, releasing: Bool) -> Outcome {
        if (200..<300).contains(status) { return .done }
        let said = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }.flatMap { text($0["error"]) }
        // A 5xx, or no answer at all (it may have landed after the phone gave up): the list is read again.
        if releasing && (status >= 500 || status == 0) { return .unfinished((said ?? Words.finishFailed) + Words.whereNow) }
        // A discard with no answer may have landed too: the list is read again, and the row says it could not tell.
        if !releasing && status == 0 { return .unfinished(Words.discardFailed + Words.whereNow) }
        return .refused(said ?? (releasing ? Words.releaseFailed : Words.discardFailed))
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
    static func queueRequest(_ mac: Settings.Mac, stopped: Bool) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/community/moderation?status=" + (stopped ? "quarantined" : "held") + "&limit=\(max)", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        return r
    }
    private static func post(_ r: inout URLRequest, _ mac: Settings.Mac, id: String) {
        sign(&r, mac)
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["id": id])
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    static func releaseRequest(_ mac: Settings.Mac, id: String) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/community/release", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "POST"
        post(&r, mac, id: id)
        return r
    }
    static func discardRequest(_ mac: Settings.Mac, id: String) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/community/discard", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "POST"
        post(&r, mac, id: id)
        return r
    }

    // A sample build's computer: one post waiting, and one stopped for an email address.
    static let sampleHeld = #"{"queue":[{"id":"p1","status":"held","entry":"post","author":{"name":"Dana"},"topic":"What we shipped this week","body":"Three small fixes and one new screen."}]}"#
    static let sampleStopped = #"{"queue":[{"id":"p2","status":"quarantined","entry":"post","agent":"eli","topic":"Notes","body":"Mail me at someone@example.com","findings":[{"cls":"email"}]}]}"#
}
