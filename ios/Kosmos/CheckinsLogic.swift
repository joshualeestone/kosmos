import Foundation

// kosmos#8959 slice D1d1: the Prompter's check-ins, native under the Prompter box on the phone's Automation screen.
// UIKit-free, so ios/LogicTests/run-checkins.sh runs it on a Mac.
//
// The board's page (web/index.html #hb-nudges: paintPrompterNudges, prompterCheckinQuestion) reads GET
// /api/prompter-nudges, which carries only { session, from, to } per stalled agent, and composes each question itself;
// for a lost connection it words the question by the agent's reconnect phase, read from /api/status. Any failure hides
// the list (a missed check-in is only a missed check-in; the board's own status still shows the truth). Neither route is
// gated for a remote session.
enum Checkins {
    enum Words {
        static let heading = "Agents that may need you"
        static let signIn = "needs to sign in again. Reconnect it, or is it done?"
        static let reconnecting = "lost its connection, and Kosmos is reconnecting it. Is it done, or still mid-something?"
        static let gaveUp = "lost its connection, and Kosmos stopped trying. Restart it, or is it done?"
        static let lost = "lost its connection. Reconnect it, or is it done?"
        static let quiet = "seems to have gone quiet. Still mid-something, finished, or stopped?"
    }

    struct Nudge: Equatable { var session: String, to: String? }
    struct Row: Equatable, Identifiable { var session: String, question: String; var id: String { session } }

    // GET /api/prompter-nudges. Nil for any failure: the page hides the list then.
    static func nudges(status: Int, data: Data?) -> [Nudge]? {
        guard status == 200, let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return ((o["nudges"] as? [Any]) ?? []).compactMap { x in
            guard let n = x as? [String: Any], let s = n["session"] as? String, !s.isEmpty else { return nil }
            return Nudge(session: s, to: n["to"] as? String)
        }
    }

    // Each agent's reconnect phase, from /api/status's agents (sessionName, reconnect.phase).
    static func phases(status: Int, data: Data?) -> [String: String] {
        guard status == 200, let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let all = o["agents"] as? [Any] else { return [:] }
        var out: [String: String] = [:]
        for case let r as [String: Any] in all {   // an entry that is not an object is skipped, not the whole list
            if let s = r["sessionName"] as? String, let p = (r["reconnect"] as? [String: Any])?["phase"] as? String { out[s] = p }
        }
        return out
    }

    // prompterCheckinQuestion
    static func question(_ n: Nudge, phase: String?) -> String {
        switch n.to {
        case "auth_failed": return Words.signIn
        case "connection_lost":
            if phase == "waiting" || phase == "retried" { return Words.reconnecting }
            if phase == "gave_up" { return Words.gaveUp }
            return Words.lost
        default: return Words.quiet
        }
    }
    static func needsPhases(_ ns: [Nudge]) -> Bool { ns.contains { $0.to == "connection_lost" } }
    static func rows(_ ns: [Nudge], phases: [String: String]) -> [Row] {
        ns.map { Row(session: $0.session, question: question($0, phase: phases[$0.session])) }
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
    static func nudgesRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/prompter-nudges", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        return r
    }
    static func statusRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/status", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        return r
    }

    // The agent a row opens, as a push tap names it: the computer's address and the agent's session.
    static func target(_ mac: Settings.Mac, session: String) -> PushBridge.AgentTarget? {
        guard let host = mac.url.host?.lowercased(), !host.isEmpty, PushBridge.isAgentSession(session) else { return nil }
        // Named as a push tap names an agent it has no name for: the session, capitalised.
        return PushBridge.AgentTarget(host: host, session: session, name: session.prefix(1).uppercased() + session.dropFirst())
    }

    // A sample build's computer: one agent gone quiet, one whose connection Kosmos gave up on.
    static let sampleNudges = #"{"at":"2026-11-25T08:00:00.000Z","ok":true,"nudges":[{"session":"dana","from":"working","to":"idle"},{"session":"eli","from":"working","to":"connection_lost"}]}"#
    static let samplePhases = ["eli": "gave_up"]
}
