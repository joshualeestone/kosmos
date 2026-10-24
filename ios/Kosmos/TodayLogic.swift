import Foundation

// kosmos#7030 (the iPhone plan's slice 4, #6838): the native Today tab's logic, built to Mona Lisa's slice 4 spec
// (24 Oct). Today gathers what needs the person into one look and says what the board says: who needs you and why,
// what an agent marked built, and who is working. What to show and in which order is decided here, apart from the
// view, so the logic tests can check it.
extension Board {
    // The one button on a needs-you card. Both open that agent's native chat (slice 3b): the choice is made there.
    enum TodayAction: Equatable { case answer, open
        var title: String { self == .answer ? "Answer" : "Open" }
    }

    // The board's own sentence and button for each reason the Mac sends (engine/cardlabel.js reasonOf), as the spec's
    // table words them: PJ_NEEDS_WHY's words, pjAlsoWhy's for a failed restart, and the spec's own for a permission
    // prompt and a wait read off the screen. A reason the phone does not know (one the Mac adds later), or none (a
    // Mac older than #7030), is worded generally, never as a question.
    static let todayWhy: [String: (String, TodayAction)] = [
        "question": ("Waiting for your answer.", .answer),
        "permission": ("Waiting for you to allow or deny something.", .answer),
        "waiting": ("Waiting for you. Open it to see what it shows.", .open),
        "restart_failed": ("Kosmos restarted it, and it did not come back.", .open),
        "trust": ("Waiting for you to approve it before it can start.", .open),
        "gave_up": ("Lost its connection, and Kosmos stopped trying to reconnect it.", .open),
        "crash_loop": ("Kosmos keeps restarting it, and it keeps stopping within a couple of minutes.", .open),
        "stuck_auth": ("Kosmos has seen it unable to sign in for a while. It cannot work until its account is reconnected.", .open),
        "stuck_rate": ("Kosmos has seen it paused by a rate limit for a while. It carries on when the limit lifts, or you can switch its model.", .open),
        "own_bound": ("Kosmos tried to get it going (a nudge, or a resume after its quota reset) and gave up. Open it to see what it shows.", .open),
        "other": ("Kosmos needs you to look at it.", .open),
    ]

    static func todayReason(_ agent: Agent) -> (sentence: String, action: TodayAction) {
        let (sentence, action) = todayWhy[agent.needsReason ?? "other"] ?? todayWhy["other"]!
        return (sentence, action)
    }

    // A task an agent marked built (the board's "Built but waiting"), from `GET /api/tasks?view=tasks`.
    struct ReadyTask: Equatable, Identifiable {
        let projectId: String
        let projectName: String
        let number: Int
        let sentence: String
        let builtAt: Date?
        // The agent's session name, or nil when the person marked it (builtByPerson) or nobody is named.
        let builtBy: String?
        let byPerson: Bool
        let note: String?
        var id: String { projectId + "#\(number)" }
    }

    // The tasks read: the rows in state `built`, oldest built first. A task whose agent needs the person is in the
    // engine's `decision` state instead, so it is not here (it sits under that agent's card, as the board puts a decision
    // above built). nil when the read is not a tasks answer at all: Today then says it could not read them, never zero.
    static func readyTasks(_ data: Data) -> [ReadyTask]? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["tasks"] as? [[String: Any]]
        else { return nil }
        // Review 1: when the Mac could not read who is running, it cannot tell a task whose agent needs the person from
        // one that is ready, so every marked task reads built. Not knowing is said as not knowing.
        if isTrue(obj["rosterUnreadable"]) { return nil }
        let ready: [ReadyTask] = rows.compactMap { t in
            guard t["state"] as? String == "built", let pid = t["projectId"] as? String, !pid.isEmpty,
                  let number = integer(t["number"]), let sentence = t["sentence"] as? String
            else { return nil }
            let byPerson = isTrue(t["builtByPerson"])
            return ReadyTask(projectId: pid,
                             projectName: (t["projectName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "",
                             number: number,
                             sentence: sentence,
                             builtAt: isoDate(t["builtAt"] as? String),
                             builtBy: byPerson ? nil : (t["builtBy"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                             byPerson: byPerson,
                             note: (t["builtNote"] as? String).flatMap { $0.isEmpty ? nil : $0 })
        }
        // Oldest built first; a task with no time after those with one; then by project and number, so the order holds.
        return ready.sorted { a, b in
            switch (a.builtAt, b.builtAt) {
            case let (x?, y?) where x != y: return x < y
            case (_?, nil): return true
            case (nil, _?): return false
            default: return a.projectName == b.projectName ? a.number < b.number : a.projectName < b.projectName
            }
        }
    }

    // What Today shows, decided once from the agents and the tasks read.
    struct TodayModel: Equatable {
        let needsYou: [Agent]
        // nil when the tasks could not be read (a line says so in place of the section).
        let ready: [ReadyTask]?
        let working: [Agent]

        // "1 thing needs you" / "N things need you" (needs-you cards plus ready cards), or nothing needs you. nil when
        // nobody needs you and the tasks are not known (not read yet, or the read failed): "Nothing needs you" would be a
        // claim about tasks nobody could see (review 1).
        var subhead: String? {
            let n = needsYou.count + (ready?.count ?? 0)
            if n == 0 { return ready == nil ? nil : "Nothing needs you right now." }
            return n == 1 ? "1 thing needs you" : "\(n) things need you"
        }
    }

    // Needs you: every agent whose tone is asked or needs you (the board's own needsPerson verdict, sent since #7004),
    // longest waiting first (an unknown start after the known ones), then by name. Working now: agents whose tone is
    // working, by name. Each section is hidden by the view when it is empty.
    static func today(agents: [Agent], tasks: [ReadyTask]?) -> TodayModel {
        let byName: (Agent, Agent) -> Bool = { a, b in
            let c = a.name.localizedStandardCompare(b.name)
            return c == .orderedSame ? a.session < b.session : c == .orderedAscending
        }
        let needs = agents.filter { let t = tone($0); return t == .asked || t == .needsYou }.sorted { a, b in
            switch (a.waitingSince, b.waitingSince) {
            case let (x?, y?) where x != y: return x < y
            case (_?, nil): return true
            case (nil, _?): return false
            default: return byName(a, b)
            }
        }
        let working = agents.filter { tone($0) == .working }.sorted(by: byName)
        return TodayModel(needsYou: needs, ready: tasks, working: working)
    }

    // The Today tab's badge: /api/status's counts.waiting (agents that need you plus unread messages, the Dock badge).
    // null when the person turned the count off, then no badge; a value that is not a whole number at 0 or more is none.
    // Not the subhead's count: the badge and the Dock always agree (engine/status.js waitingTotal).
    static func waitingCount(_ data: Data) -> Int? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let counts = obj["counts"] as? [String: Any], let n = integer(counts["waiting"]), n >= 0
        else { return nil }
        return n
    }

    // The tasks read Today makes: the board's own Tasks view read.
    static func readyTasksRequest(mac: URL) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/tasks?view=tasks", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
}
