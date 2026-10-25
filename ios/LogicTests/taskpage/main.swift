import Foundation
// Tests for the native task page (kosmos#7074), compiled for macOS with the app files run-taskpage.sh lists.
// projects-tasks.json and activity-<n>.json are what the Mac's own engine produced (engine/projects.js list, engine/
// tasks.js create/close/setBuilt/setDue/addPart/setPartClosed/setOnHold/say, engine/taskchat.js read) in a throwaway
// folder: the answers of GET /api/projects and GET .../task/<n>/activity. Not hand-written. The project folder path in
// them was replaced with a neutral one.
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
let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
func fixture(_ name: String) -> Data { (try? Data(contentsOf: here.appendingPathComponent(name))) ?? Data() }
let projectsData = fixture("projects-tasks.json")
check(!projectsData.isEmpty, "premise: the captured projects read is there")
var cal = Calendar(identifier: .gregorian)
cal.timeZone = TimeZone(identifier: "UTC")!
let roster = ["dana": "Dana (roster)", "gus": "Gus"]
func page(_ n: Int) -> Board.TaskPage? {
    if case .page(let p) = Board.parseTaskPage(projectsData, project: "springcatalogue", number: n) { return p }
    return nil
}
func names(_ p: Board.TaskPage?) -> (String) -> String { { s in p?.name(s, roster: roster) ?? s } }

section("reading a task from the projects read")
let parent = page(1)
check(parent?.projectName == "Spring catalogue" && parent?.sentence == "Print-ready catalogue", "the project and the task's title")
check(parent?.detail == "All **twelve** pages, checked against the price sheet.", "its detail, as written (formatted when drawn)")
check(parent?.subtasks.map(\.number) == [2, 3, 4] && parent?.subtasks.map(\.status) == ["Done", "Built", "Open"],
      "its subtasks in number order, each Done, Built or Open")
check(parent?.allSubtasksDone == false && parent?.allSubtasksBuilt == false, "one subtask still open: neither all-done line")
check(parent?.stateLine(roster: roster) == "Open" && parent?.act == .close && parent?.act.title == "Mark as done", "open: Mark as done")
let createdAt = Tasks.parseISO("2026-10-25T00:36:58.000Z")!
check(parent?.added(now: createdAt, calendar: cal) == "You, today", "added by the person, today")
check(parent?.added(now: createdAt.addingTimeInterval(86_400), calendar: cal) == "You, yesterday"
      && parent?.added(now: createdAt.addingTimeInterval(3 * 86_400), calendar: cal) == "You, 3 days ago", "yesterday, then days ago")
check(parent?.partLines(roster: roster).map(\.who) == ["Nobody yet"] && parent?.closeNote(roster: roster) == nil,
      "nobody on it: Nobody yet, and no close note")

let built = page(3)
check(built?.stateLine(roster: roster) == "Open, marked built by Dana: captions need a check", "built: who marked it and the note")
check(built?.parentNumber == 1 && built?.parentSentence == "Print-ready catalogue", "the task it is part of")
check(built?.partLines(roster: roster) == [Board.TaskPage.PartLine(id: "1", who: "Dana", line: nil, say: nil, done: false)],
      "Dana by the project's own name; a could-not-tell claim says nothing on the part")
check(built?.whyLine(roster: roster) == "We could not check whether Dana is on this: we cannot tell whether this is the same agent, so we cannot say whether it holds this task.",
      "the why line says the reason in full")
check(built?.closeNote(roster: roster) == "Marking it done closes it here. It does not stop Dana or change what Dana is doing.", "the close note")

let parts = page(5)
check(parts?.stateWord == "1 of 2 parts done", "two parts, one done: the count")
check(parts?.partLines(roster: roster).map { "\($0.who)|\($0.line ?? "")|\($0.done)" } == ["Eli||true", "Dana|Check linen prices|false"],
      "each part: who, its own words when they differ, and done")
check(parts?.holdLine == "You put this on hold, so only you can take it off. Kosmos does not nudge anyone about it or hand it out.",
      "held by the person: said, without the board's control words")
check(parts?.added(now: createdAt, calendar: cal) == "eli, today", "added by an agent: the board's own words (its session name)")

let replaced = page(6)
check(replaced?.stateWord == "Replaced by task 7" && replaced?.act == .reopen && replaced?.act.title == "Reopen", "replaced: says so, and Reopen")
check(replaced?.closeNote(roster: roster) == nil && replaced?.holdLine == nil, "a closed task has no close note and no hold line")
check(page(7)?.stateLine(roster: roster) == "Open. Replaces task 6", "the task that replaced it names it")
check(page(4)?.dueLine(calendar: cal) == "Due Oct 30", "a due date, read only")
check(page(1)?.dueLine(calendar: cal) == nil, "no due date: no line")

check(Board.parseTaskPage(projectsData, project: "springcatalogue", number: 99) == .gone, "a task the list does not have is gone")
check(Board.parseTaskPage(projectsData, project: "nosuch", number: 1) == .gone, "so is a project it does not have")
check(Board.parseTaskPage(Data("<html>".utf8), project: "springcatalogue", number: 1) == .unreadable, "a page that is not the list is unreadable")

section("the words for states the fixture does not hold")
func synthetic(_ task: String, agents: String = #"[{"sessionName":"dana","name":"Dana"}]"#, paused: Bool = false) -> Board.TaskPage? {
    let json = #"{"projects":[{"id":"p1","name":"P","paused":\#(paused),"agents":\#(agents),"tasks":[\#(task)]}]}"#
    if case .page(let p) = Board.parseTaskPage(Data(json.utf8), project: "p1", number: 1) { return p }
    return nil
}
let claimedTrue = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S","closedAt":null}],"progress":{"done":0,"total":1,"closed":false},"claim":{"claimed":true,"about":"dana"}}"#)
check(claimedTrue?.partLines(roster: roster).first?.say == "says it is on this", "a claim: said on the agent's part")
check(claimedTrue?.closeNote(roster: roster) == "Dana says it is on this. Marking it done closes it here. It does not stop Dana or change what Dana is doing.",
      "and its premise starts the close note")
let notReported = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S","closedAt":null}],"claim":{"claimed":null,"neverReported":true,"about":"dana"}}"#)
check(notReported?.partLines(roster: roster).first?.say == "has not reported what it is working on yet" && notReported?.whyLine(roster: roster) == nil,
      "not reported: said once, on the part")
let stranger = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"gus","sentence":"S","closedAt":null}]}"#)
check(stranger?.partLines(roster: roster).first?.who == "Gus (not on this project)", "an agent holding open work without being a member")
let allDoneOpen = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"sentence":"S"}],"progress":{"done":1,"total":1,"closed":true}}"#)
check(allDoneOpen?.closed == true && allDoneOpen?.act == .reopen, "every part done with no closedAt: closed by its progress, so Reopen")
check(synthetic(#"{"number":1,"sentence":"S"}"#, paused: true)?.holdLine == "This project is paused, so Kosmos does not nudge anyone about its tasks or hand them out.",
      "a paused project says so")
let webhook = synthetic(#"{"number":1,"sentence":"S","addedBy":"Shop","addedVia":"webhook","createdAt":"2026-10-01T10:00:00.000Z"}"#)
check(webhook?.added(now: Tasks.parseISO("2026-10-24T10:00:00.000Z")!, calendar: cal) == "Shop (a webhook), Oct 1", "a webhook's task, a while ago: the date")

section("Mark as done, Reopen and seen: the requests")
let mac = URL(string: "https://studio.kosmosplus.com")!
let close = Board.taskActRequest(mac: mac, project: "springcatalogue", number: 3, act: .close)
check(close?.httpMethod == "POST" && close?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/springcatalogue/task/3/close" && close?.httpBody == nil,
      "close: a POST to the task's own route, with no body")
check(close?.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "sent as the person's screen (the Mac's isViaScreen)")
check(Board.taskActRequest(mac: mac, project: "springcatalogue", number: 3, act: .reopen)?.url?.path == "/api/project/springcatalogue/task/3/reopen", "reopen")
check(Board.taskActRequest(mac: mac, project: "../x", number: 3, act: .close) == nil && Board.taskActRequest(mac: mac, project: "p", number: 0, act: .close) == nil,
      "not a project id or not a task number: no request")
let seen = Board.taskSeenRequest(mac: mac, project: "springcatalogue", number: 3)
check(seen?.url?.path == "/api/project/springcatalogue/task/3/seen" && seen?.httpMethod == "POST" && seen?.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin",
      "seen: a POST as the person's screen")
check(Board.taskActivityRequest(mac: mac, project: "springcatalogue", number: 3)?.url?.path == "/api/project/springcatalogue/task/3/activity", "the activity read")
check(Board.taskActResult(status: 200, body: Data(#"{"task":{}}"#.utf8)) == .done, "a 2xx is done")
check(Board.taskActResult(status: 409, body: Data(#"{"error":"the person set this task to repeat"}"#.utf8)) == .refused("the person set this task to repeat"), "a refusal: the Mac's words")
check(Board.taskActResult(status: 500, body: nil) == .refused("we could not change that task") && Board.taskActResult(status: 0, body: nil) == .refused("we could not change that task"),
      "no words, or no answer: the board's sentence")
check(Board.seenRetries(status: 503) && Board.seenRetries(status: 0) && !Board.seenRetries(status: 403) && !Board.seenRetries(status: 200), "seen tries once more only after a 5xx or no answer")

section("the activity, in the board's words")
func rows(_ n: Int) -> [String] {
    Board.parseActivity(fixture("activity-\(n).json")).map { Board.activityRows($0, name: names(page(n))).map(\.text) } ?? ["unparsed"]
}
check(rows(1) == ["Created"], "a task made with nobody on it")
check(rows(3) == ["Created and given to Dana, under task 1", "Dana marked it built: captions need a check", "Use the March photos"],
      "given to an agent under a parent, marked built, a message")
check(rows(5) == ["Created and given to Eli", "A part added: Check linen prices", "A part marked done", "Put on hold"], "parts and a hold")
check(rows(6) == ["Created", "Closed as replaced by task 7"], "replaced")
let runs: [[String: Any]] = [
    ["kind": "run", "at": "2026-10-20T10:00:00Z", "unchanged": true, "by": "dana"],
    ["kind": "run", "at": "2026-10-21T10:00:00Z", "unchanged": true, "inferred": true, "by": "dana"],
    ["kind": "run", "at": "2026-10-22T10:00:00Z", "unchanged": true, "late": true, "by": "dana"],
    ["kind": "reopened", "at": "2026-10-23T10:00:00Z", "person": true, "why": "not finished"],
]
let folded = Board.activityRows(runs, name: { $0 == "dana" ? "Dana" : $0 })
check(folded.map(\.text) == ["2 runs found nothing new or repeated the same note", "Dana ran it, late, nothing new", "You put it back: not finished"],
      "two quiet runs fold into one row; a late run never folds")
check(folded.first?.at == Tasks.parseISO("2026-10-21T10:00:00Z"), "a folded row is dated by its last run")
check(Board.activityPhrase(["kind": "something-new"], name: { $0 }) == "something-new", "an unknown kind shows its own name")
check(Board.activityPhrase(["kind": "kept-dropped", "to": "dana", "person": true], name: { _ in "Dana" })
      == "Your message to Dana was never sent: Kosmos kept it while Dana was out of usage and could not send it within a day", "a dropped message")
check(Board.activityPhrase(["kind": "missed", "count": 3, "told": "dana", "reached": false], name: { _ in "Dana" }) == "3 runs missed; Kosmos could not reach Dana",
      "missed runs, the reviewer not reached")

section("the page's model, against a fake Mac")
final class FakeMac {
    var projects: (Int, Data)? = (200, projectsData)
    var activity: (Int, Data)? = (200, fixture("activity-3.json"))
    var actAnswers: [(Int, String)?] = []
    var seenAnswers: [(Int, String)?] = []
    var asked: [String] = []
    var epoch = 0
    var onSend: ((URLRequest) -> Void)?
    func send(_ build: (URL) -> URLRequest?) -> (Data, HTTPURLResponse)? {
        guard let r = build(URL(string: "https://studio.kosmosplus.com")!) else { return nil }
        asked.append((r.httpMethod ?? "GET") + " " + r.url!.path)
        onSend?(r)
        func answer(_ a: (Int, Data)?) -> (Data, HTTPURLResponse)? {
            a.map { ($0.1, HTTPURLResponse(url: r.url!, statusCode: $0.0, httpVersion: nil, headerFields: nil)!) }
        }
        let path = r.url!.path
        if path == "/api/projects" { return answer(projects) }
        if path.hasSuffix("/activity") { return answer(activity) }
        if path.hasSuffix("/seen") { return answer(seenAnswers.isEmpty ? (200, Data("{}".utf8)) : seenAnswers.removeFirst().map { ($0.0, Data($0.1.utf8)) }) }
        return answer(actAnswers.isEmpty ? (200, Data("{}".utf8)) : actAnswers.removeFirst().map { ($0.0, Data($0.1.utf8)) })
    }
}
@MainActor
func modelTests() async {
    let mac = FakeMac()
    var slept: [TimeInterval] = []
    func model(_ n: Int) -> TaskPageModel {
        TaskPageModel(project: "springcatalogue", number: n, send: { mac.send($0) }, sleep: { slept.append($0) }, epoch: { mac.epoch })
    }
    let m = model(3)
    let nm: (String) -> String = { $0 == "dana" ? "Dana" : $0 }
    await m.read()
    await m.readActivity(names: nm)
    check(m.page?.number == 3 && m.activity?.count == 3 && !m.gone && !m.readFailed, "a read fills the page and its activity")

    mac.asked = []
    mac.actAnswers = [(409, #"{"error":"the person set this task to repeat, or chose who reviews it, so only they can close it"}"#)]
    await m.press(.close, names: nm)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/close", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "Mark as done: the close, then the page and its activity read again")
    check(m.refusal == "the person set this task to repeat, or chose who reviews it, so only they can close it" && !m.pressing, "a refusal is said, and the button is back")

    mac.asked = []
    await m.press(.reopen, names: nm)
    check(mac.asked.isEmpty, "a press whose button no longer matches the task sends nothing (the page already shows what is true)")

    mac.asked = []
    var during: Bool?
    mac.onSend = { r in if r.url!.path.hasSuffix("/close") { during = m.pressing } }
    await m.press(.close, names: nm)
    mac.onSend = nil
    check(during == true && m.refusal == nil, "while it is in the air the button is off; a press that goes clears the last refusal")

    // Seen: once per state of the activity; a 5xx tried once more after 3 s, only while it is still on screen.
    mac.asked = []
    mac.seenAnswers = [(503, "{}"), (200, "{}")]
    await m.markSeen(onScreen: { true })
    await m.markSeen(onScreen: { true })
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen", "POST /api/project/springcatalogue/task/3/seen"] && slept == [3],
          "a 503 is tried once more after 3 s, and the same state is not marked again")
    mac.asked = []
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T01:00:00Z","kind":"said","text":"new"}],"count":1}"#.utf8))
    await m.readActivity(names: nm)
    await m.markSeen(onScreen: { false })
    check(mac.asked == ["GET /api/project/springcatalogue/task/3/activity"], "not on screen: not marked seen")
    mac.seenAnswers = [(403, #"{"error":"only the person's page can mark a task seen"}"#)]
    mac.asked = []
    await m.markSeen(onScreen: { true })
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a new state is marked; a 4xx settles it with no retry")

    // A failed activity read keeps the rows shown.
    let shownRows = m.activity
    mac.activity = (500, Data())
    await m.readActivity(names: nm)
    check(m.activityFailed && m.activity == shownRows, "a failed activity read keeps what is shown")

    // The task gone, a failed read, another account.
    let g = model(99)
    await g.read()
    check(g.gone && g.page == nil, "a task the Mac no longer lists is gone")
    mac.projects = (502, Data())
    let f = model(3)
    await f.read()
    check(f.readFailed && f.page == nil, "a read with no list fails")
    mac.projects = (200, projectsData)
    let e = model(3)
    mac.onSend = { r in if r.url!.path == "/api/projects" { mac.epoch += 1 } }
    await e.read()
    mac.onSend = nil
    check(e.page == nil && !e.readFailed, "a read that lands after another account or Mac changes nothing")
    mac.asked = []
    await e.press(.close, names: nm)
    check(mac.asked.isEmpty, "and a page from before it sends nothing")
}
await modelTests()

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
