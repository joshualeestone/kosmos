import Foundation

// The native Tasks tab's logic (kosmos#7031, slice 7 of #6838), UIKit-free so LogicTests compile it for macOS.
// The phone says and orders exactly what the board's Tasks view says (web/index.html, the TSK_ functions), so each rule
// here is that function's, named after it. The board's words are read from web/index.html by the tests, so a change on
// the board shows there first.
extension Board {
    // `GET /api/tasks?view=tasks`: every task on every project, each with the board's own state (engine/tasks.js
    // taskState), as the board's Tasks view reads it. Accept JSON, as the status read does (the gate's sign-in page).
    static func tasksRequest(mac: URL) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/tasks?view=tasks", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // One task as the Tasks view row reads it. Named TaskRow, not Task: inside Board a nested `Task` would hide Swift's
    // own Task from every Board extension.
    struct TaskRow: Equatable, Identifiable {
        struct Waiting: Equatable { let who: String; let reason: String }
        struct Subtasks: Equatable { let done: Int; let total: Int; let built: Int }
        struct Reading: Equatable { let value: String; let at: String }
        let projectId: String
        let projectName: String
        var projectPath: [String] = []
        let number: Int
        let sentence: String
        let state: String
        var whoNames: [String] = []
        var waitingOn: [Waiting] = []
        var waitingSince: String? = nil
        var createdAt: String? = nil
        var builtAt: String? = nil
        var builtBy: String? = nil
        var builtByPerson = false
        var builtNote: String? = nil
        var subtasks: Subtasks? = nil
        var repeatWords: String? = nil
        var repeating = false
        var repeatMissed = 0
        var repeatMissedMore = false
        var repeatMissedWords: String? = nil
        var repeatNextWords: String? = nil
        var lastRunAt: String? = nil
        var lastRunBy: String? = nil
        var lastRunByPerson = false
        var lastRunLate = false
        var lastRunNote: String? = nil
        var lastRunRecoveredMissed = 0
        var lastRunRecoveredMore = false
        var unchangedRuns = 0
        var unchangedInferred = 0
        var lastChangeAt: String? = nil
        var lastChangeNote: String? = nil
        var verified: Reading? = nil
        var told: Reading? = nil
        // The board's key for a task (tskKey): its project and number.
        var id: String { projectId + "#" + String(number) }
    }

    // What one read said: the rows, and whether the server could read the agents (rosterUnreadable). Unknown is never
    // zero: the Needs Your Decision group says it cannot tell (TSK_DECISION_UNKNOWN).
    struct TasksRead: Equatable {
        let tasks: [TaskRow]
        let rosterUnknown: Bool
    }

    static func parseTasks(_ data: Data) -> TasksRead? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["tasks"] as? [[String: Any]]
        else { return nil }
        let str = { (row: [String: Any], k: String) -> String? in (row[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
        let int = { (row: [String: Any], k: String) -> Int in (row[k] as? NSNumber)?.intValue ?? 0 }
        let reading = { (v: Any?) -> TaskRow.Reading? in
            guard let d = v as? [String: Any], let value = d["value"] as? String else { return nil }
            return TaskRow.Reading(value: value, at: d["at"] as? String ?? "")
        }
        let tasks: [TaskRow] = rows.compactMap { row in
            guard let projectId = str(row, "projectId"), let number = (row["number"] as? NSNumber)?.intValue,
                  let state = str(row, "state")
            else { return nil }
            var t = TaskRow(projectId: projectId, projectName: row["projectName"] as? String ?? "", number: number,
                            sentence: row["sentence"] as? String ?? "", state: state)
            t.projectPath = (row["projectPath"] as? [Any])?.compactMap { $0 as? String } ?? []
            t.whoNames = (row["whoNames"] as? [Any])?.compactMap { $0 as? String } ?? []
            t.waitingOn = (row["waitingOn"] as? [[String: Any]])?.compactMap { w in
                guard let who = w["who"] as? String, !who.isEmpty else { return nil }
                return TaskRow.Waiting(who: who, reason: w["reason"] as? String ?? "other")
            } ?? []
            t.waitingSince = str(row, "waitingSince")
            t.createdAt = str(row, "createdAt")
            t.builtAt = str(row, "builtAt")
            t.builtBy = str(row, "builtBy")
            t.builtByPerson = (row["builtByPerson"] as? Bool) == true
            t.builtNote = str(row, "builtNote")
            if let s = row["subtasks"] as? [String: Any], let total = (s["total"] as? NSNumber)?.intValue, total > 0 {
                t.subtasks = TaskRow.Subtasks(done: int(s, "done"), total: total, built: int(s, "built"))
            }
            t.repeating = row["repeat"] != nil && !(row["repeat"] is NSNull)
            t.repeatWords = str(row, "repeatWords")
            t.repeatMissed = int(row, "repeatMissed")
            t.repeatMissedMore = (row["repeatMissedMore"] as? Bool) == true
            t.repeatMissedWords = str(row, "repeatMissedWords")
            t.repeatNextWords = str(row, "repeatNextWords")
            t.lastRunAt = str(row, "lastRunAt")
            t.lastRunBy = str(row, "lastRunBy")
            t.lastRunByPerson = (row["lastRunByPerson"] as? Bool) == true
            t.lastRunLate = (row["lastRunLate"] as? Bool) == true
            t.lastRunNote = str(row, "lastRunNote")
            if let rec = row["lastRunRecovered"] as? [String: Any] {
                t.lastRunRecoveredMissed = int(rec, "missed")
                t.lastRunRecoveredMore = (rec["more"] as? Bool) == true
            }
            t.unchangedRuns = int(row, "unchangedRuns")
            t.unchangedInferred = int(row, "unchangedInferred")
            t.lastChangeAt = str(row, "lastChangeAt")
            t.lastChangeNote = str(row, "lastChangeNote")
            t.verified = reading(row["verified"])
            t.told = reading(row["told"])
            return t
        }
        return TasksRead(tasks: tasks, rosterUnknown: (obj["rosterUnreadable"] as? Bool) == true)
    }
}

enum Tasks {
    // TSK_GROUPS: the board's groups, in Josh's order (#3949; Built but waiting fifth). `token` is the board's colour
    // variable for the group's dot (#panel-tasks); the view maps it to the app's colour of the same name.
    struct Group: Equatable { let key: String; let label: String; let token: String }
    static let groups: [Group] = [
        Group(key: "decision", label: "Needs Your Decision", token: "--tsk-decision"),
        Group(key: "working", label: "In progress", token: "--tsk-working"),
        Group(key: "assigned", label: "Assigned but not started", token: "--tsk-assigned"),
        Group(key: "nobody", label: "Unassigned", token: "--tsk-nobody"),
        Group(key: "built", label: "Built but waiting", token: "--tsk-built"),
        Group(key: "scheduled", label: "On a schedule", token: "--tsk-scheduled"),
        Group(key: "held", label: "On hold", token: "--tsk-held"),
        Group(key: "closed", label: "Completed", token: "--tsk-closed"),
    ]
    // TSK_DECISION_UNKNOWN, word for word.
    static let decisionUnknown = "Kosmos could not read your agents just now, so it cannot tell whether one is waiting on you."

    // tskDot: Needs Your Decision is red only with something in it and the agents read; otherwise the neutral dot.
    static func dotToken(_ g: Group, count: Int, rosterUnknown: Bool) -> String {
        g.key == "decision" && (count == 0 || rosterUnknown) ? "--tsk-nobody" : g.token
    }

    // One group as the list draws it. `unknown` is the decision group that cannot tell (drawn even when empty).
    struct Section: Equatable {
        let group: Group
        let rows: [Board.TaskRow]
        let unknown: Bool
    }

    // The groups the list draws, in order, each hidden when empty (#3949: the tiles' zeros are not repeated), except
    // the decision group that cannot tell, which is a warning, not a zero. Rows sorted as the board's default
    // ('new': newest created first). `project`: the picked project's id, or nil for All projects.
    static func sections(_ read: Board.TasksRead, project: String?) -> [Section] {
        let rows = scoped(read.tasks, project: project)
        let sorted = sortNewest(rows)
        return groups.compactMap { g in
            let ts = sorted.filter { $0.state == g.key }
            let unknown = g.key == "decision" && read.rosterUnknown
            if ts.isEmpty && !unknown { return nil }
            return Section(group: g, rows: ts, unknown: unknown)
        }
    }

    // tskScoped, without the board's search and Created window (the phone has neither; both default to off).
    static func scoped(_ all: [Board.TaskRow], project: String?) -> [Board.TaskRow] {
        guard let project else { return all }
        return all.filter { $0.projectId == project }
    }

    // tskSort('new'): newest created first; an unreadable date counts as 0, as the board's `|| 0`. Stable.
    static func sortNewest(_ list: [Board.TaskRow]) -> [Board.TaskRow] {
        let at = { (s: String?) -> Double in s.flatMap(parseISO).map { $0.timeIntervalSince1970 * 1000 } ?? 0 }
        return list.enumerated().sorted { a, b in
            let x = at(a.element.createdAt), y = at(b.element.createdAt)
            return x != y ? x > y : a.offset < b.offset
        }.map(\.element)
    }

    // tskChainOf: the project's path, then its own name.
    static func chain(_ t: Board.TaskRow) -> [String] { t.projectPath + [t.projectName] }
    // pjChainText.
    static func chainText(_ names: [String]) -> String { names.joined(separator: " \u{203A} ") }

    // tskRowsShareOneProject: every row in one and the same project; an empty list is false.
    static func shareOneProject(_ rows: [Board.TaskRow]) -> Bool {
        guard let first = rows.first?.projectId, !first.isEmpty else { return false }
        return rows.allSatisfy { $0.projectId == first }
    }

    // tskTitle: the title IS the count (#3949, Josh 09-26): "30 Tasks on 2 Projects", "5 Tasks on Launch" (a picked
    // project by its leaf name), "3 Tasks on Book A › Launch" (one project in view, none picked), "0 Tasks". Before the
    // first read it is just "Tasks".
    static func title(_ read: Board.TasksRead?, project: String?) -> String {
        guard let read else { return "Tasks" }
        let rows = scoped(read.tasks, project: project)
        let open = rows.filter { $0.state != "closed" }
        let head = String(open.count) + (open.count == 1 ? " Task" : " Tasks")
        if let project {
            let picked = pickerProjects(read).first { $0.id == project }
            return head + " on " + (picked?.chain.last ?? "")
        }
        if open.isEmpty { return head }
        if shareOneProject(rows), let first = rows.first { return head + " on " + chainText(chain(first)) }
        let on = Set(open.map(\.projectId)).count
        return head + " on " + String(on) + (on == 1 ? " Project" : " Projects")
    }

    // tskLeaveOutProjectLine: the rows leave out their project line when they are all in one project and the title
    // names it (a project picked, or at least one open task).
    static func leaveOutProjectLine(_ read: Board.TasksRead, project: String?) -> Bool {
        let rows = scoped(read.tasks, project: project)
        return shareOneProject(rows) && (project != nil || rows.contains { $0.state != "closed" })
    }

    // The picker: every project with a task, each with its open count, sorted by chain (pjChainCompare: each
    // sub-project after its parent). The words are pjChainOption's: "Ads (3), in Book A › Launch".
    struct PickerProject: Equatable { let id: String; let chain: [String]; let open: Int }
    static func pickerProjects(_ read: Board.TasksRead) -> [PickerProject] {
        var order: [String] = []
        var byId: [String: (chain: [String], open: Int)] = [:]
        for t in read.tasks {
            if byId[t.projectId] == nil { order.append(t.projectId); byId[t.projectId] = (chain(t), 0) }
            if t.state != "closed" { byId[t.projectId]!.open += 1 }
        }
        return order.map { PickerProject(id: $0, chain: byId[$0]!.chain, open: byId[$0]!.open) }
            .enumerated().sorted { a, b in
                let c = chainCompare(a.element.chain, b.element.chain)
                return c != 0 ? c < 0 : a.offset < b.offset
            }.map(\.element)
    }
    static func chainCompare(_ a: [String], _ b: [String]) -> Int {
        for i in 0..<min(a.count, b.count) {
            let c = a[i].localizedCompare(b[i])
            if c != .orderedSame { return c == .orderedAscending ? -1 : 1 }
        }
        return a.count - b.count
    }
    static func pickerWords(_ p: PickerProject) -> String {
        let own = (p.chain.last ?? "") + " (" + String(p.open) + ")"
        return p.chain.count < 2 ? own : own + ", in " + chainText(Array(p.chain.dropLast()))
    }

    // agoWords: the board's own age words.
    static func agoWords(_ ms: Double) -> String {
        guard ms.isFinite, ms >= 0 else { return "" }
        let n = Int((ms / 1000).rounded(.down))
        if n < 5 { return "just now" }
        if n < 90 { return String(n) + " seconds ago" }
        let mins = n / 60
        if mins < 90 { return String(mins) + (mins == 1 ? " minute ago" : " minutes ago") }
        let hours = n / 3600
        if hours < 36 { return String(hours) + (hours == 1 ? " hour ago" : " hours ago") }
        let days = n / 86400
        return String(days) + (days == 1 ? " day ago" : " days ago")
    }
    static func ago(_ iso: String?, now: Date) -> String {
        guard let iso, let d = parseISO(iso) else { return "" }
        return agoWords(now.timeIntervalSince(d) * 1000)
    }
    static func parseISO(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    // PJ_NEEDS_WHY's sentences (the first of each pair), for a decision row's who line.
    static let needsWhy: [String: String] = [
        "question": "Waiting for your answer.",
        "trust": "Waiting for you to approve it before it can start.",
        "gave_up": "Lost its connection, and Kosmos stopped trying to reconnect it.",
        "crash_loop": "Kosmos keeps restarting it, and it keeps stopping within a couple of minutes.",
        "stuck_auth": "Kosmos has seen it unable to sign in for a while. It cannot work until its account is reconnected.",
        "stuck_rate": "Kosmos has seen it paused by a rate limit for a while. It carries on when the limit lifts, or you can switch its model.",
        "own_bound": "Kosmos tried to get it going (a nudge, or a resume after its quota reset) and gave up. Open it to see what it shows.",
        "other": "Kosmos needs you to look at it.",
    ]

    // The row's line under its title, per the spec's table, in the board's words (tskRow). `name` is tskAgentName: an
    // agent's display name from the roster, else its session name. Empty when the group has no line.
    static func rowLine(_ t: Board.TaskRow, now: Date, name: (String) -> String) -> String {
        // "all subtasks built, ready for you to check" stands in for the line (the board's allDone, built arm).
        if let s = t.subtasks, s.built > 0, s.done + s.built == s.total, s.done != s.total, t.state != "closed" {
            return "All subtasks built, ready for you to check."
        }
        switch t.state {
        case "decision": return decisionLine(t, now: now, name: name)
        case "working", "assigned": return uniqueNames(t.whoNames).map(name).joined(separator: ", ")
        case "built": return builtLine(t, now: now, name: name)
        case "scheduled": return repeatSentence(t, now: now, name: name)
        default: return ""
        }
    }
    private static func uniqueNames(_ xs: [String]) -> [String] {
        var seen = Set<String>()
        return xs.filter { seen.insert($0).inserted }
    }

    // tskRow's waitLine and whoLine: "Cleo: Waiting for your answer for 24 seconds." for a question; "Just started
    // waiting for your answer."; any other reason "Waiting on you for 2 hours", then each agent's reason.
    static func decisionLine(_ t: Board.TaskRow, now: Date, name: (String) -> String) -> String {
        let wait = ago(t.waitingSince, now: now)
        let who = t.waitingOn
        let askOnly = !wait.isEmpty && !who.isEmpty && who.allSatisfy { $0.reason == "question" }
        var lines: [String] = []
        if !wait.isEmpty {
            if askOnly {
                let names = uniqueNames(who.map(\.who)).map(name).joined(separator: ", ")
                lines.append(names + ": " + (wait == "just now" ? "Just started waiting for your answer."
                    : "Waiting for your answer for " + wait.replacingOccurrences(of: " ago", with: "") + "."))
            } else {
                lines.append(wait == "just now" ? "Just started waiting on you" : "Waiting on you for " + wait.replacingOccurrences(of: " ago", with: ""))
            }
        }
        if !who.isEmpty && !askOnly {
            lines.append(who.map { name($0.who) + ": " + (needsWhy[$0.reason] ?? needsWhy["other"]!) }.joined(separator: " "))
        }
        return lines.joined(separator: "\n")
    }

    // tskRow's builtLine: "Marked built by Rex 2 hours ago: the note", "Marked built by you".
    static func builtLine(_ t: Board.TaskRow, now: Date, name: (String) -> String) -> String {
        guard t.builtAt != nil, t.state != "closed" else { return "" }
        var s = "Marked built"
        if t.builtByPerson { s += " by you" } else if let by = t.builtBy { s += " by " + name(by) }
        let a = ago(t.builtAt, now: now)
        if !a.isEmpty { s += " " + a }
        if let note = t.builtNote { s += ": " + note }
        return s
    }

    // tskRepeatMissed.
    static func repeatMissed(_ t: Board.TaskRow) -> String {
        guard t.repeatMissed >= 1, let words = t.repeatMissedWords else { return "" }
        if t.repeatMissed == 1 && !t.repeatMissedMore { return "Missed the run due " + words + "." }
        return "Missed " + (t.repeatMissedMore ? "more than " + String(t.repeatMissed) : String(t.repeatMissed)) + " runs, the latest due " + words + "."
    }

    // tskRepeatSentence (with tskToldSentence): the schedule as the board words it.
    static func repeatSentence(_ t: Board.TaskRow, now: Date, name: (String) -> String) -> String {
        let words = t.repeatWords ?? "on a schedule"
        let missed = repeatMissed(t)
        var s = missed + (missed.isEmpty ? "" : " ") + "Repeats " + words + "."
        if t.lastRunAt != nil {
            let a = ago(t.lastRunAt, now: now)
            let who = t.lastRunByPerson ? "you" : t.lastRunBy.map(name) ?? ""
            let recWords = t.lastRunRecoveredMissed >= 1
                ? ", after " + (t.lastRunRecoveredMore ? "more than " + String(t.lastRunRecoveredMissed) + " missed runs"
                    : t.lastRunRecoveredMissed == 1 ? "1 missed run" : String(t.lastRunRecoveredMissed) + " missed runs")
                : ""
            s += " Last run " + (a.isEmpty ? "just now" : a) + (who.isEmpty ? "" : " by " + who) + (t.lastRunLate ? ", late" : "")
                + recWords + (t.lastRunNote.map { ": " + $0 } ?? "") + "."
            let same = t.unchangedRuns
            if same >= 1 {
                let guessed = t.unchangedInferred
                let what = guessed == 0 ? "found nothing new"
                    : guessed >= same ? (same == 1 ? "repeated the note before it" : "repeated the same note")
                    : "found nothing new or repeated the same note"
                s += " " + (same == 1 ? "It " + what : "The last " + String(same) + " runs " + what)
                if let changed = t.lastChangeAt, parseISO(changed) != nil {
                    let c = ago(changed, now: now)
                    s += "; the last change was " + (c.isEmpty ? "just now" : c)
                        + (t.lastChangeNote.flatMap { $0 != t.lastRunNote ? ": " + $0 : nil } ?? "")
                }
                s += "."
            }
        } else if missed.isEmpty {
            s += " No run reported yet."
        }
        s += toldSentence(t, now: now)
        if let next = t.repeatNextWords { s += " Next " + next + "." }
        return s
    }

    // tskToldSentence.
    static func toldSentence(_ t: Board.TaskRow, now: Date) -> String {
        let v = t.verified?.value ?? ""
        guard !v.isEmpty || t.told != nil else { return "" }
        guard let told = t.told else {
            return " Its latest check found \u{201C}" + v + "\u{201D}. Kosmos has no record of you being told this."
        }
        let w = ago(told.at, now: now)
        let when = w.isEmpty ? "just now" : w
        if v.isEmpty || v == told.value {
            return " You were last told \u{201C}" + told.value + "\u{201D} (" + when + ")" + (v.isEmpty ? "." : ", the same as its latest check.")
        }
        let toldAt = parseISO(told.at)?.timeIntervalSince1970 ?? .nan
        let checkAt = t.verified.flatMap { parseISO($0.at) }?.timeIntervalSince1970 ?? .nan
        if toldAt >= checkAt {
            return " You were last told \u{201C}" + told.value + "\u{201D} (" + when + "), after its latest check found \u{201C}" + v + "\u{201D}."
        }
        return " Its latest check found \u{201C}" + v + "\u{201D}. You were last told \u{201C}" + told.value + "\u{201D} (" + when + ")."
    }

    // The row as one accessibility element (the spec): "<Title>. <Project>. <row line>."
    static func spoken(_ t: Board.TaskRow, line: String, projectShown: Bool) -> String {
        var parts = [t.sentence]
        if projectShown { parts.append(chainText(chain(t))) }
        if !line.isEmpty { parts.append(line.replacingOccurrences(of: "\n", with: " ")) }
        return parts.map { $0.hasSuffix(".") ? String($0.dropLast()) : $0 }.joined(separator: ". ") + "."
    }

    // The board's task page for a row, opened in the board view until a native task page has its own slice: the board
    // reads ?project=&task= at boot (web/index.html), as Today's Check it opens it (#7030).
    static func taskPageURL(board: URL, _ t: Board.TaskRow) -> URL? {
        guard var parts = URLComponents(url: board, resolvingAgainstBaseURL: false) else { return nil }
        parts.path = "/"
        parts.queryItems = [URLQueryItem(name: "project", value: t.projectId), URLQueryItem(name: "task", value: String(t.number))]
        return parts.url
    }
}
