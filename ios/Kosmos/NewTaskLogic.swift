import Foundation

// The native New task sheet's logic (kosmos#7078, gap 2 of #7074), UIKit-free so LogicTests compile it for macOS.
// It files a task exactly as the board's New task dialog does (web/index.html, the nt- functions): the same fields, the
// same request and the same words for its answers. The board's words are read from web/index.html by the tests.
enum NewTask {
    // What the person has typed and picked. `who` is an agent's session name (the board's nt-who option value), nil
    // for "Nobody yet"; `parent` a task number in the same project, nil for None.
    struct Draft: Equatable {
        var project: String?
        var what = ""
        var done = ""
        var detail = ""
        var who: String?
        var parent: Int?
    }

    // ntChoices: every project that is not archived, in chain order (each sub-project right after its parent, by name),
    // which is the project tree sorted A to Z.
    static func projects(_ list: Board.ProjectList) -> [Board.ProjectTreeRow] {
        Board.projectTree(list.projects, sort: .az)
    }

    // pjChainOption: its own name first, so a picker cut short still says which project: "Launch, in Book A".
    static func projectWords(_ row: Board.ProjectTreeRow, in list: Board.ProjectList) -> String {
        var names = [row.project.name]
        var at = row.project.parent
        var seen = Set([row.project.id])
        while let id = at, !seen.contains(id), let p = list.projects.first(where: { $0.id == id }) {
            names.insert(p.name, at: 0); seen.insert(id); at = p.parent
        }
        return names.count < 2 ? names[0] : names.last! + ", in " + Tasks.chainText(Array(names.dropLast()))
    }

    // The Tasks view's picked project when it is one the sheet offers (openNewTaskFromTasks also files to an archived
    // pick; the sheet offers unarchived projects only), else the first offered.
    static func firstProject(picked: String?, offered: [Board.ProjectTreeRow]) -> String? {
        if let picked, offered.contains(where: { $0.project.id == picked }) { return picked }
        return offered.first?.project.id
    }

    // The draft outlives the sheet, aimed as the board's openNewTask aims it. With a project picked in the Tasks tab
    // the sheet is for that project, and a draft for another starts clean (ntAimAt). On All projects it keeps its
    // project only while words are typed (what, details or done) and the project is still offered; else the first
    // offered, and the words follow. Never sent to a project the picker cannot show.
    static func settled(_ d: Draft, picked: String?, offered: [Board.ProjectTreeRow]) -> Draft {
        if let picked, offered.contains(where: { $0.project.id == picked }) {
            return d.project == picked ? d : Draft(project: picked)
        }
        let drafted = !trimmed(d.what).isEmpty || !trimmed(d.detail).isEmpty || !trimmed(d.done).isEmpty
        if drafted, let p = d.project, offered.contains(where: { $0.project.id == p }) { return d }
        guard let first = firstProject(picked: nil, offered: offered) else {
            var n = d
            n.project = nil; n.who = nil; n.parent = nil
            return n
        }
        return aimed(d, at: first)
    }

    // The nt-who options: the project's members, by the name the board shows, "Nobody yet" first (in the view).
    static func members(of project: String?, in list: Board.ProjectList) -> [Board.ProjectMember] {
        list.projects.first { $0.id == project }?.members ?? []
    }

    // ntFillParents: the project's open tasks, newest first (by number), None by default. Read from the Tasks tab's own
    // list, which is every task of every project.
    static func parents(of project: String?, in read: Board.TasksRead?) -> [Board.TaskRow] {
        guard let project, let read else { return [] }
        return read.tasks.filter { $0.projectId == project && $0.state != "closed" }.sorted { $0.number > $1.number }
    }

    // A different project picked: the words stay, who and Part of do not (an agent or a task picked for one project
    // was not picked for another), as the board's nt-proj change.
    static func aimed(_ d: Draft, at project: String) -> Draft {
        var n = d
        if project != d.project { n.who = nil; n.parent = nil }
        n.project = project
        return n
    }

    // A pick that is no longer offered (its task closed or went, the member left, under a re-read) falls back to
    // nobody and None, as the board's selects fall back to their first option (ntFillParents), never sent unseen.
    // parents nil is a Tasks read that failed: nothing is known about Part of, so its pick stays.
    static func keepingOffered(_ d: Draft, members: [Board.ProjectMember], parents: [Board.TaskRow]?) -> Draft {
        var n = d
        if let who = d.who, !members.contains(where: { $0.session == who }) { n.who = nil }
        if let parent = d.parent, let parents, !parents.contains(where: { $0.number == parent }) { n.parent = nil }
        return n
    }

    // ntGoState: Create is held down until what needs doing, how you will know it is done, and a project exist.
    static func canCreate(_ d: Draft) -> Bool {
        d.project != nil && !trimmed(d.what).isEmpty && !trimmed(d.done).isEmpty
    }

    static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    // After "could not tell", the words that got no answer hold Create back while they are what the draft says (the
    // project and the three fields, as sent): a second create of the same words is how a duplicate gets made. Other
    // words, or another project, are another task.
    // The person can lift it ("Create it anyway") once they have looked; a Tasks read that shows the task lifts it too.
    struct Held: Equatable {
        var sent: Draft
        var before: Set<Int>?   // the project's task numbers when it was sent, for found(_:in:before:)
    }
    static func heldBack(_ d: Draft, by held: Held?) -> Bool {
        guard let s = held?.sent else { return false }
        return d.project == s.project && trimmed(d.what) == trimmed(s.what) && trimmed(d.done) == trimmed(s.done)
            && trimmed(d.detail) == trimmed(s.detail)
    }
    static let anyway = "Create it anyway"

    // After "could not tell", a Tasks read that came back: the open task in the project it was sent to, with the
    // sentence it was sent with, that was not there when it was sent. Nil when the read cannot say (no list from before
    // the send, so an older task with the same words could not be told apart).
    static func found(_ sent: Draft, in read: Board.TasksRead, before: Set<Int>?) -> Int? {
        guard let before, let project = sent.project else { return nil }
        let words = trimmed(sent.what)
        return read.tasks.first {
            $0.projectId == project && $0.state != "closed" && !before.contains($0.number) && trimmed($0.sentence) == words
        }?.number
    }

    // The board's limits (its inputs' maxlength, engine/tasks.js SENTENCE_MAX and DETAIL_MAX), counted as the page
    // counts them, in UTF-16 units, and never splitting a character. Over 200 the Mac shortens a title and moves it into
    // the details, saying so only in the note this sheet does not show, so the sheet stops the typing there instead.
    static let whatMax = 200
    static let doneMax = 200
    static let detailMax = 2000
    static func capped(_ s: String, at max: Int) -> String {
        var used = 0
        var out = ""
        for c in s {
            used += c.utf16.count
            if used > max { break }
            out.append(c)
        }
        return out
    }

    // The board asks both questions in one-line inputs, and the Mac refuses a done-when check of more than one line,
    // so a line break typed (or pasted) into either becomes a space.
    static func oneLine(_ s: String) -> String {
        s.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).joined(separator: " ")
    }

    // The board's nt-go body: the sentence as typed, the details and the check trimmed (left out when empty), who and
    // Part of only when picked.
    static func body(_ d: Draft) -> [String: Any] {
        var b: [String: Any] = ["sentence": d.what]
        let detail = trimmed(d.detail)
        if !detail.isEmpty { b["detail"] = detail }
        let done = trimmed(d.done)
        if !done.isEmpty { b["doneWhen"] = [done] }
        if let who = d.who, !who.isEmpty { b["who"] = who }
        if let parent = d.parent { b["parent"] = parent }
        return b
    }

    // POST /api/project/<id>/tasks. The route reads whether the person's screen asked (isViaScreen); every request
    // BoardClient sends to the Mac carries that (#7075), so nothing is added here.
    static func request(mac: URL, draft d: Draft) -> URLRequest? {
        guard let project = d.project, Board.isProjectId(project), canCreate(d),
              let data = try? JSONSerialization.data(withJSONObject: body(d)) else { return nil }
        var r = URLRequest(url: URL(string: "/api/project/\(project)/tasks", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = data
        return r
    }

    enum Result: Equatable {
        // number: the new task's; note: the Mac's own note (a task with the same text, a title shortened). Read, but not
        // shown: the board's Tasks line leaves it out, and its words are for the command line.
        case made(number: Int?, note: String?)
        case refused(String)
        // No answer from the Mac came back (none at all, or a server error with no sentence of the Mac's, which is what
        // the relay sends when the Mac stops answering mid-request), so the Mac may have made it. The board says it
        // failed here, but its request crosses no relay; a phone's reply is lost far more often, and "could not add"
        // would invite a second, duplicate task.
        case unknown
    }

    // The board's own words for the dialog (web/index.html, the #nt- fields), pinned there by the tests.
    enum Words {
        static let what = "What needs doing?"
        static let whatExample = "Rewrite the handoff checklist"
        static let done = "How will you know it is done?"
        static let doneExample = "The checklist fits on one page and the team has read it"
        static let doneHint = "Needed to create the task. The agent checks its work against this."
        static let detail = "Anything they should know"
        static let detailExample = "Optional. What it is for, anything you already tried."
        static let whoHint = "You can give it to somebody later."
    }

    // The sheet's own words for .unknown; the board has none.
    static let unsureWords = "Kosmos could not tell whether that went through. Look in Tasks before you try again."

    // The board's words when the Mac's done-when refusal names "done-when checks", words the sheet never shows.
    static let doneWords = "Your answer to \"How will you know it is done?\" has to be one line of plain text, 200 characters or fewer. Some emoji and symbols cannot be used there."
    static let fallback = "we could not add that task"

    // The Mac's answer, read as the board's nt-go reads it: any 2xx is made; otherwise its own sentence (the done-when
    // one in the field's words), else unknown for a server error and the board's words for anything else.
    // sent false: no request left the phone (not connected to the Mac, or the request could not be built), so the
    // task certainly was not made: the board's words, never "could not tell".
    static func result(sent: Bool = true, status: Int, body: Data?) -> Result {
        if !sent { return .refused(fallback) }
        if status == 0 { return .unknown }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if (200...299).contains(status) {
            let task = obj?["task"] as? [String: Any]
            let number = (task?["number"] as? NSNumber)?.intValue
            let note = (obj?["note"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return .made(number: number, note: note)
        }
        let why = obj?["error"] as? String ?? ""
        // 502 and 504 are a gateway's (the relay's) whatever they say: the Mac's task create never sends either.
        if status == 502 || status == 504 || (why.isEmpty && status >= 500) { return .unknown }
        if why.range(of: #"done-when check has to be (one line of plain text|\d+ characters or fewer)"#, options: .regularExpression) != nil {
            return .refused(doneWords)
        }
        return .refused(why.isEmpty ? fallback : why)
    }

    // The Tasks view's line after a create: "Added task 12 to Launch." (the number left out when the Mac did not say).
    static func addedLine(number: Int?, projectName: String) -> String {
        "Added task " + (number.map { String($0) + " " } ?? "") + "to " + projectName + "."
    }
}
