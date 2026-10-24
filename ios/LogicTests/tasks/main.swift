import Foundation
// Tests for the native Tasks tab's logic (#7031), compiled for macOS with the app files run-tasks.sh lists.
// It prints every case and ends with one verdict line; a missing verdict means the run did not finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() {
        passed += 1
        print("  ok   \(name)")
    } else {
        failed += 1
        print("  FAIL \(name) (line \(line))")
    }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }
let page = repoText("web/index.html")
check(page.count > 100_000, "premise: the board's page was read")

let now = Tasks.parseISO("2026-10-24T12:00:00.000Z")!
func iso(_ secondsAgo: Double) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: now.addingTimeInterval(-secondsAgo))
}
func row(_ number: Int, _ state: String, project: String = "p1", name: String = "Launch", path: [String] = [],
         created: Double = 0, _ edit: (inout Board.TaskRow) -> Void = { _ in }) -> Board.TaskRow {
    var t = Board.TaskRow(projectId: project, projectName: name, number: number, sentence: "Task \(number)", state: state)
    t.projectPath = path
    t.createdAt = iso(created)
    edit(&t)
    return t
}
let names = ["rex-discord": "Rex", "cleo-discord": "Cleo"]
let name: (String) -> String = { names[$0] ?? $0 }

section("the board's own words and order (web/index.html)")
// TSK_GROUPS: every { k: '...', l: '...' } in its order.
if let start = page.range(of: "const TSK_GROUPS = ["), let end = page.range(of: "];", range: start.upperBound..<page.endIndex) {
    let body = String(page[start.upperBound..<end.lowerBound])
    let re = try! NSRegularExpression(pattern: #"\{ k: '([a-z]+)', l: '([^']+)', c: 'var\((--tsk-[a-z]+)\)'"#)
    let found = re.matches(in: body, range: NSRange(body.startIndex..., in: body)).map { m -> Tasks.Group in
        let s = { (i: Int) in String(body[Range(m.range(at: i), in: body)!]) }
        return Tasks.Group(key: s(1), label: s(2), token: s(3))
    }
    check(found.count == 8, "premise: TSK_GROUPS has its eight groups (found \(found.count))")
    check(found == Tasks.groups, "the groups, labels, colours and order are the board's TSK_GROUPS")
    check(Tasks.groups.firstIndex { $0.key == "built" } == 4, "Built but waiting stays fifth (Josh, #3949)")
} else { check(false, "TSK_GROUPS was found in web/index.html") }
check(page.contains("const TSK_DECISION_UNKNOWN = '" + Tasks.decisionUnknown + "';"), "the cannot-tell sentence is the board's TSK_DECISION_UNKNOWN")
for (k, v) in Tasks.needsWhy {
    check(page.contains("  " + k + ": ['" + v + "',"), "the \(k) reason is the board's PJ_NEEDS_WHY")
}
check(page.contains("'<span>all subtasks built, ready for you to check</span>'"), "premise: the board still says all subtasks built, ready for you to check")
check(page.contains("const WANT_TASK = PARAMS.get('task');"), "premise: the board opens ?task= at boot")

section("the read")
let answer = """
{"tasks":[{"projectId":"p1","projectName":"Launch","projectPath":["Book A"],"number":3,"sentence":"Ship the logo","state":"built","builtAt":"\(iso(7200))","builtBy":"rex-discord","builtNote":"in the folder","createdAt":"\(iso(100))"},
 {"projectId":"p2","projectName":"Ads","number":1,"sentence":"Ask about the budget","state":"decision","waitingOn":[{"who":"cleo-discord","reason":"question"}],"waitingSince":"\(iso(24))","subtasks":{"done":1,"total":3,"built":2}},
 {"projectId":"p2","number":2,"state":"weird"},
 {"number":4,"state":"working"},
 {"projectId":"p2","projectName":"Ads","number":5,"sentence":"No state"}],
 "count":5,"rosterUnreadable":false}
"""
let read = Board.parseTasks(Data(answer.utf8))
check(read?.tasks.count == 3, "rows with a project, a number and a state are kept; a row missing one is dropped")
check(read?.rosterUnknown == false, "agents read")
check(read?.tasks.first?.projectPath == ["Book A"] && read?.tasks.first?.builtBy == "rex-discord", "fields carried")
check(read?.tasks[1].subtasks == Board.TaskRow.Subtasks(done: 1, total: 3, built: 2), "subtasks carried")
check(read?.tasks[1].waitingOn == [Board.TaskRow.Waiting(who: "cleo-discord", reason: "question")], "who it waits on")
check(Board.parseTasks(Data(#"{"tasks":[],"rosterUnreadable":true}"#.utf8))?.rosterUnknown == true, "rosterUnreadable reads as unknown")
check(Board.parseTasks(Data(#"{"error":"no"}"#.utf8)) == nil, "an answer with no tasks list is not a read")
check(Board.parseTasks(Data("<html>sign in</html>".utf8)) == nil, "the gate's sign-in page is not a read")
let req = Board.tasksRequest(mac: URL(string: "https://studio.kosmosplus.com")!)
check(req.url?.absoluteString == "https://studio.kosmosplus.com/api/tasks?view=tasks" && req.value(forHTTPHeaderField: "Accept") == "application/json", "the request is the Tasks view's read, as JSON")

section("the groups: in order, each hidden when empty")
let mixed = Board.TasksRead(tasks: [
    row(1, "closed"), row(2, "nobody"), row(3, "decision"), row(4, "built"), row(5, "working"),
    row(6, "held"), row(7, "scheduled"), row(8, "assigned"), row(9, "weird"),
], rosterUnknown: false)
let keys = Tasks.sections(mixed, project: nil).map(\.group.key)
check(keys == ["decision", "working", "assigned", "nobody", "built", "scheduled", "held", "closed"], "the board's order")
check(!Tasks.sections(mixed, project: nil).flatMap(\.rows).contains { $0.state == "weird" }, "a state the board has no group for is not drawn (the board draws by TSK_GROUPS)")
let few = Board.TasksRead(tasks: [row(1, "working"), row(2, "closed")], rosterUnknown: false)
check(Tasks.sections(few, project: nil).map(\.group.key) == ["working", "closed"], "an empty group is not drawn (#3949)")
let blind = Board.TasksRead(tasks: [row(1, "working")], rosterUnknown: true)
let blindSections = Tasks.sections(blind, project: nil)
check(blindSections.first?.group.key == "decision" && blindSections.first?.unknown == true && blindSections.first?.rows.isEmpty == true,
      "agents unread: Needs Your Decision shows that it cannot tell, even empty, never a zero")
check(Tasks.sections(few, project: nil).allSatisfy { !$0.unknown }, "control: agents read, no cannot-tell group")

section("a live update keeps every row where it was drawn")
let first = Board.TasksRead(tasks: [row(1, "working", created: 10), row(2, "nobody", created: 20), row(3, "working", created: 30)], rosterUnknown: false)
let drawn = Tasks.sections(first, project: nil)
let moved = Board.TasksRead(tasks: [row(1, "built", created: 10) { $0.builtAt = iso(5) }, row(2, "nobody", created: 20), row(4, "working", created: 1)], rosterUnknown: false)
let live = Tasks.keepingPlaces(drawn, with: moved, project: nil)
check(live.first { $0.group.key == "working" }?.rows.map(\.number) == [1, 4], "a row that changed group stays in place (with its fresh state); a new one joins its own group at the end")
check(live.first { $0.group.key == "working" }?.rows.first?.state == "built", "the kept row carries its fresh words")
check(!live.flatMap(\.rows).contains { $0.number == 3 }, "a row that is gone goes")
check(live.flatMap(\.rows).filter { $0.number == 1 }.count == 1, "never twice")
check(Tasks.sections(moved, project: nil).first { $0.group.key == "built" }?.rows.map(\.number) == [1], "control: laid out again, it moves to its new group")
let emptied = Tasks.keepingPlaces(drawn, with: Board.TasksRead(tasks: [row(1, "working", created: 10)], rosterUnknown: true), project: nil)
check(emptied.map(\.group.key) == ["decision", "working"] && emptied[0].unknown, "an emptied group goes; the cannot-tell group appears when the agents go unread")

section("the dot")
let decision = Tasks.groups[0]
check(Tasks.dotToken(decision, count: 2, rosterUnknown: false) == "--tsk-decision", "red with something waiting")
check(Tasks.dotToken(decision, count: 0, rosterUnknown: false) == "--tsk-nobody", "neutral at zero")
check(Tasks.dotToken(decision, count: 2, rosterUnknown: true) == "--tsk-nobody", "neutral when it cannot tell")
check(Tasks.dotToken(Tasks.groups[1], count: 0, rosterUnknown: true) == "--tsk-working", "other groups keep their colour")

section("the order inside a group: newest created first (the board's default sort)")
let byAge = Board.TasksRead(tasks: [row(1, "working", created: 300), row(2, "working", created: 10), row(3, "working", created: 100)], rosterUnknown: false)
check(Tasks.sections(byAge, project: nil)[0].rows.map(\.number) == [2, 3, 1], "newest first")
let undated = Board.TasksRead(tasks: [row(1, "working") { $0.createdAt = nil }, row(2, "working", created: 10)], rosterUnknown: false)
check(Tasks.sections(undated, project: nil)[0].rows.map(\.number) == [2, 1], "an unknown date sorts as the oldest (the board's || 0)")

section("the title is the count (tskTitle)")
check(Tasks.title(nil, project: nil) == "Tasks", "before the first read")
let two = Board.TasksRead(tasks: [row(1, "working", project: "p1"), row(2, "nobody", project: "p2", name: "Ads"), row(3, "closed", project: "p3")], rosterUnknown: false)
check(Tasks.title(two, project: nil) == "2 Tasks on 2 Projects", "open tasks, and the projects THEY are on")
check(Tasks.title(Board.TasksRead(tasks: [row(1, "working")], rosterUnknown: false), project: nil) == "1 Task on Launch", "one project in view is named")
check(Tasks.title(Board.TasksRead(tasks: [row(1, "working", path: ["Book A"])], rosterUnknown: false), project: nil) == "1 Task on Book A \u{203A} Launch", "named by its path when none is picked")
check(Tasks.title(two, project: "p2") == "1 Task on Ads", "a picked project by its own name")
check(Tasks.title(Board.TasksRead(tasks: [row(1, "closed")], rosterUnknown: false), project: nil) == "0 Tasks", "nothing open")
check(Tasks.title(Board.TasksRead(tasks: [row(1, "working", project: "p1"), row(2, "working", project: "p2", name: "Ads")], rosterUnknown: false), project: nil).hasSuffix("on 2 Projects"), "two projects counted")
check(Tasks.leaveOutProjectLine(two, project: "p2") && !Tasks.leaveOutProjectLine(two, project: nil), "the project line goes only when the header names the project")
check(!Tasks.leaveOutProjectLine(Board.TasksRead(tasks: [row(1, "closed")], rosterUnknown: false), project: nil), "only closed and none picked: the line stays (the title says 0 Tasks)")

section("the picker: each sub-project after its parent, with its open count")
let tree = Board.TasksRead(tasks: [
    row(1, "working", project: "launch", name: "Launch", path: ["Book A"]),
    row(2, "closed", project: "launch", name: "Launch", path: ["Book A"]),
    row(3, "nobody", project: "booka", name: "Book A"),
    row(4, "working", project: "ads", name: "Ads", path: ["Book A", "Launch"]),
    row(5, "working", project: "art", name: "Art"),
], rosterUnknown: false)
let picker = Tasks.pickerProjects(tree)
check(picker.map(\.id) == ["art", "booka", "launch", "ads"], "by chain: Art, Book A, Book A › Launch, Book A › Launch › Ads")
check(picker.first { $0.id == "launch" }?.open == 1, "the open count leaves out closed tasks")
check(Tasks.pickerWords(picker[3]) == "Ads (1), in Book A \u{203A} Launch", "the board's words (pjChainOption)")
check(Tasks.pickerWords(picker[0]) == "Art (1)", "a top-level project is its bare name")
check(Tasks.sections(tree, project: "launch").flatMap(\.rows).map(\.number).sorted() == [1, 2], "a picked project shows only its tasks")

section("age words (agoWords)")
check(Tasks.agoWords(4_000) == "just now" && Tasks.agoWords(24_000) == "24 seconds ago" && Tasks.agoWords(89_000) == "89 seconds ago", "seconds")
check(Tasks.agoWords(90_000) == "1 minute ago" && Tasks.agoWords(89 * 60_000) == "89 minutes ago", "minutes")
check(Tasks.agoWords(90 * 60_000) == "1 hour ago" && Tasks.agoWords(35 * 3_600_000) == "35 hours ago", "hours")
check(Tasks.agoWords(36 * 3_600_000) == "1 day ago" && Tasks.agoWords(-1) == "", "days, and nothing for the future")

section("the row line, per group")
let ask = row(1, "decision") { $0.waitingOn = [.init(who: "cleo-discord", reason: "question")]; $0.waitingSince = iso(24) }
check(Tasks.rowLine(ask, now: now, name: name) == "Cleo: Waiting for your answer for 24 seconds.", "a question: the name and the age")
let justAsked = row(1, "decision") { $0.waitingOn = [.init(who: "cleo-discord", reason: "question")]; $0.waitingSince = iso(1) }
check(Tasks.rowLine(justAsked, now: now, name: name) == "Cleo: Just started waiting for your answer.", "just asked")
let other = row(1, "decision") { $0.waitingOn = [.init(who: "rex-discord", reason: "crash_loop")]; $0.waitingSince = iso(7200) }
check(Tasks.rowLine(other, now: now, name: name) == "Waiting on you for 2 hours\nRex: Kosmos keeps restarting it, and it keeps stopping within a couple of minutes.", "another reason: the wait, then each agent's reason")
let noStart = row(1, "decision") { $0.waitingOn = [.init(who: "rex-discord", reason: "trust")] }
check(Tasks.rowLine(noStart, now: now, name: name) == "Rex: Waiting for you to approve it before it can start.", "no known start: the who line alone")
let working = row(1, "working") { $0.whoNames = ["rex-discord", "cleo-discord", "rex-discord"] }
check(Tasks.rowLine(working, now: now, name: name) == "Rex, Cleo", "in progress: the agents on it, by name, once each")
check(Tasks.rowLine(row(1, "assigned") { $0.whoNames = ["ghost"] }, now: now, name: name) == "ghost", "an agent the roster does not name keeps its session name")
check(Tasks.rowLine(row(1, "nobody"), now: now, name: name).isEmpty, "unassigned: no line (the heading says it)")
check(Tasks.rowLine(row(1, "held"), now: now, name: name).isEmpty && Tasks.rowLine(row(1, "closed"), now: now, name: name).isEmpty, "on hold and completed: no line")
let built = row(1, "built") { $0.builtAt = iso(7200); $0.builtBy = "rex-discord"; $0.builtNote = "in the folder" }
check(Tasks.rowLine(built, now: now, name: name) == "Marked built by Rex 2 hours ago: in the folder", "built: who, when, the note")
let builtByYou = row(1, "built") { $0.builtAt = iso(60); $0.builtByPerson = true }
check(Tasks.rowLine(builtByYou, now: now, name: name) == "Marked built by you 60 seconds ago", "built by you")
let kids = row(1, "working") { $0.subtasks = .init(done: 1, total: 3, built: 2); $0.whoNames = ["rex-discord"] }
check(Tasks.rowLine(kids, now: now, name: name) == "All subtasks built, ready for you to check.", "every subtask done or built: the board's ready-to-check line")
let allDone = row(1, "working") { $0.subtasks = .init(done: 3, total: 3, built: 0); $0.whoNames = ["rex-discord"] }
check(Tasks.rowLine(allDone, now: now, name: name) == "Rex", "control: all done (not built) keeps the ordinary line")

section("the schedule, as the board words it (tskRepeatSentence)")
let rep = row(1, "scheduled") { $0.repeatWords = "every weekday at 9am"; $0.repeatNextWords = "Monday at 9am" }
check(Tasks.rowLine(rep, now: now, name: name) == "Repeats every weekday at 9am. No run reported yet. Next Monday at 9am.", "no run yet")
let ran = row(1, "scheduled") { $0.repeatWords = "daily"; $0.lastRunAt = iso(3600); $0.lastRunBy = "rex-discord"; $0.lastRunNote = "all fine" }
check(Tasks.rowLine(ran, now: now, name: name) == "Repeats daily. Last run 60 minutes ago by Rex: all fine.", "the last run")
let missed = row(1, "scheduled") { $0.repeatWords = "daily"; $0.repeatMissed = 3; $0.repeatMissedWords = "today at 9am" }
check(Tasks.rowLine(missed, now: now, name: name) == "Missed 3 runs, the latest due today at 9am. Repeats daily.", "missed runs lead, and no 'No run reported yet' after them")
let same = row(1, "scheduled") { $0.repeatWords = "daily"; $0.lastRunAt = iso(60); $0.lastRunByPerson = true; $0.unchangedRuns = 2; $0.lastChangeAt = iso(86_400 * 2); $0.lastChangeNote = "up 3%" }
check(Tasks.rowLine(same, now: now, name: name) == "Repeats daily. Last run 60 seconds ago by you. The last 2 runs found nothing new; the last change was 2 days ago: up 3%.", "runs that found nothing new")
let told = row(1, "scheduled") { $0.repeatWords = "daily"; $0.lastRunAt = iso(60); $0.verified = .init(value: "42", at: iso(60)); $0.told = .init(value: "40", at: iso(7200)) }
check(Tasks.rowLine(told, now: now, name: name) == "Repeats daily. Last run 60 seconds ago. Its latest check found \u{201C}42\u{201D}. You were last told \u{201C}40\u{201D} (2 hours ago).", "a change you were not told about")

section("a row, spoken and opened")
check(Tasks.spoken(built, line: "Marked built by Rex 2 hours ago", projectShown: true) == "Task 1. Launch. Marked built by Rex 2 hours ago.", "one element: title, project, line")
check(Tasks.spoken(ask, line: "a\nb", projectShown: false) == "Task 1. a b.", "a two-line row reads as one, with no project when the header names it")
let url = Tasks.taskPageURL(board: URL(string: "https://studio.kosmosplus.com")!, project: "book a", number: 7)
check(url?.absoluteString == "https://studio.kosmosplus.com/?project=book%20a&task=7", "the board's task page, by ?project=&task=")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
