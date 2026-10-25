import Foundation

// kosmos#7074 (a gap in #6838's plan): a task's page, native. Until now Today's Check it and every Tasks row opened the
// board's page in the web view, and Mark as done lived only there. This file decides what the page says, in the board's
// own words (web/index.html: paintTaskPage, tkStateWord, tkAdded, tkMemberName, tkSayPart, taskClaimHtml,
// claimNotReported, the tk-note close note, tkPaintSubtasks, tkActPhrase, tkActRowsHtml), and makes its requests.
// UIKit-free, so ios/LogicTests/run-taskpage.sh runs it on a Mac.
extension Board {
    struct TaskPart: Equatable {
        let id: String
        let who: String?
        let sentence: String
        let closed: Bool
    }

    // What the engine read about whether the agent on it says it is on it (engine/projects.js joinTaskClaims).
    struct TaskClaim: Equatable {
        // true, false, or nil when it could not tell.
        let claimed: Bool?
        let because: String?
        // The agent the claim is about: one still holding open work here.
        let about: String?
        let neverReported: Bool
    }

    struct SubtaskRow: Equatable, Identifiable {
        let number: Int
        let sentence: String
        // Done, Replaced, Built or Open (tkPaintSubtasks).
        let status: String
        var id: Int { number }
    }

    struct TaskPage: Equatable {
        let projectId: String
        let projectName: String
        let projectPaused: Bool
        // The project's members, by session name (tkMemberName's first source).
        let members: [String: String]
        let number: Int
        let sentence: String
        let detail: String?
        let createdAt: String?
        let addedBy: String?
        let addedVia: String?
        // The task's own finished state (progress.closed, else closedAt), as the board's Done/Open and its button.
        let closed: Bool
        // Only the stored close time: the board keys the built words and the close note on it alone.
        let closedAt: String?
        let partsDone: Int
        let partsTotal: Int
        let replacedBy: Int?
        let dueDate: String?
        let onHold: Bool
        let onHoldByPerson: Bool
        let builtAt: String?
        let builtBy: String?
        let builtByPerson: Bool
        let builtNote: String?
        let parts: [TaskPart]
        let claim: TaskClaim?
        // A task from before parts: the one agent on it.
        let legacyWho: String?
        let parentNumber: Int?
        let parentSentence: String?
        let subtasks: [SubtaskRow]
        // Every subtask done, or every one done or built (some only built), while this one is open.
        let allSubtasksDone: Bool
        let allSubtasksBuilt: Bool
        // The tasks this one replaced (theirs name it; the link is stored once).
        let replaces: [Int]
    }

    enum TaskPageRead: Equatable {
        case page(TaskPage)
        // The project or the task is not in the Mac's list any more (deleted, or moved under another computer).
        case gone
        case unreadable
    }

    // GET /api/projects (Board.projectsRequest), the board's own read for a task page: the project, then the task by
    // its number.
    static func parseTaskPage(_ data: Data, project: String, number: Int) -> TaskPageRead {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let projects = obj["projects"] as? [[String: Any]] else { return .unreadable }
        guard let p = projects.first(where: { $0["id"] as? String == project }) else { return .gone }
        let tasks = (p["tasks"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
        guard let t = tasks.first(where: { integer($0["number"]) == number }) else { return .gone }
        var members: [String: String] = [:]
        for a in (p["agents"] as? [Any] ?? []).compactMap({ $0 as? [String: Any] }) {
            if let s = a["sessionName"] as? String, !s.isEmpty { members[s] = (a["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? s }
        }
        func text(_ v: Any?) -> String? { (v as? String).flatMap { $0.isEmpty ? nil : $0 } }
        func isClosed(_ x: [String: Any]) -> Bool {
            if let g = x["progress"] as? [String: Any], let c = g["closed"] as? Bool { return c }
            return text(x["closedAt"]) != nil
        }
        let progress = t["progress"] as? [String: Any]
        let rawParts = (t["parts"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
        let closedAt = text(t["closedAt"])
        let parts: [TaskPart] = rawParts.isEmpty
            ? [TaskPart(id: "1", who: text(t["who"]), sentence: text(t["sentence"]) ?? "", closed: closedAt != nil)]
            : rawParts.enumerated().map { i, x in
                TaskPart(id: (x["id"]).map { "\($0)" } ?? String(i + 1), who: text(x["who"]), sentence: text(x["sentence"]) ?? "",
                         closed: text(x["closedAt"]) != nil)
            }
        let claim = (t["claim"] as? [String: Any]).map { c in
            TaskClaim(claimed: c["claimed"] as? Bool, because: text(c["because"]), about: text(c["about"]),
                      neverReported: c["neverReported"] as? Bool == true)
        }
        let closed = isClosed(t)
        let kids = tasks.filter { integer($0["parent"]) == number }.sorted { (integer($0["number"]) ?? 0) < (integer($1["number"]) ?? 0) }
        func built(_ x: [String: Any]) -> Bool { !isClosed(x) && x["onHold"] as? Bool != true && text(x["builtAt"]) != nil }
        let subtasks = kids.compactMap { x -> SubtaskRow? in
            guard let n = integer(x["number"]) else { return nil }
            let status = isClosed(x) ? (integer(x["replacedBy"]) != nil ? "Replaced" : "Done") : built(x) ? "Built" : "Open"
            return SubtaskRow(number: n, sentence: text(x["sentence"]) ?? "", status: status)
        }
        let parentNumber = integer(t["parent"])
        let parent = parentNumber.flatMap { n in tasks.first { integer($0["number"]) == n } }
        let replaces = tasks.filter { integer($0["replacedBy"]) == number && isClosed($0) }.compactMap { integer($0["number"]) }.sorted()
        return .page(TaskPage(
            projectId: project, projectName: text(p["name"]) ?? project, projectPaused: p["paused"] as? Bool == true,
            members: members, number: number, sentence: text(t["sentence"]) ?? "", detail: text(t["detail"]),
            createdAt: text(t["createdAt"]), addedBy: text(t["addedBy"]), addedVia: text(t["addedVia"]),
            closed: closed, closedAt: closedAt,
            partsDone: integer(progress?["done"]) ?? parts.filter(\.closed).count,
            partsTotal: integer(progress?["total"]) ?? parts.count,
            replacedBy: integer(t["replacedBy"]), dueDate: text(t["dueDate"]),
            onHold: t["onHold"] as? Bool == true, onHoldByPerson: t["onHoldByPerson"] as? Bool == true,
            builtAt: text(t["builtAt"]), builtBy: text(t["builtBy"]), builtByPerson: t["builtByPerson"] as? Bool == true,
            builtNote: text(t["builtNote"]), parts: parts, claim: claim, legacyWho: text(t["who"]),
            parentNumber: parent == nil ? nil : parentNumber, parentSentence: parent.flatMap { text($0["sentence"]) },
            subtasks: subtasks,
            allSubtasksDone: !kids.isEmpty && kids.allSatisfy(isClosed) && !closed,
            allSubtasksBuilt: !kids.isEmpty && !kids.allSatisfy(isClosed) && kids.allSatisfy { isClosed($0) || built($0) } && !closed,
            replaces: replaces))
    }
}

// MARK: What the page says (the board's words)

extension Board.TaskPage {
    // tkMemberName: the project's name for an agent, else the roster's, else the session name; "(not on this project)"
    // for one that holds open work here without being a member (#6895).
    func name(_ session: String, roster: [String: String], holds: Bool = false) -> String {
        if let m = members[session] { return m }
        let shown = roster[session] ?? session
        return holds ? shown + " (not on this project)" : shown
    }

    // tkStateWord, and the built words after it.
    var stateWord: String {
        if closed, let r = replacedBy { return "Replaced by task \(r)" }
        if partsTotal > 1 { return "\(partsDone) of \(partsTotal) parts done" }
        return closed ? "Done" : "Open"
    }

    func stateLine(roster: [String: String]) -> String {
        var line = stateWord
        if builtAt != nil && closedAt == nil {
            let who = builtByPerson ? "you" : builtBy.map { name($0, roster: roster) } ?? ""
            line += ", marked built" + (who.isEmpty ? "" : " by " + who) + (builtNote.map { ": " + $0 } ?? "")
        }
        if !replaces.isEmpty {
            line += (line.last.map { ".!?".contains($0) } == true ? " " : ". ") + "Replaces " + replaces.map { "task \($0)" }.joined(separator: ", ")
        }
        return line
    }

    // tkAdded: who added it and when, in whole days in the phone's own time zone.
    func added(now: Date, calendar: Calendar = .current) -> String {
        let who = addedVia == "webhook" ? (addedBy.map { $0 + " (a webhook)" } ?? "A webhook")
            : addedBy == "operator" ? "You"
            : (addedBy ?? (addedVia == "process" ? "An agent" : "Somebody"))
        guard let raw = createdAt, let at = Tasks.parseISO(raw) else { return who }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: at), to: calendar.startOfDay(for: now)).day ?? 0
        let when: String
        if days <= 0 { when = "today" }
        else if days == 1 { when = "yesterday" }
        else if days < 7 { when = "\(days) days ago" }
        else {
            let f = DateFormatter()
            f.calendar = calendar
            f.timeZone = calendar.timeZone
            f.setLocalizedDateFormatFromTemplate("MMMd")
            when = f.string(from: at)
        }
        return who + ", " + when
    }

    // The due date, read only here (it is set on the board's page): "Due Oct 30".
    func dueLine(calendar: Calendar = .current) -> String? {
        guard let due = dueDate else { return nil }
        let p = DateFormatter()
        p.locale = Locale(identifier: "en_US_POSIX")
        p.calendar = Calendar(identifier: .gregorian)
        p.timeZone = calendar.timeZone
        p.dateFormat = "yyyy-MM-dd"
        guard let d = p.date(from: due) else { return "Due " + due }
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.setLocalizedDateFormatFromTemplate("MMMd")
        return "Due " + f.string(from: d)
    }

    // The board's hold hint, said here only when there is something to say (a paused project, or a hold): the control
    // that the other hints describe is on the board's page.
    var holdLine: String? {
        guard !closed else { return nil }
        if projectPaused { return "This project is paused, so Kosmos does not nudge anyone about its tasks or hand them out." }
        guard onHold else { return nil }
        return onHoldByPerson
            ? "You put this on hold, so only you can take it off. Kosmos does not nudge anyone about it or hand it out."
            : "This was put on hold outside this screen (by an agent, or with kosmos task hold), so an agent or you can take it off. Kosmos does not nudge anyone about it or hand it out."
    }

    // claimNotReported.
    var notReported: String? {
        claim.flatMap { $0.claimed == nil && $0.neverReported ? "has not reported what it is working on yet" : nil }
    }

    // tkSayPart: the agent's first open part carries its claim line.
    var sayPartId: String? {
        guard let who = claim?.about else { return nil }
        return parts.first { $0.who == who && !$0.closed }?.id
    }

    // taskClaimHtml as words, for the part that carries it; nil where the page says nothing there (a could-not-tell
    // reason is given in full by the why line instead).
    var claimWords: String? {
        guard let c = claim else { return nil }
        if c.claimed == true { return "says it is on this" }
        if c.claimed == false { return "says it is not on this" }
        guard let nr = notReported else { return nil }
        return nr
    }

    // One row per part: who (or Nobody yet), the part's own words when they differ from the task's, and the claim line.
    struct PartLine: Equatable, Identifiable { let id: String; let who: String; let line: String?; let say: String?; let done: Bool }
    func partLines(roster: [String: String]) -> [PartLine] {
        parts.map { part in
            PartLine(id: part.id,
                     who: part.who.map { name($0, roster: roster, holds: !closed && !part.closed) } ?? "Nobody yet",
                     line: part.sentence != sentence && !part.sentence.isEmpty ? part.sentence : nil,
                     say: part.id == sayPartId ? claimWords : nil,
                     done: part.closed)
        }
    }

    // The why line under the parts.
    func whyLine(roster: [String: String]) -> String? {
        let aboutName = claim?.about.map { name($0, roster: roster) }
        if let nr = notReported { return sayPartId != nil || aboutName == nil ? nil : aboutName! + " " + nr + "." }
        if let c = claim, c.claimed == nil, let because = c.because {
            return "We could not check whether " + (aboutName ?? "its agent") + " is on this: " + because + "."
        }
        return nil
    }

    // The tk-note close note: what Mark as done does not do. Keyed on the stored close time, as the board's.
    func closeNote(roster: [String: String]) -> String? {
        let who = claim?.about.map { name($0, roster: roster) } ?? legacyWho.map { name($0, roster: roster) }
        guard let who, closedAt == nil else { return nil }
        let says = claim?.claimed == true ? who + " says it is on this. " : ""
        return says + "Marking it done closes it here. It does not stop " + who + " or change what " + who + " is doing."
    }

    // The one act the person owns, as the button promises it.
    var act: Board.TaskAct { closed ? .reopen : .close }
}

// MARK: Marking it done, and seen

extension Board {
    enum TaskAct: String, Equatable { case close, reopen
        var title: String { self == .close ? "Mark as done" : "Reopen" }
    }

    // The phone acting for the person, as the board's page does: the Mac's isViaScreen reads Sec-Fetch-Site, which
    // WebKit sends from the board in the app's web view and URLSession never does. Without it, marking a task seen is
    // refused, a reopen is not recorded as the person's, and a task whose repeat the person set cannot be closed.
    // Agents are told apart by their token, which the phone never sends.
    static func asPerson(_ r: inout URLRequest) {
        r.setValue("same-origin", forHTTPHeaderField: "Sec-Fetch-Site")
    }

    static func taskRoute(mac: URL, project: String, number: Int, _ tail: String) -> URL? {
        guard isProjectId(project), number > 0 else { return nil }
        return URL(string: "/api/project/\(project)/task/\(number)/\(tail)", relativeTo: mac)?.absoluteURL
    }

    // POST .../task/<n>/close or /reopen, with no body (the board's tk-done).
    static func taskActRequest(mac: URL, project: String, number: Int, act: TaskAct) -> URLRequest? {
        guard let url = taskRoute(mac: mac, project: project, number: number, act.rawValue) else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        asPerson(&r)
        return r
    }

    enum TaskActResult: Equatable { case done, refused(String) }

    // The Mac's answer: any 2xx is done; otherwise its own sentence, else the board's.
    static func taskActResult(status: Int, body: Data?) -> TaskActResult {
        if (200...299).contains(status) { return .done }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if status != 0, let e = obj?["error"] as? String, !e.isEmpty { return .refused(e) }
        return .refused("we could not change that task")
    }

    // POST .../task/<n>/seen: the person has this task in front of them (engine/taskseen.js).
    static func taskSeenRequest(mac: URL, project: String, number: Int) -> URLRequest? {
        guard let url = taskRoute(mac: mac, project: project, number: number, "seen") else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        asPerson(&r)
        return r
    }

    // A 5xx or no answer is tried once more; anything else settles it (the board's tkMarkSeen).
    static func seenRetries(status: Int) -> Bool { status == 0 || status >= 500 }
}

// MARK: The task's activity (GET .../activity; tkActPhrase, tkActRowsHtml)

extension Board {
    struct ActivityRow: Equatable, Identifiable {
        let id: String
        let at: Date?
        let text: String
    }

    static func taskActivityRequest(mac: URL, project: String, number: Int) -> URLRequest? {
        guard let url = taskRoute(mac: mac, project: project, number: number, "activity") else { return nil }
        var r = URLRequest(url: url)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // The events, oldest first as the Mac keeps them; nil when the answer is not one.
    static func parseActivity(_ data: Data) -> [[String: Any]]? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let events = obj["events"] as? [Any] else { return nil }
        return events.compactMap { $0 as? [String: Any] }
    }

    // tkActPhrase: one event, as the page says it. `name` gives an agent's name (tkMemberName).
    static func activityPhrase(_ ev: [String: Any], name: (String) -> String) -> String {
        func s(_ k: String) -> String? { (ev[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
        func nameOf(_ k: String) -> String? { s(k).map(name) }
        let person = ev["person"] as? Bool == true
        let kind = ev["kind"] as? String ?? ""
        switch kind {
        case "created":
            let who = nameOf("who")
            return (who.map { "Created and given to " + $0 } ?? "Created") + (integer(ev["parent"]).map { ", under task \($0)" } ?? "")
                + (s("doneWhen").map { ". Done when: " + $0 } ?? "")
        case "assigned": return nameOf("who").map { $0 + " put on a part" } ?? "A part left with nobody on it"
        case "part-added": return "A part added" + (s("sentence").map { ": " + $0 } ?? "")
        case "part-closed": return "A part marked done"
        case "part-reopened": return "A part put back"
        case "due-set": return s("dueDate").map { "Due date set to " + $0 } ?? "Due date set"
        case "due-cleared": return "Due date cleared"
        case "done-when-set":
            let who = person ? "You" : nameOf("by")
            return (who.map { $0 + " set" } ?? "Set") + " what done means" + (s("doneWhen").map { ": " + $0 } ?? "")
        case "done-when-cleared":
            let who = person ? "You" : nameOf("by")
            return (who.map { $0 + " took" } ?? "Took") + " off what done means"
        case "hold-set": return s("via") == "agent" ? "Put on hold by an agent" : "Put on hold"
        case "hold-cleared":
            return s("via") == "agent" ? "Taken off hold by an agent" : s("via") == "close" ? "Taken off hold, as it was closed" : "Taken off hold"
        case "parent-set": return integer(ev["parent"]).map { "Put under task \($0)" } ?? "Put under another task"
        case "parent-cleared": return "Taken out from under its task"
        case "repeat-set": return s("words").map { "Set to repeat " + $0 } ?? "Set to repeat"
        case "repeat-cleared": return "No longer repeats"
        case "run":
            let who = person ? "You" : nameOf("by")
            let missed = (number(ev["missedBefore"]) ?? 0) >= 1 ? Int(number(ev["missedBefore"])!) : 0
            let missedWords = missed == 0 ? ""
                : ", after " + (ev["missedMore"] as? Bool == true ? "more than \(missed) missed runs" : missed == 1 ? "1 missed run" : "\(missed) missed runs")
            let unchanged = ev["unchanged"] as? Bool == true ? (ev["inferred"] as? Bool == true ? ", the same note again" : ", nothing new") : ""
            return (who.map { $0 + " ran it" } ?? "Ran") + (ev["late"] as? Bool == true ? ", late" : "") + missedWords + unchanged
                + (s("note").map { ": " + $0 } ?? "")
        case "reviewer-set": return person ? "You will be told if a run is missed" : (nameOf("who") ?? "An agent") + " will be told if a run is missed"
        case "reviewer-cleared": return "Nobody is told now if a run is missed"
        case "hold-stale":
            let who = nameOf("told") ?? "its owner"
            return ev["reached"] as? Bool == false
                ? "Still on hold while " + who + " worked in its project room; Kosmos could not reach " + who
                : "Still on hold while " + who + " worked in its project room; " + who + " was asked whether the hold still stands"
        case "missed":
            let count = ev["count"].map { "\($0)" } ?? ""
            let runs = ev["more"] as? Bool == true ? "More than " + count + " runs missed" : (number(ev["count"]) ?? 0) > 1 ? count + " runs missed" : "A run was missed"
            if person { return runs + "; you review it" }
            let who = nameOf("told") ?? "its reviewer"
            return runs + (ev["reached"] as? Bool == false ? "; Kosmos could not reach " + who : "; " + who + " was told")
        case "said": return (nameOf("who").map { $0 + ": " } ?? "") + (ev["text"] as? String ?? "")
        case "kept-sent", "kept-dropped":
            let to = nameOf("to") ?? "an agent"
            let built = ev["built"] as? Bool == true
            let from = nameOf("from")
            let personSent = ev["person"] as? Bool == true
            let subject = built ? (from.map { "the built notice from " + $0 } ?? "a built notice")
                : personSent ? "your message" : from.map { "the message from " + $0 } ?? "a message"
            let Subject = built ? (from.map { "The built notice from " + $0 } ?? "A built notice")
                : personSent ? "Your message" : from.map { "A message from " + $0 } ?? "A message"
            let behind = ev["behind"] as? Bool == true
            if kind == "kept-dropped" {
                return Subject + " to " + to + " was never sent: Kosmos kept it " + (behind ? "behind earlier messages" : "while " + to + " was out of usage")
                    + " and could not send it within a day"
            }
            let kept = behind ? ", kept behind earlier messages, " : ", kept while " + to + " was out of usage, "
            let when = behind ? "once the messages ahead of it had gone" : "once " + to + " was back"
            return s("state") == "unconfirmed"
                ? "Kosmos tried to send " + subject + " to " + to + " " + when + ", but could not confirm " + to + " got it"
                : Subject + " to " + to + kept + "was sent " + when
        case "closed": return integer(ev["replacedBy"]).map { "Closed as replaced by task \($0)" } ?? "Marked done"
        case "replaced": return integer(ev["replacedBy"]).map { "Marked as replaced by task \($0)" } ?? "Marked as replaced"
        case "undone":
            let files = number(ev["files"]) ?? 0
            return files == 1 ? "One file\u{2019}s changes undone" : "File changes undone (\(Int(files)) files)"
        case "reopened":
            let who = person ? "You" : nameOf("by")
            return (who.map { $0 + " put it back" } ?? "Put back") + (s("why").map { ": " + $0 } ?? "")
        case "built":
            let who = person ? "You" : nameOf("by")
            return (who.map { $0 + " marked it built" } ?? "Marked built") + (s("note").map { ": " + $0 } ?? "")
        case "unbuilt":
            if s("reason") == "new work" { return "No longer built: there is new work on it" }
            if s("reason") == "it repeats" { return (person ? "You made it repeat" : "Made to repeat") + ", so it is no longer built" }
            let who = person ? "You" : nameOf("by")
            return who.map { $0 + " took the built mark off" } ?? "Built mark taken off"
        default: return kind
        }
    }

    // tkActRowsHtml: one row per event, oldest first, with two or more quiet runs in a row folded into one.
    static func activityRows(_ events: [[String: Any]], name: (String) -> String) -> [ActivityRow] {
        func at(_ ev: [String: Any]) -> Date? { (ev["at"] as? String).flatMap(Tasks.parseISO) }
        func quiet(_ ev: [String: Any]) -> Bool {
            ev["kind"] as? String == "run" && ev["unchanged"] as? Bool == true && ev["late"] as? Bool != true && !((number(ev["missedBefore"]) ?? 0) >= 1)
        }
        var out: [ActivityRow] = []
        var i = 0
        while i < events.count {
            var j = i
            while j < events.count && quiet(events[j]) { j += 1 }
            if j - i >= 2 {
                let group = Array(events[i..<j])
                let inferred = group.filter { $0["inferred"] as? Bool == true }.count
                let what = inferred == 0 ? " runs found nothing new" : inferred == group.count ? " runs repeated the same note"
                    : " runs found nothing new or repeated the same note"
                out.append(ActivityRow(id: "\(i)@" + (group[0]["at"] as? String ?? ""), at: at(group[group.count - 1]), text: "\(group.count)" + what))
                i = j
            } else {
                out.append(ActivityRow(id: "\(i)@" + (events[i]["at"] as? String ?? ""), at: at(events[i]), text: activityPhrase(events[i], name: name)))
                i += 1
            }
        }
        return out
    }

    static let activityEmpty = "Nothing yet. As this task is worked on, what happens shows up here."
    static let activityUnread = "We could not read the activity just now."

    // A JSON number as a Double (counts may come as Int or Double).
    fileprivate static func number(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
}
