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
        // Done, Replaced, Built, On hold or Open (tkPaintSubtasks).
        let status: String
        var id: Int { number }
    }

    struct TaskPage: Equatable {
        let projectId: String
        let projectName: String
        let projectPaused: Bool
        // The project's members' own names, by session name (tkMemberName's first source), and who is a member at all
        // (a member with no name of its own is still one).
        let members: [String: String]
        let memberSessions: Set<String>
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
        var onHoldForPerson = false   // kosmos#7788
        let builtAt: String?
        let builtBy: String?
        let builtByPerson: Bool
        let builtNote: String?
        var builtWaitingOn: String? = nil   // kosmos#8939
        var whoFinished: [String] = []   // kosmos#8137
        var whoLeft: [String] = []
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
        // kosmos#8958 slice B3: the board's repeat fields (Board.fillRepeat) when the task repeats, for its line; and the
        // stored rule as the Repeats controls show it (Board.repeatStored): the Never choice when it does not repeat, nil for a rule
        // this phone cannot show (the controls then stay on the board).
        var repeatRow: TaskRow? = nil
        var repeatStored: RepeatChoice? = RepeatChoice(every: .never)
        // kosmos#8958 slice B3b: who is told when a run is missed (the board's tkReviewerOf): "none", "me", or an agent's
        // session name; and the project's members in the project's order (a Set has none), for the choice's list.
        var repeatReviewer = "none"
        var memberOrder: [String] = []
        // kosmos#8958 slice B4: the closed state the receipt belongs to, the board's tkReceiptSync key: nil while the task is
        // open, else its close time (the task's own, or its newest part's), so closed, put back and closed again asks
        // again. And whether it was closed as never run (kosmos#8301).
        var receiptKey: String? = nil
        var closedUnrun = false
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
        var memberSessions = Set<String>()
        var memberOrder: [String] = []
        for a in (p["agents"] as? [Any] ?? []).compactMap({ $0 as? [String: Any] }) {
            guard let s = a["sessionName"] as? String, !s.isEmpty else { continue }
            if memberSessions.insert(s).inserted { memberOrder.append(s) }
            // A member with no name of its own is named by the roster (tkMemberName: m.name || tskAgentName).
            if let n = a["name"] as? String, !n.isEmpty { members[s] = n }
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
        let whoIsLeft = Tasks.whoIsLeft(t)
        let kids = tasks.filter { integer($0["parent"]) == number }.sorted { (integer($0["number"]) ?? 0) < (integer($1["number"]) ?? 0) }
        func built(_ x: [String: Any]) -> Bool { !isClosed(x) && x["onHold"] as? Bool != true && text(x["builtAt"]) != nil }
        let subtasks = kids.compactMap { x -> SubtaskRow? in
            guard let n = integer(x["number"]) else { return nil }
            // kosmos#8146 (the board's tkPaintSubtasks since #8140): a held one reads On hold, not Open.
            let status = isClosed(x) ? (integer(x["replacedBy"]) != nil ? "Replaced" : "Done") : built(x) ? "Built"
                : x["onHold"] as? Bool == true ? "On hold" : "Open"
            return SubtaskRow(number: n, sentence: text(x["sentence"]) ?? "", status: status)
        }
        let parentNumber = integer(t["parent"])
        let parent = parentNumber.flatMap { n in tasks.first { integer($0["number"]) == n } }
        let replaces = tasks.filter { integer($0["replacedBy"]) == number && isClosed($0) }.compactMap { integer($0["number"]) }.sorted()
        var page = TaskPage(
            projectId: project, projectName: text(p["name"]) ?? project, projectPaused: p["paused"] as? Bool == true,
            members: members, memberSessions: memberSessions, number: number, sentence: text(t["sentence"]) ?? "", detail: text(t["detail"]),
            createdAt: text(t["createdAt"]), addedBy: text(t["addedBy"]), addedVia: text(t["addedVia"]),
            closed: closed, closedAt: closedAt,
            // Without the engine's progress the board says Open or Done (tkStateWord), never a count of its own.
            partsDone: integer(progress?["done"]) ?? 0,
            partsTotal: integer(progress?["total"]) ?? 1,
            replacedBy: integer(t["replacedBy"]), dueDate: text(t["dueDate"]),
            onHold: t["onHold"] as? Bool == true, onHoldByPerson: t["onHoldByPerson"] as? Bool == true,
            onHoldForPerson: t["onHold"] as? Bool == true && t["onHoldForPerson"] as? Bool == true,
            builtAt: text(t["builtAt"]), builtBy: text(t["builtBy"]), builtByPerson: t["builtByPerson"] as? Bool == true,
            builtNote: text(t["builtNote"]), builtWaitingOn: text(t["builtWaitingOn"]), whoFinished: whoIsLeft.finished, whoLeft: whoIsLeft.left, parts: parts, claim: claim, legacyWho: text(t["who"]),
            parentNumber: parent == nil ? nil : parentNumber, parentSentence: parent.flatMap { text($0["sentence"]) },
            subtasks: subtasks,
            allSubtasksDone: !kids.isEmpty && kids.allSatisfy(isClosed) && !closed,
            allSubtasksBuilt: !kids.isEmpty && !kids.allSatisfy(isClosed) && kids.allSatisfy { isClosed($0) || built($0) } && !closed,
            replaces: replaces)
        // kosmos#8958 slice B3: a task that repeats carries the board's words for its rule, runs and next run.
        var row = TaskRow(projectId: project, projectName: page.projectName, number: number, sentence: page.sentence, state: closed ? "done" : "open")
        fillRepeat(&row, t)
        if row.repeating { page.repeatRow = row }
        page.repeatStored = repeatStored(t["repeat"])
        page.repeatReviewer = t["repeatReviewerPerson"] as? Bool == true ? "me" : text(t["repeatReviewer"]) ?? "none"
        page.memberOrder = memberOrder
        if closed { page.receiptKey = closedAt ?? rawParts.compactMap { text($0["closedAt"]) }.max() ?? "" }
        page.closedUnrun = t["closedUnrun"] as? Bool == true
        return .page(page)
    }
}

// MARK: What the page says (the board's words)

extension Board.TaskPage {
    // tkMemberName: the project's name for an agent, else the roster's, else the session name; "(not on this project)"
    // for one that holds open work here without being a member (#6895).
    func name(_ session: String, roster: [String: String], holds: Bool = false) -> String {
        if let m = members[session] { return m }
        let shown = roster[session] ?? session
        return holds && !memberSessions.contains(session) ? shown + " (not on this project)" : shown
    }

    // tkStateWord, and the built words after it.
    var stateWord: String {
        if closed, let r = replacedBy { return "Replaced by task \(r)" }
        if partsTotal > 1 { return "\(partsDone) of \(partsTotal) parts done" }
        return closed ? "Done" : "Open"
    }

    // kosmos#8137: tkWhoLeftWords; nil on a task with one agent, or a closed one (the board sends none then).
    func whoLeftLine(roster: [String: String]) -> String? {
        let w = Tasks.whoLeftWords(finished: whoFinished, left: whoLeft) { name($0, roster: roster) }
        return w.isEmpty ? nil : w
    }

    func stateLine(roster: [String: String]) -> String {
        var line = stateWord
        if builtAt != nil && closedAt == nil {
            let who = builtByPerson ? "you" : builtBy.map { name($0, roster: roster) } ?? ""
            line += ", marked built" + (who.isEmpty ? "" : " by " + who) + Tasks.builtWaitsWords(builtWaitingOn) + (builtNote.map { ": " + $0 } ?? "")
        }
        if !replaces.isEmpty {
            line += (line.last.map { ".!?".contains($0) } == true ? " " : ". ") + "Replaces " + replaces.map { "task \($0)" }.joined(separator: ", ")
        }
        return line
    }

    // tkAdded: who added it and when, in whole days in the phone's own time zone.
    func added(now: Date, calendar: Calendar = .current) -> String { addedParts(now: now, calendar: calendar).words }

    // Who and when, and whether the who is one of tkAdded's own fixed words (You, A webhook, An agent, Somebody) rather
    // than a name, so the line drawn can lower it without ever touching a name.
    func addedParts(now: Date, calendar: Calendar = .current) -> (words: String, fixedOpening: String?) {
        let fixed: String? = addedVia == "webhook" ? (addedBy == nil ? "A webhook" : nil)
            : addedBy == "operator" ? "You"
            : (addedBy == nil ? (addedVia == "process" ? "An agent" : "Somebody") : nil)
        let who = fixed ?? (addedVia == "webhook" ? addedBy! + " (a webhook)" : addedBy!)
        return (addedWhen(who: who, now: now, calendar: calendar), fixed)
    }

    private func addedWhen(who: String, now: Date, calendar: Calendar) -> String {
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

    // The line the page draws: "Added by you, today" (tkAdded's own words start a sentence, so its fixed openings are
    // lowered here; a name is left as it is).
    func addedLine(now: Date, calendar: Calendar = .current) -> String {
        let parts = addedParts(now: now, calendar: calendar)
        guard let fixed = parts.fixedOpening else { return "Added by " + parts.words }
        return "Added by " + fixed.lowercased() + parts.words.dropFirst(fixed.count)
    }

    // The board's hold hint, said here only when there is something to say (a paused project, or a hold): the control
    // that the other hints describe is on the board's page.
    var holdLine: String? {
        guard !closed else { return nil }
        if projectPaused { return "This project is paused, so Kosmos does not nudge anyone about its tasks or hand them out." }
        guard onHold else { return nil }
        // kosmos#7788: an agent's hold that waits on the person, in the board's words (tk-hold-hint). kosmos#8958 slice B2:
        // the page takes it off now (Take off hold), so "here", as the board says.
        if onHoldForPerson && !onHoldByPerson {
            return "An agent put this on hold because it waits on you. Once you have answered, take it off hold here, or tell the agent. Kosmos does not nudge anyone about it or hand it out."
        }
        return onHoldByPerson
            ? "You put this on hold, so only you can take it off, here. Kosmos does not nudge anyone about it or hand it out."
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

    // These go through BoardClient, which marks every request to the Mac as the board's own (kosmos#7075,
    // Board.forMac). The Mac's isViaScreen reads that too: without it, marking a task seen is refused, a reopen is not
    // recorded as the person's, and a task whose repeat the person set cannot be closed.

    static func taskRoute(mac: URL, project: String, number: Int, _ tail: String) -> URL? {
        guard isProjectId(project), number > 0 else { return nil }
        return URL(string: "/api/project/\(project)/task/\(number)/\(tail)", relativeTo: mac)?.absoluteURL
    }

    // POST .../task/<n>/close or /reopen, with no body (the board's tk-done).
    static func taskActRequest(mac: URL, project: String, number: Int, act: TaskAct) -> URLRequest? {
        // Each act names its own route, so a new act cannot be built without one (and the iOS routes check reads each).
        let url: URL?
        switch act {
        case .close: url = taskRoute(mac: mac, project: project, number: number, "close")
        case .reopen: url = taskRoute(mac: mac, project: project, number: number, "reopen")
        }
        guard let url else { return nil }
        // Each request here has its own name, so server.ios-routes-6838.test.js can tell them apart (its SITES).
        var press = URLRequest(url: url)
        press.httpMethod = "POST"
        press.setValue("application/json", forHTTPHeaderField: "Accept")
        press.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return press
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
        var seen = URLRequest(url: url)
        seen.httpMethod = "POST"
        seen.setValue("application/json", forHTTPHeaderField: "Accept")
        return seen
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
        var activity = URLRequest(url: url)
        activity.setValue("application/json", forHTTPHeaderField: "Accept")
        activity.cachePolicy = .reloadIgnoringLocalCacheData
        return activity
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
        // kosmos#8679: the page's check-reported and edited (kosmos#8664) words; before, both showed their bare kind.
        case "check-reported":
            let who = nameOf("by") ?? "An agent"
            let check = integer(ev["check"]).flatMap { $0 >= 1 ? "\($0)" : nil } ?? "?"
            return who + " says done-when check " + check + (ev["met"] as? Bool == true ? " is met" : " is not met")
                + (s("how").map { ": " + $0 } ?? "")
        case "edited":
            let who = person ? "You" : nameOf("by")
            var bits: [String] = []
            if let title = ev["title"] as? String { bits.append("the title from " + ((ev["fromTitle"] as? String) ?? "") + " to " + title) }
            if ev["detailCleared"] as? Bool == true { bits.append("cleared the detail") }
            else if ev["detail"] is String { bits.append("changed the detail") }
            var what = bits.isEmpty ? "changed the task" : bits.joined(separator: " and ")
            if what.hasPrefix("the title") { what = "changed " + what }
            return who.map { $0 + " " + what } ?? (what.prefix(1).uppercased() + what.dropFirst())
        case "hold-set": return s("via") == "agent" ? "Put on hold by an agent" : "Put on hold"
        case "hold-cleared":
            return s("via") == "agent" ? "Taken off hold by an agent" : s("via") == "close" ? "Taken off hold, as it was closed" : "Taken off hold"
        case "parent-set": return integer(ev["parent"]).map { "Put under task \($0)" } ?? "Put under another task"
        case "parent-cleared": return "Taken out from under its task"
        case "repeat-set": return s("words").map { "Set to repeat " + $0 } ?? "Set to repeat"
        case "repeat-cleared": return "No longer repeats"
        case "run":
            let who = person ? "You" : nameOf("by")
            let missed = count(ev["missedBefore"]) ?? 0
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
        // kosmos#8581: its holder was told a run is due (engine/repeatdue.js), as the page words it.
        case "due-told":
            let who = nameOf("told") ?? "its holder"
            return ev["reached"] as? Bool == false ? "A run was due; Kosmos could not reach " + who : "A run was due; " + who + " was told"
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
        case "closed":
            if let r = integer(ev["replacedBy"]) { return "Closed as replaced by task \(r)" }
            if ev["notRun"] as? Bool == true { return "Closed without running" }   // kosmos#8301
            if s("via") == "parent", let p = integer(ev["parent"]) { return "Marked done with task \(p)" }   // kosmos#7514
            return "Marked done"
        case "not-run": return "Marked as not run"   // kosmos#8301
        case "replaced": return integer(ev["replacedBy"]).map { "Marked as replaced by task \($0)" } ?? "Marked as replaced"
        case "undone":
            let files = count(ev["files"]) ?? 0
            return files == 1 ? "One file\u{2019}s changes undone" : "File changes undone (\(files) files)"
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
    // A whole count of at least 1, clamped so no number the Mac sends can trap (the board's Number(x) >= 1).
    fileprivate static func count(_ v: Any?) -> Int? {
        guard let d = number(v), d.isFinite, d >= 1 else { return nil }
        return Int(min(d, 1_000_000_000).rounded(.down))
    }
}

// MARK: Saying something, the due date, and the words (kosmos#8958 slice B1: the board's tkSayPost, saveTaskDue, tk-editform)

extension Board {
    static let taskSayPlaceholder = "Say something about this task"
    static let taskSayLabel = "Add a message to this task"
    static let taskSayNote = "A message is recorded on the task, shows in the activity above, and is sent to the agents assigned to the task."
    static let taskSayMax = 2000
    static let taskSayFailed = "we could not record that message"
    static let taskSayUnreached = "we could not reach Kosmos to record that message"
    static let taskDueFailed = "we could not set that due date"
    static let taskDueUnreached = "we could not reach Kosmos to set that date"
    static let taskEditOpen = "Edit title or detail"
    static let taskEditTitle = "What needs doing?"
    static let taskEditDetail = "Anything they should know"
    static let taskEditTitleMax = 200
    static let taskEditDetailMax = 2000
    static let taskEditNeedsTitle = "A task needs a title: say what needs doing."
    static let taskEditFailed = "we could not change that task"

    // The board's maxlength and the Mac count UTF-16 units, so the phone's caps do too.
    static func capped(_ text: String, _ max: Int) -> String {
        guard text.utf16.count > max else { return text }
        var t = text
        while t.utf16.count > max { t.removeLast() }
        return t
    }
    // Line ends as the board's form reads them (/\r\n?/g).
    static func boardLineEnds(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    }

    private static func taskPost(_ url: URL?, _ body: [String: Any]) -> URLRequest? {
        guard let url, let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = data
        return r
    }

    // POST .../task/<n>/message {text}: the words trimmed; nothing for an empty box (the board sends nothing either).
    static func taskMessageRequest(mac: URL, project: String, number: Int, text: String) -> URLRequest? {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return nil }
        return taskPost(taskRoute(mac: mac, project: project, number: number, "message"), ["text": words])
    }

    // POST .../task/<n>/due {dueDate}: a calendar date (YYYY-MM-DD), or nil to clear it.
    static func taskDueRequest(mac: URL, project: String, number: Int, due: String?) -> URLRequest? {
        if let due, dueDay(due) == nil { return nil }
        return taskPost(taskRoute(mac: mac, project: project, number: number, "due"), ["dueDate": due.map { $0 as Any } ?? NSNull()])
    }

    // POST .../task/<n>/text with only what changed (the board's form): nil when nothing did.
    static func taskTextRequest(mac: URL, project: String, number: Int, body: [String: Any]) -> URLRequest? {
        guard !body.isEmpty else { return nil }
        return taskPost(taskRoute(mac: mac, project: project, number: number, "text"), body)
    }

    // The day a due date names, read in the person's own calendar (the Mac keeps the date alone, no time zone).
    private static func dueFormatter(_ calendar: Calendar) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }
    static func dueDay(_ s: String, calendar: Calendar = .current) -> Date? {
        guard s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
              let d = dueFormatter(calendar).date(from: s), dueString(d, calendar: calendar) == s else { return nil }
        return d
    }
    static func dueString(_ d: Date, calendar: Calendar = .current) -> String { dueFormatter(calendar).string(from: d) }

    // The Due section's picker: a date being chosen is kept only while it differs from the one the Mac holds, so a
    // draft that came back to the stored day, or that the stored day moved to, is dropped rather than left to show
    // later as a change nobody is making.
    static func keptDraft(_ draft: String?, stored: String?) -> String? {
        guard let draft, dueDay(draft) != nil, draft != stored else { return nil }
        return draft
    }
    // What the section shows: a date being chosen (Set and Cancel), a stored date (Clear), a stored date this phone cannot
    // read (said as kept, with Clear), or none (Set a due date).
    enum DueControls: Equatable { case choosing(String), stored(String), unreadable(String), none }
    static func dueControls(stored: String?, draft: String?) -> DueControls {
        if let d = keptDraft(draft, stored: stored) { return .choosing(d) }
        if let s = stored { return dueDay(s) != nil ? .stored(s) : .unreadable(s) }
        return .none
    }

    enum TaskEdit: Equatable { case nothing, needsTitle, send([String: String?]) }
    // The board's Save: both trimmed; a title is needed; only what differs from what the form opened with is sent, and
    // an emptied detail goes as null (cleared). Line ends compared as a textarea gives them back.
    static func taskEdit(title: String, detail: String, openedTitle: String, openedDetail: String?) -> TaskEdit {
        // A title is one line: a line break in it is a space. (The board's text input drops a stored line break instead,
        // and so sends such a title back as changed; the phone compares both sides one line, below, and does not.)
        func oneLine(_ s: String) -> String { boardLineEnds(s).replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespacesAndNewlines) }
        let t = oneLine(title)
        let d = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return .needsTitle }
        var body: [String: String?] = [:]
        if t != oneLine(openedTitle) { body["sentence"] = t }
        let was = boardLineEnds(openedDetail ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if d != was { body["detail"] = d.isEmpty ? .some(nil) : .some(d) }
        return body.isEmpty ? .nothing : .send(body)
    }
    static func taskTextBody(_ edit: [String: String?]) -> [String: Any] {
        edit.mapValues { $0.map { $0 as Any } ?? NSNull() }
    }

    // A write's answer: a 2xx is done; a refusal is the Mac's own words, else the board's; no answer, the board's
    // could-not-reach words.
    static func taskWriteResult(status: Int, body: Data?, failed: String, unreached: String) -> TaskActResult {
        if (200...299).contains(status) { return .done }
        if status == 0 { return .refused(unreached) }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if let e = obj?["error"] as? String, !e.isEmpty { return .refused(e) }
        return .refused(failed)
    }

    // #5842 on the board: who a message on the task did NOT reach, one line per agent (its worst outcome when listed
    // twice), in the page's own sentences. nil when every assignee got it, or the answer had no list (the board says
    // nothing then either).
    static func taskSaidLine(_ body: Data?, name: (String) -> String) -> String? {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        guard let all = obj?["delivered"] as? [Any] else { return nil }
        // The board tests the list as it came (an empty one means nobody is assigned); entries that are not objects are
        // skipped after that.
        if all.isEmpty { return "No agent is assigned to this task, so nobody was told." }
        let list = all.compactMap { $0 as? [String: Any] }
        func rank(_ s: String?) -> Int { s == "could_not" ? 3 : s == "placed" ? 0 : s == "held" ? 1 : 2 }
        var order: [String] = []
        var by: [String: [String: Any]] = [:]
        for d in list {
            // The board's String(d.agent == null ? '' : d.agent).trim().
            let raw = d["agent"]
            let key = raw == nil || raw is NSNull ? "" : String(describing: raw!).trimmingCharacters(in: .whitespacesAndNewlines)
            if let had = by[key] { if rank(d["state"] as? String) > rank(had["state"] as? String) { by[key] = d } } else { order.append(key); by[key] = d }
        }
        var lines: [String] = []
        for sn in order {
            guard let d = by[sn] else { continue }
            let state = d["state"] as? String ?? ""
            if state == "placed" { continue }
            let who = sn.isEmpty ? "an agent" : name(sn)
            let lead = sn.isEmpty ? "An agent" : who
            let why = d["because"] as? String ?? ""
            func has(_ s: String) -> Bool { why.contains(s) }
            if state == "could_not" {
                let line = has("switched off in this project")
                    ? lead + " is switched off in this project, so it was not told. Switch it on in the project's members to send it work here."
                    : has("not on this project any more") ? lead + " is not on this project any more, so it was not told."
                    : has("could not keep this one") ? "Kosmos could not keep your message for " + who + ", so it was not told."
                    : has("input box already holds text") ? lead + "'s input box held text that had not been sent, so it was not told."
                    : "Kosmos could not reach " + who + ", so it was not told."
                lines.append(line + " Your message stays on the task.")
            } else if state == "held" {
                // The board names the reset time (quotaResetWords); the phone says the same sentence without it, as its
                // other held lines do (AgentInfoLogic wakeHeldLine).
                let out = (d["heldUntil"] as? String).flatMap(isoDate).map { $0 > Date() } == true
                lines.append((d["heldFor"] as? String) == "signin" ? lead + " is signed out. Kosmos will try to send your message to " + who + " once it is signed in again."
                    : out ? lead + " is out of usage. Kosmos will try to send your message to " + who + " once its usage resets."
                    : has("still has messages kept") ? "Kosmos will try to send your message to " + who + " after the ones already waiting for it."
                    : "Kosmos is keeping your message and will try to send it to " + who + " later.")
            } else {
                lines.append("Kosmos could not confirm that " + who + " got it.")
            }
        }
        return lines.isEmpty ? nil : lines.joined(separator: " ")
    }
}

// MARK: Putting it on hold and taking it off (kosmos#8958 slice B2: the board's tk-hold button)

extension Board {
    static func holdTitle(onHold: Bool) -> String { onHold ? "Take off hold" : "Put on hold" }
    static let holdCheckFailed = "We could not check that task just now, so nothing changed."
    static let holdTaskGone = "That task is no longer on this project, so nothing changed."
    static let holdAlready = "This is already on hold, so nothing changed."
    static let holdFailed = "We could not change that task."
    static let holdUnreached = "We could not reach Kosmos to change that task."
    // The board cuts this ask off the unhold route's sentence and puts a Choose who button under it; the phone has no
    // picker for a task's parts yet, so the ask is cut and holdChooseOnBoard said in its place (review 1: the person is
    // told where choosing happens, not left at "so it waits for a person.").
    static let holdAssignAsk = " To choose who, assign it now."
    static let holdChooseOnBoard = " To choose who, open this task on your computer's board."

    // POST .../task/<n>/hold {onHold}.
    static func taskHoldRequest(mac: URL, project: String, number: Int, onHold: Bool) -> URLRequest? {
        guard let url = taskRoute(mac: mac, project: project, number: number, "hold"),
              let data = try? JSONSerialization.data(withJSONObject: ["onHold": onHold]) else { return nil }
        var hold = URLRequest(url: url)
        hold.httpMethod = "POST"
        hold.setValue("application/json", forHTTPHeaderField: "Accept")
        hold.setValue("application/json", forHTTPHeaderField: "Content-Type")
        hold.httpBody = data
        return hold
    }

    // What the unhold route says next (who gets the task now), or nil: a hold answers with none. Where the board would
    // show Choose who (the route's closing ask, or a free part beside one somebody is on: its looseBesideHeld), the phone
    // says to choose on the computer's board instead.
    static func holdNextLine(_ body: Data?, page: TaskPage? = nil) -> String? {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        guard var next = obj?["next"] as? String, !next.isEmpty else { return nil }
        var ask = false
        if next.hasSuffix(holdAssignAsk) { next.removeLast(holdAssignAsk.count); ask = true }
        let open = page?.parts.filter { !$0.closed } ?? []
        let looseBesideHeld = open.contains { $0.who != nil } && open.contains { $0.who == nil }
        if next.isEmpty { return nil }
        return ask || looseBesideHeld ? next + holdChooseOnBoard : next
    }

    // The board's tkHoldNextSig: what the next sentence was read from (open, held or closed, who is on each open part,
    // and the project's pause and members, named or not: review 2). Narrower than the board's in one way (review 3):
    // members are the parsed session names, sorted, so a member with no session name, or the roster's order, does not
    // count here; the line can then stay where the board would take it down, never the reverse. `project` is the shown page, for a task read
    // out of the hold route's answer, which carries no project.
    static func holdNextSig(_ t: TaskPage, project: TaskPage? = nil) -> String {
        let p = project ?? t
        let state = t.closed ? "closed" : t.onHold ? "held" : "open"
        let who = t.parts.filter { !$0.closed }.map { $0.who ?? "" }.joined(separator: ",")
        let proj = (p.projectPaused ? "paused" : "live") + ":" + p.memberSessions.sorted().joined(separator: ",")
        return state + "|" + who + "|" + proj
    }

    // The task the hold route's answer describes (its `task`), read as a task page; nil when the answer has none. The
    // board records the next sentence against this task, not against its own read after the post (review 2).
    static func holdAnswerTask(_ body: Data?, project: String, number: Int) -> TaskPage? {
        guard let obj = body.flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }),
              var task = obj["task"] as? [String: Any] else { return nil }
        task["number"] = number
        guard let wrapped = try? JSONSerialization.data(withJSONObject: ["projects": [["id": project, "tasks": [task]]]]),
              case .page(let t) = parseTaskPage(wrapped, project: project, number: number) else { return nil }
        return t
    }
}

// MARK: How often it repeats (kosmos#8958 slice B3: the board's Repeats controls, tk-repeat-*)

extension Board {
    // The board's frequency choices (tk-repeat-every), in its order and words.
    enum RepeatEvery: String, CaseIterable, Equatable {
        case never = "", minutes, hour, day, week
        var words: String {
            switch self {
            case .never: return "Never"
            case .minutes: return "Every so many minutes"
            case .hour: return "Every hour"
            case .day: return "Every day"
            case .week: return "Every week"
            }
        }
    }
    // The days as the route reads them (taskrepeat.fromWords), Monday first as the board lists them.
    static let repeatDays: [(key: String, words: String)] = [("mon", "Monday"), ("tue", "Tuesday"), ("wed", "Wednesday"),
        ("thu", "Thursday"), ("fri", "Friday"), ("sat", "Saturday"), ("sun", "Sunday")]
    // The engine's day numbers (Sunday 0), the board's TK_REPEAT_DAYS.
    static let repeatDayOfNumber = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

    // What the controls hold, each box keeping its own value whichever frequency shows (as the board's inputs do): the
    // minutes box, the time box, a daily rule's other times (kosmos#5752: the box shows the first, the line says them
    // all) and the day. Defaults as the board's tkRepeatShowChoice: 30 minutes, 9am, Monday.
    struct RepeatChoice: Equatable {
        var every: RepeatEvery
        var minutes = "30"
        var at = "09:00"
        var others: [String] = []
        var on = "mon"
    }

    // What a choice sends, as the board's tkRepeatChoice: nothing yet for an empty box (needsMinutes, needsTime). Two
    // choices are the same rule when these are equal, which is how Save knows there is nothing to save. Unlike the
    // board, a daily list is compared sorted on both sides (the engine stores it sorted, so the two agree on real data).
    enum RepeatWire: Equatable {
        case clear, hour, minutes(String), day(String), week(on: String, at: String), needsMinutes, needsTime
    }
    static func repeatWire(_ c: RepeatChoice) -> RepeatWire {
        switch c.every {
        case .never: return .clear
        case .hour: return .hour
        case .minutes:
            let m = c.minutes.trimmingCharacters(in: .whitespacesAndNewlines)
            if m.isEmpty { return .needsMinutes }
            // Written as the board stores it (review 2 on the board): "030" is 30, and 60 minutes is the hourly rule.
            let n = m.allSatisfy({ $0.isASCII && $0.isNumber }) ? (Int(m).map(String.init) ?? m) : m
            return n == "60" ? .hour : .minutes(n)
        case .day:
            if c.at.isEmpty { return .needsTime }
            if c.others.isEmpty { return .day(c.at) }
            return .day(Array(Set([c.at] + c.others)).sorted().joined(separator: ","))
        case .week:
            if c.at.isEmpty { return .needsTime }
            return .week(on: c.on, at: c.at)
        }
    }
    // The request body for a choice (the board's JSON), nil while a box is empty.
    static func repeatBody(_ w: RepeatWire) -> [String: Any]? {
        switch w {
        case .clear: return ["clear": true]
        case .hour: return ["every": "hour"]
        case .minutes(let n): return ["every": "minutes", "at": n]
        case .day(let at): return ["every": "day", "at": at]
        case .week(let on, let at): return ["every": "week", "on": on, "at": at]
        case .needsMinutes, .needsTime: return nil
        }
    }
    // The board's tkRepeatDirty line for an empty box.
    static func repeatNeeds(_ w: RepeatWire) -> String? {
        switch w {
        case .needsMinutes: return "Say how many minutes"
        case .needsTime: return "Choose a time"
        default: return nil
        }
    }

    // The stored rule (a task's `repeat`) as the controls show it, the board's tkRepeatStoredChoice and
    // tkRepeatShowChoice together: never for none; nil for a rule the controls cannot show (the line still says it).
    // An hourly rule an agent set at another minute shows as hourly: from this screen hourly runs on the hour, and the
    // rule reads unchanged until the person changes it (as on the board).
    static func repeatStored(_ raw: Any?) -> RepeatChoice? {
        guard let r = raw as? [String: Any] else { return raw == nil || raw is NSNull ? RepeatChoice(every: .never) : nil }
        switch r["every"] as? String {
        case "hour": return RepeatChoice(every: .hour)
        case "minutes":
            guard let n = integer(r["n"]) else { return nil }
            return RepeatChoice(every: .minutes, minutes: String(n))
        case "day":
            let list = ((r["at"] as? [Any])?.compactMap { $0 as? String } ?? (r["at"] as? String).map { [$0] } ?? []).filter { !$0.isEmpty }
            guard let first = list.first else { return nil }
            return RepeatChoice(every: .day, at: first, others: list.dropFirst().filter { $0 != first })
        case "week":
            guard let d = integer(r["day"]), repeatDayOfNumber.indices.contains(d), let at = r["at"] as? String, !at.isEmpty else { return nil }
            return RepeatChoice(every: .week, at: at, on: repeatDayOfNumber[d])
        default: return nil
        }
    }

    // The person's choice kept over the stored rule, the board's paint: nil (follow what is stored) once it is the same
    // rule. A daily rule changed elsewhere under an edit keeps the edit, but its other times follow the new rule (the
    // board's tkRepeatFollowUnderEdit, kosmos#5752 round 3), so Save never sends times that are on no screen.
    static func keptRepeatDraft(_ draft: RepeatChoice?, stored: RepeatChoice?) -> RepeatChoice? {
        guard var d = draft, let stored else { return nil }
        // First as it stands: a draft that IS the stored rule goes (after a save, the rule just saved). Following the
        // others first would rebuild them from the sorted stored list and lose a time the box had moved past.
        if repeatWire(d) == repeatWire(stored) { return nil }
        // Whatever frequency the draft shows (the board's keeps its others for every choice): a weekly draft switched
        // back to daily must carry the new rule's other times, never ones that were removed while it was weekly.
        let list = stored.every == .day ? [stored.at] + stored.others : []
        d.others = Array(list.dropFirst()).filter { $0 != d.at }
        return repeatWire(d) == repeatWire(stored) ? nil : d
    }

    // The stored rule as the controls show it, with a daily rule's box on `box` when the stored list holds that time:
    // after a save, the box stays on the time the person put in it, whichever place it sorts to (the board's
    // tkRepeatSaved, kosmos#5752 round 3). Any other rule, or a box the list no longer holds, shows as stored.
    static func repeatShown(_ stored: RepeatChoice?, box: String?) -> RepeatChoice? {
        guard var s = stored, s.every == .day, let box, box != s.at, s.others.contains(box) else { return stored }
        s.others = ([s.at] + s.others).filter { $0 != box }
        s.at = box
        return s
    }

    // The stored rule moved (another device, an agent) under a draft: a draft that was the OLD rule is nothing unsaved,
    // so the controls follow the new one (the board's tkPaintRepeat review 3); any other draft stands, as keptRepeatDraft
    // keeps it.
    static func followStored(_ draft: RepeatChoice?, old: RepeatChoice?, new: RepeatChoice?) -> RepeatChoice? {
        guard let draft else { return nil }
        if let old, repeatWire(draft) == repeatWire(old) { return nil }
        return keptRepeatDraft(draft, stored: new)
    }

    // A time box's "HH:mm" as a picker's Date, and back. The time is the computer's clock as the board keeps it, so it
    // is read and written in one fixed calendar, never moved by this phone's time zone.
    static let repeatClock: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }()
    static func repeatTime(_ at: String) -> Date {
        let parts = at.split(separator: ":").compactMap { Int($0) }
        let (h, m) = parts.count == 2 ? (parts[0], parts[1]) : (9, 0)
        return repeatClock.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: h, minute: m)) ?? Date(timeIntervalSince1970: 0)
    }
    static func repeatTimeString(_ d: Date) -> String {
        let c = repeatClock.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
    }

    static let repeatFailed = "we could not change how that task repeats"
    static let repeatUnreached = "we could not reach Kosmos to change how that task repeats"
    static let repeatSaved = "Saved."
    static let repeatOnBoard = "This task repeats in a way this screen cannot show. To change it, open it on your computer's board."

    // POST .../task/<n>/repeat with the board's body; nil while a box is empty.
    static func taskRepeatRequest(mac: URL, project: String, number: Int, wire: RepeatWire) -> URLRequest? {
        guard let body = repeatBody(wire) else { return nil }
        return taskPost(taskRoute(mac: mac, project: project, number: number, "repeat"), body)
    }
}

// MARK: Who is told when a run is missed (kosmos#8958 slice B3b: the board's tk-review-who)

extension Board {
    struct ReviewerOption: Equatable, Hashable { let value: String; let words: String }
    // The board's tkPaintReviewer list: Nobody, Me, the project's agents in its order, and a stored reviewer no longer on
    // the project, said so, so the choice never shows something that is not stored.
    static func reviewerOptions(_ p: TaskPage, roster: [String: String]) -> [ReviewerOption] {
        var agents = p.memberOrder
        let stored = p.repeatReviewer
        if stored != "none" && stored != "me" && !p.memberSessions.contains(stored) { agents.append(stored) }
        return [ReviewerOption(value: "none", words: "Nobody"), ReviewerOption(value: "me", words: "Me")]
            + agents.map { ReviewerOption(value: $0, words: p.name($0, roster: roster) + (p.memberSessions.contains($0) ? "" : " (left the project)")) }
    }
    static let reviewerFailed = "we could not change who is told"
    static let reviewerUnreached = "we could not reach Kosmos to change who is told"

    // POST .../task/<n>/repeat {reviewer}: the same route as the rule, with only the reviewer (the board's change).
    static func taskReviewerRequest(mac: URL, project: String, number: Int, reviewer: String) -> URLRequest? {
        taskPost(taskRoute(mac: mac, project: project, number: number, "repeat"), ["reviewer": reviewer])
    }
}

// MARK: A closed task's receipt (kosmos#8958 slice B4: the board's tk-receipt, #5153 and #6842)

extension Board {
    struct Receipt: Equatable {
        // "This task was put back ... and handed on ...", or that it was done without; nil when the board says nothing.
        let again: String?
        let agents: [ReceiptAgent]
    }
    struct ReceiptPR: Equatable { let label: String; let url: URL? }
    struct ReceiptAgent: Equatable, Identifiable {
        let id: Int
        let who: String
        // What it did, or why there is nothing to show (muted).
        let line: String
        let muted: Bool
        // "Worked on pull request app#12." in pieces, so each number can be its own link: the words before, the pull
        // requests, the words after. Empty when there are none.
        let prs: [ReceiptPR]
        let prsBefore: String
        let prsAfter: String
        // "4 files", or nil when it edited none; the list under it; the agent's folder.
        let filesTitle: String?
        let files: [String]
        let folder: String?
    }
    enum ReceiptRead: Equatable { case receipt(Receipt), none, unreadable }

    static let receiptIntro = "What each agent did while it held this task, including anything else it did in that time. A file changed by a command counts as a command."
    static let receiptNobody = "Nobody held this task, so there is no work to show."
    static let receiptTools = ["codex": "Codex", "gemini": "Gemini CLI", "grok": "Grok", "antigravity": "Antigravity", "muse": "Muse"]

    // GET .../task/<n>/receipt. Asked only for a closed task; an open one answers { ready: false }.
    static func taskReceiptRequest(mac: URL, project: String, number: Int) -> URLRequest? {
        guard let url = taskRoute(mac: mac, project: project, number: number, "receipt") else { return nil }
        var receipt = URLRequest(url: url)
        receipt.setValue("application/json", forHTTPHeaderField: "Accept")
        receipt.cachePolicy = .reloadIgnoringLocalCacheData
        // The Mac answers only when the whole receipt is worked out, and an agent's long transcripts can take longer than the
        // 15 s every other call keeps (the board's own read sets no limit).
        receipt.timeoutInterval = receiptTimeout
        return receipt
    }
    static let receiptTimeout: TimeInterval = 120

    // tkReceiptHtml. `replaced` (the task was closed as replaced) and `unrun` (closed as never run): the board then says
    // nothing about put-backs when there were none.
    static func parseReceipt(_ data: Data, replaced: Bool, unrun: Bool) -> ReceiptRead {
        guard let r = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .unreadable }
        if r["ready"] as? Bool == false { return .none }
        let retries = r["retries"] as? [String: Any] ?? [:]
        func times(_ k: Double) -> String { k == 1 ? "1 time" : receiptNum(k) + " times" }
        let reopened = amount(retries["reopened"]), handoffs = amount(retries["handoffs"])
        let again = [reopened > 0 ? "put back " + times(reopened) : nil, handoffs > 0 ? "handed on " + times(handoffs) : nil].compactMap { $0 }
        let agents = (r["agents"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
        return .receipt(Receipt(
            again: !again.isEmpty ? "This task was " + again.joined(separator: " and ") + "."
                : replaced || unrun ? nil : "Done without being put back or handed on.",
            agents: agents.enumerated().map { receiptAgent($0, $1) }))
    }

    // tkReceiptAgentHtml, for one entry of the receipt's agents.
    private static func receiptAgent(_ i: Int, _ a: [String: Any]) -> ReceiptAgent {
        let who = a["who"] as? String ?? ""
        let provider = (a["provider"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        func quiet(_ line: String) -> ReceiptAgent {
            ReceiptAgent(id: i, who: who, line: line, muted: true, prs: [], prsBefore: "", prsAfter: "", filesTitle: nil, files: [], folder: nil)
        }
        guard a["available"] as? Bool == true else {
            return quiet(a["because"] as? String == "provider"
                ? "A receipt is not available for " + (provider.map { receiptTools[$0] ?? $0 } ?? "this provider") + " agents yet."
                : "Not an agent with a folder on this computer, so there is nothing to read.")
        }
        guard amount(a["transcriptsWithWork"]) > 0 else {
            let tool = provider.map { $0 == "claude" ? "Claude Code" : receiptTools[$0] ?? $0 } ?? "Claude Code"
            return quiet("No " + tool + " activity found while it held this task.")
        }
        let files = (a["files"] as? [Any] ?? []).compactMap { $0 as? String }
        let filesMore = amount(a["filesMore"])
        let nFiles = Double(files.count) + filesMore
        let commands = amount(a["commands"])
        var bits = [
            nFiles == 1 ? "Edited 1 file" : "Edited " + receiptNum(nFiles) + " files",
            commands == 1 ? "ran 1 command" : "ran " + receiptNum(commands) + " commands",
            receiptAbbr(receiptTokens(a["models"])) + " tokens",
        ]
        if let cost = receiptCost(a["cost"]) { bits.append(cost) }
        let folder = (a["folder"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let prs = receiptPRs(a)
        return ReceiptAgent(
            id: i, who: who, line: bits.joined(separator: ", ") + ".", muted: false,
            prs: prs.list, prsBefore: prs.before, prsAfter: prs.after,
            filesTitle: nFiles == 0 ? nil : nFiles == 1 ? "1 file" : receiptNum(nFiles) + " files",
            files: files + (filesMore > 0 ? ["and " + receiptNum(filesMore) + " more"] : []), folder: folder)
    }

    // tkReceiptPrsHtml: a link only to a github.com pull request, as the engine wrote it.
    private static func receiptPRs(_ a: [String: Any]) -> (list: [ReceiptPR], before: String, after: String) {
        let list = (a["prs"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }.compactMap { p -> ReceiptPR? in
            guard let n = integer(p["number"]) else { return nil }
            let repo = (p["repo"] as? String ?? "").components(separatedBy: "/").last ?? ""
            let url = (p["url"] as? String).flatMap { u in
                u.range(of: #"\Ahttps://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/[0-9]+\z"#, options: .regularExpression) == nil ? nil : URL(string: u)
            }
            return ReceiptPR(label: repo + "#" + String(n), url: url)
        }
        guard !list.isEmpty else { return ([], "", "") }
        let more = amount(a["prsMore"])
        return (list, Double(list.count) + more == 1 ? "Worked on pull request " : "Worked on pull requests ",
                (more > 0 ? (a["upTo"] as? Bool == true ? " and up to " : " and ") + receiptNum(more) + " more" : "") + ".")
    }

    // The cost words of tkTokensAndCost, from the numbers the Mac worked out; nil from a Mac that sends none.
    static func receiptCost(_ raw: Any?) -> String? {
        guard let cost = raw as? [String: Any] else { return nil }
        let unpriced = (cost["unpriced"] as? [Any] ?? []).compactMap { $0 as? String }
        let named = unpriced.joined(separator: ", ")
        if let usd = number(cost["usd"]) {
            return receiptUsd(usd) + " at API prices"
                + (unpriced.isEmpty ? "" : " (not counting " + named + (unpriced.count > 1 ? ", which have" : ", which has") + " no published price)")
        }
        return unpriced.isEmpty ? nil : "no published price for " + named
    }

    // usageRowTokenTotal over a model -> buckets map: the four token fields, never `rows`.
    static func receiptTokens(_ models: Any?) -> Double {
        (models as? [String: Any] ?? [:]).values.reduce(0.0) { sum, b in
            let b = b as? [String: Any] ?? [:]
            return sum + ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].reduce(0.0) { $0 + amount(b[$1]) }
        }
    }

    // The page's Number(x) || 0 for a count the Mac sends.
    fileprivate static func amount(_ v: Any?) -> Double { number(v).flatMap { $0.isFinite ? $0 : nil } ?? 0 }

    // usageNum: grouped digits.
    static func receiptNum(_ v: Double) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "en_US"); f.maximumFractionDigits = 3
        return f.string(from: NSNumber(value: v)) ?? String(v)
    }
    // JavaScript's toFixed for a number of at least 0: printf rounds an exact tie to even, toFixed rounds it up. A double is
    // an exact tie at d digits only when v * 2^(d+1) is an odd whole number.
    static func toFixed(_ v: Double, _ d: Int) -> String {
        let t = v * pow(2, Double(d + 1))
        let tie = t == t.rounded() && t.truncatingRemainder(dividingBy: 2) == 1
        // No locale argument: with one, Foundation rounds the shortest decimal (9.995 becomes 10.00) and not the number itself.
        return String(format: "%.\(d)f", tie ? v.nextUp : v)
    }
    // usageAbbr: the unit is chosen after rounding.
    static func receiptAbbr(_ v: Double) -> String {
        func rounded(_ x: Double, _ d: Int) -> Double { Double(toFixed(x, d)) ?? x }
        if v >= 1e9 || rounded(v / 1e6, 1) >= 1000 { return toFixed(v / 1e9, v >= 1e10 || rounded(v / 1e9, 1) >= 10 ? 0 : 1) + "B" }
        if v >= 1e6 || rounded(v / 1e3, 0) >= 1000 { return toFixed(v / 1e6, 1) + "M" }
        if v >= 1e3 { return toFixed(v / 1e3, 0) + "K" }
        return toFixed(v, 0)
    }
    // usageUsd.
    static func receiptUsd(_ v: Double) -> String {
        if v >= 1e9 { return "$" + toFixed(v / 1e9, 2) + "B" }
        if v >= 1e6 { return "$" + toFixed(v / 1e6, 0) + "M" }
        if v >= 1e3 { return "$" + receiptNum((v + 0.5).rounded(.down)) }
        return "$" + toFixed(v, v < 10 ? 2 : 0)
    }
}
