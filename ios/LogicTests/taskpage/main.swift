import Foundation
import Combine
import JavaScriptCore
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
// kosmos#8146: a held subtask reads On hold, as the board's task page does since #8140. The captured read with its
// open subtask (4) and its built one (3) put on hold, as engine/tasks.js setOnHold stores it (onHold: true): a held
// one is never Built (the board's built() leaves held out, kosmos#5956).
func withHeld(_ numbers: Set<Int>) -> Data {
    guard var top = try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any],
          var projects = top["projects"] as? [[String: Any]],
          let i = projects.firstIndex(where: { $0["id"] as? String == "springcatalogue" }),
          var list = projects[i]["tasks"] as? [[String: Any]] else { return Data() }
    for j in list.indices where numbers.contains((list[j]["number"] as? NSNumber)?.intValue ?? -1) { list[j]["onHold"] = true }
    projects[i]["tasks"] = list
    top["projects"] = projects
    return (try? JSONSerialization.data(withJSONObject: top)) ?? Data()
}
func statuses(_ d: Data) -> [String]? {
    if case .page(let p) = Board.parseTaskPage(d, project: "springcatalogue", number: 1) { return p.subtasks.map(\.status) }
    return nil
}
check(statuses(withHeld([4])) == ["Done", "Built", "On hold"], "a held open subtask reads On hold, not Open")
check(statuses(withHeld([3])) == ["Done", "On hold", "Open"], "a held built subtask reads On hold, not Built")
check(statuses(withHeld([2])) == ["Done", "Built", "Open"], "a closed subtask still reads Done when held (closing drops a hold)")
check(statuses(withHeld([])) == ["Done", "Built", "Open"], "CONTROL: the rebuilt read with nothing held reads as the captured one")
check(parent?.stateLine(roster: roster) == "Open" && parent?.act == .close && parent?.act.title == "Mark as done", "open: Mark as done")
let createdAt = Tasks.parseISO("2026-10-25T00:36:58.000Z")!
check(parent?.added(now: createdAt, calendar: cal) == "You, today", "added by the person, today")
check(parent?.addedLine(now: createdAt, calendar: cal) == "Added by you, today" && page(5)?.addedLine(now: createdAt, calendar: cal) == "Added by eli, today",
      "the line drawn: the board's fixed opening lowered, a name left as it is")
check(parent?.added(now: createdAt.addingTimeInterval(86_400), calendar: cal) == "You, yesterday"
      && parent?.added(now: createdAt.addingTimeInterval(3 * 86_400), calendar: cal) == "You, 3 days ago", "yesterday, then days ago")
check(parent?.partLines(roster: roster).map(\.who) == ["Nobody yet"] && parent?.closeNote(roster: roster) == nil,
      "nobody on it: Nobody yet, and no close note")

let built = page(3)
check(built?.stateLine(roster: roster) == "Open, marked built by Dana: captions need a check", "built: who marked it and the note")
// kosmos#8939: the page says what the mark waits on, after who and before the note; a value not in the table says nothing.
func withBuiltWaiting(_ v: String) -> Board.TaskPage? {
    guard var top = try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any],
          var projects = top["projects"] as? [[String: Any]],
          let i = projects.firstIndex(where: { $0["id"] as? String == "springcatalogue" }),
          var list = projects[i]["tasks"] as? [[String: Any]] else { return nil }
    for j in list.indices where (list[j]["number"] as? NSNumber)?.intValue == 3 { list[j]["builtWaitingOn"] = v }
    projects[i]["tasks"] = list
    top["projects"] = projects
    guard let d = try? JSONSerialization.data(withJSONObject: top), case .page(let p) = Board.parseTaskPage(d, project: "springcatalogue", number: 3) else { return nil }
    return p
}
check(withBuiltWaiting("person")?.stateLine(roster: roster) == "Open, marked built by Dana, waiting on you: captions need a check", "built, waiting on you")
check(withBuiltWaiting("review")?.stateLine(roster: roster) == "Open, marked built by Dana, waiting on a review: captions need a check", "built, waiting on a review")
check(withBuiltWaiting("release")?.stateLine(roster: roster) == "Open, marked built by Dana, waiting on a release: captions need a check", "built, waiting on a release")
check(withBuiltWaiting("__proto__")?.stateLine(roster: roster) == "Open, marked built by Dana: captions need a check", "a value not in the table says nothing")
check(built?.parentNumber == 1 && built?.parentSentence == "Print-ready catalogue", "the task it is part of")
check(built?.partLines(roster: roster) == [Board.TaskPage.PartLine(id: "1", who: "Dana", line: nil, say: nil, done: false, session: "dana")],
      "Dana by the project's own name; a could-not-tell claim says nothing on the part")
check(built?.whyLine(roster: roster) == "We could not check whether Dana is on this: we cannot tell whether this is the same agent, so we cannot say whether it holds this task.",
      "the why line says the reason in full")
check(built?.closeNote(roster: roster) == "Marking it done closes it here. It does not stop Dana or change what Dana is doing.", "the close note")

let parts = page(5)
check(parts?.stateWord == "1 of 2 parts done", "two parts, one done: the count")
check(parts?.partLines(roster: roster).map { "\($0.who)|\($0.line ?? "")|\($0.done)" } == ["Eli||true", "Dana|Check linen prices|false"],
      "each part: who, its own words when they differ, and done")
check(parts?.holdLine == "You put this on hold, so only you can take it off, here. Kosmos does not nudge anyone about it or hand it out.",
      "held by the person: said, and where it is taken off (here, since #8958 slice B2)")
check(parts?.added(now: createdAt, calendar: cal) == "eli, today", "added by an agent: the board's own words (its session name)")

let replaced = page(6)
check(replaced?.stateWord == "Replaced by task 7" && replaced?.act == .reopen && replaced?.act.title == "Reopen", "replaced: says so, and Reopen")
check(replaced?.closeNote(roster: roster) == nil && replaced?.holdLine == nil, "a closed task has no close note and no hold line")
check(page(7)?.stateLine(roster: roster) == "Open. Replaces task 6", "the task that replaced it names it")
check(page(2)?.closed == true && page(2)?.closeNote(roster: roster) == nil && page(2)?.partLines(roster: roster).first?.who == "Dana",
      "a finished task with an agent on it: no close note (closing it again stops nobody)")
check(page(4)?.dueDate == "2026-10-30" && page(1)?.dueDate == nil, "the due date as the Mac keeps it, or none")

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
// kosmos#7788: an agent's hold for the person says it waits on them; a plain agent hold keeps the outside words (control).
check(synthetic(#"{"number":1,"sentence":"S","onHold":true,"onHoldForPerson":true}"#)?.holdLine?.hasPrefix("An agent put this on hold because it waits on you.") == true,
      "an agent's hold for you says it waits on you")
check(synthetic(#"{"number":1,"sentence":"S","onHold":true}"#)?.holdLine?.hasPrefix("This was put on hold outside this screen") == true,
      "control: a plain agent hold keeps its words")
// The board's page, found from this file (ios/LogicTests/taskpage/main.swift -> the repo root): run-taskpage.sh passes no repo.
let boardPage = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("web/index.html")
check(String(data: (try? Data(contentsOf: boardPage)) ?? Data(), encoding: .utf8)?
        .contains("'An agent put this on hold because it waits on you. Once you have answered, take it off hold here, or tell the agent.") == true,
      "the board's hint opens with the same words")
check(synthetic(#"{"number":1,"sentence":"S"}"#, paused: true)?.holdLine == "This project is paused, so Kosmos does not nudge anyone about its tasks or hand them out.",
      "a paused project says so")
let webhook = synthetic(#"{"number":1,"sentence":"S","addedBy":"Shop","addedVia":"webhook","createdAt":"2026-10-01T10:00:00.000Z"}"#)
check(webhook?.added(now: Tasks.parseISO("2026-10-24T10:00:00.000Z")!, calendar: cal) == "Shop (a webhook), Oct 1", "a webhook's task, a while ago: the date")
let youName = synthetic(#"{"number":1,"sentence":"S","addedBy":"You Need A Budget","addedVia":"webhook","createdAt":"2026-10-24T10:00:00.000Z"}"#)
check(youName?.addedLine(now: Tasks.parseISO("2026-10-24T11:00:00.000Z")!, calendar: cal) == "Added by You Need A Budget (a webhook), today",
      "a name that starts like a fixed word is left as it is")
check(synthetic(#"{"number":1,"sentence":"S","addedVia":"process"}"#)?.addedLine(now: Date(), calendar: cal) == "Added by an agent",
      "a fixed opening is lowered")
check(synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"sentence":"S"},{"id":2,"sentence":"T","closedAt":"2026-10-24T10:00:00.000Z"}]}"#)?.stateWord == "Open",
      "no progress from the engine: Open or Done, never a count of its own")

section("Mark as done, Reopen and seen: the requests")
let mac = URL(string: "https://studio.kosmosplus.com")!
let close = Board.taskActRequest(mac: mac, project: "springcatalogue", number: 3, act: .close)
check(close?.httpMethod == "POST" && close?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/springcatalogue/task/3/close" && close?.httpBody == nil,
      "close: a POST to the task's own route, with no body")
let coordinatorURL = URL(string: "https://login.kosmosplus.com")!
check(close.map { Board.forMac($0, coordinator: coordinatorURL) }?.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin",
      "Board.forMac marks it as the board's own (BoardClient applies it to every request, kosmos#7075), so the Mac's isViaScreen reads it as the person's")
check(Board.taskActRequest(mac: mac, project: "springcatalogue", number: 3, act: .reopen)?.url?.path == "/api/project/springcatalogue/task/3/reopen", "reopen")
check(Board.taskActRequest(mac: mac, project: "../x", number: 3, act: .close) == nil && Board.taskActRequest(mac: mac, project: "p", number: 0, act: .close) == nil,
      "not a project id or not a task number: no request")
let seen = Board.taskSeenRequest(mac: mac, project: "springcatalogue", number: 3)
check(seen?.url?.path == "/api/project/springcatalogue/task/3/seen" && seen?.httpMethod == "POST", "seen: a POST to the task's own route")
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
check(Board.activityPhrase(["kind": "closed", "via": "parent", "parent": 4], name: { $0 }) == "Marked done with task 4"
      && Board.activityPhrase(["kind": "closed"], name: { $0 }) == "Marked done",
      "kosmos#7514: a subtask closed with its parent names the parent, as engine/taskactphrase.js does; a plain close as before")
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
// kosmos#8679: edited (kosmos#8664) and check-reported read as the page reads them (engine/taskactphrase.test.js's fixtures).
let named: (String) -> String = { $0 == "mara" ? "Mara" : $0 == "leo" ? "Leo" : $0 }
check(Board.activityPhrase(["kind": "edited", "person": true, "fromTitle": "Fix login", "title": "Fix login on iPhone"], name: named) == "You changed the title from Fix login to Fix login on iPhone", "edited: the person's new title")
check(Board.activityPhrase(["kind": "edited", "by": "mara", "detail": "new words"], name: named) == "Mara changed the detail", "edited: an agent's new detail")
check(Board.activityPhrase(["kind": "edited", "by": "leo", "fromTitle": "a", "title": "b", "fromDetail": "x", "detailCleared": true], name: named) == "Leo changed the title from a to b and cleared the detail", "edited: both, the detail cleared")
check(Board.activityPhrase(["kind": "edited", "fromTitle": "a", "title": "b"], name: named) == "Changed the title from a to b", "edited: nobody named")
check(Board.activityPhrase(["kind": "edited"], name: named) == "Changed the task", "edited: no fields")
check(Board.activityPhrase(["kind": "check-reported", "by": "mara", "check": 2, "met": true, "how": "node --test, 40 of 40"], name: named) == "Mara says done-when check 2 is met: node --test, 40 of 40", "check-reported: met, with how")
check(Board.activityPhrase(["kind": "check-reported", "check": 1, "met": false], name: named) == "An agent says done-when check 1 is not met", "check-reported: unmet, nobody named")
check(Board.activityPhrase(["kind": "edited"], name: named) != "edited", "CONTROL: edited no longer shows its bare kind")
check(Board.activityPhrase(["kind": "run", "missedBefore": 1e300], name: { $0 }) == "Ran, after 1000000000 missed runs"
      && Board.activityPhrase(["kind": "undone", "files": 1e300], name: { $0 }) == "File changes undone (1000000000 files)",
      "a count far too large is clamped, never a crash")
let unnamed = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"}]}"#, agents: #"[{"sessionName":"dana","name":""}]"#)
check(unnamed?.partLines(roster: ["dana": "Dana"]).first?.who == "Dana", "a member with no name of its own: the roster's name (tkMemberName)")
check(Board.activityPhrase(["kind": "kept-dropped", "to": "dana", "person": true], name: { _ in "Dana" })
      == "Your message to Dana was never sent: Kosmos kept it while Dana was out of usage and could not send it within a day", "a dropped message")
check(Board.activityPhrase(["kind": "missed", "count": 3, "told": "dana", "reached": false], name: { _ in "Dana" }) == "3 runs missed; Kosmos could not reach Dana",
      "missed runs, the reviewer not reached")
// kosmos#8581: a due run told to its holder, reached and not, as engine/taskactphrase.js words it.
check(Board.activityPhrase(["kind": "due-told", "told": "dana", "reached": true], name: { _ in "Dana" }) == "A run was due; Dana was told",
      "a due run, the holder told")
check(Board.activityPhrase(["kind": "due-told", "told": "dana", "reached": false], name: { _ in "Dana" }) == "A run was due; Kosmos could not reach Dana",
      "a due run, the holder not reached")

section("the page's model, against a fake Mac")
// kosmos#7751: on the main actor, as the model is. Unisolated, asyncSend ran on another thread (Swift 5 mode runs a
// nonisolated async method off the caller's actor), so a test's yield loop did not wait for it and the two raced on
// `held` and `asked`. ThreadSanitizer reported that race before this change.
@MainActor
final class FakeMac {
    var projects: (Int, Data)? = (200, projectsData)
    var activity: (Int, Data)? = (200, fixture("activity-3.json"))
    var receipt: (Int, Data)? = (200, Data(#"{"retries":{},"agents":[]}"#.utf8))
    // What an undo would do (GET .../undo); doing it (POST) is answered from actAnswers.
    var undo: (Int, Data)? = (200, Data(#"{"on":false,"ready":false,"because":"off","files":[]}"#.utf8))
    var actAnswers: [(Int, String)?] = []
    var seenAnswers: [(Int, String)?] = []
    var asked: [String] = []
    var epoch = 0
    var onSend: ((URLRequest) -> Void)?
    // When set, a request is held until release() (for reads that land out of order). Set it with holdTheNext().
    private(set) var holdNext = false
    private var held: CheckedContinuation<Void, Never>?
    var holding: Bool { held != nil }
    // Arms a hold only when none is armed or held, so the hold a test then waits for is the one it armed.
    func holdTheNext(line: Int = #line) {
        if holdNext || held != nil { endRun("a hold was armed while an earlier one was still armed or held", line: line) }
        holdNext = true
    }
    func release() { let h = held; held = nil; h?.resume() }
    // kosmos#8958 slice B3b: holds EVERY request while set, in the order sent, so two can be out at once and answered in
    // any order (release(at:)): a tick read started before a save, landing while the save's own read is still out.
    var queueing = false
    private var queued: [CheckedContinuation<Void, Never>] = []
    var queuedCount: Int { queued.count }
    func release(at i: Int) { queued.remove(at: i).resume() }
    func asyncSend(_ build: (URL) -> URLRequest?) async -> (Data, HTTPURLResponse)? {
        let answer = send(build)
        if holdNext {
            holdNext = false
            // Never drop a held continuation: it would never resume.
            if held != nil { endRun("a second request was held while one already was") }
            await withCheckedContinuation { held = $0 }
        }
        if queueing { await withCheckedContinuation { queued.append($0) } }
        // As URLSession: a request whose task was cancelled gives no answer.
        return Task.isCancelled ? nil : answer
    }
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
        if path.hasSuffix("/receipt") { return answer(receipt) }
        if path.hasSuffix("/undo") && r.httpMethod != "POST" { return answer(undo) }
        if path.hasSuffix("/seen") { return answer(seenAnswers.isEmpty ? (200, Data("{}".utf8)) : seenAnswers.removeFirst().map { ($0.0, Data($0.1.utf8)) }) }
        return answer(actAnswers.isEmpty ? (200, Data("{}".utf8)) : actAnswers.removeFirst().map { ($0.0, Data($0.1.utf8)) })
    }
}
// Ends the run as a FAIL with its verdict line. A precondition would not do: in this suite's -O build it traps with no
// message, which reads in the log as the bare crash kosmos#7751 was.
func endRun(_ why: String, line: Int = #line) -> Never {
    check(false, why, line: line)
    print("")
    print("VERDICT: FAIL \(failed) of \(passed + failed)")
    exit(1)
}
// Wait until a request, parse or build the test holds is held. Never carry on without it: a test that went on would
// release nothing and leave the hold armed for some later request.
@MainActor
func waitUntil(_ reached: () -> Bool, _ what: String, line: Int = #line) async {
    // Only for holds on the main actor: yields there do not wait for another thread (kosmos#7751), so a hold reached
    // off it could take longer than this bound and FAIL a correct test.
    for _ in 0..<100_000 { if reached() { return }; await Task.yield() }
    endRun("the test never reached its hold: \(what)", line: line)
}
@MainActor
func modelTests() async {
    let mac = FakeMac()
    var slept: [TimeInterval] = []
    var clock = Date(timeIntervalSince1970: 1_800_000_000)
    func model(_ n: Int) -> TaskPageModel {
        let m = TaskPageModel(project: "springcatalogue", number: n, send: { await mac.asyncSend($0) }, sleep: { slept.append($0) },
                              epoch: { mac.epoch }, now: { clock })
        m.onScreen = true
        m.touched()
        return m
    }
    let m = model(3)
    let nm = ["dana": "Dana"]
    await m.read()
    await m.readActivity(names: nm)
    check(m.page?.number == 3 && m.activity?.count == 3 && !m.gone && !m.readFailed, "a read fills the page and its activity")

    mac.asked = []
    mac.actAnswers = [(409, #"{"error":"the person set this task to repeat, or chose who reviews it, so only they can close it"}"#)]
    await m.press(.close, names: nm)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/close", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "Mark as done: the close, then the page and its activity read again")
    check(m.refusal == "the person set this task to repeat, or chose who reviews it, so only they can close it" && !m.pressing, "a refusal is said, and the button is back")
    // The task closed elsewhere meanwhile: the refusal about the close goes with the next read that shows it.
    let savedProjects = mac.projects
    mac.projects = (200, Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[{"number":3,"sentence":"Pages 9 to 12","closedAt":"2026-10-25T02:00:00.000Z","progress":{"done":1,"total":1,"closed":true}}]}]}"#.utf8))
    await m.read()
    check(m.page?.act == .reopen && m.refusal == nil, "closed elsewhere after a refused close: the refusal goes, and the button says Reopen")
    mac.projects = savedProjects
    await m.read()

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
    await m.markSeen()
    await m.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen", "POST /api/project/springcatalogue/task/3/seen"] && slept == [3],
          "a 503 is tried once more after 3 s, and the same state is not marked again")
    mac.asked = []
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T01:00:00Z","kind":"said","text":"new"}],"count":1}"#.utf8))
    await m.readActivity(names: nm)
    m.onScreen = false
    await m.markSeen()
    check(mac.asked == ["GET /api/project/springcatalogue/task/3/activity"], "not on screen: not marked seen")
    mac.seenAnswers = [(403, #"{"error":"only the person's page can mark a task seen"}"#)]
    mac.asked = []
    m.onScreen = true
    m.touched()
    await m.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"],
          "the state that landed while it was off screen is marked when the page is back; a 4xx settles it with no retry")

    // The person must be there (the board's tkPresent): no touch for two minutes, or the app in the background.
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T01:05:00Z","kind":"said","text":"newer"}],"count":1}"#.utf8))
    await m.readActivity(names: nm)
    clock += TaskPageModel.presentFor + 1
    mac.asked = []
    await m.markSeen()
    check(mac.asked.isEmpty, "nobody has touched it for two minutes: not marked seen (a phone left open on a stand)")
    m.touched()
    await m.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a touch after being idle: the next mark records the state that arrived meanwhile")
    mac.asked = []
    clock += TaskPageModel.presentFor + 1
    m.assistive = true
    await m.markSeen(again: true)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"],
          "with VoiceOver running the person counts as there without a touch; again records the same state once more (the board's tab return)")
    await m.markSeen()
    check(mac.asked.count == 1, "and without again the same state is not sent twice")
    m.assistive = false
    mac.asked = []
    m.touched()
    m.appActive = false
    await m.markSeen(again: true)
    check(mac.asked.isEmpty, "the app in the background: not marked seen")
    m.appActive = true
    // A state the Mac has never recorded, so only the skipped retry's handling can make the return send it.
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T01:10:00Z","kind":"said","text":"newest"}],"count":1}"#.utf8))
    await m.readActivity(names: nm)
    mac.asked = []
    mac.seenAnswers = [(502, "{}")]
    mac.onSend = { r in if r.url!.path.hasSuffix("/seen") { m.onScreen = false } }
    await m.markSeen()
    mac.onSend = nil
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a retry is not sent once the person has left the page")
    m.onScreen = true
    m.touched()
    mac.asked = []
    await m.markSeen(again: true)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "and that state is sent again when they come back (left unmarked, not settled)")

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
    let ep = model(3)
    await ep.read()
    check(ep.page != nil, "premise: a page read under the account before")
    mac.epoch += 1
    mac.asked = []
    await ep.press(.close, names: nm)
    await ep.read()
    check(mac.asked.isEmpty, "a page from before another account or Mac sends nothing, though it has a task shown: no press, no read")

    // The 5-second tick: the task on every tick while on screen; its activity first, then only while the person is there.
    let t = model(3)
    check(t.shouldReadTask && t.shouldReadActivity(first: true) && t.shouldReadActivity(first: false), "present: every tick reads both")
    clock += TaskPageModel.presentFor + 1
    check(t.shouldReadTask && t.shouldReadActivity(first: true) && !t.shouldReadActivity(first: false),
          "idle: the task is still read (its state and button never go stale), its activity only the first time")
    t.appActive = false
    check(!t.shouldReadTask, "the app in the background: nothing is read")

    // Again re-records only a state the Mac recorded (tkTabReturn): a refused one is not sent again on every return.
    let rr = model(3)
    mac.activity = (200, fixture("activity-3.json"))
    await rr.readActivity(names: nm)
    mac.seenAnswers = [(403, "{}")]
    mac.asked = []
    await rr.markSeen(again: true)
    await rr.markSeen(again: true)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a state the Mac refused is not re-sent on a return")
    mac.asked = []
    let rec = model(3)
    await rec.readActivity(names: nm)
    await rec.markSeen()
    await rec.markSeen(again: true)
    check(mac.asked.filter { $0.hasSuffix("/seen") }.count == 2, "a recorded state is recorded again on a return")

    // A seen mark cut short (the loop restarted while it was on its way) is not a failure: the next mark sends it.
    let cm = model(3)
    mac.activity = (200, fixture("activity-3.json"))
    await cm.readActivity(names: nm)
    mac.asked = []
    mac.holdTheNext()
    let cut = Task { await cm.markSeen() }
    await waitUntil({ mac.holding }, "a request held")
    cut.cancel()
    mac.release()
    await cut.value
    check(mac.asked.first == "POST /api/project/springcatalogue/task/3/seen", "premise: the cut mark had started its POST")
    mac.asked = []
    await cm.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a cancelled seen mark leaves the state unmarked, so the next mark sends it")
    mac.holdTheNext()
    let cutRead = Task { await cm.read() }
    await waitUntil({ mac.holding }, "a request held")
    cutRead.cancel()
    mac.release()
    await cutRead.value
    check(!cm.readFailed, "a read cut short records no failure")

    // A parse held while a newer read lands: the newer answer stands, and so does a newer failure.
    @MainActor final class ParseGate {
        private(set) var hold = false
        private var held: CheckedContinuation<Void, Never>?
        var waiting: Bool { held != nil }
        func release() { let h = held; held = nil; h?.resume() }
        // As FakeMac's: a second hold would drop the first one's continuation, so the run ends instead.
        func arm(line: Int = #line) {
            if hold || held != nil { endRun("a parse or build hold was armed while an earlier one was still armed or held", line: line) }
            hold = true
        }
        func park(line: Int = #line) async {
            guard hold else { return }
            hold = false
            if held != nil { endRun("a second parse or build was held while one already was", line: line) }
            await withCheckedContinuation { held = $0 }
        }
    }
    for newerFails in [false, true] {
        let gate = ParseGate()
        let pm = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch },
                               now: { clock }, parse: { data, project, number in
                                   await gate.park()
                                   return Board.parseTaskPage(data, project: project, number: number)
                               })
        mac.projects = (200, projectsData)
        gate.arm()
        let older = Task { await pm.read() }
        await waitUntil({ gate.waiting }, "a parse held")
        mac.projects = newerFails ? (502, Data()) : (200, Data(#"{"projects":[]}"#.utf8))
        await pm.read()
        gate.release()
        await older.value
        check(pm.page == nil && (newerFails ? pm.readFailed : pm.gone),
              newerFails ? "a newer read's failure stands over an older parse finishing after it" : "a newer answer stands over an older parse finishing after it")
    }
    mac.projects = (200, projectsData)

    // A retry cut short is not attempted either: the state stays unmarked.
    let rc = model(3)
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T03:00:00Z","kind":"said","text":"retry-cut"}],"count":1}"#.utf8))
    await rc.readActivity(names: nm)
    mac.asked = []
    mac.seenAnswers = [(503, "{}")]
    var retryTask: Task<Void, Never>?
    mac.onSend = { r in if r.url!.path.hasSuffix("/seen") && mac.asked.count == 2 { mac.holdTheNext() } }
    retryTask = Task { await rc.markSeen() }
    await waitUntil({ mac.holding }, "a request held")
    check(mac.asked.count == 2, "premise: the retry is in the air")
    retryTask?.cancel()
    mac.release()
    await retryTask?.value
    mac.onSend = nil
    mac.asked = []
    await rc.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a cancelled retry leaves the state unmarked, so the next mark sends it")

    // An activity build held while a newer read lands: the newer rows stand, and so does a newer failure.
    for newerFails in [false, true] {
        let gate = ParseGate()
        let am = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch },
                               now: { clock }, buildRows: { names, data in
                                   await gate.park()
                                   return await TaskPageModel.buildOffMain(names, data)
                               })
        mac.activity = (200, fixture("activity-3.json"))
        gate.arm()
        let olderBuild = Task { await am.readActivity(names: nm) }
        await waitUntil({ gate.waiting }, "a build held")
        mac.activity = newerFails ? (502, Data()) : (200, Data(#"{"events":[],"count":0}"#.utf8))
        let newerShown = await am.readActivity(names: nm)
        gate.release()
        let olderShown = await olderBuild.value
        check(!olderShown && (newerFails ? (!newerShown && am.activityFailed && am.activity == nil) : (newerShown && am.activity == [])),
              newerFails ? "a newer activity failure stands over an older build finishing after it" : "newer activity rows stand over an older build finishing after it")
    }
    mac.activity = (200, fixture("activity-3.json"))

    // readActivity says whether its state is the one drawn, so a return marks only what was just read.
    let ra = model(3)
    let drew = await ra.readActivity(names: nm)
    check(drew, "a read that draws its state says so")
    mac.activity = (500, Data())
    let failedReturn = await ra.readActivity(names: nm)
    check(!failedReturn, "a failed read says it drew nothing (the view then sends no seen mark for the old state)")
    mac.activity = (200, fixture("activity-3.json"))

    // A tick that changes nothing publishes nothing (the page and its history are not redrawn).
    let quiet = model(3)
    await quiet.read()
    await quiet.readActivity(names: nm)
    var published = 0
    let sub = quiet.objectWillChange.sink { _ in published += 1 }
    await quiet.read()
    await quiet.readActivity(names: nm)
    sub.cancel()
    check(published == 0, "an unchanged read and activity read publish nothing (\(published))")

    // The tick (TaskPageView's loop body): a return marks only after its own read draws.
    let tk = model(3)
    mac.activity = (200, fixture("activity-3.json"))
    await tk.tick(first: true, returning: true, names: nm)
    mac.asked = []
    await tk.tick(first: true, returning: true, names: nm)
    check(mac.asked == ["GET /api/projects", "GET /api/project/springcatalogue/task/3/activity", "POST /api/project/springcatalogue/task/3/seen"],
          "a return reads the task and its activity, then records the state it drew once more")
    mac.activity = (500, Data())
    mac.asked = []
    await tk.tick(first: true, returning: true, names: nm)
    check(!mac.asked.contains { $0.hasSuffix("/seen") }, "a return whose activity read fails sends no seen mark (nothing new was drawn)")
    mac.activity = (200, fixture("activity-3.json"))
    clock += TaskPageModel.presentFor + 1
    mac.asked = []
    await tk.tick(first: false, returning: false, names: nm)
    check(mac.asked == ["GET /api/projects"], "an idle tick reads the task only")

    // The same answer and names again: the rows are not rebuilt.
    var builds = 0
    let bm = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch },
                           now: { clock }, buildRows: { names, data in builds += 1; return await TaskPageModel.buildOffMain(names, data) })
    let b1 = await bm.readActivity(names: nm)
    let b2 = await bm.readActivity(names: nm)
    check(b1 && b2 && builds == 1, "an unchanged answer is not rebuilt, and still counts as drawn (\(builds) builds)")
    _ = await bm.readActivity(names: ["dana": "Dana R."])
    check(builds == 2 && bm.activity?.first?.text == "Created and given to Dana R., under task 1", "new names rebuild the rows")
    // Once the task has been read, the project's own member names win over the roster's (tkMemberName).
    let mn = model(3)
    await mn.read()
    _ = await mn.readActivity(names: ["dana": "Dana (roster)"])
    check(mn.activity?.first?.text == "Created and given to Dana, under task 1", "the project's member name is used over the roster's")

    // A return that cannot mark leaves the recorded state recorded.
    let rs = model(3)
    await rs.readActivity(names: nm)
    await rs.markSeen()
    rs.appActive = false
    await rs.markSeen(again: true)
    rs.appActive = true
    mac.asked = []
    await rs.markSeen()
    check(mac.asked.isEmpty, "a blocked return does not make the next ordinary mark re-send a recorded state")

    // Reads that land out of order: the newer answer stands.
    mac.epoch = 0
    let o = model(3)
    mac.holdTheNext()
    let first = Task { await o.read() }
    await waitUntil({ mac.holding }, "a request held")
    mac.projects = (200, Data(#"{"projects":[]}"#.utf8))
    await o.read()
    check(o.gone, "premise: the newer read says the task is gone")
    mac.release()
    await first.value
    check(o.gone && o.page == nil, "the older read, landing after it, does not bring the task back")
    mac.projects = (200, projectsData)
    mac.activity = (200, fixture("activity-3.json"))
    mac.holdTheNext()
    let firstActivity = Task { await o.readActivity(names: nm) }
    await waitUntil({ mac.holding }, "a request held")
    mac.activity = (200, Data(#"{"events":[],"count":0}"#.utf8))
    await o.readActivity(names: nm)
    mac.release()
    await firstActivity.value
    check(o.activity == [], "an older activity read landing after a newer one does not replace it")
}
section("#8137: the task page says who is still to finish")
let whoJSON = #"{"projects":[{"id":"p1","name":"Launch","tasks":[{"number":7,"sentence":"Two agents","createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana"},{"id":2,"who":"gus"}],"whoIsLeft":{"finished":["dana"],"left":["gus"]}},{"number":8,"sentence":"One agent","createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana"}]}]}]}"#
func whoPage(_ n: Int) -> Board.TaskPage? {
    if case .page(let p) = Board.parseTaskPage(Data(whoJSON.utf8), project: "p1", number: n) { return p }
    return nil
}
check(whoPage(7)?.whoLeftLine(roster: roster) == "Reported finished: Dana (roster). Still to finish: Gus.", "names from the roster, as the part lines have them")
check(whoPage(7) != nil && whoPage(8) != nil, "premise: both pages parsed")
check(whoPage(8)?.whoLeftLine(roster: roster) == nil, "control: one agent, no line")

await modelTests()

section("#8958 slice B1: a message on the task, the due date, and the words")
let macURL = URL(string: "https://studio.kosmosplus.com")!
func bodyOf(_ r: URLRequest?) -> [String: Any]? { r?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
let say = Board.taskMessageRequest(mac: macURL, project: "springcatalogue", number: 4, text: "  Use the March photos.\n")
check(say?.httpMethod == "POST" && say?.url?.path == "/api/project/springcatalogue/task/4/message"
      && bodyOf(say)?["text"] as? String == "Use the March photos.", "a message posts its trimmed words to the task's message route")
check(Board.taskMessageRequest(mac: macURL, project: "springcatalogue", number: 4, text: " \n ") == nil, "an empty box sends nothing")
let due = Board.taskDueRequest(mac: macURL, project: "springcatalogue", number: 4, due: "2026-11-30")
check(due?.url?.path == "/api/project/springcatalogue/task/4/due" && bodyOf(due)?["dueDate"] as? String == "2026-11-30", "a due date posts the calendar date")
let clear = Board.taskDueRequest(mac: macURL, project: "springcatalogue", number: 4, due: nil)
check(bodyOf(clear)?["dueDate"] is NSNull, "clearing the due date sends null")
check(Board.taskDueRequest(mac: macURL, project: "springcatalogue", number: 4, due: "2026-02-30") == nil
      && Board.taskDueRequest(mac: macURL, project: "springcatalogue", number: 4, due: "30/11/2026") == nil, "no request for a date that is not a real calendar date")
var central = Calendar(identifier: .gregorian); central.timeZone = TimeZone(identifier: "America/Chicago")!
check(Board.dueDay("2026-11-30", calendar: central).map { Board.dueString($0, calendar: central) } == "2026-11-30", "a due date reads and writes back as the same day")
check(Board.keptDraft("2026-10-30", stored: "2026-10-30") == nil && Board.keptDraft("2026-11-02", stored: "2026-10-30") == "2026-11-02"
      && Board.keptDraft("2026-02-30", stored: nil) == nil && Board.keptDraft(nil, stored: "2026-10-30") == nil,
      "a draft is kept only while it is a real day that differs from the stored one")
check(Board.dueControls(stored: "2026-10-30", draft: "2026-10-30") == .stored("2026-10-30"), "a draft back on the stored day: just the stored date (Clear)")
check(Board.dueControls(stored: "2026-10-30", draft: "2026-11-02") == .choosing("2026-11-02"), "a different day being chosen: Set and Cancel")
check(Board.dueControls(stored: nil, draft: "2026-12-01") == .choosing("2026-12-01"), "no stored date, a day being chosen: Set and Cancel")
check(Board.dueControls(stored: nil, draft: nil) == .none, "no date at all: Set a due date")
check(Board.dueControls(stored: "soon", draft: nil) == .unreadable("soon"), "a stored date that is not a day: said as kept")
check(Board.keptDraft("2026-11-02", stored: "2026-11-02") == nil, "the stored day moving to the draft's day drops the draft")
check(Board.taskEdit(title: "Pages 1 to 8", detail: "", openedTitle: "Pages 1 to 8", openedDetail: nil) == .nothing, "nothing changed: nothing is sent")
check(Board.taskEdit(title: "  ", detail: "x", openedTitle: "Pages 1 to 8", openedDetail: nil) == .needsTitle, "an empty title is refused before sending")
check(Board.taskEdit(title: " Pages 1 to 9 ", detail: "keep", openedTitle: "Pages 1 to 8", openedDetail: "keep") == .send(["sentence": "Pages 1 to 9"]),
      "only the title, when only it changed (trimmed)")
check(Board.taskEdit(title: "Pages 1 to 8", detail: "  ", openedTitle: "Pages 1 to 8", openedDetail: "old words") == .send(["detail": String?.none]),
      "an emptied detail is sent as cleared")
check(Board.taskEdit(title: "Pages 1 to 8", detail: "a\nb", openedTitle: "Pages 1 to 8", openedDetail: "a\r\nb") == .nothing,
      "line ends compared as the board's textarea gives them back")
check(bodyOf(Board.taskTextRequest(mac: macURL, project: "springcatalogue", number: 4, body: Board.taskTextBody(["detail": String?.none])))?["detail"] is NSNull,
      "the cleared detail goes on the wire as null")
check(Board.taskTextRequest(mac: macURL, project: "springcatalogue", number: 4, body: [:]) == nil, "no request with nothing to say")
check(Board.taskWriteResult(status: 200, body: nil, failed: "f", unreached: "u") == .done, "a 2xx is done")
check(Board.taskWriteResult(status: 400, body: Data(#"{"error":"that is not a real date"}"#.utf8), failed: "f", unreached: "u") == .refused("that is not a real date"),
      "a refusal is the Mac's own words")
check(Board.taskWriteResult(status: 500, body: nil, failed: "f", unreached: "u") == .refused("f")
      && Board.taskWriteResult(status: 0, body: nil, failed: "f", unreached: "u") == .refused("u"), "else the board's words, and its could-not-reach words with no answer")
func said(_ json: String) -> String? { Board.taskSaidLine(Data(json.utf8), name: { ["dana": "Dana", "eli": "Eli"][$0] ?? $0 }) }
check(said(#"{"delivered":[{"agent":"dana","state":"placed"}]}"#) == nil, "every assignee reached: no line")
check(said(#"{"delivered":[]}"#) == "No agent is assigned to this task, so nobody was told.", "nobody assigned is said")
check(said(#"{"ok":true}"#) == nil, "CONTROL: no list, no line")
check(said(#"{"delivered":[{"agent":"dana","state":"could_not","because":"dana is switched off in this project"}]}"#)
      == "Dana is switched off in this project, so it was not told. Switch it on in the project's members to send it work here. Your message stays on the task.",
      "switched off, by its card name, and the message stays")
check(said(#"{"delivered":[{"agent":"eli","state":"held","heldFor":"signin"}]}"#)
      == "Eli is signed out. Kosmos will try to send your message to Eli once it is signed in again.", "signed out")
check(said(#"{"delivered":[{"agent":"eli","state":"held","heldUntil":"2999-01-01T00:00:00Z"}]}"#)
      == "Eli is out of usage. Kosmos will try to send your message to Eli once its usage resets.", "out of usage, without the board's time")
check(said(#"{"delivered":[{"agent":"dana","state":"placed"},{"agent":"dana","state":"could_not","because":"x"}]}"#)
      == "Kosmos could not reach Dana, so it was not told. Your message stays on the task.", "listed twice: its worst outcome")
check(said(#"{"delivered":[{"agent":"eli","state":"unconfirmed"}]}"#) == "Kosmos could not confirm that Eli got it.", "anything else: not confirmed")
check(said(#"{"delivered":[{"agent":"eli","state":"could_not","because":"eli is not on this project any more"}]}"#)
      == "Eli is not on this project any more, so it was not told. Your message stays on the task.", "not on the project any more")
check(said(#"{"delivered":[{"agent":"eli","state":"could_not","because":"Kosmos could not keep this one"}]}"#)
      == "Kosmos could not keep your message for Eli, so it was not told. Your message stays on the task.", "could not keep it")
check(said(#"{"delivered":[{"agent":"eli","state":"held","because":"it still has messages kept"}]}"#)
      == "Kosmos will try to send your message to Eli after the ones already waiting for it.", "behind messages already kept")
check(said(#"{"delivered":[{"agent":"eli","state":"held"}]}"#) == "Kosmos is keeping your message and will try to send it to Eli later.",
      "held with no time known")
check(said(#"{"delivered":[{"agent":"eli","state":"held","heldUntil":"2000-01-01T00:00:00Z"}]}"#)
      == "Kosmos is keeping your message and will try to send it to Eli later.", "a reset time already past is not called out of usage")
check(said(#"{"delivered":[{"agent":null,"state":"could_not","because":"x"}]}"#)
      == "Kosmos could not reach an agent, so it was not told. Your message stays on the task.", "an agent with no name")
check(said(#"{"delivered":[{"agent":"","state":"held","heldFor":"signin"}]}"#)
      == "An agent is signed out. Kosmos will try to send your message to an agent once it is signed in again.", "a sentence opening with no name")
check(said(#"{"delivered":[null]}"#) == nil, "a list with no usable entry: no line, as the board (its list was not empty)")
check(Board.capped(String(repeating: "\u{1F600}", count: 3), 4).utf16.count == 4 && Board.capped("abc", 4) == "abc",
      "the caps count UTF-16 units, as the board's maxlength")
check(Board.boardLineEnds("a\rb\r\nc") == "a\nb\nc", "a lone CR and a CRLF are both line ends, as the board's form")
check(Board.taskEdit(title: "Pages 1\nto 9", detail: "", openedTitle: "Pages 1 to 8", openedDetail: nil) == .send(["sentence": "Pages 1 to 9"]),
      "a line break in a title is a space (one line, as the board's text input)")
check(Board.taskEdit(title: "Pages 1 to 8", detail: "", openedTitle: "Pages 1\nto 8", openedDetail: nil) == .nothing,
      "a stored title with a line break is not sent back by a Save that changed nothing")

await b1ModelTests()

section("#8958 slice B2: Put on hold and Take off hold")
// Declared before the B2 tests run: a main.swift global below its first use is still empty there.
// The unhold route's answer: the task as it now is (open, Dana on it), and who has it next.
let unheldAnswer = #"{"task":{"number":3,"sentence":"Pages 9 to 12","parts":[{"id":1,"who":"dana"}]},"next":"It stays with Dana."}"#
let heldTask3 = Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[{"number":3,"sentence":"Pages 9 to 12","onHold":true,"createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana"}]}]}]}"#.utf8)
let noTask3 = Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[]}]}"#.utf8)
let closedTask3 = Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[{"number":3,"sentence":"Pages 9 to 12","closedAt":"2026-10-25T12:00:00.000Z","createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana","closedAt":"2026-10-25T12:00:00.000Z"}],"progress":{"done":1,"total":1,"closed":true}}]}]}"#.utf8)
let hold = Board.taskHoldRequest(mac: macURL, project: "springcatalogue", number: 4, onHold: true)
check(hold?.httpMethod == "POST" && hold?.url?.path == "/api/project/springcatalogue/task/4/hold" && bodyOf(hold)?["onHold"] as? Bool == true,
      "Put on hold posts onHold true to the task's hold route")
check(bodyOf(Board.taskHoldRequest(mac: macURL, project: "springcatalogue", number: 4, onHold: false))?["onHold"] as? Bool == false, "Take off hold posts false")
check(Board.holdTitle(onHold: false) == "Put on hold" && Board.holdTitle(onHold: true) == "Take off hold", "the board's two words")
check(Board.holdNextLine(Data(#"{"task":{},"next":"It stays with Dana."}"#.utf8)) == Board.HoldNext(words: "It stays with Dana.", choose: false), "an unhold's next sentence is said")
check(Board.holdNextLine(Data(#"{"next":"Nobody is on it, and the Assigner is off, so it waits for a person. To choose who, assign it now."}"#.utf8))
      == Board.HoldNext(words: "Nobody is on it, and the Assigner is off, so it waits for a person.", choose: true),
      "the board's assign ask is cut, with Choose who")
let looseBeside = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"},{"id":2,"sentence":"T"}]}"#)
let allOn = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"}]}"#)
check(Board.holdNextLine(Data(#"{"next":"It stays with Dana."}"#.utf8), page: looseBeside) == Board.HoldNext(words: "It stays with Dana.", choose: true),
      "a free part beside one somebody is on (the board's looseBesideHeld): Choose who too")
check(Board.holdNextLine(Data(#"{"next":"It stays with Dana."}"#.utf8), page: allOn) == Board.HoldNext(words: "It stays with Dana.", choose: false), "CONTROL: every open part has somebody: no Choose who")
if let a = allOn, let held = synthetic(#"{"number":1,"sentence":"S","onHold":true,"parts":[{"id":1,"who":"dana","sentence":"S"}]}"#),
   let paused = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"}]}"#, paused: true),
   let other = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"eli","sentence":"S"}]}"#) {
    let nameless = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"}]}"#,
                             agents: #"[{"sessionName":"dana","name":"Dana"},{"sessionName":"eli"}]"#)
    check(nameless.map { Board.holdNextSig($0) != Board.holdNextSig(a) } == true,
          "a member with no name of its own joining changes the signature (the board's every sessionName)")
    check(Board.holdNextSig(held) != Board.holdNextSig(a) && Board.holdNextSig(paused) != Board.holdNextSig(a) && Board.holdNextSig(other) != Board.holdNextSig(a),
          "the signature changes when the task is held again, the project paused, or someone else is on it")
} else { check(false, "the signature fixtures parse") }
check(Board.holdNextLine(Data(#"{"task":{}}"#.utf8)) == nil, "a hold answers with no next: nothing said")

await b2ModelTests()

@MainActor
func b2ModelTests() async {
    let mac = FakeMac()
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
    m.onScreen = true
    m.touched()
    let nm = ["dana": "Dana"]
    await m.read()
    check(m.page?.onHold == false && m.page?.closed == false, "premise: task 3 is open and not on hold")
    mac.asked = []
    await m.toggleHold(wasOnHold: false, names: nm)
    check(mac.asked == ["GET /api/projects", "POST /api/project/springcatalogue/task/3/hold", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "Put on hold reads the task first, then posts, then reads the page and activity again")
    check(!m.holding && m.holdSay == nil && !m.holdRefused, "a hold has no next line")
    // Already on hold elsewhere: the first read shows it, nothing is posted.
    let saved = mac.projects
    mac.projects = (200, Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[{"number":3,"sentence":"Pages 9 to 12","onHold":true,"createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana"}]}]}]}"#.utf8))
    mac.asked = []
    await m.toggleHold(wasOnHold: false, names: nm)
    check(!mac.asked.contains { $0.hasSuffix("/hold") } && m.holdSay == Board.holdAlready, "already on hold: nothing sent, and said so")
    // Take off hold: posted at once, and the next sentence said.
    mac.asked = []
    mac.actAnswers = [(200, unheldAnswer)]
    mac.projects = saved   // the Mac takes it off: the read after the post shows it open
    await m.toggleHold(wasOnHold: true, names: nm)
    check(mac.asked.first == "POST /api/project/springcatalogue/task/3/hold" && m.holdSay == "It stays with Dana.", "Take off hold posts at once and says who has it next")
    await m.read()
    mac.actAnswers = [(409, #"{"error":"a finished task cannot be put on hold"}"#)]
    await m.toggleHold(wasOnHold: false, names: nm)
    check(m.holdSay == "a finished task cannot be put on hold" && !m.holding && m.holdRefused, "a refusal is the Mac's words, drawn as a refusal")
    mac.asked = []
    await m.toggleHold(wasOnHold: true, names: nm)
    check(mac.asked.isEmpty, "a press whose button no longer matches the task sends nothing")
    await b2ReviewTests()
}


// kosmos#8958 slice B2 review 1: the guards no check above could tell from their absence.
@MainActor
func b2ReviewTests() async {
    let nm = ["dana": "Dana"]
    func fresh(_ mac: FakeMac, parse: TaskPageModel.Parse? = nil) async -> TaskPageModel {
        let m = parse.map { TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch }, parse: $0) }
            ?? TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
        m.onScreen = true
        await m.read()
        return m
    }
    let posted: (FakeMac) -> Bool = { $0.asked.contains { $0.hasSuffix("/hold") } }

    // The check is its own read: the tick's read overtaking it cannot leave the check on the task as it was (WARNING 1).
    do {
        final class Gate { var armed = false; var held: CheckedContinuation<Void, Never>? }
        let gate = Gate()
        let mac = FakeMac()
        let m = await fresh(mac, parse: { data, project, number in
            if gate.armed { gate.armed = false; await withCheckedContinuation { gate.held = $0 } }
            return Board.parseTaskPage(data, project: project, number: number)
        })
        check(m.page?.onHold == false, "premise: shown as not on hold")
        mac.projects = (200, heldTask3)   // an agent has just put it on hold
        mac.asked = []
        mac.holdTheNext()
        let pressing = Task { await m.toggleHold(wasOnHold: false, names: nm) }
        await waitUntil({ mac.holding }, "the press's check held on the wire")
        gate.armed = true
        let tick = Task { await m.read() }
        await waitUntil({ gate.held != nil }, "the tick's read held in its parse")
        mac.release()
        await pressing.value
        check(!posted(mac) && m.holdSay == Board.holdAlready, "a tick read overtaking the press's check: the agent's hold is seen, nothing is posted")
        gate.held?.resume(); gate.held = nil
        await tick.value
    }
    // Two presses at once: the second sends nothing.
    do {
        let mac = FakeMac(); let m = await fresh(mac)
        mac.asked = []
        mac.holdTheNext()
        let first = Task { await m.toggleHold(wasOnHold: false, names: nm) }
        await waitUntil({ mac.holding }, "the first press's check held")
        await m.toggleHold(wasOnHold: false, names: nm)
        check(mac.asked == ["GET /api/projects"], "a second press while one is out sends nothing")
        // Mark as done waits for the hold too (WARNING 3).
        guard let act = m.page?.act else { check(false, "premise: a task to act on"); mac.release(); await first.value; return }
        await m.press(act, names: nm)
        check(mac.asked == ["GET /api/projects"], "Mark as done while a hold is out sends nothing")
        mac.release()
        await first.value
        check(mac.asked.filter { $0.hasSuffix("/hold") }.count == 1, "the first press still posts its one hold")
    }
    // A closed task: no hold is sent.
    do {
        let mac = FakeMac(); mac.projects = (200, closedTask3); let m = await fresh(mac)
        check(m.page?.closed == true, "premise: task 3 reads closed")
        mac.asked = []
        await m.toggleHold(wasOnHold: false, names: nm)
        check(mac.asked.isEmpty && m.holdSay == nil, "a closed task: nothing sent")
    }
    // Gone by the check, and a check that could not read: nothing posted, and the board's words.
    do {
        let mac = FakeMac(); let m = await fresh(mac)
        mac.projects = (200, noTask3); mac.asked = []
        await m.toggleHold(wasOnHold: false, names: nm)
        check(!posted(mac) && m.holdSay == Board.holdTaskGone && m.gone, "gone by the check: nothing posted, said so, and the page knows")
        let mac2 = FakeMac(); let m2 = await fresh(mac2)
        mac2.projects = (500, Data("{}".utf8)); mac2.asked = []
        await m2.toggleHold(wasOnHold: false, names: nm)
        check(!posted(mac2) && m2.holdSay == Board.holdCheckFailed && !m2.holding, "a check that could not read: nothing posted, said so")
        mac2.projects = nil
        await m2.toggleHold(wasOnHold: false, names: nm)
        check(m2.holdSay == Board.holdCheckFailed, "no answer at all: the same")
    }
    // Signed out while the hold is in the air: nothing more is read or said.
    do {
        let mac = FakeMac(); let m = await fresh(mac)
        mac.asked = []
        mac.onSend = { r in if r.url!.path.hasSuffix("/hold") { mac.epoch += 1 } }
        mac.actAnswers = [(200, unheldAnswer)]
        mac.projects = (200, heldTask3)
        await m.read()   // the page shows it held, so Take off hold
        mac.asked = []
        await m.toggleHold(wasOnHold: true, names: nm)
        check(mac.asked == ["POST /api/project/springcatalogue/task/3/hold"] && m.holdSay == nil, "signed out mid-press: no read after, nothing said")
    }
    // The next line goes when the task no longer reads as it did (WARNING 2), and stays while it does.
    do {
        let mac = FakeMac(); mac.projects = (200, heldTask3); let m = await fresh(mac)
        mac.projects = (200, projectsData)
        mac.actAnswers = [(200, unheldAnswer)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdSay == "It stays with Dana.", "premise: the next line is said")
        await m.read()
        check(m.holdSay == "It stays with Dana.", "CONTROL: a tick that reads the same keeps the line")
        mac.projects = (200, heldTask3)   // an agent holds it again
        await m.read()
        check(m.holdSay == nil, "held again elsewhere: the stale next line goes")
    }
    // The line is about the task in the answer (review 2): said only while the page shows that task as it was.
    do {
        let mac = FakeMac(); mac.projects = (200, heldTask3); let m = await fresh(mac)
        mac.projects = (200, projectsData)
        mac.actAnswers = [(200, #"{"task":{"number":3,"sentence":"Pages 9 to 12","parts":[{"id":1,"who":null}]},"next":"Kosmos hands it to the next free agent."}"#)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdSay == nil && !m.holding, "a hand-out landing before the read (the page shows Dana, the answer nobody): nothing said")
        let mac2 = FakeMac(); mac2.projects = (200, heldTask3); let m2 = await fresh(mac2)
        mac2.actAnswers = [(200, unheldAnswer)]
        mac2.onSend = { r in if r.url!.path.hasSuffix("/hold") { mac2.projects = (500, Data("{}".utf8)) } }
        await m2.toggleHold(wasOnHold: true, names: nm)
        check(m2.holdSay == nil && m2.page?.onHold == true, "the read after the post failed (the page still shows it held): nothing said")
        let mac3 = FakeMac(); mac3.projects = (200, heldTask3); let m3 = await fresh(mac3)
        mac3.projects = (200, projectsData)
        mac3.actAnswers = [(200, #"{"next":"It stays with Dana."}"#)]
        await m3.toggleHold(wasOnHold: true, names: nm)
        check(m3.holdSay == nil, "an answer with no task: nothing said, as the board's")
        // CONTROL for all three: the same press with the answer's task matching the page is said.
        let mac4 = FakeMac(); mac4.projects = (200, heldTask3); let m4 = await fresh(mac4)
        mac4.projects = (200, projectsData)
        mac4.actAnswers = [(200, unheldAnswer)]
        await m4.toggleHold(wasOnHold: true, names: nm)
        check(m4.holdSay == "It stays with Dana." && !m4.holdRefused, "CONTROL: the answer's task as the page shows it: said")
    }
    // The line goes when the task does.
    do {
        let mac = FakeMac(); mac.projects = (200, heldTask3); let m = await fresh(mac)
        mac.projects = (200, projectsData)
        mac.actAnswers = [(200, unheldAnswer)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdSay == "It stays with Dana.", "premise: said")
        mac.projects = (200, noTask3)
        await m.read()
        check(m.holdSay == nil && m.gone, "the task gone: the line goes with it")
    }
    // Each press starts clean (review 3): a refusal's colour does not carry to the next line, and a next line's
    // signature does not carry to a refusal (which a later tick would then wipe).
    do {
        let mac = FakeMac(); mac.projects = (200, heldTask3); let m = await fresh(mac)
        mac.actAnswers = [(409, #"{"error":"not now"}"#)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdRefused && m.holdSay == "not now", "premise: a refusal")
        mac.projects = (200, projectsData)
        mac.actAnswers = [(200, unheldAnswer)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdSay == "It stays with Dana." && !m.holdRefused, "the next press's line is not drawn as a refusal")
        // Now a next line's signature is recorded; a refusal follows, then the task changes elsewhere.
        mac.actAnswers = [(409, #"{"error":"a finished task cannot be put on hold"}"#)]
        await m.toggleHold(wasOnHold: false, names: nm)
        check(m.holdSay == "a finished task cannot be put on hold", "premise: the refusal replaced the next line")
        mac.projects = (200, heldTask3)
        await m.read()
        check(m.holdSay == "a finished task cannot be put on hold", "a tick after a refusal keeps the refusal (the old line's signature went with it)")
    }
    check(Board.holdNextLine(Data(#"{"next":" To choose who, assign it now."}"#.utf8)) == nil, "a next that is only the assign ask: nothing said")
    // A hold pressed while Mark as done is out sends nothing (review 2: the other direction).
    do {
        let mac = FakeMac(); let m = await fresh(mac)
        mac.asked = []
        mac.holdTheNext()
        guard let act = m.page?.act else { check(false, "premise: a task to act on"); return }
        let pressing = Task { await m.press(act, names: nm) }
        await waitUntil({ mac.holding }, "Mark as done held on the wire")
        let before = mac.asked
        await m.toggleHold(wasOnHold: false, names: nm)
        check(mac.asked == before, "Put on hold while Mark as done is out sends nothing")
        mac.release()
        await pressing.value
    }
}

@MainActor
func b1ModelTests() async {
    let mac = FakeMac()
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
    m.onScreen = true
    m.touched()
    let nm = ["dana": "Dana"]
    await m.read()
    mac.asked = []
    mac.actAnswers = [(200, #"{"ok":true,"delivered":[{"agent":"dana","state":"could_not","because":"input box already holds text"}]}"#)]
    let recorded = await m.say("Check the captions", name: { nm[$0] ?? $0 }, names: nm)
    check(recorded && mac.asked == ["POST /api/project/springcatalogue/task/3/message", "GET /api/project/springcatalogue/task/3/activity"],
          "a message is posted, then the activity read again (where it now shows)")
    check(m.sayLine == "Dana's input box held text that had not been sent, so it was not told. Your message stays on the task." && !m.sayRefused && !m.saying,
          "the line says who it did not reach")
    mac.asked = []
    mac.actAnswers = [(400, #"{"error":"keep the message to 2000 characters or fewer"}"#)]
    let refused = await m.say("x", name: { $0 }, names: nm)
    check(!refused && m.sayRefused && m.sayLine == "keep the message to 2000 characters or fewer" && mac.asked.count == 1,
          "a refusal keeps the box (false), says the Mac's words, and reads nothing more")
    mac.asked = []
    let empty = await m.say("   ", name: { $0 }, names: nm)
    check(!empty && mac.asked.isEmpty, "an empty box sends nothing")

    mac.asked = []
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    await m.setDue("2026-11-30", names: nm)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/due", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"]
          && m.dueRefusal == nil && !m.dueSaving, "a due date is saved, then the task and its activity read again")
    mac.actAnswers = [(400, #"{"error":"that is not a real date"}"#)]
    await m.setDue("2026-11-29", names: nm)
    check(m.dueRefusal == "that is not a real date", "a refused date is said")
    mac.actAnswers = [nil]
    let unanswered = await m.setDue("2026-11-28", names: nm)
    check(!unanswered && m.dueRefusal == Board.taskDueUnreached, "no answer: the could-not-reach words, and not recorded")
    mac.asked = []
    let badDay = await m.setDue("2026-02-30", names: nm)
    check(!badDay && m.dueRefusal == Board.taskDueFailed && mac.asked.isEmpty, "a date that is not a day is refused here, never sent")

    mac.asked = []
    let nothing = await m.saveText(title: "Pages 9 to 12", detail: "", openedTitle: "Pages 9 to 12", openedDetail: nil, names: nm)
    check(nothing && mac.asked.isEmpty, "Save with nothing changed closes the form and sends nothing")
    let untitled = await m.saveText(title: " ", detail: "", openedTitle: "Pages 9 to 12", openedDetail: nil, names: nm)
    check(!untitled && m.editRefusal == Board.taskEditNeedsTitle && mac.asked.isEmpty, "no title: said, nothing sent")
    var sent: [String: Any]?
    mac.onSend = { r in if r.url!.path.hasSuffix("/text") { sent = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } } }
    mac.actAnswers = [(200, #"{"task":{},"changed":true}"#)]
    var lockedThroughRead: Bool?
    let earlier = mac.onSend
    mac.onSend = { r in earlier?(r); if r.url!.path == "/api/projects" { lockedThroughRead = m.editSaving } }
    let saved = await m.saveText(title: "Pages 9 to 13", detail: "", openedTitle: "Pages 9 to 12", openedDetail: nil, names: nm)
    check(saved && m.editRefusal == nil && sent?["sentence"] as? String == "Pages 9 to 13" && sent?["detail"] == nil,
          "a changed title is saved alone, and the form closes")
    check(lockedThroughRead == true && !m.editSaving, "the form stays locked through the page's re-read, then unlocks")
    mac.onSend = nil
    mac.actAnswers = [(400, #"{"error":"say what needs doing in 200 characters or fewer; the detail has the room"}"#)]
    let long = await m.saveText(title: String(repeating: "a", count: 201), detail: "", openedTitle: "Pages 9 to 12", openedDetail: nil, names: nm)
    check(!long && m.editRefusal == "say what needs doing in 200 characters or fewer; the detail has the room", "a refused save keeps the form open with the Mac's words")
}

section("slice B3: how often it repeats (kosmos#8958)")
do {
    typealias C = Board.RepeatChoice
    check(Board.repeatStored(nil) == C(every: .never) && Board.repeatStored(NSNull()) == C(every: .never), "no rule: Never")
    check(Board.repeatStored(["every": "hour", "minute": 20]) == C(every: .hour), "an hourly rule an agent set at :20 shows as Every hour")
    check(Board.repeatStored(["every": "minutes", "n": 45]) == C(every: .minutes, minutes: "45"), "every 45 minutes fills the minutes box")
    check(Board.repeatStored(["every": "day", "at": "07:30"]) == C(every: .day, at: "07:30"), "a daily time fills the time box")
    check(Board.repeatStored(["every": "day", "at": ["09:00", "17:00"]]) == C(every: .day, at: "09:00", others: ["17:00"]),
          "several daily times: the first in the box, the rest kept (kosmos#5752)")
    check(Board.repeatStored(["every": "week", "day": 1, "at": "09:30"]) == C(every: .week, at: "09:30", on: "mon")
          && Board.repeatStored(["every": "week", "day": 0, "at": "08:00"])?.on == "sun", "weekly: the engine's day number (Sunday 0) as the route's day")
    check(Board.repeatStored(["every": "fortnight"]) == nil && Board.repeatStored(["every": "week", "day": 9, "at": "09:00"]) == nil
          && Board.repeatStored("daily") == nil, "a rule the controls cannot show is nil, never shown as another rule")

    check(Board.repeatWire(C(every: .never)) == .clear && Board.repeatWire(C(every: .hour)) == .hour, "Never clears; Every hour")
    check(Board.repeatWire(C(every: .minutes, minutes: " 030 ")) == .minutes("30") && Board.repeatWire(C(every: .minutes, minutes: "60")) == .hour,
          "minutes are sent as the board stores them: 030 is 30, and 60 is hourly")
    check(Board.repeatWire(C(every: .minutes, minutes: "")) == .needsMinutes && Board.repeatNeeds(.needsMinutes) == "Say how many minutes",
          "an empty minutes box is no choice yet, said in the board's words")
    check(Board.repeatWire(C(every: .minutes, minutes: "12x")) == .minutes("12x"), "a minutes box that is not a number is sent for the Mac to refuse")
    check(Board.repeatWire(C(every: .day, at: "")) == .needsTime && Board.repeatNeeds(.needsTime) == "Choose a time", "an empty time: Choose a time")
    check(Board.repeatWire(C(every: .day, at: "18:00", others: ["09:00", "18:00"])) == .day("09:00,18:00"),
          "the box and the other times go as one sorted list, each once")
    check(Board.repeatWire(C(every: .week, at: "09:00", on: "fri")) == .week(on: "fri", at: "09:00"), "weekly sends its day and time")
    check(Board.repeatBody(.clear)?["clear"] as? Bool == true && Board.repeatBody(.minutes("30"))?["at"] as? String == "30"
          && Board.repeatBody(.week(on: "fri", at: "09:00"))?["on"] as? String == "fri" && Board.repeatBody(.needsTime) == nil,
          "the bodies are the board's: clear, the minutes as at, the day as on; nothing while a box is empty")

    let stored = C(every: .day, at: "09:00", others: ["17:00"])
    var moved = stored; moved.at = "10:00"
    check(Board.keptRepeatDraft(stored, stored: stored) == nil, "a draft that is the stored rule is no draft")
    check(Board.keptRepeatDraft(moved, stored: stored).map(Board.repeatWire) == .day("10:00,17:00"), "moving the box keeps the other time")
    var onto = stored; onto.at = "17:00"
    check(Board.keptRepeatDraft(onto, stored: stored).map(Board.repeatWire) == .day("17:00"), "moving the box onto the other time leaves one time")
    let agentChanged = C(every: .day, at: "08:00", others: ["20:00"])
    check(Board.keptRepeatDraft(moved, stored: agentChanged).map(Board.repeatWire) == .day("10:00,20:00"),
          "an edit under a rule changed elsewhere stands, and its other times follow the new rule (round 3 on the board)")
    var weekly = stored; weekly.every = .week
    check(Board.keptRepeatDraft(weekly, stored: stored)?.every == .week, "a frequency change is a draft")
    check(Board.keptRepeatDraft(moved, stored: nil) == nil, "a rule the controls cannot show drops the draft")
    var past = stored; past.at = "20:00"
    let savedPast = C(every: .day, at: "17:00", others: ["20:00"])   // as the read after the save gives it, sorted
    check(Board.repeatWire(past) == .day("17:00,20:00") && Board.keptRepeatDraft(past, stored: savedPast) == nil,
          "a box moved past the other time and saved: the read of the saved rule ends the draft (no time dropped)")
    check(Board.followStored(past, old: stored, new: savedPast) == nil, "and so does the change the save itself caused")
    check(Board.repeatShown(savedPast, box: "20:00") == C(every: .day, at: "20:00", others: ["17:00"]),
          "and the box stays on the time the person saved, though it sorts second")
    check(Board.repeatShown(savedPast, box: "17:00") == savedPast && Board.repeatShown(savedPast, box: "06:00") == savedPast
          && Board.repeatShown(savedPast, box: nil) == savedPast && Board.repeatShown(C(every: .hour), box: "20:00") == C(every: .hour),
          "a box the list does not hold, none, or a rule that is not daily: shown as stored")
    check(Board.repeatShown(savedPast, box: "20:00").map(Board.repeatWire) == Board.repeatWire(savedPast), "showing the box there changes nothing that would be sent")
    var weeklyThenDaily = C(every: .week, at: "09:00", others: ["17:00"], on: "fri")
    weeklyThenDaily = Board.followStored(weeklyThenDaily, old: stored, new: agentChanged) ?? weeklyThenDaily
    weeklyThenDaily.every = .day
    check(Board.repeatWire(weeklyThenDaily) == .day("09:00,20:00"),
          "a weekly draft over a daily rule changed elsewhere, switched back to daily, sends the new rule's other time, not the removed one")
    let never = C(every: .never), hourly = C(every: .hour)
    check(Board.followStored(never, old: never, new: stored) == nil,
          "a draft put back on the old rule follows a rule changed elsewhere (never left showing Never over a daily rule)")
    check(Board.followStored(hourly, old: never, new: stored).map(Board.repeatWire) == .hour, "a real edit stands when the rule changes elsewhere")
    check(Board.followStored(moved, old: stored, new: agentChanged).map(Board.repeatWire) == .day("10:00,20:00"),
          "an edited daily time stands and takes the new rule's other times")
    check(Board.followStored(nil, old: never, new: stored) == nil && Board.followStored(hourly, old: never, new: hourly) == nil,
          "no draft stays none; a draft the new rule now equals goes")
    check(Board.repeatTimeString(Board.repeatTime("07:05")) == "07:05" && Board.repeatTimeString(Board.repeatTime("23:59")) == "23:59",
          "a time goes through the picker's Date and back unchanged")

    let req = Board.taskRepeatRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "springcatalogue", number: 3, wire: .day("09:00"))
    let sentBody = req?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    check(req?.httpMethod == "POST" && req?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/springcatalogue/task/3/repeat"
          && sentBody?["every"] as? String == "day" && sentBody?["at"] as? String == "09:00", "POST .../repeat with the board's body")
    check(Board.taskRepeatRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "x", number: 1, wire: .needsMinutes) == nil,
          "nothing is built while a box is empty")

    // A task that repeats, read from the projects read: the fields engine/taskrepeat.fieldsOf adds to it.
    var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
    var projs = doc["projects"] as? [[String: Any]] ?? []
    var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
    if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) {
        tks[i]["repeat"] = ["every": "day", "at": ["09:00", "17:00"]]
        tks[i]["repeatWords"] = "every day at 9am and 5pm"
        tks[i]["repeatNextWords"] = "today at 5pm"
        tks[i]["repeatMissed"] = 1
        tks[i]["repeatMissedWords"] = "today at 9am"
    }
    if !projs.isEmpty { projs[0]["tasks"] = tks }
    doc["projects"] = projs
    let repeating = (try? JSONSerialization.data(withJSONObject: doc)).map { Board.parseTaskPage($0, project: "springcatalogue", number: 3) }
    if case .page(let rp)? = repeating, let row = rp.repeatRow {
        check(rp.repeatStored == C(every: .day, at: "09:00", others: ["17:00"]), "the page reads the stored rule for its controls")
        check(Tasks.repeatSentence(row, now: Date()) { $0 } == "Missed the run due today at 9am. Repeats every day at 9am and 5pm. Next today at 5pm.",
              "the page's line is the board's sentence, the missed run first")
        check(!Tasks.repeatMissed(row).isEmpty, "a missed run marks the line (drawn red)")
    } else {
        check(false, "a repeating task reads as a page with its repeat row")
    }
    check(page(3)?.repeatRow == nil && page(3)?.repeatStored == C(every: .never), "a task that does not repeat has no line, and Never")
}
await b3ModelTests()

section("slice B3b: who is told when a run is missed (kosmos#8958)")
do {
    // The fields engine/tasks.js setReviewer writes, on task 3 of the captured read.
    func pageWith(_ fields: [String: Any]) -> Board.TaskPage? {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
        if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) { for (k, v) in fields { tks[i][k] = v } }
        if !projs.isEmpty { projs[0]["tasks"] = tks }
        doc["projects"] = projs
        guard let d = try? JSONSerialization.data(withJSONObject: doc), case .page(let pg) = Board.parseTaskPage(d, project: "springcatalogue", number: 3) else { return nil }
        return pg
    }
    let rule: [String: Any] = ["every": "hour"]
    check(page(3)?.repeatReviewer == "none" && page(3)?.memberOrder == ["dana", "eli"], "no reviewer reads as none; members in the project's order")
    do {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var agents = projs.first?["agents"] as? [[String: Any]] ?? []
        if let first = agents.first { agents.append(first) }
        if !projs.isEmpty { projs[0]["agents"] = agents }
        doc["projects"] = projs
        if let d = try? JSONSerialization.data(withJSONObject: doc), case .page(let twice) = Board.parseTaskPage(d, project: "springcatalogue", number: 3) {
            check(twice.memberOrder == ["dana", "eli"], "an agent listed twice is one choice")
        } else { check(false, "a page with an agent listed twice") }
    }
    check(pageWith(["repeat": rule, "repeatReviewerPerson": true])?.repeatReviewer == "me", "the person as reviewer reads as me")
    check(pageWith(["repeat": rule, "repeatReviewer": "eli"])?.repeatReviewer == "eli", "an agent as reviewer reads as its session")
    check(pageWith(["repeat": rule, "repeatReviewerPerson": true, "repeatReviewer": "eli"])?.repeatReviewer == "me",
          "the person's mark wins over an agent's name, as the board's tkReviewerOf")
    if let pg = pageWith(["repeat": rule, "repeatReviewer": "eli"]) {
        check(Board.reviewerOptions(pg, roster: roster).map(\.words) == ["Nobody", "Me", "Dana", "Eli"]
              && Board.reviewerOptions(pg, roster: roster).map(\.value) == ["none", "me", "dana", "eli"], "Nobody, Me, then the project's agents by name")
    } else { check(false, "a page with a reviewer") }
    if let gone = pageWith(["repeat": rule, "repeatReviewer": "gus"]) {
        check(Board.reviewerOptions(gone, roster: roster).last == Board.ReviewerOption(value: "gus", words: "Gus (left the project)"),
              "a stored reviewer no longer on the project stays listed, and says so")
    } else { check(false, "a page with a reviewer who left") }
    let req = Board.taskReviewerRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "springcatalogue", number: 3, reviewer: "me")
    check(req?.url?.path == "/api/project/springcatalogue/task/3/repeat"
          && (req?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?.keys.sorted() == ["reviewer"],
          "POST .../repeat with the reviewer alone, so the rule is left as it is")
}
await b3bModelTests()

section("#8958 slice B4: a closed task's receipt")
// receipt-words.json is what web/index.html's own functions say (ios.receipt-words-8958.test.js writes it and fails when the
// page no longer says it).
do {
    let words = (try? JSONSerialization.jsonObject(with: fixture("receipt-words.json")) as? [String: Any]) ?? [:]
    let abbr = words["abbr"] as? [[Any]] ?? [], usd = words["usd"] as? [[Any]] ?? []
    let agents = words["agents"] as? [[String: Any]] ?? [], whole = words["whole"] as? [[String: Any]] ?? []
    check(abbr.count >= 20 && usd.count >= 20 && agents.count >= 20 && whole.count >= 7, "premise: the page's words are there")
    for x in abbr { let v = (x[0] as? NSNumber)?.doubleValue ?? -1; check(Board.receiptAbbr(v) == x[1] as? String, "tokens \(v): \(Board.receiptAbbr(v)) as the page's \(x[1])") }
    for x in usd { let v = (x[0] as? NSNumber)?.doubleValue ?? -1; check(Board.receiptUsd(v) == x[1] as? String, "dollars \(v): \(Board.receiptUsd(v)) as the page's \(x[1])") }
    func lines(_ a: Board.ReceiptAgent) -> [String] {
        [a.line] + (a.prs.isEmpty ? [] : [a.prsBefore + a.prs.map(\.label).joined(separator: ", ") + a.prsAfter])
            + [a.filesTitle].compactMap { $0 } + a.files + (a.folder.map { ["In " + $0] } ?? [])
    }
    func read(_ given: Any, replaced: Bool = false, unrun: Bool = false) -> Board.Receipt? {
        guard let d = try? JSONSerialization.data(withJSONObject: given), case .receipt(let r) = Board.parseReceipt(d, replaced: replaced, unrun: unrun) else { return nil }
        return r
    }
    for (i, x) in agents.enumerated() {
        let a = read(["agents": [x["given"] ?? [:]]])?.agents.first
        check(a.map(lines) == x["lines"] as? [String], "agent case \(i): \(a.map(lines) ?? []) as the page's")
        check(a?.prs.compactMap { $0.url?.absoluteString } == x["links"] as? [String], "agent case \(i): the page's links and no other")
    }
    for (i, x) in whole.enumerated() {
        let r = read(x["given"] ?? [:], replaced: x["replaced"] as? Bool == true, unrun: x["unrun"] as? Bool == true)
        let said = r.map { r in [r.again].compactMap { $0 } + ["Receipt", Board.receiptIntro] + (r.agents.isEmpty ? [Board.receiptNobody] : r.agents.flatMap(lines)) }
        check(said == x["lines"] as? [String], "whole receipt \(i): \(said?.first ?? "nothing") as the page's")
    }
    check(read(["agents": [["who": "a", "available": true, "transcriptsWithWork": 1, "models": ["claude-opus-5": ["input_tokens": 1500]]]]])?.agents.first?.line
          == "Edited 0 files, ran 0 commands, 2K tokens.", "a Mac that sends no cost: the cost is left out, never a zero")
    check(Board.parseReceipt(Data(#"{"ready":false,"because":"open"}"#.utf8), replaced: false, unrun: false) == .none, "an open task's answer is no receipt")
    for bad in ["null", "[]", "", "<html>"] { check(Board.parseReceipt(Data(bad.utf8), replaced: false, unrun: false) == .unreadable, "an answer that is not a receipt is unreadable: \(bad)") }
    check(Board.taskReceiptRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "springcatalogue", number: 3)
        .map { ($0.httpMethod ?? "GET") + " " + ($0.url?.path ?? "") } == "GET /api/project/springcatalogue/task/3/receipt", "GET .../task/<n>/receipt")
    check(Board.taskReceiptRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "springcatalogue", number: 3)?.timeoutInterval == 120,
          "it waits longer than the 15 s of other calls: the Mac answers only once the receipt is worked out")
    check(Board.taskReceiptRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "../x", number: 3) == nil, "no request for a name that is not a project's")
    // The key the receipt belongs to (the board's tkReceiptSync): the close time, the task's own or its newest part's.
    func keyed(_ fields: String) -> Board.TaskPage? { synthetic(#"{"number":1,"sentence":"S",\#(fields)}"#) }
    check(keyed(#""detail":"d""#) != nil, "premise: the page parses")
    check(keyed(#""progress":{"done":0,"total":1,"closed":false}"#)?.receiptKey == nil, "an open task has no receipt key")
    check(keyed(#""closedAt":"2026-11-24T15:00:00.000Z""#)?.receiptKey == "2026-11-24T15:00:00.000Z", "a closed task's is its close time")
    check(keyed(#""progress":{"done":2,"total":2,"closed":true},"parts":[{"id":1,"closedAt":"2026-11-24T15:00:00.000Z"},{"id":2,"closedAt":"2026-11-24T16:00:00.000Z"},{"id":3,"closedAt":"2026-11-24T14:00:00.000Z"}]"#)?.receiptKey
          == "2026-11-24T16:00:00.000Z", "closed by its last part: the newest part's close")
    check(keyed(#""progress":{"done":1,"total":1,"closed":true}"#)?.receiptKey == "", "closed with no time on record: still a closed state of its own")
    check(keyed(#""closedAt":"2026-11-24T15:00:00.000Z","closedUnrun":true"#)?.closedUnrun == true
          && keyed(#""closedAt":"2026-11-24T15:00:00.000Z""#)?.closedUnrun == false, "closed as never run is read")
}
await b4ModelTests()

section("#8958 slice B5: undoing a closed task's file changes")
do {
    let u = ((try? JSONSerialization.jsonObject(with: fixture("receipt-words.json")) as? [String: Any]) ?? [:])["undo"] as? [String: Any] ?? [:]
    let plans = u["plans"] as? [[String: Any]] ?? [], done = u["done"] as? [[String: Any]] ?? []
    check(plans.count == 3 && done.count == 5 && (u["why"] as? [String: String])?.count == 12, "premise: the page's undo words are there")
    check(Board.undoWhy == u["why"] as? [String: String], "every reason in the page's words, and no other")
    check(Board.undoOpen == u["open"] as? String, "the offer, as the page's")
    check(Board.undoChoose == u["choose"] as? String, "nothing chosen, as the page's")
    check(Board.undoFailed == u["failed"] as? String, "a failure, as the page's")
    for (i, x) in plans.enumerated() {
        check(Board.undoTitle == x["title"] as? String && Board.undoIntro == x["intro"] as? String && Board.undoGo == x["go"] as? String, "list \(i): its heading, sentence and button as the page's")
        var files: [Board.UndoFile] = []
        if let d = try? JSONSerialization.data(withJSONObject: x["given"] ?? [:]), case .plan(let p) = Board.parseUndoPlan(d) { files = p.files }
        let rows = x["rows"] as? [[String: Any]] ?? []
        check(!rows.isEmpty && files.count == rows.count, "list \(i): a row for each file")
        for (f, r) in zip(files, rows) {
            check(f.path == r["path"] as? String && f.shown == r["shown"] as? String && f.why == r["why"] as? String
                  && f.chosen == r["chosen"] as? Bool && f.choosable == r["choosable"] as? Bool, "list \(i): \(f.shown) as the page's: \(f.why)")
        }
        check(Set(files.map(\.id)).count == files.count, "list \(i): each row has its own id")
    }
    for x in done {
        let n = (x["done"] as? NSNumber)?.intValue ?? -1, k = (x["skipped"] as? NSNumber)?.intValue ?? -1
        let out: [String: Any] = ["done": Array(repeating: "f", count: max(0, n)), "skipped": Array(repeating: [String: String](), count: max(0, k)), "savedIn": x["savedIn"] ?? NSNull()]
        check(Board.undoDoneLine(try? JSONSerialization.data(withJSONObject: out)) == x["line"] as? String, "\(n) done and \(k) left, as the page's")
    }
    for bad in ["{}", "<html>", "", "[]", #"{"done":3}"#] { check(Board.undoDoneLine(Data(bad.utf8)) == nil, "not an answer to an undo says nothing done: \(bad)") }
    check(Board.undoDoneLine(nil) == nil, "no answer says nothing done")
    check(Board.undoResult(status: 200, body: Data(#"{"done":["a"],"skipped":[],"because":"x"}"#.utf8)) == .done("Undone: 1 file."), "something done is done, whatever else it says")
    check(Board.undoResult(status: 200, body: Data(#"{"done":[],"skipped":[{}]}"#.utf8)) == .done("Undone: 0 files. 1 file was left as it was."), "every file left is said, as the board's")
    for bad in ["", "null", "[]", "<html>"] { check(Board.parseUndoPlan(Data(bad.utf8)) == .unreadable, "not a plan is unreadable: \(bad)") }
    check(Board.parseUndoPlan(Data(#"{"on":true,"ready":false,"because":"stamps-unknown","files":[]}"#.utf8)) == .unreadable, "records the Mac could not read just now: asked again, not nothing to offer")
    for (what, off) in [("off", #"{"on":false,"files":[{"path":"/a","ok":true,"action":"restore"}]}"#), ("no files", #"{"on":true,"files":[]}"#),
                        ("not ready", #"{"on":true,"ready":false,"because":"open","files":[]}"#), ("a file with no path", #"{"on":true,"files":[{"ok":true}, 7]}"#)] {
        check(Board.parseUndoPlan(Data(off.utf8)) == .off, "nothing to offer: \(what)")
    }
    let studio = URL(string: "https://studio.kosmosplus.com")!
    let ask = Board.taskUndoRequest(mac: studio, project: "springcatalogue", number: 3)
    check((ask?.httpMethod ?? "GET") + " " + (ask?.url?.path ?? "") == "GET /api/project/springcatalogue/task/3/undo" && ask?.timeoutInterval == 120, "GET .../task/<n>/undo, with the receipt's wait")
    let go = Board.taskUndoApply(mac: studio, project: "springcatalogue", number: 3, paths: ["/a", "/b"])
    check((go?.httpMethod ?? "") + " " + (go?.url?.path ?? "") == "POST /api/project/springcatalogue/task/3/undo" && go?.timeoutInterval == 120, "POST .../task/<n>/undo, with the receipt's wait")
    check((go?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: [String]] }) == ["paths": ["/a", "/b"]], "the chosen files, and nothing else")
    check(Board.taskUndoApply(mac: studio, project: "springcatalogue", number: 3, paths: []) == nil, "no files: no request")
    check(Board.taskUndoRequest(mac: studio, project: "../x", number: 3) == nil && Board.taskUndoApply(mac: studio, project: "../x", number: 3, paths: ["/a"]) == nil, "no request for a name that is not a project's")
}
await b5ModelTests()

section("#8958 slice B6: subtasks")
check(Board.subtasksDoneLine(unrun: true) == "All subtasks closed." && Board.subtasksDoneLine(unrun: false) == "All subtasks done.", "all done, unless one was closed without running")
check(["Done", "Replaced", "Not run"].allSatisfy { Board.SubtaskRow(number: 1, sentence: "", status: $0).closed } && ["Built", "On hold", "Open"].allSatisfy { !Board.SubtaskRow(number: 1, sentence: "", status: $0).closed }, "which subtasks are closed")
do {
    // The board's own words, read from the page.
    let pageURL = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web/index.html")
    let html = (try? String(contentsOf: pageURL, encoding: .utf8)) ?? ""
    check(html.contains("function tkPaintSubtasks"), "premise: the board's page is there")
    for words in [Board.subtasksNone, ">" + Board.subtaskAdd + "<", ">" + Board.subtasksCloseAll + "<", Board.subtasksCloseUnsure,
                  "'" + Board.subtasksDoneLine(unrun: false) + "'", "'" + Board.subtasksDoneLine(unrun: true) + "'",
                  "'The rest are built.' : 'All subtasks are built.') + ' Check each one first.'", "'. Its built subtasks are closed.'",
                  "' subtask before it is' : ' subtasks before it are') + ' closed.'", "' This task is still open.'", "'as a subtask.'", "'we could not close it'"] {
        check(html.contains(words), "the board says: \(words)")
    }
    check(Board.subtasksBuiltLine(unrun: false) == "All subtasks are built. Check each one first." && Board.subtasksBuiltLine(unrun: true) == "The rest are built. Check each one first.", "the built line, with and without one not run")
    check(Board.subtaskAddedLine(number: 12) == "Added task 12 as a subtask." && Board.subtaskAddedLine(number: nil) == "Added task as a subtask.", "the added line")
    check(Board.subtasksStopped(at: nil, why: "no", closed: 2) == "no. Its built subtasks are closed.", "stopped at this task")
    check(Board.subtasksStopped(at: 4, why: "no", closed: 0) == "Task #4: no. This task is still open.", "stopped at the first")
    check(Board.subtasksStopped(at: 4, why: "no", closed: 1) == "Task #4: no. 1 subtask before it is closed. This task is still open.", "stopped at the second")
    check(Board.subtasksStopped(at: 4, why: "no", closed: 1, open: false) == "Task #4: no. 1 subtask before it is closed.", "stopped, and this task closed elsewhere: not said to be open")
    check(Board.subtasksStopped(at: 4, why: "no", closed: 2) == "Task #4: no. 2 subtasks before it are closed. This task is still open.", "stopped at the third")
    let e = Data(#"{"error":"no"}"#.utf8)
    check(Board.closeStop(status: 204, body: nil) == nil && Board.closeStop(status: 409, body: e) == .refused("no") && Board.closeStop(status: 400, body: nil) == .refused("we could not close it"), "closed, refused with words, refused with none")
    check(Board.closeStop(status: 500, body: e) == .refused("no"), "a 500 with the Mac's words is the Mac's")
    for s in [0, 500, 502, 504] { check(Board.closeStop(status: s, body: s == 502 || s == 504 ? e : nil) == .unsure, "no answer, or a gateway's: unsure (\(s))") }
    func kids(_ unrun: String, _ third: String) -> Board.TaskPage? {
        synthetic(#"{"number":1,"sentence":"S"\#(unrun)},{"number":2,"sentence":"a","parent":1,"builtAt":"2026-11-24T15:00:00.000Z"},{"number":3,"sentence":"b","parent":1,\#(third)}"#)
    }
    check(kids("", #""closedAt":"2026-11-24T15:00:00.000Z","closedUnrun":true"#)?.subtasks.map(\.status) == ["Built", "Not run"], "a subtask closed without running reads Not run (kosmos#8301)")
    check(kids(#","subtasks":{"unrun":1}"#, #""closedAt":"2026-11-24T15:00:00.000Z""#)?.subtasksUnrun == true && kids("", #""closedAt":"2026-11-24T15:00:00.000Z""#)?.subtasksUnrun == false, "the engine's count of those not run is read")
}
await b6ModelTests()

section("#8958 slice B7: parts")
do {
    let pageURL = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web/index.html")
    let html = (try? String(contentsOf: pageURL, encoding: .utf8)) ?? ""
    check(html.contains("async function tkPartPost"), "premise: the board's page is there")
    for words in ["'" + Board.partFailed + "'", "'" + Board.partNoMembers + "'", "'" + Board.holdChooseNobody + "'", ">" + Board.holdChoose + "</button>", "'Put back' : 'Done'",
                  ">" + Board.partNobody + "</option>", "placeholder=\"" + Board.partAdd + "\" aria-label=\"" + Board.partAddLabel + "\"", "id=\"tk-newpart\" maxlength=\"\(Board.partAddMax)\"",
                  "'Told ' + heard.who + '.'", "'Could not tell ' + heard.who + ': '", "'Could not confirm ' + heard.who + ' saw it: '"] {
        check(html.contains(words), "the board says: \(words)")
    }
    check(Board.partActTitle(done: true) == "Put back" && Board.partActTitle(done: false) == "Done", "Done on an open part, Put back on a done one")
    func req(_ w: Board.PartWrite) -> URLRequest? { Board.partRequest(mac: macURL, project: "springcatalogue", number: 4, w) }
    let at = "/api/project/springcatalogue/task/4/"
    check(req(.who(part: "2", "eli", was: nil))?.url?.path == at + "part/2/who" && bodyOf(req(.who(part: "2", "eli", was: nil)))?["who"] as? String == "eli" && req(.who(part: "2", "eli", was: nil))?.httpMethod == "POST", "who is on a part")
    check(bodyOf(req(.who(part: "2", nil, was: nil)))?["who"] is NSNull, "nobody is null")
    check(req(.close(part: "2"))?.url?.path == at + "part/2/close" && req(.reopen(part: "2"))?.url?.path == at + "part/2/reopen", "Done and Put back")
    check(req(.who(part: "2", "eli", was: nil))?.timeoutInterval == Board.partWhoTimeout && (req(.close(part: "2"))?.timeoutInterval ?? 0) > 50, "a who write waits for the telling")
    check(req(.add("  Proofread \n"))?.url?.path == at + "parts" && bodyOf(req(.add("  Proofread \n")))?["sentence"] as? String == "Proofread", "an added part, trimmed")
    check(req(.add(" \n")) == nil && req(.close(part: "x/../1")) == nil && req(.close(part: "")) == nil && req(.close(part: "\u{0661}")) == nil, "nothing for an empty part, or one with no number")
    func heard(_ s: String) -> String? { Board.heardLine(Data(s.utf8), name: { $0 == "dana" ? "Dana" : $0 }) }
    check(heard(#"{"heard":{"who":"dana","state":"placed"}}"#) == "Told Dana.", "told")
    check(heard(#"{"heard":{"who":"dana","state":"could_not","because":"its window is closed"}}"#) == "Could not tell Dana: Its window is closed.", "not told, and why")
    check(heard(#"{"heard":{"who":"dana","state":"unconfirmed","because":"no echo"}}"#) == "Could not confirm Dana saw it: No echo.", "not confirmed")
    check(heard("{}") == nil && heard(#"{"heard":{"who":"","state":"placed"}}"#) == nil && heard(#"{"heard":{"who":"dana","state":"held"}}"#) == nil && Board.heardLine(nil, name: { $0 }) == nil, "nobody to tell, or a state the board says nothing for")
    let two = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"gus","sentence":"S"},{"id":2,"sentence":"T"}]}"#, agents: #"[{"sessionName":"eli","name":"Eli"},{"sessionName":"dana","name":"Dana"}]"#)
    if let p = two {
        check(Board.partOptions(p, session: nil, roster: [:]).map(\.words) == ["Nobody yet", "Eli", "Dana"] && Board.partOptions(p, session: nil, roster: [:]).map(\.value) == [nil, "eli", "dana"], "Nobody yet, then the members in the project's order")
        check(Board.partOptions(p, session: "gus", roster: ["gus": "Gus"]).last?.value == "gus", "whoever is on it and left stays in the list")
        check(p.partLines(roster: [:]).map(\.session) == ["gus", nil], "each line carries who is on it")
        check(Board.partWritten(.who(part: "1", "gus", was: nil), before: [], now: p.parts) && !Board.partWritten(.who(part: "1", nil, was: nil), before: [], now: p.parts) && Board.partWritten(.who(part: "2", nil, was: nil), before: [], now: p.parts)
              && !Board.partWritten(.who(part: "9", nil, was: nil), before: [], now: p.parts), "who: written when the part reads so; a part that is gone is not")
        check(!Board.partWritten(.close(part: "1"), before: [], now: p.parts) && Board.partWritten(.reopen(part: "1"), before: [], now: p.parts)
              && !Board.partWritten(.reopen(part: "9"), before: [], now: p.parts) && !Board.partWritten(.close(part: "9"), before: [], now: p.parts), "Done and Put back likewise")
        check(Board.partWritten(.add(" T "), before: [p.parts[0]], now: p.parts) && !Board.partWritten(.add("T"), before: p.parts, now: p.parts) && !Board.partWritten(.add("U"), before: [], now: p.parts),
              "an added part: a new one with its words, never one that was there")
    } else { check(false, "the parts fixture parses") }
    check(Board.unfinished(status: 400, body: nil, failed: Board.partFailed) == .refused(Board.partFailed) && Board.unfinished(status: 0, body: nil, failed: "x") == .unsure, "refused with no words, and no answer")
}
await b7ModelTests()

section("#8958 slice B8: what a hold waits for and why")
// A held task 1 in a project with others; `hold` is its own hold fields, `others` more tasks.
func heldTasks(_ hold: String, others: String = "", own: String = "", paused: Bool = false, on: Bool = true) -> (Int, Data) {
    (200, Data((#"{"projects":[{"id":"springcatalogue","name":"Spring","paused":\#(paused),"agents":[{"sessionName":"dana","name":"Dana"}],"tasks":[{"number":1,"sentence":"All"\#(on ? #","onHold":true"# : "")\#(hold)\#(own),"progress":{"done":0,"total":1,"closed":false}}\#(others)]}]}"#).utf8))
}
func heldPage(_ hold: String, others: String = "", own: String = "", paused: Bool = false, on: Bool = true) -> Board.TaskPage? {
    if case .page(let p) = Board.parseTaskPage(heldTasks(hold, others: others, own: own, paused: paused, on: on).1, project: "springcatalogue", number: 1) { return p }
    return nil
}
let onTask5 = #","onHoldUntil":{"task":5},"holdUntil":{"words":"task #5 is closed","met":false}"#
let open5 = #",{"number":5,"sentence":"Prices","progress":{"done":0,"total":1,"closed":false}}"#
let closed5 = #",{"number":5,"sentence":"Prices","closedAt":"2026-11-24T15:00:00.000Z","progress":{"done":1,"total":1,"closed":true}}"#
do {
    let pageURL = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web/index.html")
    let html = (try? String(contentsOf: pageURL, encoding: .utf8)) ?? ""
    check(html.contains("function tkPaintHoldUntil"), "premise: the board's page is there")
    for words in Board.HoldFor.allCases.map({ "<option value=\"" + $0.rawValue + "\">" + $0.words + "</option>" })
        + ["<span>" + Board.holdSection + "</span>", "<span>" + Board.holdForLabel + "</span>", "<span>" + Board.holdUntilLabel + "</span>", "aria-label=\"" + Board.holdForSpoken + "\"", "aria-label=\"" + Board.holdTaskSpoken + "\"", "aria-label=\"" + Board.holdAtSpoken + "\"",
           "<span>" + Board.holdWhyLabel + "</span>", "maxlength=\"\(Board.holdWhyMax)\" aria-label=\"" + Board.holdWhySpoken + "\" placeholder=\"" + Board.holdWhyPrompt + "\"",
           "aria-label=\"" + Board.holdSaveSpoken + "\"", "'<option value=\"\">" + Board.holdChooseTask + "</option>'", "' (no longer on this project)'", "tkHoldSay(key, '" + Board.holdSaved + "')",
           "'" + Board.holdSaveFailed + "'", "'" + Board.holdTakenOff + "'", "'" + Board.holdTakeover(forPerson: false, paused: false) + "'", "'" + Board.holdTakeover(forPerson: true, paused: false) + "'",
           "'Why: '".dropLast().description, "'Last confirmed '", "' Suggested: '", "' is no longer on this project, so this can come off hold.'", "' is closed, so this can come off hold.'",
           "'That time has passed, so this can come off hold.'", "'Waiting until '", "'Waiting for task '", "' to close.'", "/^task #(\\d+) is closed$/", "Date.now() + 60000", "Date.now() + 365 * 86400000"] {
        let want = words == "'Why: " ? ">Why: '" : words
        check(html.contains(want), "the board says: \(want)")
    }
    check(Board.holdTakeover(forPerson: true, paused: true) == Board.holdTakeover(forPerson: false, paused: true) && !Board.holdTakeover(forPerson: true, paused: true).contains("Needs"), "in a paused project it is not in Needs Your Decision")
}
do {
    let now = Tasks.parseISO("2026-11-24T18:00:00.000Z")!
    func lines(_ hold: String, others: String = "", own: String = "", on: Bool = true) -> [String]? { heldPage(hold, others: others, own: own, on: on)?.holdLines(now: now, calendar: cal) }
    check(lines("") == [], "a bare hold says nothing of its own")
    check(lines(onTask5, others: open5, on: false) == [], "a task not on hold says nothing")
    check(heldPage("", own: #","closedAt":"2026-11-24T15:00:00.000Z""#, on: false)?.hold == nil && heldPage("")?.hold != nil, "a hold is read on a held task alone")
    if case .page(let p) = Board.parseTaskPage(Data(#"{"projects":[{"id":"p1","tasks":[{"number":1,"sentence":"S","onHold":true,"progress":{"closed":true}}]}]}"#.utf8), project: "p1", number: 1) {
        check(p.hold == nil, "nor on one that is finished")
    } else { check(false, "the closed fixture parses") }
    check(lines(onTask5, others: open5) == ["Waiting for task 5 to close."], "waiting for a task")
    check(lines(#","onHoldUntil":{"task":5},"holdUntil":{"words":"task #5 is closed","met":true}"#, others: closed5) == ["Task 5 is closed, so this can come off hold."], "it closed, in the Mac's reading")
    check(lines(onTask5, others: closed5) == ["Waiting for task 5 to close."], "met is the Mac's word, never worked out here")
    check(lines(onTask5) == ["Task 5 is no longer on this project, so this can come off hold."], "it is gone from the project")
    let at = #","onHoldUntil":{"at":"2026-11-25T09:30:00.000Z"},"holdUntil":{"words":"2026-11-25T09:30:00.000Z","met":false}"#
    check(lines(at)?.count == 1 && lines(at)?.first?.hasPrefix("Waiting until Wed") == true && lines(at)?.first?.contains("25") == true && lines(at)?.first?.contains("9:30") == true && lines(at)?.first?.hasSuffix(".") == true, "waiting for a time: its day and time")
    check(lines(at.replacingOccurrences(of: "false", with: "true")) == ["That time has passed, so this can come off hold."], "the time passed")
    check(lines(#","holdUntil":{"words":"something else","met":false}"#) == [], "words it cannot read say nothing")
    check(Board.holdUntilTask("task #12 is closed") == 12 && Board.holdUntilTask("task # is closed") == nil && Board.holdUntilTask("task #1x is closed") == nil && Board.holdUntilTask("task #1 is closed now") == nil
          && Board.holdUntilTask("a task #1 is closed") == nil && Board.holdUntilTask("task #\u{0661} is closed") == nil
          && Board.holdUntilTask("task #12 is opened") == nil && Board.holdUntilTask("card #12 is closed") == nil, "only the Mac's own words name a task")
    let why = #","onHoldBecause":"Prices come Friday""#
    check(lines(why) == ["Why: Prices come Friday"], "why")
    check(lines(why + #","onHoldConfirmedAt":"2026-11-24T01:00:00.000Z""# + onTask5, others: open5) == ["Why: Prices come Friday", "Last confirmed today.", "Waiting for task 5 to close."], "why, how fresh, what for: in that order")
    check(lines(why + #","onHoldConfirmedAt":"2026-11-23T23:00:00.000Z""#)?.last == "Last confirmed yesterday." && lines(why + #","onHoldConfirmedAt":"2026-11-20T23:00:00.000Z""#)?.last == "Last confirmed 4 days ago.", "in calendar days")
    check(lines(why + #","onHoldConfirmedAt":"2026-11-25T01:00:00.000Z""#) == ["Why: Prices come Friday"] && lines(why + #","onHoldConfirmedAt":"soon""#) == ["Why: Prices come Friday"], "a time ahead, or one it cannot read, says no age")
    check(lines(#","onHoldConfirmedAt":"2026-11-24T01:00:00.000Z""#) == [], "with no reason there is no age (the board's)")
    let forMe = #","onHoldForPerson":true,"onHoldSuggest":" Use the spring list ","onHoldConfirmedAt":"2026-11-24T01:00:00.000Z""#
    check(lines(why + forMe) == ["Why: Prices come Friday", "Suggested: Use the spring list."], "a hold on the person: the suggested answer, and no age")
    check(lines(#","onHoldForPerson":true,"onHoldSuggest":"Which?""#) == ["Suggested: Which?"], "its own full stop stands")
    check(lines(#","onHoldForPerson":true,"onHoldSuggest":"  ""#) == [] && lines(#","onHoldSuggest":"Yes""#) == [], "no suggestion when blank, or not waiting on the person")
}
do {
    let others = #",{"number":2,"sentence":"  Page\n two ","progress":{"closed":false}},{"number":3,"sentence":"Done one","progress":{"closed":true}},{"number":4,"sentence":"Waits here","onHold":true,"onHoldUntil":{"task":1},"progress":{"closed":false}}"#
        + open5 + #",{"number":6,"progress":{"closed":false}},{"number":7,"sentence":""# + String(repeating: "x", count: 61) + #"","progress":{"closed":false}},{"number":8,"sentence":""# + String(repeating: "y", count: 60)
        + #"","onHoldUntil":{"task":1},"progress":{"closed":false}},{"number":9,"sentence":"Waits for another","onHold":true,"onHoldUntil":{"task":2},"progress":{"closed":false}}"#
    if let h = heldPage("", others: others)?.hold {
        let o = Board.holdOptions(h, chosen: nil)
        check(o.map(\.value) == [nil, 2, 5, 6, 7, 8, 9], "the project's open tasks but this one, none that waits for it, with a first choice of none")
        check(o[0].words == "Choose a task" && o[1].words == "#2 Page two" && o[3].words == "#6", "each its number and tidied words, the number alone when it has none")
        check(o[4].words == "#7 " + String(repeating: "x", count: 59) + "\u{2026}" && o[5].words == "#8 " + String(repeating: "y", count: 60), "longer than 60 is cut, 60 is not")
        check(Board.holdOptions(h, chosen: 3).map(\.value) == [nil, 2, 3, 5, 6, 7, 8, 9], "one chosen and closed since stays a choice")
        check(Board.holdOptions(h, chosen: 4).first { $0.value == 4 }?.words == "#4 Waits here" && Board.holdOptions(h, chosen: 4).filter { $0.value == 4 }.count == 1 && Board.holdOptions(h, chosen: 99).last?.words == "#99 (no longer on this project)", "one chosen and no longer to be offered is still in the menu, by its own words while it is on the project")
    } else { check(false, "the options fixture parses") }
    if let h = heldPage(#","onHoldUntil":{"task":3}"#, others: others)?.hold {
        check(Board.holdOptions(h, chosen: nil).map(\.value) == [nil, 2, 3, 5, 6, 7, 8, 9], "the stored one stays a choice once closed")
    } else { check(false, "the closed-wait fixture parses") }
    if let h = heldPage(#","onHoldUntil":{"task":4}"#, others: others)?.hold {
        check(Board.holdOptions(h, chosen: nil).first { $0.value == 4 }?.words == "#4 Waits here", "and so does a stored one that waits for this task")
    } else { check(false, "the mutual-wait fixture parses") }
    if let h = heldPage(#","onHoldUntil":{"task":44}"#, others: others)?.hold {
        check(Board.holdOptions(h, chosen: 44).filter { $0.value == 44 }.map(\.words) == ["#44 (no longer on this project)"], "a stored one that is gone is said so, once")
        check(Board.holdOptions(h, chosen: 2).map(\.value).last == 44, "and stays while another is chosen")
    } else { check(false, "the gone-wait fixture parses") }
    check(heldPage(#","onHoldUntil":{"at":"2026-11-25T09:30:40.000Z"},"onHoldBecause":"W""#)?.hold?.stored == Board.HoldChoice(kind: .at, at: Tasks.parseISO("2026-11-25T09:30:00.000Z"), why: "W"), "a stored time shows to the minute")
    check(heldPage(#","onHoldUntil":{"at":"never"}"#)?.hold?.stored == Board.HoldChoice() && heldPage(#","onHoldUntil":{"odd":1}"#)?.hold?.stored.kind == .nothing, "a condition it cannot read shows as none")
}
do {
    let now = Tasks.parseISO("2026-11-24T18:00:30.000Z")!
    func at(_ s: String) -> Date { Tasks.parseISO(s)! }
    let none = Board.HoldChoice(), five = Board.HoldChoice(kind: .task, task: 5), nine = Board.HoldChoice(kind: .at, at: at("2026-11-25T09:30:00.000Z"))
    func ready(_ c: Board.HoldChoice, _ s: Board.HoldChoice) -> Bool { Board.holdReady(c, stored: s, now: now) }
    check(!ready(none, none) && !ready(five, five) && !ready(nine, nine), "nothing differs: Save is off")
    check(ready(five, none) && ready(nine, none) && ready(none, five) && ready(none, nine) && ready(nine, five), "a whole change: on")
    check(ready(Board.HoldChoice(kind: .task, task: 6), five), "another task is a change")
    check(!ready(Board.HoldChoice(kind: .task), none) && !ready(Board.HoldChoice(kind: .at), none), "no task or no time chosen: off")
    check(!ready(Board.HoldChoice(kind: .nothing, task: 5, at: now), none) && !ready(Board.HoldChoice(kind: .task, task: 5, at: now), five), "what another kind holds is no change")
    check(!ready(Board.HoldChoice(kind: .at, at: at("2026-11-25T09:30:59.000Z")), nine) && ready(Board.HoldChoice(kind: .at, at: at("2026-11-25T09:31:00.000Z")), nine), "times compare to the minute")
    check(!ready(Board.HoldChoice(kind: .task, task: 5, why: "  "), five) && ready(Board.HoldChoice(kind: .task, task: 5, why: "x"), five), "a stray space is no change, a reason is")
    let w = Board.HoldChoice(why: "a b")
    check(!ready(Board.HoldChoice(why: " a \n b\u{a0}"), w) && ready(Board.HoldChoice(why: "ab"), w) && ready(none, w), "a reason compares tidied, and can be taken away")
    let passed = Board.HoldChoice(kind: .at, at: at("2026-11-20T09:00:00.000Z"))
    check(ready(Board.HoldChoice(kind: .at, at: passed.at, why: "x"), passed), "a reason saves on a hold whose time has passed")
    check(!ready(passed, none) && !ready(Board.HoldChoice(kind: .at, at: passed.at, why: "x"), none), "but a passed time cannot be set")
    func set(_ s: String) -> Bool { ready(Board.HoldChoice(kind: .at, at: at(s)), none) }
    check(set("2026-11-24T18:01:00.000Z") && !set("2026-11-24T18:00:59.000Z"), "from a minute ahead")
    check(set("2027-11-24T18:00:59.000Z") && !set("2027-11-24T18:01:00.000Z"), "to 365 days")
    check(Board.holdFirstTime(now: now, calendar: cal) == at("2026-11-25T09:00:00.000Z"), "the first time offered: tomorrow at nine")
    check(Board.holdAheadOK(Board.HoldChoice(kind: .at, at: Board.holdFirstTime(now: now, calendar: cal)), now: now) && !Board.holdAheadOK(Board.HoldChoice(kind: .at), now: now), "and it can be saved")
    check(Board.holdTidy("\u{feff} a\u{2003}\u{3000}b\r\nc\u{85}d ") == "a b c\u{85}d" && Board.holdTidy(" \n") == "", "tidied as the engine does, by the same spaces")
    // Following.
    func follow(_ d: Board.HoldChoice?, _ b: Board.HoldChoice?, _ s: Board.HoldChoice?) -> Board.HoldChoice? { Board.holdFollow(d, base: b, stored: s) }
    check(follow(nil, none, five) == nil && follow(five, none, nil) == nil, "nothing unsaved, or no hold: none")
    check(follow(five, none, five) == nil && follow(none, none, five) == nil, "what is stored now, or was not changed: nothing unsaved")
    check(follow(Board.HoldChoice(why: "mine"), none, Board.HoldChoice(kind: .task, task: 5, why: "theirs")) == Board.HoldChoice(kind: .task, task: 5, why: "mine"), "a reason typed stays, and the wait follows")
    check(follow(five, none, Board.HoldChoice(why: "theirs")) == Board.HoldChoice(kind: .task, task: 5, why: "theirs"), "a wait chosen stays, and the reason follows")
    check(follow(Board.HoldChoice(kind: .task, task: 5, why: "mine"), none, Board.HoldChoice(kind: .task, task: 6, why: "theirs")) == Board.HoldChoice(kind: .task, task: 5, why: "mine"), "both changed: both stay")
    check(follow(Board.HoldChoice(kind: .nothing, task: 7, why: "mine"), none, Board.HoldChoice(kind: .at, at: nine.at))?.task == 7, "a box that is not shown keeps its value")
    check(follow(Board.HoldChoice(kind: .nothing, at: nine.at, why: "mine"), none, five)?.at == nine.at, "and the time box its")
    check(Board.holdAfter(nine, base: none, now: five) == nine, "saved: a time")
    func late(_ c: Board.HoldChoice, _ s: Board.HoldChoice) -> Bool { Board.holdLate(c, stored: s, now: now) }
    check(late(passed, none) && !late(passed, passed) && !late(nine, none) && !late(five, none) && !late(Board.HoldChoice(kind: .at), none) && !late(Board.HoldChoice(kind: .nothing, at: passed.at), five), "a chosen time that has passed, and nothing else, is late")
    check(follow(Board.HoldChoice(why: "mine"), nil, five) == Board.HoldChoice(why: "mine"), "with nothing to compare with, the draft stays")
    // What is sent.
    func sent(_ c: Board.HoldChoice, _ b: Board.HoldChoice, _ hold: String) -> String {
        guard let h = heldPage(hold)?.hold, let d = try? JSONSerialization.data(withJSONObject: Board.taskHoldSaveBody(c, base: b, now: h), options: .sortedKeys) else { return "?" }
        return String(decoding: d, as: UTF8.self)
    }
    check(sent(five, none, "") == #"{"onHold":true,"until":{"task":5}}"#, "a task alone")
    check(sent(Board.HoldChoice(kind: .at, at: at("2026-11-25T09:30:59.500Z")), none, "") == #"{"onHold":true,"until":{"at":"2026-11-25T09:30:00.000Z"}}"#, "a time, at its minute")
    check(sent(none, five, #","onHoldUntil":{"task":5}"#) == #"{"onHold":true}"#, "nothing in particular sends no condition, which clears it")
    check(sent(Board.HoldChoice(kind: .at, at: nine.at, why: " new  one "), nine, #","onHoldUntil":{"at":"2026-11-25T09:30:40.000Z"}"#) == #"{"because":"new one","onHold":true,"until":{"at":"2026-11-25T09:30:40.000Z"}}"#, "a reason alone sends the wait back as it is kept, to the second")
    check(sent(Board.HoldChoice(why: "x"), none, #","onHoldUntil":{"task":8}"#) == #"{"because":"x","onHold":true,"until":{"task":8}}"#, "or as it has become since")
    check(sent(Board.HoldChoice(why: "x"), none, "") == #"{"because":"x","onHold":true}"#, "and none when there is none")
    check(sent(Board.HoldChoice(why: "x"), none, #","onHoldUntil":{"odd":{"a":[1]}}"#) == #"{"because":"x","onHold":true,"until":{"odd":{"a":[1]}}}"#, "a condition this phone cannot read goes back whole")
    check(sent(none, Board.HoldChoice(why: "old"), #","onHoldBecause":"old""#) == #"{"because":"","onHold":true}"#, "an emptied reason clears it")
    check(sent(Board.HoldChoice(kind: .task, task: 5, why: "w"), Board.HoldChoice(why: "w"), "") == #"{"onHold":true,"until":{"task":5}}"#, "a reason not changed is not sent")
    check(Board.holdAfter(Board.HoldChoice(kind: .task, task: 5, why: "w"), base: Board.HoldChoice(why: "w"), now: Board.HoldChoice(why: "theirs")) == Board.HoldChoice(kind: .task, task: 5, why: "theirs")
          && Board.holdAfter(Board.HoldChoice(kind: .task, task: 5, why: "w"), base: five, now: nine) == Board.HoldChoice(kind: .at, at: nine.at, why: "w"), "saved: what was changed, over what is kept")
    let r = Board.taskHoldRequest(mac: macURL, project: "springcatalogue", number: 4, body: ["onHold": true, "because": "x"])
    check(r?.httpMethod == "POST" && r?.url?.path == "/api/project/springcatalogue/task/4/hold" && bodyOf(r)?["because"] as? String == "x" && bodyOf(r)?["onHold"] as? Bool == true, "to the hold route")
}
await b8ModelTests()

section("#8958 slice B9: when it is done, and what it waits to wake on")
do {
    let pageURL = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web/index.html")
    let html = (try? String(contentsOf: pageURL, encoding: .utf8)) ?? ""
    for words in ["function tkCheckResults", "'Done when' : 'Moved here from other tasks'", "'Not reported yet'", "'An agent') + ' says ' + (r.met ? 'met' : 'not met') + ': '", "'Moved to '", "', reported not met there: '",
                  "return 'Closed, not run';", "how === 'change' ? 'with a change' : how === 'note' ? 'on a note' : how === 'unbuilt' ? 'without being marked built'",
                  "' Not checked just now: '", "' Nobody holds this task, so nobody will be told until someone does.'", "'Woke: '", "' Nobody holds this task, so nobody has been told.'", "' Its holder is still to be told.'",
                  "' Its holder was told.'", "' Its holder could not be reached.'"] { check(html.contains(words), "the board says: \(words)") }
    check([Board.checksTitle, Board.movedHereTitle, Board.checkUnreported, Board.closedNotRun] == ["Done when", "Moved here from other tasks", "Not reported yet", "Closed, not run"], "and so does the phone")
    func one(_ own: String, others: String = "") -> Board.TaskPage? { synthetic(#"{"number":1,"sentence":"S"\#(own)}\#(others)"#) }
    let four = one(#","doneWhen":["A","B","C","D","E"],"doneWhenResults":[{"met":true,"how":"seen","by":"dana"},{"met":false,"how":"later.","by":"gus","movedTo":3},null,{"met":true,"how":"x","movedTo":3},{"met":false,"how":"y","by":""}]"#)
    check(four?.checks.map(\.words) == ["A", "B", "C", "D", "E"] && four?.checks.map(\.movedTo) == [nil, 3, nil, nil, nil], "each check in order; only one not met can have moved")
    check(four?.checks.map { four!.checkSays($0, roster: roster) } == ["Dana says met: seen", "Gus says not met: later.", "Not reported yet", "An agent says met: x", "An agent says not met: y"], "and what is said of it, by whom")
    check(one(#","doneWhen":["A","B"],"doneWhenResults":[{"met":"yes","how":"x"},{"met":true}]"#)?.checks.map(\.met) == [nil, nil] && one(#","doneWhen":["A","B"],"doneWhenResults":[]"#)?.checks.map(\.met) == [nil, nil], "a result it cannot read is not reported")
    check(one(#","doneWhen":["A"],"doneWhenResults":[{"met":false,"how":"x","movedTo":0}]"#)?.checks.first?.movedTo == nil, "nor is a task number that cannot be one")
    check(one("")?.checks == [] && one(#","doneWhen":[]"#)?.checks == [] && one(#","doneWhenResults":[{"met":true,"how":"x"}]"#)?.checks == [], "no checks: none")
    let moved = one("", others: #",{"number":9,"doneWhen":["N1","N2"],"doneWhenResults":[null,{"met":false,"how":"x","movedTo":1}]},{"number":4,"doneWhen":["F1","F2","F3"],"doneWhenResults":[{"met":false,"how":"x","movedTo":1},{"met":false,"how":"x","movedTo":2},{"met":false,"how":"x","movedTo":1}]}"#)
    check(moved?.movedHere == [Board.MovedCheck(from: 4, check: 1, words: "F1"), Board.MovedCheck(from: 4, check: 3, words: "F3"), Board.MovedCheck(from: 9, check: 2, words: "N2")], "those moved here, by task and check")
    check(one(#","doneWhen":["A"],"doneWhenResults":[{"met":false,"how":"x","movedTo":1}]"#)?.movedHere == [], "never its own")
    if let p = one(#","doneWhen":["A","B."]"#) { check(p.checks.enumerated().map { p.checkSpoken($0, $1, roster: [:]) } == ["Check 1: A. Not reported yet", "Check 2: B. Not reported yet"], "each is said with its number, with one stop") }
    else { check(false, "the spoken fixture parses") }
    check(one(#","doneWhen":["A","B"],"doneWhenResults":[{"met":1,"how":"x"},{"met":0,"how":"y","movedTo":3}]"#)?.checks.map(\.met) == [nil, nil], "nor a number for yes or no, as the board")
    // The wake line.
    func wake(_ own: String) -> String? { one(own)?.wakeLine }
    check(wake(#","wakeWords":"waits for PR #1 in a/b to merge""#) == "Waits for PR #1 in a/b to merge.", "what it waits for, as a sentence")
    check(wake(#","wakeWords":" waits until Friday. ","wakeProblem":"GitHub did not answer","wakeNobody":true"#) == "Waits until Friday. Not checked just now: GitHub did not answer. Nobody holds this task, so nobody will be told until someone does.", "why it was not checked, and that nobody holds it")
    check(wake("") == nil && wake(#","wakeWords":"""#) == nil && wake(#","wakeNobody":true"#) == nil, "none: nothing")
    let woke = #","wakeMetWords":"PR #1 in a/b: it was merged""#
    check(wake(woke + #","wakeToldAt":"2026-11-24T15:00:00.000Z","wakeReached":true"#) == "Woke: PR #1 in a/b: it was merged. Its holder was told.", "it woke, and its holder was told")
    check(wake(woke + #","wakeToldAt":"2026-11-24T15:00:00.000Z""#)?.hasSuffix(" Its holder could not be reached.") == true && wake(woke)?.hasSuffix(" Its holder is still to be told.") == true
          && wake(woke + #","wakeNobody":true,"wakeToldAt":"2026-11-24T15:00:00.000Z""#)?.hasSuffix(" Nobody holds this task, so nobody has been told.") == true, "or not, or not yet, or there is nobody")
    check(wake(#","wakeWords":"waits for x","progress":{"closed":true}"#) == nil, "a finished task says none")
    // How it was closed.
    let shut = #","closedAt":"2026-11-24T15:00:00.000Z""#
    check(one(shut + #","closedHow":"change""#)?.stateLine(roster: [:]) == "Done, with a change" && one(shut + #","closedHow":"note""#)?.stateLine(roster: [:]) == "Done, on a note" && one(shut + #","closedHow":"unbuilt""#)?.stateLine(roster: [:]) == "Done, without being marked built", "how it was closed")
    check(one(shut + #","closedHow":"odd""#)?.stateLine(roster: [:]) == "Done" && one(shut + #","closedHow":"change","landedCheck":"missing""#)?.stateLine(roster: [:]) == "Done" && one(shut + #","closedHow":"change","landedCheck":"landed""#)?.stateLine(roster: [:]) == "Done, with a change", "not a word it cannot read, nor of a commit found missing")
    check(one(#","closedHow":"change""#)?.stateLine(roster: [:]) == "Open", "an open task was not closed any way")
    check(one(shut + #","closedUnrun":true"#)?.stateLine(roster: [:]) == "Closed, not run" && one(#","closedUnrun":true"#)?.stateLine(roster: [:]) == "Open" && one(shut + #","closedUnrun":true,"replacedBy":3"#)?.stateLine(roster: [:]) == "Replaced by task 3", "closed, not run; replaced before it")
    check(one(shut + #","closedUnrun":true,"progress":{"done":2,"total":2,"closed":true}"#)?.stateLine(roster: [:]) == "Closed, not run", "and before the parts' count")
    check(one(shut + #","replacedBy":3"#, others: #",{"number":9,"replacedBy":1,"closedAt":"2026-11-24T15:00:00.000Z"}"#)?.stateTasks == [3, 9] && one(#","replacedBy":3"#)?.stateTasks == [] && one("")?.stateTasks == [], "the tasks its state names")
    // Every event's words are the board's: its own tkActPhrase is run on engine/taskactphrase.test.js's events, which hold every
    // kind it knows, and the phone's are compared with it.
    let testURL = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("engine/taskactphrase.test.js")
    let engineTest = (try? String(contentsOf: testURL, encoding: .utf8)) ?? ""
    func lifted(_ src: String, _ from: String, _ to: String) -> String {
        guard let a = src.range(of: from), let b = src.range(of: to, range: a.upperBound..<src.endIndex) else { return "" }
        return String(src[a.lowerBound..<b.upperBound])
    }
    let js = JSContext()!
    js.evaluateScript("const NAMES = {'mara-discord': 'Mara', 'leo-discord': 'Leo'}; function tkMemberName(p, s) { return NAMES[s] || s; } Date.prototype.toLocaleString = () => 'WHEN';")
    js.evaluateScript(lifted(html, "function tkActPhrase(ev, p) {", "\n}\n"))
    js.evaluateScript(lifted(engineTest, "const EVENTS = [", "\n];\n").replacingOccurrences(of: "const EVENTS", with: "var EVENTS"))
    let events = (js.evaluateScript("JSON.stringify(EVENTS)")?.toString()).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [[String: Any]] } ?? []
    let words = js.evaluateScript("EVENTS.map((ev) => tkActPhrase(ev, {}))")?.toArray() as? [String] ?? []
    check(events.count > 90 && words.count == events.count, "premise: the board's words for every event (\(events.count))")
    let names = ["mara-discord": "Mara", "leo-discord": "Leo"]
    for (ev, want) in zip(events, words) {
        let got = Board.activityPhrase(ev, name: { names[$0] ?? $0 }, when: { _ in "WHEN" })
        check(got == want, "the board's words: \(want)" + (got == want ? "" : " (the phone: \(got))"))
    }
    check(Board.activityPhrase(["kind": "hold-set", "until": "2026-11-02T15:00:00.000Z"], name: { $0 }).contains("Nov") && Board.activityPhrase(["kind": "hold-set", "until": "soon"], name: { $0 }) == "Put on hold until soon", "a time on the phone's clock, anything else as it is")
    let quiet: [[String: Any]] = [["kind": "run", "at": "2026-11-24T10:00:00.000Z", "unchanged": true, "by": "dana", "note": "same"], ["kind": "run", "at": "2026-11-24T11:00:00.000Z", "unchanged": true, "by": "dana"], ["kind": "closed", "at": "2026-11-24T12:00:00.000Z", "replacedBy": 7]]
    let rows = Board.activityRows(quiet, name: { $0 == "dana" ? "Dana" : $0 })
    check(rows.map(\.text) == ["2 runs found nothing new", "Closed as replaced by task 7"] && rows[0].folded.map(\.text) == ["Dana ran it, nothing new: same", "Dana ran it, nothing new"] && rows[0].folded.map(\.at) == [Tasks.parseISO("2026-11-24T10:00:00.000Z"), Tasks.parseISO("2026-11-24T11:00:00.000Z")], "a folded row holds each run")
    check(Set((rows + rows[0].folded).map(\.id)).count == 4 && rows.map(\.task) == [nil, 7] && rows[1].folded.isEmpty, "each with its own id; the replacing task is the row's to open")
    check(Board.activityRows([["kind": "replaced", "replacedBy": 7], ["kind": "closed"], ["kind": "said", "text": "see task 7", "replacedBy": 7]], name: { $0 }).map(\.task) == [7, nil, nil], "no other row's")
}

@MainActor
func b8ModelTests() async {
    var clock = Tasks.parseISO("2026-11-24T18:00:30.000Z")!
    func model(_ mac: FakeMac) async -> TaskPageModel {
        let m = TaskPageModel(project: "springcatalogue", number: 1, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch }, now: { clock },
                              parse: { Board.parseTaskPage($0, project: $1, number: $2) })   // on this actor: waitUntil cannot wait for another thread (kosmos#7751)
        m.onScreen = true
        await m.read()
        mac.asked = []
        return m
    }
    let none = Board.HoldChoice(), five = Board.HoldChoice(kind: .task, task: 5)
    let bare = heldTasks("", others: open5), onFive = heldTasks(onTask5, others: open5), off = heldTasks("", others: open5, on: false)
    let post = "POST /api/project/springcatalogue/task/1/hold", list = "GET /api/projects", act = "GET /api/project/springcatalogue/task/1/activity"
    func posted(_ mac: FakeMac) -> Int { mac.asked.filter { $0 == post }.count }
    func save(_ m: TaskPageModel, _ c: Board.HoldChoice? = nil, base: Board.HoldChoice? = nil) async -> Bool { await m.saveHold(c ?? five, base: base ?? none, names: [:]) }
    do {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        var body: [String: Any]?
        var sawSaving = false
        mac.onSend = { r in if r.httpMethod == "POST" { body = bodyOf(r); sawSaving = m.holding && m.holdFormSaving; mac.projects = onFive } }
        let ok = await save(m)
        check(ok && mac.asked == [list, post, list, act], "Save reads the task, posts, then reads the page and activity")
        check((body?["until"] as? [String: Any])?["task"] as? Int == 5 && body?["because"] == nil, "with what was changed")
        check(sawSaving && !m.holding && !m.holdFormSaving, "in the air while it is, and not after")
        check(m.holdSay == Board.holdSaved && m.holdSayAtForm && !m.holdRefused, "Saved., by the form")
        check(m.page?.hold?.stored == five, "and the page shows it")
        await m.read()
        check(m.holdSay == Board.holdSaved, "a read of the same leaves it")
        mac.projects = bare
        await m.read()
        check(m.holdSay == nil && !m.holdSayAtForm, "changed elsewhere, it goes")
    }
    for (what, words) in [("off", off), ("gone", (200, Data(#"{"projects":[{"id":"springcatalogue","name":"Spring","tasks":[]}]}"#.utf8)))] {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = onFive } }
        _ = await save(m)
        check(m.holdSay == Board.holdSaved, "premise: saved, then \(what)")
        mac.projects = words
        await m.read()
        check(m.holdSay == nil, "\(what): Saved. goes")
    }
    do {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.projects = off
        let ok = await save(m)
        check(!ok && posted(mac) == 0 && m.holdSay == "This was taken off hold, so nothing changed." && !m.holdRefused && !m.holdSayAtForm, "taken off meanwhile: nothing sent, and said")
        check(mac.asked == [list, list, act] && m.page?.onHold == false && !m.holding && !m.holdFormSaving, "and the page shows it off")
        await m.read()
        check(m.holdSay == Board.holdTakenOff, "a read of it off leaves that line")
        mac.projects = bare
        await m.read()
        check(m.holdSay == nil && !m.holdSayAtForm, "held again, it goes: it is not about the new hold")
        mac.projects = off
        _ = await save(m)
        check(m.holdSay == Board.holdTakenOff, "premise: said again")
        mac.projects = heldTasks("", others: open5, own: #","closedAt":"2026-11-24T15:00:00.000Z""#, on: false)
        mac.projects = (200, Data(String(decoding: mac.projects!.1, as: UTF8.self).replacingOccurrences(of: #""total":1,"closed":false}}"#, with: #""total":1,"closed":true}}"#, options: [], range: nil).utf8))
        await m.read()
        check(m.page?.closed == true && m.holdSay == nil, "finished, it goes, and a reopening does not bring it back")
    }
    do {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.projects = (200, Data(#"{"projects":[{"id":"springcatalogue","name":"Spring","tasks":[]}]}"#.utf8))
        let ok = await save(m)
        check(!ok && posted(mac) == 0 && m.holdSay == Board.holdTaskGone && m.gone, "gone: nothing sent, and said")
        mac.projects = bare
        await m.read()
        check(m.holdSay == nil && !m.gone, "back, it goes: the task is there")
    }
    do {
        // Saved again: the last line goes at the press.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.actAnswers = [(400, #"{"error":"no"}"#)]
        _ = await save(m)
        check(m.holdSay == "no" && m.holdRefused, "premise: refused")
        mac.holdTheNext()
        let going = Task { await save(m) }
        await waitUntil({ mac.holding }, "the second Save")
        check(m.holdSay == nil && !m.holdRefused, "saved again: the last line goes at once")
        mac.release()
        _ = await going.value
    }
    do {
        // Switched while it is out: a refusal says nothing on the page of the one there is now.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.actAnswers = [(400, #"{"error":"no"}"#)]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.epoch += 1 } }
        let ok = await save(m)
        check(!ok && posted(mac) == 1 && m.holdSay == nil && mac.asked.last == post, "switched while it is out: nothing said, nothing more asked")
    }
    do {
        // Switched while the read after it is out: nothing is shown as saved here.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.onSend = { r in if r.url!.path == "/api/projects", mac.asked.contains(post) { mac.epoch += 1 } }
        _ = await save(m)
        check(mac.asked == [list, post, list] && m.holdShown == nil && m.holdSay == nil, "switched during the read after it: nothing is shown as saved")
    }
    do {
        // A time, all the way: sent, read back and said.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = heldTasks(#","onHoldUntil":{"at":"2026-11-25T09:30:00.000Z"},"holdUntil":{"words":"2026-11-25T09:30:00.000Z","met":false}"#, others: open5) } }
        let ok = await save(m, Board.HoldChoice(kind: .at, at: Tasks.parseISO("2026-11-25T09:30:20.000Z")))
        check(ok && m.holdSay == Board.holdSaved && m.page?.hold?.stored.kind == .at, "a time is saved, and said")
    }
    do {
        // A check that failed says so until the hold reads otherwise.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.projects = nil
        _ = await save(m)
        mac.projects = bare
        await m.read()
        check(m.holdSay == Board.holdCheckFailed, "the failed check is still said")
        mac.projects = onFive
        await m.read()
        check(m.holdSay == nil, "until the hold reads otherwise")
    }
    do {
        // A tick read that started before the answer, and lands after it with the hold as it was, is not news.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.queueing = true
        let tick = Task { await m.read() }
        await waitUntil({ mac.queuedCount == 1 }, "the tick")
        mac.projects = onFive
        mac.actAnswers = [(409, #"{"error":"no"}"#)]
        let going = Task { await save(m, Board.HoldChoice(why: "x")) }
        await waitUntil({ mac.queuedCount == 2 }, "the check")
        mac.release(at: 1)
        await waitUntil({ mac.queuedCount == 2 }, "the post")
        mac.release(at: 1)
        _ = await going.value
        check(m.holdSay == "no", "premise: refused of the newer hold")
        mac.queueing = false
        mac.release(at: 0)
        await tick.value
        check(m.holdSay == "no" && m.page?.hold?.stored == none, "an older read landing late leaves the line")
        await m.read()
        check(m.holdSay == "no", "and so does the next, which shows the hold it is of")
    }
    for (what, answer) in [("no answer", nil as (Int, Data)?), ("an error", (500, Data("{}".utf8))), ("not a list", (200, Data("{}".utf8)))] {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.projects = answer
        let ok = await save(m)
        check(!ok && mac.asked == [list] && m.holdSay == Board.holdCheckFailed && !m.holding && !m.holdFormSaving, "the check failed (\(what)): nothing sent, and said")
    }
    do {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.actAnswers = [(409, #"{"error":"task #5 is already closed, so there is nothing to wait for"}"#)]
        let ok = await save(m)
        check(!ok && m.holdSay == "task #5 is already closed, so there is nothing to wait for" && m.holdRefused && m.holdSayAtForm && !m.holding && !m.holdFormSaving, "a refusal is the Mac's words, by the form")
        await m.read()
        check(m.holdSay != nil, "a read of the same hold leaves it")
        mac.projects = onFive
        await m.read()
        check(m.holdSay == nil && !m.holdRefused, "it goes once the hold reads otherwise")
        mac.projects = bare
        await m.read()
        mac.actAnswers = [(500, "{}")]
        _ = await save(m)
        check(m.holdSay == Board.holdSaveFailed && m.holdRefused, "no words of its own: the board's")
        mac.actAnswers = [nil]
        _ = await save(m)
        check(m.holdSay == Board.holdUnreached && m.holdRefused, "no answer")
        m.clearHoldFormSay()
        check(m.holdSay == nil && !m.holdRefused && !m.holdSayAtForm, "a new choice retires it")
    }
    do {
        // A hold that moved between the page's read and the press: the refusal is of it as just read, and stays.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.projects = onFive
        mac.actAnswers = [(409, #"{"error":"no"}"#)]
        _ = await save(m, Board.HoldChoice(why: "x"))
        await m.read()
        check(m.holdSay == "no", "a refusal outlives the page catching up with what it was said of")
    }
    do {
        // Only what was changed, over what is kept now.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        var body: [String: Any]?
        mac.projects = onFive
        mac.onSend = { r in if r.httpMethod == "POST" { body = bodyOf(r); mac.projects = heldTasks(onTask5 + #","onHoldBecause":"x""#, others: open5) } }
        let ok = await save(m, Board.HoldChoice(why: "x"))
        check(ok && (body?["until"] as? [String: Any])?["task"] as? Int == 5 && body?["because"] as? String == "x" && m.holdSay == Board.holdSaved, "a wait set by somebody else since is sent back, not cleared")
    }
    do {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = heldTasks(#","onHoldBecause":"theirs""#, others: open5) } }
        let ok = await save(m)
        check(ok && m.holdSay == nil, "changed elsewhere before the page was read again: not Saved. over something else")
    }
    do {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = nil } }
        let ok = await save(m)
        check(ok && m.holdSay == Board.holdSaved && m.page?.hold?.stored == none && m.holdShown == five, "the read after it failed: Saved., and what was saved is what shows")
        mac.onSend = nil
        mac.projects = onFive
        await m.read()
        check(m.holdSay == Board.holdSaved && m.holdShown == nil, "and the read that shows it leaves it, and takes over")
    }
    do {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        for c in [none, Board.HoldChoice(kind: .task), Board.HoldChoice(kind: .at)] { _ = await save(m, c) }
        check(mac.asked.isEmpty && m.holdSay == nil, "nothing changed, or not whole: nothing sent")
        let at = Board.HoldChoice(kind: .at, at: clock.addingTimeInterval(600))
        clock = clock.addingTimeInterval(1200)
        _ = await save(m, at)
        check(mac.asked.isEmpty && m.holdSay == Board.holdAhead && m.holdSayAtForm && !m.holdRefused && !m.holding, "a time that passed while the form was open: nothing sent, and said")
        await m.read()
        check(m.holdSay == Board.holdAhead, "a read of the same hold leaves it")
        mac.projects = onFive
        await m.read()
        check(m.holdSay == nil, "and it goes with the hold")
        mac.projects = bare
        await m.read()
        mac.asked = []
        clock = clock.addingTimeInterval(-1200)
        mac.actAnswers = [(409, #"{"error":"no"}"#)]
        _ = await save(m, at)
        check(m.holdRefused, "premise: refused")
        clock = clock.addingTimeInterval(1200)
        _ = await save(m, at)
        check(m.holdSay == Board.holdAhead && !m.holdRefused, "and is not drawn as the last refusal was")
        mac.asked = []
        mac.epoch += 1
        _ = await save(m)
        check(mac.asked.isEmpty, "switched before the press: nothing sent")
    }
    do {
        let mac = FakeMac(); mac.projects = off; let m = await model(mac)
        _ = await save(m)
        check(mac.asked.isEmpty, "not on hold: nothing sent")
    }
    // One at a time with everything that could cross it.
    for what in ["save", "button", "done", "part"] {
        let mac = FakeMac(); mac.projects = heldTasks("", others: open5, own: #","parts":[{"id":1,"sentence":"All"},{"id":2,"sentence":"Two"}]"#); let m = await model(mac)
        mac.holdTheNext()
        let going = Task {
            switch what {
            case "save": _ = await save(m)
            case "button": await m.toggleHold(wasOnHold: true, names: [:])
            case "done": await m.press(.close, names: [:])
            default: _ = await m.writePart(.close(part: "2"), name: { $1 }, names: [:])
            }
        }
        await waitUntil({ mac.holding }, what)
        let before = mac.asked.count
        let ok = await save(m)
        check(!ok && mac.asked.count == before, "no Save while \(what) is out")
        mac.release()
        await going.value
    }
    for what in ["button", "done", "part", "save"] {
        let mac = FakeMac(); mac.projects = heldTasks("", others: open5, own: #","parts":[{"id":1,"sentence":"All"},{"id":2,"sentence":"Two"}]"#); let m = await model(mac)
        mac.holdTheNext()
        let going = Task { _ = await save(m) }
        await waitUntil({ mac.holding }, "save")
        let before = mac.asked.count
        switch what {
        case "button": await m.toggleHold(wasOnHold: true, names: [:])
        case "done": await m.press(.close, names: [:])
        case "part": _ = await m.writePart(.close(part: "2"), name: { $1 }, names: [:])
        default: m.clearHoldFormSay()
        }
        check(mac.asked.count == before, "no \(what) while a Save is out")
        mac.release()
        await going.value
        check(!m.holding && !m.holdFormSaving, "and it ends")
    }
    // Another account or Mac while it is out: nothing more is sent or said. Held at each request in turn.
    for at in 0..<4 {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.queueing = true
        let going = Task { await save(m) }
        for i in 0..<at {
            await waitUntil({ mac.queuedCount == 1 }, "request \(i)")
            mac.release(at: 0)
        }
        await waitUntil({ mac.queuedCount == 1 }, "request \(at)")
        mac.epoch += 1
        let before = mac.asked.count
        mac.queueing = false
        mac.release(at: 0)
        let ok = await going.value
        check(!ok && mac.asked.count == before && m.holdSay == nil, "switched at request \(at): nothing more")
    }
    for at in 0..<3 {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.projects = off
        mac.queueing = true
        let going = Task { await save(m) }
        for i in 0..<at {
            await waitUntil({ mac.queuedCount == 1 }, "request \(i)")
            mac.release(at: 0)
        }
        await waitUntil({ mac.queuedCount == 1 }, "request \(at)")
        mac.epoch += 1
        mac.queueing = false
        mac.release(at: 0)
        _ = await going.value
        check(m.holdSay == nil, "switched at request \(at) of one taken off: nothing said")
    }
    // Lines of one press do not stay under the next.
    do {
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        mac.actAnswers = [(409, #"{"error":"no"}"#)]
        _ = await save(m)
        check(m.holdSay == "no" && m.holdSayAtForm, "premise: refused at the form")
        mac.actAnswers = [(409, #"{"error":"not now"}"#)]
        await m.toggleHold(wasOnHold: true, names: [:])
        check(m.holdSay == "not now" && !m.holdSayAtForm && m.holdRefused, "the button's refusal is by the button")
        m.clearHoldFormSay()
        check(m.holdSay == "not now", "and a new choice in the form leaves it")
        mac.projects = onFive
        await m.read()
        check(m.holdSay == "not now", "and it is not the form's, so the hold moving leaves it")
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = bare } }
        _ = await save(m, Board.HoldChoice(), base: five)
        check(m.holdSay == Board.holdSaved && !m.holdRefused && m.holdSayAtForm, "a Save starts clean")
        m.sayNoMembersOnHold()
        check(m.holdSay == Board.holdChooseNobody && !m.holdSayAtForm, "a line by the button is by the button")
        await m.read()
        check(m.holdSay == Board.holdChooseNobody, "and stays")
    }
    do {
        // A part's line goes at a Save, as at the button.
        let mac = FakeMac(); mac.projects = bare; let m = await model(mac)
        m.sayNoMembers()
        check(m.partSay != nil, "premise: a part line")
        _ = await save(m)
        check(m.partSay == nil, "a Save takes the part's line down")
    }
}

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)

@MainActor
func b3ModelTests() async {
    let mac = FakeMac()
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
    m.onScreen = true
    m.touched()
    let nm = ["dana": "Dana"]
    await m.read()
    // The rule the Mac stores once the save lands, so the read after it shows it (as the real board does).
    func withRule(_ rule: Any, closed: Bool = false) -> Data {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
        if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) {
            tks[i]["repeat"] = rule
            if closed { tks[i]["progress"] = ["done": 1, "total": 1, "closed": true]; tks[i]["closedAt"] = "2026-11-24T15:00:00.000Z" }
        }
        if !projs.isEmpty { projs[0]["tasks"] = tks }
        doc["projects"] = projs
        return (try? JSONSerialization.data(withJSONObject: doc)) ?? Data()
    }
    mac.asked = []
    let unchanged = await m.saveRepeat(.clear, names: nm)
    check(!unchanged && mac.asked.isEmpty, "Save of the rule already stored (none) sends nothing")
    let empty = await m.saveRepeat(.needsTime, names: nm)
    check(!empty && mac.asked.isEmpty, "nothing is sent while a box is empty")
    var body: [String: Any]?
    mac.onSend = { r in if r.url!.path.hasSuffix("/repeat") { body = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } } }
    mac.actAnswers = [(200, #"{"task":{},"words":"every week on Friday at 9am"}"#)]
    mac.projects = (200, withRule(["every": "week", "day": 5, "at": "09:00"]))
    let saved = await m.saveRepeat(.week(on: "fri", at: "09:00"), names: nm)
    check(saved && body?["every"] as? String == "week" && body?["on"] as? String == "fri" && body?["at"] as? String == "09:00",
          "a weekly rule is posted with its day and time")
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/repeat", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "then the page and its activity are read again")
    check(m.repeatSay == Board.repeatSaved && !m.repeatRefused && !m.repeatSaving && m.page?.repeatStored?.on == "fri", "Saved., and the page shows the new rule")
    mac.asked = []
    let again = await m.saveRepeat(.week(on: "fri", at: "09:00"), names: nm)
    check(!again && mac.asked.isEmpty, "the same rule again sends nothing")
    await m.read()
    check(m.repeatSay == Board.repeatSaved, "Saved. stays through a read that still shows the saved rule")
    mac.projects = (200, withRule(["every": "hour"]))
    await m.read()
    check(m.repeatSay == nil, "Saved. goes once the rule is changed elsewhere")
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    let toDaily = await m.saveRepeat(.day("08:00"), names: nm)
    mac.projects = (200, withRule(["every": "day", "at": "08:00"], closed: true))
    await m.read()
    check(toDaily && m.page?.closed == true && m.repeatSay == nil, "Saved. goes when the task is finished, even with its rule unchanged")
    mac.projects = (200, withRule(["every": "hour"]))   // open again for the refusals below
    await m.read()
    mac.onSend = nil
    mac.actAnswers = [(400, #"{"error":"every so many minutes takes a number from 15 to 720"}"#)]
    let refused = await m.saveRepeat(.minutes("5"), names: nm)
    check(!refused && m.repeatSay == "every so many minutes takes a number from 15 to 720" && m.repeatRefused && !m.repeatSaving,
          "a refusal is the Mac's own sentence, marked as a refusal")
    mac.projects = (200, withRule(["every": "hour"], closed: true))
    await m.read()
    check(m.repeatSay == nil && !m.repeatRefused, "a refusal goes when the task is finished")
    mac.projects = (200, withRule(["every": "hour"]))
    await m.read()
    mac.actAnswers = [(400, #"{"error":"every so many minutes takes a number from 15 to 720"}"#)]
    _ = await m.saveRepeat(.minutes("5"), names: nm)
    m.clearRepeatSay()
    check(m.repeatSay == nil && !m.repeatRefused, "a new choice retires the last answer")
    mac.actAnswers = [nil]
    let unreached = await m.saveRepeat(.minutes("30"), names: nm)
    check(!unreached && m.repeatSay == Board.repeatUnreached, "no answer: the could-not-reach words")

    // The guards between Save and Mark as done, each way, and Save on a finished task.
    mac.actAnswers = []
    mac.holdTheNext()
    let saving = Task { await m.saveRepeat(.minutes("45"), names: nm) }
    await waitUntil({ mac.holding }, "the repeat save held")
    let duringSave = mac.asked.count
    if let act = m.page?.act { await m.press(act, names: nm) }
    check(m.repeatSaving && mac.asked.count == duringSave, "Mark as done sends nothing while a Repeats save is out")
    mac.release()
    _ = await saving.value
    mac.holdTheNext()
    let pressing = Task { if let act = m.page?.act { await m.press(act, names: nm) } }
    await waitUntil({ mac.holding }, "the press held")
    let duringPress = mac.asked.count
    let savedDuringPress = await m.saveRepeat(.minutes("50"), names: nm)
    check(!savedDuringPress && mac.asked.count == duringPress, "Save sends nothing while Mark as done is out")
    mac.release()
    await pressing.value
    mac.projects = (200, withRule(["every": "hour"], closed: true))
    await m.read()
    mac.asked = []
    let onClosed = await m.saveRepeat(.minutes("30"), names: nm)
    check(m.page?.closed == true && !onClosed && mac.asked.isEmpty, "Save on a finished task sends nothing")
}

@MainActor
func b3bModelTests() async {
    let mac = FakeMac()
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
    m.onScreen = true
    m.touched()
    let nm = ["dana": "Dana"]
    func with(_ fields: [String: Any], closed: Bool = false) -> Data {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
        if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) {
            for (k, v) in fields { tks[i][k] = v }
            if closed { tks[i]["progress"] = ["done": 1, "total": 1, "closed": true]; tks[i]["closedAt"] = "2026-11-24T15:00:00.000Z" }
        }
        if !projs.isEmpty { projs[0]["tasks"] = tks }
        doc["projects"] = projs
        return (try? JSONSerialization.data(withJSONObject: doc)) ?? Data()
    }
    let rule: [String: Any] = ["every": "hour"]
    await m.read()
    mac.asked = []
    let noRule = await m.saveReviewer("me", names: nm)
    check(!noRule && mac.asked.isEmpty, "a task that does not repeat sends nothing")
    mac.projects = (200, with(["repeat": rule]))
    await m.read()
    mac.asked = []
    let same = await m.saveReviewer("none", names: nm)
    check(!same && mac.asked.isEmpty, "the reviewer already stored sends nothing")
    var body: [String: Any]?
    mac.onSend = { r in if r.url!.path.hasSuffix("/repeat") { body = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } } }
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "dana"]))
    let saved = await m.saveReviewer("dana", names: nm)
    check(saved && body?["reviewer"] as? String == "dana" && body?.count == 1, "the reviewer is posted alone")
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/repeat", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "then the page and its activity are read")
    check(m.reviewerSay == Board.repeatSaved && m.reviewerSaving == nil && m.page?.repeatReviewer == "dana", "Saved., and the page shows the new reviewer")
    await m.read()
    check(m.reviewerSay == Board.repeatSaved, "Saved. stays through a read that still shows the saved reviewer")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    await m.read()
    check(m.reviewerSay == nil, "Saved. goes once the reviewer is changed elsewhere")
    // Recorded, but the read after it failed: the choice keeps showing what was saved until a read succeeds.
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    mac.projects = (500, Data())
    let unread = await m.saveReviewer("dana", names: nm)
    check(unread && m.reviewerSay == Board.repeatSaved && m.reviewerShown == "dana" && m.page?.repeatReviewer == "eli",
          "a save whose read failed: Saved., and the choice shows what was saved, not the old reviewer")
    // Picking the page's (stale) reviewer back while the saved one shows is a change, and is sent.
    mac.asked = []
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    let back = await m.saveReviewer("eli", names: nm)
    check(back && mac.asked.first == "POST /api/project/springcatalogue/task/3/repeat", "choosing the old reviewer back while the saved one shows is sent, not ignored")
    mac.projects = (500, Data())
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    _ = await m.saveReviewer("dana", names: nm)
    check(m.reviewerShown == "dana", "premise: the saved reviewer shows again after a second unread save")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "dana"]))
    await m.read()
    check(m.reviewerShown == nil && m.page?.repeatReviewer == "dana", "the next read that lands shows the page")
    // A tick read started BEFORE the save, landing (with the old reviewer) while the save's own read is still out, and
    // that own read then failing: the tick is not the save's read, so the saved reviewer still shows.
    mac.queueing = true
    let tick = Task { await m.read() }
    await waitUntil({ mac.queuedCount == 1 }, "the tick read queued")
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    let racing = Task { await m.saveReviewer("me", names: nm) }
    await waitUntil({ mac.queuedCount == 2 }, "the save's post queued")
    mac.projects = (500, Data())
    mac.release(at: 1)                                   // the post is recorded; the save's own read is sent and fails
    await waitUntil({ mac.queuedCount == 2 }, "the save's own read queued")
    mac.release(at: 0)                                   // the older tick lands, with the old reviewer
    await tick.value
    mac.queueing = false
    mac.release(at: 0)                                   // the save's own read answers, failed
    _ = await racing.value
    check(m.page?.repeatReviewer == "dana" && m.reviewerShown == "me",
          "a tick read started before the save and landing during it does not stand for the save's own read")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "me"]))
    await m.read()
    check(m.reviewerSay == Board.repeatSaved, "premise: Saved. for me shows")
    // The reviewer is left as saved, so only the rule being gone can take Saved. down.
    mac.projects = (200, with(["repeat": NSNull(), "repeatReviewer": "me"]))
    await m.read()
    check(m.reviewerSay == nil, "Saved. goes when the task stops repeating")
    // A save whose own read shows someone else (changed elsewhere in between) says nothing: never Saved. under another name.
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "me"]))
    await m.read()
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    let overtaken = await m.saveReviewer("dana", names: nm)
    check(overtaken && m.reviewerSay == nil && m.page?.repeatReviewer == "eli", "a save overtaken by another change says no Saved. under that other reviewer")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "dana"]))
    await m.read()
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    _ = await m.saveReviewer("eli", names: nm)
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"], closed: true))
    await m.read()
    check(m.reviewerSay == nil, "Saved. goes when the task is finished")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    await m.read()
    mac.actAnswers = [nil]
    let unreached = await m.saveReviewer("me", names: nm)
    check(!unreached && m.reviewerSay == Board.reviewerUnreached && m.reviewerRefused, "no answer: the could-not-reach words")
    mac.onSend = nil
    mac.actAnswers = [(403, #"{"error":"only the person can name themselves as the reviewer"}"#)]
    let refused = await m.saveReviewer("me", names: nm)
    check(!refused && m.reviewerSay == "only the person can name themselves as the reviewer" && m.reviewerRefused && m.reviewerSaving == nil,
          "a refusal is the Mac's own sentence, marked as a refusal")
    await m.read()
    check(m.reviewerRefused && m.reviewerSay != nil, "a refusal stays through a read that still shows the task repeating")
    mac.projects = (200, with(["repeat": NSNull()]))
    await m.read()
    check(m.reviewerSay == nil && !m.reviewerRefused, "a refusal goes when the task stops repeating")
    mac.projects = (200, with(["repeat": rule]))
    await m.read()
    mac.actAnswers = [(403, #"{"error":"only the person can name themselves as the reviewer"}"#)]
    _ = await m.saveReviewer("dana", names: nm)
    mac.projects = (200, with(["repeat": rule], closed: true))
    await m.read()
    check(m.reviewerSay == nil && !m.reviewerRefused, "a refusal goes when the task is finished")
    mac.projects = (200, with(["repeat": NSNull()]))
    await m.read()
    mac.projects = (200, with(["repeat": rule]))
    await m.read()

    // The guards each way: a reviewer save against Mark as done and against a Repeats save.
    mac.actAnswers = []
    mac.holdTheNext()
    let saving = Task { await m.saveReviewer("eli", names: nm) }
    await waitUntil({ mac.holding }, "the reviewer save held")
    let during = mac.asked.count
    if let act = m.page?.act { await m.press(act, names: nm) }
    let repeatDuring = await m.saveRepeat(.minutes("30"), names: nm)
    check(m.reviewerSaving == "eli" && !repeatDuring && mac.asked.count == during, "Mark as done and a Repeats save send nothing while a reviewer save is out")
    mac.release()
    _ = await saving.value
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    await m.read()
    mac.holdTheNext()
    let repeatSaving = Task { await m.saveRepeat(.minutes("30"), names: nm) }
    await waitUntil({ mac.holding }, "the repeat save held")
    let duringRepeat = mac.asked.count
    let reviewerDuring = await m.saveReviewer("me", names: nm)
    check(!reviewerDuring && mac.asked.count == duringRepeat, "a reviewer save sends nothing while a Repeats save is out")
    mac.release()
    _ = await repeatSaving.value
    mac.holdTheNext()
    let pressing = Task { if let act = m.page?.act { await m.press(act, names: nm) } }
    await waitUntil({ mac.holding }, "the press held")
    let duringPress = mac.asked.count
    let reviewerPress = await m.saveReviewer("me", names: nm)
    check(!reviewerPress && mac.asked.count == duringPress, "a reviewer save sends nothing while Mark as done is out")
    mac.release()
    await pressing.value
    mac.projects = (200, with(["repeat": rule], closed: true))
    await m.read()
    mac.asked = []
    let onClosed = await m.saveReviewer("me", names: nm)
    check(!onClosed && mac.asked.isEmpty, "a finished task sends nothing")
}

@MainActor
func b4ModelTests() async {
    func with(closedAt: String?, _ fields: [String: Any] = [:]) -> (Int, Data) {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
        if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) {
            for (k, v) in fields { tks[i][k] = v }
            tks[i]["progress"] = ["done": closedAt == nil ? 0 : 1, "total": 1, "closed": closedAt != nil]
            tks[i]["closedAt"] = closedAt ?? NSNull()
        }
        if !projs.isEmpty { projs[0]["tasks"] = tks }
        doc["projects"] = projs
        return (200, (try? JSONSerialization.data(withJSONObject: doc)) ?? Data())
    }
    func answer(_ who: String) -> (Int, Data) { (200, Data(#"{"retries":{},"agents":[{"who":"\#(who)","available":false,"because":"no-folder"}]}"#.utf8)) }
    let asksReceipt = { (mac: FakeMac) in mac.asked.filter { $0.hasSuffix("/receipt") }.count }
    let at1 = "2026-11-24T15:00:00.000Z", at2 = "2026-11-24T16:00:00.000Z"
    let mac = FakeMac()
    var clock = Date(timeIntervalSince1970: 1_800_000_000)
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch }, now: { clock })
    m.onScreen = true
    m.touched()
    func tick() async { await m.tick(first: false, returning: false, names: [:]); await m.receiptReading?.value }

    mac.projects = with(closedAt: nil)
    mac.receipt = answer("ann")
    await tick()
    check(m.page != nil && m.receipt == nil && asksReceipt(mac) == 0, "an open task asks for no receipt")
    var openRedraws = 0
    let watchOpen = m.objectWillChange.sink { openRedraws += 1 }
    await tick()
    watchOpen.cancel()
    check(openRedraws == 0, "a quiet tick of an open task redraws nothing")
    mac.projects = with(closedAt: at1)
    await tick()
    check(m.receipt?.agents.map(\.who) == ["ann"] && asksReceipt(mac) == 1, "closed: its receipt is read and drawn")
    check(mac.asked.contains("GET /api/project/springcatalogue/task/3/receipt"), "from the task's own receipt route")
    var redraws = 0
    let watch = m.objectWillChange.sink { redraws += 1 }
    await tick()
    check(asksReceipt(mac) == 1 && redraws == 0, "a quiet tick asks nothing again and redraws nothing")
    watch.cancel()
    mac.projects = with(closedAt: at2)
    mac.receipt = answer("bob")
    await tick()
    check(asksReceipt(mac) == 2 && m.receipt?.agents.map(\.who) == ["bob"], "put back and closed again between two reads: asked again")
    mac.projects = with(closedAt: nil)
    await tick()
    check(m.receipt == nil && asksReceipt(mac) == 2, "put back: the receipt goes")
    mac.projects = with(closedAt: at2)
    await tick()
    check(asksReceipt(mac) == 3 && m.receipt != nil, "closed at the same time again: asked again, since putting it back forgot it")

    // A failed read: hidden, then asked again only after 30 s; an unreadable answer is a failure too.
    for (what, bad) in [("a 500", (500, Data("{}".utf8))), ("an answer that is not a receipt", (200, Data("null".utf8)))] as [(String, (Int, Data))] {
        mac.projects = with(closedAt: nil); await tick()
        mac.projects = with(closedAt: at1)
        mac.receipt = bad
        let before = asksReceipt(mac)
        await tick()
        check(m.receipt == nil && asksReceipt(mac) == before + 1, "\(what): nothing drawn")
        mac.receipt = answer("ann")
        clock.addTimeInterval(29); m.touched()
        await tick()
        check(asksReceipt(mac) == before + 1, "\(what): not asked again within 30 s")
        clock.addTimeInterval(1); m.touched()
        await tick()
        check(asksReceipt(mac) == before + 2 && m.receipt?.agents.count == 1, "\(what): asked again after 30 s, and drawn")
    }
    // A failure that fails again redraws nothing (there is still nothing to draw).
    mac.projects = with(closedAt: nil); await tick()
    mac.projects = with(closedAt: at1); mac.receipt = (500, Data()); await tick()
    let failedOnce = asksReceipt(mac)
    clock.addTimeInterval(31); m.touched()
    redraws = 0
    let watchFailed = m.objectWillChange.sink { redraws += 1 }
    await tick()
    watchFailed.cancel()
    check(asksReceipt(mac) == failedOnce + 1 && redraws == 0, "a read that fails again redraws nothing")
    // A failure for one close does not hold back another's.
    mac.projects = with(closedAt: nil); await tick()
    mac.projects = with(closedAt: at1); mac.receipt = (500, Data()); await tick()
    let failedAsks = asksReceipt(mac)
    mac.projects = with(closedAt: at2); mac.receipt = answer("ann"); await tick()
    check(asksReceipt(mac) == failedAsks + 1 && m.receipt != nil, "another close is asked at once, inside the first one's 30 s")
    // An answer of { ready: false } is settled, not a failure.
    mac.projects = with(closedAt: at1); mac.receipt = (200, Data(#"{"ready":false}"#.utf8)); await tick()
    let notReady = asksReceipt(mac)
    clock.addTimeInterval(60); m.touched()
    await tick()
    check(m.receipt == nil && asksReceipt(mac) == notReady, "not ready: nothing drawn, and not asked again")

    // Replaced, or closed as never run: no line about put-backs when there were none.
    mac.projects = with(closedAt: at2, ["replacedBy": 4]); mac.receipt = answer("ann"); await tick()
    check(m.receipt != nil && m.receipt?.again == nil, "a replaced task says nothing about put-backs")
    mac.projects = with(closedAt: at1, ["closedUnrun": true]); await tick()
    check(m.receipt != nil && m.receipt?.again == nil, "nor one closed as never run")
    mac.projects = with(closedAt: at2); await tick()
    check(m.receipt?.again == "Done without being put back or handed on.", "control: a task simply done does")

    // Out of order: the first ask answered after the second draws nothing; nor one answered after a put-back.
    let late = FakeMac()
    let l = TaskPageModel(project: "springcatalogue", number: 3, send: { await late.asyncSend($0) }, sleep: { _ in }, epoch: { late.epoch })
    l.onScreen = true
    // Reads the task with its receipt's answer held: the task's own read is released, the receipt's stays queued.
    func readHolding(_ model: TaskPageModel, _ mac: FakeMac) async {
        mac.queueing = true
        let reading = Task { await model.read() }
        await waitUntil({ mac.queuedCount == 1 }, "the task's read")
        mac.release(at: 0)
        await reading.value
        await waitUntil({ mac.queuedCount == 1 }, "the receipt ask")
        mac.queueing = false
    }
    late.projects = with(closedAt: at1)
    late.receipt = answer("old")
    await readHolding(l, late)
    let first = l.receiptReading
    late.projects = with(closedAt: at2)
    late.receipt = answer("new")
    await l.read()
    check(first?.isCancelled == true, "an older ask still out is cancelled by a newer one")
    await l.receiptReading?.value
    check(l.receipt?.agents.map(\.who) == ["new"], "the newer ask draws")
    late.release(at: 0)
    await first?.value
    check(l.receipt?.agents.map(\.who) == ["new"], "an older ask answered after it draws nothing")
    late.projects = with(closedAt: at1)
    await readHolding(l, late)
    let beforePutBack = l.receiptReading
    late.projects = with(closedAt: nil)
    await l.read()
    check(beforePutBack?.isCancelled == true && l.receipt == nil, "put back: the ask still out is cancelled, and the receipt shown goes with the same read")
    late.release(at: 0)
    await beforePutBack?.value
    check(l.receipt == nil, "an ask answered after the task was put back draws nothing")
    // Another account or Mac meanwhile: the page is about nothing, and its receipt is not drawn.
    late.projects = with(closedAt: at2)
    await readHolding(l, late)
    let beforeSwitch = l.receiptReading
    late.epoch += 1
    late.release(at: 0)
    await beforeSwitch?.value
    check(l.receipt == nil, "an answer landing after the Mac was switched draws nothing")
    let gone = FakeMac()
    let g = TaskPageModel(project: "springcatalogue", number: 3, send: { await gone.asyncSend($0) }, sleep: { _ in }, epoch: { gone.epoch }, now: { clock })
    g.onScreen = true
    gone.projects = with(closedAt: at1)
    gone.receipt = (500, Data())
    await g.read()
    await g.receiptReading?.value
    clock.addTimeInterval(60)
    gone.epoch += 1
    g.syncReceipt()
    await g.receiptReading?.value
    check(g.page != nil && asksReceipt(gone) == 1, "after a switch, no receipt is asked for again")

    // A task no longer on the computer: its page is a message, and nothing is asked for.
    let off = FakeMac()
    let o = TaskPageModel(project: "springcatalogue", number: 3, send: { await off.asyncSend($0) }, sleep: { _ in }, epoch: { off.epoch }, now: { clock })
    o.onScreen = true
    off.projects = with(closedAt: at1)
    off.receipt = (500, Data())
    await o.read()
    await o.receiptReading?.value
    off.projects = (200, Data(#"{"projects":[]}"#.utf8))
    await o.read()
    clock.addTimeInterval(60)
    o.syncReceipt()
    await o.receiptReading?.value
    check(o.gone && o.page != nil && asksReceipt(off) == 1, "a task no longer on the computer asks for no receipt again")

    // Marked replaced while the receipt was out: said as the task reads when it lands.
    let mid = FakeMac()
    let r = TaskPageModel(project: "springcatalogue", number: 3, send: { await mid.asyncSend($0) }, sleep: { _ in }, epoch: { mid.epoch })
    r.onScreen = true
    mid.projects = with(closedAt: at1)
    await readHolding(r, mid)
    mid.projects = with(closedAt: at1, ["replacedBy": 4])
    await r.read()
    mid.release(at: 0)
    await r.receiptReading?.value
    check(r.receipt != nil && r.receipt?.again == nil, "marked replaced while it was out: no line about put-backs")

    // A tick does not wait for the receipt: the page is read again while the receipt is still out.
    let slow = FakeMac()
    let s = TaskPageModel(project: "springcatalogue", number: 3, send: { await slow.asyncSend($0) }, sleep: { _ in }, epoch: { slow.epoch })
    s.onScreen = true
    slow.projects = with(closedAt: at1)
    await readHolding(s, slow)
    await s.tick(first: false, returning: false, names: [:])
    check(slow.asked.filter { $0 == "GET /api/projects" }.count == 2 && asksReceipt(slow) == 1, "a tick finishes while the receipt is out, and does not ask for it twice")
    slow.release(at: 0)
    await s.receiptReading?.value
    check(s.receipt != nil, "and the receipt is drawn when it lands")

    // The page leaves the screen with its receipt still out: cancelled, no failure (no 30 s wait), asked for on the next read.
    let left = FakeMac()
    let x = TaskPageModel(project: "springcatalogue", number: 3, send: { await left.asyncSend($0) }, sleep: { _ in }, epoch: { left.epoch }, now: { clock })
    x.onScreen = true
    left.projects = with(closedAt: at1)
    await readHolding(x, left)
    let leaving = x.receiptReading
    x.stopReceipt()
    check(leaving?.isCancelled == true && x.receiptReading == nil, "leaving the page cancels the read still out")
    left.release(at: 0)
    await leaving?.value
    check(x.receipt == nil, "and its answer draws nothing")
    await x.read()
    await x.receiptReading?.value
    check(asksReceipt(left) == 2 && x.receipt != nil, "back on the page: asked for again at once, and drawn")
    x.stopReceipt()
    await x.read()
    await x.receiptReading?.value
    check(asksReceipt(left) == 2 && x.receipt != nil, "leaving with the receipt drawn keeps it, and asks nothing more")
    // A read landing after the person left, or with the app not in front, asks for no receipt; the read on their return does.
    for (what, leave, back) in [("off screen", { x.onScreen = false }, { x.onScreen = true }), ("not in front", { x.appActive = false }, { x.appActive = true })] as [(String, () -> Void, () -> Void)] {
        let before = asksReceipt(left)
        leave()
        left.projects = with(closedAt: before == 2 ? at2 : at1)
        await x.read()
        await x.receiptReading?.value
        check(x.page?.receiptKey == (before == 2 ? at2 : at1) && asksReceipt(left) == before, "\(what): a read that lands asks for no receipt")
        back()
        await x.read()
        await x.receiptReading?.value
        check(asksReceipt(left) == before + 1, "\(what), then back: asked for")
    }

    // Mark as done: its receipt is asked for at once, not at the next tick.
    let done = FakeMac()
    let d = TaskPageModel(project: "springcatalogue", number: 3, send: { await done.asyncSend($0) }, sleep: { _ in }, epoch: { done.epoch })
    d.onScreen = true
    done.projects = with(closedAt: nil)
    await d.read()
    done.projects = with(closedAt: at1)
    await d.press(.close, names: [:])
    await d.receiptReading?.value
    check(d.page?.closed == true && d.receipt != nil, "Mark as done draws its receipt")
}

@MainActor
func b5ModelTests() async {
    func with(closedAt: String?) -> (Int, Data) {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
        if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) {
            tks[i]["progress"] = ["done": closedAt == nil ? 0 : 1, "total": 1, "closed": closedAt != nil]
            tks[i]["closedAt"] = closedAt ?? NSNull()
        }
        if !projs.isEmpty { projs[0]["tasks"] = tks }
        doc["projects"] = projs
        return (200, (try? JSONSerialization.data(withJSONObject: doc)) ?? Data())
    }
    func offer(_ names: String...) -> (Int, Data) {
        (200, Data((#"{"on":true,"ready":true,"files":["# + names.map { #"{"path":"/w/\#($0)","shown":"\#($0)","action":"restore","ok":true}"# }.joined(separator: ",") + "]}").utf8))
    }
    let off: (Int, Data) = (200, Data(#"{"on":false,"files":[]}"#.utf8))
    let at1 = "2026-11-24T15:00:00.000Z", at2 = "2026-11-24T16:00:00.000Z"
    let undoPath = "/api/project/springcatalogue/task/3/undo"
    func asks(_ mac: FakeMac) -> Int { mac.asked.filter { $0 == "GET " + undoPath }.count }
    func posts(_ mac: FakeMac) -> Int { mac.asked.filter { $0 == "POST " + undoPath }.count }
    // As the list does: the plan it opened with is the one offered then.
    func press(_ m: TaskPageModel, _ paths: [String]) async { await m.undo(paths, of: m.undoPlan ?? Board.UndoPlan(files: []), names: [:]) }
    func shown(_ m: TaskPageModel) -> [String]? { m.undoPlan?.files.map(\.shown) }
    var clock = Date(timeIntervalSince1970: 1_800_000_000)
    func model(_ mac: FakeMac) -> TaskPageModel {
        let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch }, now: { clock })
        m.onScreen = true
        m.touched()
        return m
    }
    // A read of the task, then what it set off: the receipt, then the undo plan.
    func settle(_ m: TaskPageModel) async { await m.read(); await m.receiptReading?.value; await m.undoReading?.value }

    let mac = FakeMac()
    let m = model(mac)
    mac.projects = with(closedAt: nil)
    mac.undo = offer("a.js", "b.md")
    await settle(m)
    check(asks(mac) == 0 && m.undoPlan == nil, "an open task asks for no undo")
    mac.projects = with(closedAt: at1)
    mac.receipt = (200, Data(#"{"ready":false}"#.utf8))
    await settle(m)
    check(asks(mac) == 0, "nor a closed one with no receipt")
    await settle(m)
    check(asks(mac) == 0, "nor on the next read of it")
    mac.projects = with(closedAt: at2)
    mac.receipt = (200, Data(#"{"retries":{},"agents":[]}"#.utf8))
    await settle(m)
    check(asks(mac) == 1 && shown(m) == ["a.js", "b.md"], "once the receipt is drawn, what an undo would do is read and offered")
    check(mac.asked.suffix(2) == ["GET /api/project/springcatalogue/task/3/receipt", "GET " + undoPath], "after the receipt, from the task's own undo route")
    var redraws = 0
    let watch = m.objectWillChange.sink { redraws += 1 }
    await settle(m)
    watch.cancel()
    check(asks(mac) == 1 && redraws == 0, "a quiet read asks nothing again and redraws nothing")
    mac.projects = with(closedAt: at1)
    mac.undo = offer("c.md")
    await settle(m)
    check(asks(mac) == 2 && shown(m) == ["c.md"], "another close: read again")
    mac.projects = with(closedAt: nil)
    await settle(m)
    check(m.undoPlan == nil && asks(mac) == 2, "put back: the offer goes")
    mac.projects = with(closedAt: at1)
    await settle(m)
    check(asks(mac) == 3 && shown(m) == ["c.md"], "closed at the same time again: read again")
    // A task gone from the computer, then back: the offer goes, and is read again.
    mac.projects = (200, Data(#"{"projects":[]}"#.utf8))
    await settle(m)
    check(m.gone && m.undoPlan == nil, "gone from the computer: the offer goes")
    m.leaveUndo(); m.syncReceipt()
    await m.undoReading?.value
    check(asks(mac) == 3, "and nothing is asked for")
    mac.projects = with(closedAt: at1)
    await settle(m)
    check(asks(mac) == 4 && shown(m) == ["c.md"], "back: read again")
    // A receipt that goes takes the offer with it.
    mac.projects = with(closedAt: at2)
    mac.receipt = (500, Data())
    await settle(m)
    check(m.receipt == nil && m.undoPlan == nil, "a receipt that cannot be read takes the offer with it")

    // A read that failed, or is not a plan: nothing offered, asked again only after 30 s.
    for (what, bad) in [("a 500", (500, Data("{}".utf8))), ("an answer that is not a plan", (200, Data("null".utf8)))] as [(String, (Int, Data))] {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = bad
        await settle(f)
        check(f.receipt != nil && f.undoPlan == nil && asks(fm) == 1, "\(what): nothing offered")
        fm.undo = offer("a.js")
        clock.addTimeInterval(29)
        await settle(f)
        check(asks(fm) == 1, "\(what): not asked again within 30 s")
        clock.addTimeInterval(1)
        await settle(f)
        check(asks(fm) == 2 && shown(f) == ["a.js"], "\(what): asked again after 30 s, and offered")
    }
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = (500, Data())
        await settle(f)
        fm.projects = with(closedAt: at2); fm.undo = offer("a.js")
        await settle(f)
        check(asks(fm) == 2 && shown(f) == ["a.js"], "a failure for one close does not hold back another's")
        fm.projects = with(closedAt: at1); fm.undo = off
        await settle(f)
        let settled = asks(fm)
        clock.addTimeInterval(60)
        await settle(f)
        check(f.undoPlan == nil && asks(fm) == settled, "off is settled, not a failure: not asked again")
    }

    // Left with the plan's read still out, put back, switched to another Mac: its answer draws nothing.
    func holdingThePlan(_ fm: FakeMac, _ f: TaskPageModel) async {
        // Queued from the start, and the task's read and the receipt's released in turn, so only the plan's is left out.
        fm.queueing = true
        let reading = Task { await f.read() }
        await waitUntil({ fm.queuedCount == 1 }, "the task's read")
        fm.release(at: 0)
        await reading.value
        await waitUntil({ fm.queuedCount == 1 }, "the receipt's read")
        let receiving = f.receiptReading
        fm.release(at: 0)
        await receiving?.value
        await waitUntil({ fm.queuedCount == 1 }, "the undo's read")
        fm.queueing = false
    }
    for (what, leave) in [("leaving the page", { fm, f in f.stopReceipt() }),
                          ("put back", { fm, f in fm.projects = with(closedAt: nil); await f.read() }),
                          ("gone from the computer", { fm, f in fm.projects = (200, Data(#"{"projects":[]}"#.utf8)); await f.read() })] as [(String, (FakeMac, TaskPageModel) async -> Void)] {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await holdingThePlan(fm, f)
        let reading = f.undoReading
        await leave(fm, f)
        check(reading != nil && reading?.isCancelled == true && f.undoReading == nil, "\(what): the plan's read still out is cancelled")
        fm.release(at: 0)
        await reading?.value
        check(f.undoPlan == nil, "\(what): its answer offers nothing")
        fm.projects = with(closedAt: at1)
        await settle(f)
        check(asks(fm) == 2 && shown(f) == ["a.js"], "\(what), then back: asked for at once, and offered")
    }
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await holdingThePlan(fm, f)
        let reading = f.undoReading
        fm.epoch += 1
        fm.release(at: 0)
        await reading?.value
        check(f.undoPlan == nil, "an answer landing after the Mac was switched offers nothing")
        // Switched with a plan offered: nothing is asked of the other Mac, and nothing undone on it.
        let om = FakeMac(); let o = model(om)
        om.projects = with(closedAt: at1); om.undo = offer("a.js")
        await settle(o)
        check(shown(o) == ["a.js"], "premise: a plan is offered")
        om.epoch += 1
        o.leaveUndo()
        await o.undoReading?.value
        check(asks(om) == 1, "switched with a plan offered: not read again")
        await press(o, ["/w/a.js"])
        check(posts(om) == 0 && !o.undoing, "nor undone on the other Mac")
    }
    // Gone while its receipt is still out: the receipt landing asks for no plan.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        fm.queueing = true
        let reading = Task { await f.read() }
        await waitUntil({ fm.queuedCount == 1 }, "the task's read")
        fm.release(at: 0)
        await reading.value
        await waitUntil({ fm.queuedCount == 1 }, "the receipt's read")
        fm.queueing = false
        let receiving = f.receiptReading
        fm.projects = (200, Data(#"{"projects":[]}"#.utf8))
        await f.read()
        fm.release(at: 0)
        await receiving?.value
        await f.undoReading?.value
        check(f.gone && f.receipt != nil && asks(fm) == 0, "a receipt landing after the task went asks for no plan")
    }
    // A receipt out for another close: the plan is not read under the old one, and once when the new one lands.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.projects = with(closedAt: at2)
        fm.queueing = true
        let reading = Task { await f.read() }
        await waitUntil({ fm.queuedCount == 1 }, "the task's read")
        fm.release(at: 0)
        await reading.value
        await waitUntil({ fm.queuedCount == 1 }, "the receipt's read")
        fm.queueing = false
        let receiving = f.receiptReading
        await f.read()
        await f.undoReading?.value
        check(asks(fm) == 1 && shown(f) == nil, "closed again: the last close's offer goes at once, and no plan is read while its receipt is out")
        fm.release(at: 0)
        await receiving?.value
        await f.undoReading?.value
        check(asks(fm) == 2 && shown(f) == ["a.js"], "it is asked for when that receipt lands")
    }
    // Same plan read again: nothing is redrawn.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        var redraws = 0
        let watch = f.objectWillChange.sink { redraws += 1 }
        f.leaveUndo()
        await f.undoReading?.value
        watch.cancel()
        check(asks(fm) == 2 && redraws == 0, "Cancel with the same plan read again redraws nothing")
    }
    // The list opened while Cancel's read is out: that read is given up, so it cannot close the list or wipe its line.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.undo = (500, Data())
        fm.holdTheNext()
        f.leaveUndo()
        let reading = f.undoReading
        await waitUntil({ fm.holding }, "Cancel's read")
        f.openUndo()
        check(reading?.isCancelled == true && f.undoReading == nil, "opening the list gives up Cancel's read")
        fm.release()
        await reading?.value
        await settle(f)
        check(shown(f) == ["a.js"] && asks(fm) == 2, "which draws nothing, and the next reads do not ask under the open list")
        await press(f, [])
        check(f.undoSay == Board.undoChoose, "premise: a line in the list")
        f.openUndo()
        check(f.undoSay == nil, "opened again: the old line is gone")
        fm.undo = offer("b.md")
        f.leaveUndo()
        await f.undoReading?.value
        check(shown(f) == ["b.md"], "Cancel reads it again")
        await f.undo(["/w/a.js"], of: Board.UndoPlan(files: []), names: [:])
        check(posts(fm) == 0, "a press from a list that is not the one offered sends nothing")
    }
    // Put back and closed again while an undo is out, seen only as another close: what it did, or why not, stays.
    for (what, answer, said) in [("done", (200, #"{"done":["/w/a.js"]}"#), "Undone: 1 file."), ("refused", (409, #"{"error":"no"}"#), "no")] as [(String, (Int, String), String)] {
        for landsAfter in [false, true] {
            let fm = FakeMac(); let f = model(fm)
            fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
            await settle(f)
            fm.actAnswers = [answer]
            fm.queueing = true
            let going = Task { await press(f, ["/w/a.js"]) }
            await waitUntil({ fm.queuedCount == 1 }, "the undo")
            fm.projects = with(closedAt: at2); fm.undo = offer("b.md")
            let reading = Task { await f.read() }
            await waitUntil({ fm.queuedCount == 2 }, "the task's read")
            fm.release(at: 1)
            await reading.value
            await waitUntil({ fm.queuedCount == 2 }, "the other close's receipt")
            fm.queueing = false
            let receiving = f.receiptReading
            for at in landsAfter ? [0, 0] : [1, 0] {
                fm.release(at: at)
                if at == 0 && !going.isCancelled && fm.queuedCount == (landsAfter ? 1 : 0) { await going.value }
                if fm.queuedCount == 0 { await receiving?.value }
                if at == 1 { await receiving?.value; await f.undoReading?.value; check(asks(fm) == 1 && f.undoing, "\(what): no plan is read while the undo is out") }
            }
            await f.undoReading?.value
            await settle(f)
            let line = what == "done" ? f.undoDone : f.undoSay
            check(line == said && asks(fm) == 1, "\(what), the receipt landing \(landsAfter ? "after" : "before") the answer: said, and still said after the next read")
        }
    }
    // Refused, and closed again while it was out: the list still open is of the last close, so it sends nothing more; Cancel
    // reads this one's.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.actAnswers = [(409, #"{"error":"no"}"#)]
        fm.holdTheNext()
        let going = Task { await press(f, ["/w/a.js"]) }
        await waitUntil({ fm.holding }, "the undo")
        fm.projects = with(closedAt: at2); fm.undo = offer("b.md")
        await f.read()
        await f.receiptReading?.value
        fm.release()
        await going.value
        check(f.undoSay == "no" && shown(f) == ["a.js"] && posts(fm) == 1, "premise: refused, the last close's list still open")
        await press(f, ["/w/a.js"])
        check(posts(fm) == 1 && f.undoSay == Board.undoClosedAgain && f.undoRefused, "pressed again: nothing sent, and it says why")
        f.openUndo()
        await settle(f)
        check(shown(f) == ["b.md"], "opened again before Cancel: the next read takes this close's plan, not the last one's")
    }
    // Closed again with the list open: this close's plan, read after its receipt, not pinned by the list.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        f.openUndo()
        fm.projects = with(closedAt: at2); fm.undo = offer("b.md")
        await settle(f)
        check(shown(f) == ["b.md"] && asks(fm) == 2, "closed again with the list open: its own plan is read")
    }
    // What was done goes when the task is put back; a refusal goes when another close's plan lands.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.actAnswers = [(409, #"{"error":"no"}"#)]
        await press(f, ["/w/a.js"])
        fm.projects = with(closedAt: at2)
        await settle(f)
        check(f.undoSay == nil && !f.undoRefused && shown(f) == ["a.js"], "another close takes the refusal away")
        fm.actAnswers = [(200, #"{"done":["/w/a.js"]}"#)]
        await press(f, ["/w/a.js"])
        check(f.undoDone != nil, "premise: undone")
        fm.projects = with(closedAt: nil)
        await settle(f)
        check(f.undoDone == nil, "put back: what was done goes with the receipt")
    }
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await f.read()
        f.onScreen = false
        await f.receiptReading?.value
        check(asks(fm) == 0, "a receipt landing after the person left asks for no plan")
        f.onScreen = true
        await settle(f)
        check(asks(fm) == 1 && shown(f) == ["a.js"], "back: asked for")
    }

    // Cancel: the plan is read again, the old one offered meanwhile; a late older read never replaces a newer.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        await press(f, [])
        check(f.undoSay == Board.undoChoose && !f.undoRefused && posts(fm) == 0, "no files: says to choose one, sends nothing")
        fm.undo = offer("old.js")
        fm.holdTheNext()
        f.leaveUndo()
        let older = f.undoReading
        await waitUntil({ fm.holding }, "the first Cancel's read")
        check(f.undoSay == nil && shown(f) == ["a.js"] && asks(fm) == 2, "Cancel: the line goes, the plan is read again, the offer stays meanwhile")
        fm.undo = offer("new.js")
        f.leaveUndo()
        check(older?.isCancelled == true, "a second Cancel cancels the first one's read")
        await f.undoReading?.value
        fm.release()
        await older?.value
        check(shown(f) == ["new.js"], "and only the newest is offered")
        fm.undo = off
        f.leaveUndo()
        await f.undoReading?.value
        check(f.undoPlan == nil, "turned off meanwhile: the offer goes")
        let before = asks(fm)
        f.leaveUndo()
        check(asks(fm) == before && f.undoReading == nil, "with nothing offered, leaving asks nothing")
    }

    // Undone.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js", "b.md")
        await settle(f)
        var sent: [[String]] = []
        fm.onSend = { r in if r.httpMethod == "POST", let b = r.httpBody, let o = try? JSONSerialization.jsonObject(with: b) as? [String: [String]] { sent.append(o["paths"] ?? []) } }
        fm.asked = []
        fm.actAnswers = [(200, #"{"done":["/w/a.js"],"skipped":[],"savedIn":"/saved/1"}"#)]
        fm.holdTheNext()
        let going = Task { await press(f, ["/w/a.js"]) }
        await waitUntil({ fm.holding }, "the undo")
        check(f.undoing && f.undoPlan != nil, "while it is out, the list stays")
        await press(f, ["/w/b.md"])
        check(posts(fm) == 1, "a second press while it is out sends nothing")
        f.leaveUndo()
        await settle(f)
        check(asks(fm) == 0, "and the plan is not read under it")
        fm.release()
        await going.value
        check(sent == [["/w/a.js"]], "the chosen files are sent")
        check(f.undoDone == "Undone: 1 file. The versions from before the undo are saved in /saved/1." && f.undoPlan == nil && !f.undoing, "what was done is said in the offer's place")
        check(fm.asked.last == "GET /api/project/springcatalogue/task/3/activity", "and the activity is read")
        await settle(f)
        check(f.undoDone != nil && asks(fm) == 0, "the line stays: the next read does not put the offer back over it")
        await press(f, ["/w/a.js"])
        check(posts(fm) == 1, "nothing offered: nothing sent")
        fm.projects = with(closedAt: at2)
        await settle(f)
        check(f.undoDone == nil && shown(f) == ["a.js", "b.md"], "another close: its own offer takes the line's place")
        // Refused, then with no answer, then with an answer that is not one.
        for (what, answer, why) in [("turned off", (409, #"{"error":"undo is turned off in Settings","done":[],"skipped":[]}"#), "undo is turned off in Settings"),
                                    ("refused with no words", (400, "{}"), Board.undoFailed), ("a 502 from the tunnel", (502, #"{"error":"bad gateway"}"#), Board.undoUnsure), ("no answer", nil, Board.undoUnsure),
                                    ("an answer that is not one", (200, "<html>"), Board.undoUnsure),
                                    ("nothing done, and why", (200, #"{"done":[],"skipped":[],"because":"stamps-unknown"}"#), Board.undoFailed)] as [(String, (Int, String)?, String)] {
            fm.actAnswers = [answer]
            fm.asked = []
            await press(f, ["/w/a.js"])
            check(f.undoSay == why && f.undoRefused && f.undoDone == nil && f.undoPlan != nil && !f.undoing, "\(what): said, and the list stays")
            check(fm.asked == ["POST " + undoPath, "GET /api/project/springcatalogue/task/3/activity"], "\(what): the activity is read, where an undo whose answer was lost shows")
        }
        await settle(f)
        check(f.undoSay != nil, "a quiet read leaves the refusal")
        await press(f, [])
        check(f.undoSay == Board.undoChoose && !f.undoRefused, "then nothing chosen: that line in its place, not as a refusal")
        fm.actAnswers = [(409, #"{"error":"no"}"#)]
        await press(f, ["/w/a.js"])
        f.clearUndoSay()
        check(f.undoSay == nil && !f.undoRefused, "a choice changed clears it")
        fm.actAnswers = [(409, #"{"error":"no"}"#)]
        await press(f, ["/w/a.js"])
        fm.projects = with(closedAt: nil)
        await settle(f)
        check(f.undoSay == nil && !f.undoRefused && f.undoPlan == nil, "put back: the refusal goes with the offer")
    }
    // Cancel, then the list opened again and an undo sent while Cancel's read is still out: that read never draws over it.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.holdTheNext()
        f.leaveUndo()
        let reading = f.undoReading
        await waitUntil({ fm.holding }, "Cancel's read")
        fm.actAnswers = [(200, #"{"done":["/w/a.js"]}"#)]
        await press(f, ["/w/a.js"])
        fm.release()
        await reading?.value
        check(reading?.isCancelled == true && f.undoDone == "Undone: 1 file." && f.undoPlan == nil, "an undo stands over a Cancel's read still out")
        await settle(f)
        check(f.undoDone != nil, "and after the next read")
    }
    // Closed again while an undo is out, and this close has no receipt: nothing for the answer to stand under.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.actAnswers = [(200, #"{"done":["/w/a.js"]}"#)]
        fm.holdTheNext()
        let going = Task { await press(f, ["/w/a.js"]) }
        await waitUntil({ fm.holding }, "the undo")
        fm.projects = with(closedAt: at2)
        fm.receipt = (200, Data(#"{"ready":false}"#.utf8))
        await settle(f)
        check(f.receipt == nil && f.undoPlan == nil, "the receipt went: the offer goes, an undo out or not")
        fm.release()
        await going.value
        check(f.undoDone == nil && !f.undoing, "and its answer draws nothing")
    }
    // Closed again while an undo is out and the page is not in front: what was done is still said on the return.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.actAnswers = [(200, #"{"done":["/w/a.js"]}"#)]
        fm.holdTheNext()
        let going = Task { await press(f, ["/w/a.js"]) }
        await waitUntil({ fm.holding }, "the undo")
        f.onScreen = false
        fm.projects = with(closedAt: at2)
        await f.read()
        fm.release()
        await going.value
        check(f.undoDone == "Undone: 1 file.", "premise: done, while away")
        f.onScreen = true
        await settle(f)
        check(f.undoDone == "Undone: 1 file." && f.undoPlan == nil, "back on the page: still said")
    }
    // A plan landing takes the line about the last list with it.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.holdTheNext()
        f.leaveUndo()
        let reading = f.undoReading
        await waitUntil({ fm.holding }, "Cancel's read")
        await press(f, [])
        check(f.undoSay == Board.undoChoose, "premise: a line about this list")
        fm.release()
        await reading?.value
        check(f.undoSay == nil && shown(f) == ["a.js"], "read again: the line goes")
    }
    for what in ["a part write", "a press"] {
        // Either can take the task out of its close, so the undo beside it sends nothing.
        let mac = FakeMac(); let f = model(mac)
        mac.projects = with(closedAt: at1); mac.undo = offer("a.js")
        await settle(f)
        check(f.undoPlan != nil, "premise: offered, for \(what)")
        mac.holdTheNext()
        let going = Task {
            if what == "a press" { await f.press(.reopen, names: [:]) } else { _ = await f.writePart(.add("More"), name: { $1 }, names: [:]) }
        }
        await waitUntil({ mac.holding }, what)
        await press(f, ["/w/a.js"])
        check(posts(mac) == 0 && !f.undoing, "no undo beside \(what)")
        mac.release()
        await going.value
        if f.undoPlan != nil { await press(f, ["/w/a.js"]) }
        check(posts(mac) == 1, "and one after \(what)")
    }
    // Put back, or the Mac switched, while an undo is out: its answer draws nothing.
    do {
        let fm = FakeMac(); let f = model(fm)
        fm.projects = with(closedAt: at1); fm.undo = offer("a.js")
        await settle(f)
        fm.actAnswers = [(200, #"{"done":["/w/a.js"]}"#)]
        fm.holdTheNext()
        let going = Task { await press(f, ["/w/a.js"]) }
        await waitUntil({ fm.holding }, "the undo")
        fm.projects = with(closedAt: nil)
        await f.read()
        check(f.undoPlan == nil, "put back while it is out: the offer goes")
        fm.release()
        await going.value
        check(f.undoDone == nil && f.undoSay == nil && !f.undoing, "and what it did is not said under no receipt")
        fm.projects = with(closedAt: at1)
        await settle(f)
        check(shown(f) == ["a.js"], "closed again: offered again")
        fm.actAnswers = [(200, #"{"done":["/w/a.js"]}"#)]
        fm.holdTheNext()
        let second = Task { await press(f, ["/w/a.js"]) }
        await waitUntil({ fm.holding }, "the second undo")
        let before = fm.asked.count
        fm.epoch += 1
        fm.release()
        await second.value
        check(f.undoDone == nil && fm.asked.count == before, "the Mac switched while it is out: nothing said, nothing read")
    }
}

@MainActor
func b6ModelTests() async {
    // Task 1 with three subtasks: 2 closed, 3 and 4 as given.
    func tasks(_ three: [String: Any], _ four: [String: Any], own: [String: Any] = [:]) -> (Int, Data) {
        var list: [[String: Any]] = [["number": 1, "sentence": "All", "progress": ["done": 0, "total": 1, "closed": false]].merging(own) { $1 },
                                     ["number": 4, "sentence": "c", "parent": 1].merging(four) { $1 }, ["number": 3, "sentence": "b", "parent": 1].merging(three) { $1 }]
        list.append(["number": 2, "sentence": "a", "parent": 1, "closedAt": "2026-11-24T15:00:00.000Z"])
        return (200, (try? JSONSerialization.data(withJSONObject: ["projects": [["id": "springcatalogue", "name": "Spring", "tasks": list]]])) ?? Data())
    }
    let built: [String: Any] = ["builtAt": "2026-11-24T15:00:00.000Z"], closed: [String: Any] = ["closedAt": "2026-11-24T16:00:00.000Z", "progress": ["done": 1, "total": 1, "closed": true]]
    func model(_ mac: FakeMac) async -> TaskPageModel {
        let m = TaskPageModel(project: "springcatalogue", number: 1, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
        m.onScreen = true
        await m.read()
        mac.asked = []
        return m
    }
    func closes(_ mac: FakeMac) -> [String] { mac.asked.filter { $0.hasPrefix("POST ") }.map { $0.replacingOccurrences(of: "POST /api/project/springcatalogue/task/", with: "") } }

    do {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        check(m.page?.allSubtasksBuilt == true, "premise: all built or done")
        mac.onSend = { r in if r.url?.path.hasSuffix("/task/1/close") == true { mac.projects = tasks(closed, closed, own: closed) } }
        let said = await m.closeWithSubtasks(names: [:])
        check(said, "and it says it is closed")
        check(closes(mac) == ["3/close", "4/close", "1/close"], "each built subtask in number order, not the one already closed, then this task")
        check(mac.asked.first == "GET /api/projects" && mac.asked.dropFirst(4).first == "GET /api/projects" && mac.asked.contains("GET /api/project/springcatalogue/task/1/activity"), "read first, then the task and its activity again")
        check(m.page?.closed == true && m.refusal == nil && !m.pressing && !m.closingSubtasks, "closed, nothing refused")
    }
    for (what, answers, want, sent) in [("the second refused", [(200, "{}"), (409, #"{"error":"no"}"#)], "Task #4: no. 1 subtask before it is closed. This task is still open.", 2),
                                        ("the first refused", [(409, #"{"error":"no"}"#)], "Task #3: no. This task is still open.", 1),
                                        ("this task refused", [(200, "{}"), (200, "{}"), (409, #"{"error":"no"}"#)], "no. Its built subtasks are closed.", 3),
                                        ("no answer", [(200, "{}"), nil], Board.subtasksCloseUnsure, 2)] as [(String, [(Int, String)?], String, Int)] {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.actAnswers = answers
        await m.closeWithSubtasks(names: [:])
        check(m.refusal == want && closes(mac).count == sent && !m.pressing, "\(what): it stops there and says where")
        check(mac.asked.contains("GET /api/projects") && mac.asked.contains("GET /api/project/springcatalogue/task/1/activity"), "\(what): the list is read again")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.actAnswers = [(200, "{}"), (200, "{}"), nil]
        mac.onSend = { r in if r.url?.path.hasSuffix("/task/1/close") == true { mac.projects = tasks(closed, closed, own: closed) } }
        let said = await m.closeWithSubtasks(names: [:])
        check(said && m.page?.closed == true && m.refusal == nil, "this task's answer lost, but all read closed: nothing is said to have stopped")
    }
    for (what, three, four) in [("one open", built, [:]), ("one held", built, ["builtAt": "x", "onHold": true]), ("all done", closed, closed)] as [(String, [String: Any], [String: Any])] {
        let mac = FakeMac(); mac.projects = tasks(three, four); let m = await model(mac)
        await m.closeWithSubtasks(names: [:])
        check(mac.asked.isEmpty, "\(what): nothing is sent")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.holdTheNext()
        mac.onSend = { r in if r.httpMethod == "POST" { mac.onSend = nil } }
        let going = Task { await m.closeWithSubtasks(names: [:]) }
        await waitUntil({ mac.holding }, "the fresh read")
        check(m.pressing && closes(mac).isEmpty, "nothing closed before it is read")
        mac.release()
        mac.holdTheNext()
        await waitUntil({ mac.holding }, "the first close")
        check(m.pressing && m.closingSubtasks && m.refusal == nil, "in progress while it is out")
        await m.closeWithSubtasks(names: [:])
        await m.press(.close, names: [:])
        check(closes(mac).count == 1, "a second press, or Mark as done, sends nothing meanwhile")
        mac.epoch += 1
        mac.release()
        await going.value
        check(closes(mac).count == 1 && mac.asked.count == 2, "the Mac switched meanwhile: no more closes, nothing read")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.epoch += 1
        await m.closeWithSubtasks(names: [:])
        check(mac.asked.isEmpty, "switched before the press: nothing is sent")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.holdTheNext()
        let going = Task { await m.press(.close, names: [:]) }
        await waitUntil({ mac.holding }, "Mark as done")
        await m.closeWithSubtasks(names: [:])
        check(closes(mac).count == 1 && !m.closingSubtasks, "nothing while Mark as done is out")
        mac.release()
        await going.value
        mac.asked = []
        mac.holdTheNext()
        let hold = Task { await m.toggleHold(wasOnHold: false, names: [:]) }
        await waitUntil({ mac.holding }, "the hold")
        await m.closeWithSubtasks(names: [:])
        check(closes(mac).isEmpty, "nor a hold")
        mac.release()
        await hold.value
    }
    do {
        // Switched while the check is out: nothing is closed on the Mac there is now.
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.holdTheNext()
        let going = Task { await m.closeWithSubtasks(names: [:]) }
        await waitUntil({ mac.holding }, "the check")
        mac.epoch += 1
        mac.release()
        _ = await going.value
        check(closes(mac).isEmpty && mac.asked.count == 1, "switched while the check is out: nothing is closed")
    }
    do {
        // Every subtask reads closed, but this task was refused: it is not said to be closed.
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.actAnswers = [(200, "{}"), (200, "{}"), (409, #"{"error":"no"}"#)]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks(closed, closed) } }
        let said = await m.closeWithSubtasks(names: [:])
        check(!said && m.refusal == "no. Its built subtasks are closed.", "this task refused, its subtasks closed: not said to be closed")
        await m.read()
        check(m.refusal != nil, "a read of the same leaves the line")
        mac.projects = tasks(closed, built)
        await m.read()
        check(m.refusal == nil, "and one that finds them changed takes it away")
    }
    do {
        // Pressed again: the last line goes at the press.
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.actAnswers = [(409, #"{"error":"no"}"#)]
        await m.closeWithSubtasks(names: [:])
        check(m.refusal != nil, "premise: refused")
        mac.holdTheNext()
        let going = Task { await m.closeWithSubtasks(names: [:]) }
        await waitUntil({ mac.holding }, "the second press")
        check(m.refusal == nil, "pressed again: the last line goes at once")
        mac.release()
        _ = await going.value
    }
    // The page is old: what it would close is not what is there.
    for (what, now) in [("one open since", tasks(built, [:])), ("one held since", tasks(built, ["builtAt": "x", "onHold": true])), ("one closed since", tasks(built, closed)),
                        ("the task closed since", tasks(built, built, own: closed)), ("gone", (200, Data(#"{"projects":[]}"#.utf8)))] as [(String, (Int, Data))] {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.projects = now
        let said = await m.closeWithSubtasks(names: [:])
        check(closes(mac).isEmpty && !m.pressing && !m.closingSubtasks && !said, "\(what): nothing is closed, nor said to be")
        if what == "the task closed since" { check(m.page?.closed == true && m.refusal == nil, "\(what): the page says it, not a line") }
        if what == "one open since" || what == "one held since" { check(m.refusal == Board.subtasksChanged, "\(what): and it says they changed") }
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.projects = (500, Data())
        await m.closeWithSubtasks(names: [:])
        check(closes(mac).isEmpty && m.refusal == Board.subtasksCheckFailed, "the read failed: nothing is closed, and it says so")
        mac.projects = tasks(built, built)
        await m.read()
        check(m.refusal == Board.subtasksCheckFailed, "a read that finds the same subtasks leaves the line")
        mac.projects = tasks(closed, built)
        await m.read()
        check(m.refusal == nil, "one that finds them changed takes it away")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.actAnswers = [nil]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = (500, Data()) } }
        await m.closeWithSubtasks(names: [:])
        check(m.refusal == Board.subtasksCloseUnsureUnread, "no answer, and the list could not be read again: it does not point at the list")
    }
    // This task closed elsewhere while its subtasks were being closed.
    for (what, answers, three, want) in [("the first refused", [(409, #"{"error":"no"}"#)], built, "Task #3: no."),
                                        ("no answer to the second", [(200, "{}"), nil], closed, Board.subtasksCloseUnsure)] as [(String, [(Int, String)?], [String: Any], String)] {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.actAnswers = answers
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks(three, built, own: closed) } }
        let said = await m.closeWithSubtasks(names: [:])
        check(!said && m.page?.closed == true && m.refusal == want, "\(what), this task closed elsewhere: a subtask is still built, and it says so, not that all are closed")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.onSend = { r in if r.url?.path.hasSuffix("/task/1/close") == true { mac.projects = (500, Data()) } }
        let said = await m.closeWithSubtasks(names: [:])
        check(said && m.refusal == nil && m.readFailed, "every close answered, the read after them failed: they are closed")
    }
    // A partial close whose read after it failed: the line is not taken away by the closes themselves.
    for (what, answers) in [("refused", [(200, "{}"), (409, #"{"error":"no"}"#)]), ("no answer", [(200, "{}"), nil])] as [(String, [(Int, String)?])] {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.actAnswers = answers
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = (500, Data()) } }
        await m.closeWithSubtasks(names: [:])
        let line = m.refusal
        check(line != nil && (what == "refused" || line == Board.subtasksCloseUnsureUnread), "\(what): it says so")
        mac.projects = tasks(closed, built)
        await m.read()
        let after = what == "no answer" ? Board.subtasksCloseUnsure : line   // it can now say where it stopped
        check(m.refusal == after && m.page?.subtasks.first?.status != m.page?.subtasks.last?.status, "\(what): the next read shows what was closed, and the line stays")
        await m.read()
        check(m.refusal == after, "\(what): and stays while they read the same")
        mac.projects = tasks(closed, closed)
        await m.read()
        check(m.refusal == nil, "\(what): and goes once they change")
    }
    // A later press's refusal is not that line: a change to the subtasks leaves it, whichever way the last one ended.
    for failed in [false, true] {
        let mac = FakeMac(); mac.projects = tasks(built, built); let m = await model(mac)
        mac.actAnswers = [(409, #"{"error":"no"}"#)]
        if failed { mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = (500, Data()) } } }
        await m.closeWithSubtasks(names: [:])
        check(m.refusal != nil, "premise: refused")
        mac.onSend = nil
        mac.actAnswers = [(409, #"{"error":"not yet"}"#)]
        if !failed { mac.projects = tasks(built, built) }
        await m.press(.close, names: [:])
        let line = m.refusal
        mac.projects = tasks(built, built)
        await m.read()
        mac.projects = tasks(closed, built)
        await m.read()
        check(line != nil && m.refusal == line, "Mark as done's refusal outlives a change to the subtasks (the read failed: \(failed))")
    }
    // Nor while the repeat rule or its reviewer is being saved (a task that repeats).
    for which in ["repeat", "reviewer"] {
        let rep: [String: Any] = ["repeat": ["every": "hour"], "repeatWords": "every hour"]
        let mac = FakeMac(); mac.projects = tasks(built, built, own: rep); let m = await model(mac)
        check(m.page?.repeatRow != nil, "premise: it repeats")
        mac.holdTheNext()
        let saving = Task { () -> Bool in
            if which == "repeat", let w = Board.repeatWire(Board.RepeatChoice(every: .day)) as Board.RepeatWire? { return await m.saveRepeat(w, names: [:]) }
            return await m.saveReviewer("me", names: [:])
        }
        await waitUntil({ mac.holding }, "the \(which) save")
        await m.closeWithSubtasks(names: [:])
        check(closes(mac).filter { $0.hasSuffix("/close") }.isEmpty, "nothing while the \(which) save is out")
        mac.release()
        _ = await saving.value
    }
}

@MainActor
func b7ModelTests() async {
    // Task 1, two parts: 1 on dana, 2 as given; extra parts after.
    func tasks(_ two: String = #""who":null"#, one: String = #""who":"dana""#, extra: String = "", own: String = "", closed: Bool = false, others: String = "") -> (Int, Data) {
        (200, Data((#"{"projects":[{"id":"springcatalogue","name":"Spring","agents":[{"sessionName":"dana","name":"Dana"},{"sessionName":"eli","name":"Eli"}],"tasks":[{"number":1,"sentence":"All"\#(own),"progress":{"done":0,"total":2,"closed":\#(closed)},"parts":["#
            + #"{"id":1,"sentence":"All",\#(one)},{"id":2,"sentence":"Two",\#(two)}\#(extra)]}\#(others)]}]}"#).utf8))
    }
    func model(_ mac: FakeMac) async -> TaskPageModel {
        let m = TaskPageModel(project: "springcatalogue", number: 1, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
        m.onScreen = true
        await m.read()
        mac.asked = []
        return m
    }
    func posts(_ mac: FakeMac) -> [String] { mac.asked.filter { $0.hasPrefix("POST ") }.map { $0.replacingOccurrences(of: "POST /api/project/springcatalogue/task/1/", with: "") } }
    let name: (Board.TaskPage, String) -> String = { $0.name($1, roster: [:]) }
    func put(_ m: TaskPageModel, _ w: Board.PartWrite) async -> Bool { await m.writePart(w, name: name, names: [:]) }
    let eli: Board.PartWrite = .who(part: "2", "eli", was: nil)

    do {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [(200, #"{"heard":{"who":"eli","state":"placed"}}"#)]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks(#""who":"eli""#) } }
        let ok = await put(m, eli)
        check(ok && posts(mac) == ["part/2/who"] && m.page?.parts.last?.who == "eli" && m.partSay == "Told Eli." && !m.partRefused && m.partWriting == nil, "somebody is put on a part, and it says who was told")
        check(mac.asked == ["GET /api/projects", "POST /api/project/springcatalogue/task/1/part/2/who", "GET /api/projects", "GET /api/project/springcatalogue/task/1/activity"], "read first, then the task and its activity again")
        mac.asked = []
        let again = await put(m, eli)
        check(!again && mac.asked.isEmpty && m.partSay == "Told Eli.", "choosing who is already on it sends nothing and changes nothing")
        for w in [Board.PartWrite.reopen(part: "1"), .add("  ")] { _ = await put(m, w) }
        check(mac.asked.isEmpty, "nor Put back on an open part, nor an empty part")
        mac.asked = []
        _ = await put(m, .close(part: "9"))
        check(mac.asked.isEmpty, "nor anything for a part the page does not have")
        mac.actAnswers = [(400, #"{"error":"no part by that number"}"#)]
        mac.onSend = nil
        let refused = await put(m, .close(part: "2"))
        check(!refused && m.partSay == "no part by that number" && m.partRefused, "a refusal is the Mac's words, as a refusal")
        mac.actAnswers = [(200, "{}")]
        let done = await put(m, .close(part: "1"))
        check(done && m.partSay == nil && !m.partRefused, "the next write starts clean, and nobody to tell says nothing")
        mac.actAnswers = [(400, "{}")]
        _ = await put(m, .close(part: "1"))
        check(m.partSay == Board.partFailed && m.partRefused, "a refusal with no words says the board's")
    }
    // An answer lost: the read after it says.
    for (what, w, now) in [("who", eli, tasks(#""who":"eli""#)), ("Done", .close(part: "2"), tasks(#""who":null,"closedAt":"2026-11-24T16:00:00.000Z""#)),
                           ("Add", .add("Three"), tasks(extra: #",{"id":3,"sentence":"Three"}"#))] as [(String, Board.PartWrite, (Int, Data))] {
        for status in [0, 500, 502] {
            let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
            mac.actAnswers = [status == 0 ? nil : (status, status == 502 ? #"{"error":"bad gateway"}"# : "")]
            mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = now } }
            let ok = await put(m, w)
            check(ok && m.partSay == (what == "who" ? Board.partUntold("Eli") : nil) && !m.partRefused && m.partWriting == nil, "\(what), answer \(status): the parts read so, so it was made")
            let mac2 = FakeMac(); mac2.projects = tasks(); let m2 = await model(mac2)
            mac2.actAnswers = [status == 0 ? nil : (status, "")]
            let ok2 = await put(m2, w)
            check(!ok2 && m2.partSay == Board.partUnsure && m2.partRefused, "\(what), answer \(status): they do not, so it could not tell")
            await m2.read()
            check(m2.partSay == Board.partUnsure, "\(what): and it stays while they read the same")
            mac2.projects = now
            await m2.read()
            check(m2.partSay == (what == "who" ? Board.partUntold("Eli") : nil) && !m2.partRefused && m2.partAdded == (what == "Add" ? ["Three"] : []), "\(what): once they read so it goes (who: nobody can say it was told; Add: the box lets go of the words)")
        }
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [nil]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = (500, Data()) } }
        let ok = await put(m, eli)
        check(!ok && m.partSay == Board.partUnsure, "no answer, and the read after it failed: it could not tell")
        mac.onSend = nil
        mac.projects = tasks()
        await m.read()
        check(m.partSay == Board.partUnsure, "the next read shows it was not made: the line stays")
        mac.projects = tasks(extra: #",{"id":3,"sentence":"Three"}"#)
        await m.read()
        check(m.partSay == Board.partUnsure, "another part changing is not about it")
        mac.projects = tasks(#""who":"dana""#)
        await m.read()
        check(m.partSay == nil, "and goes once that part changes")
        mac.projects = tasks()
        await m.read()
        mac.actAnswers = [nil]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = (500, Data()) } }
        _ = await put(m, eli)
        mac.onSend = nil
        mac.projects = tasks(#""who":"eli""#)
        check(m.partSay == Board.partUnsure, "premise: could not tell again")
        await m.read()
        check(m.partSay == Board.partUntold("Eli") && !m.partRefused, "the next read shows it was made: it says so, and that it may not have been told")
        mac.projects = tasks(#""who":"dana""#)
        await m.read()
        check(m.partSay == nil, "and that goes once the part changes")
    }
    // An Add nobody answered, pressed again.
    for there in [true, false] {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [nil]
        _ = await put(m, .add("Three"))
        check(m.partSay == Board.partUnsure && posts(mac) == ["parts"], "premise: could not tell")
        if there { mac.projects = tasks(extra: #",{"id":3,"sentence":"Three"}"#) }
        mac.asked = []
        let ok = await put(m, .add(" Three "))
        check(ok && posts(mac) == (there ? [] : ["parts"]) && m.partSay == nil, there ? "it had been made: nothing is sent again, and it is done" : "it had not: it is sent")
        check(m.partAdded == (there ? ["Three"] : []), "the box lets go of them once")
        m.tookAdded()
        check(m.partAdded.isEmpty, "taken")
        mac.asked = []
        _ = await put(m, .add("Three"))
        check(posts(mac) == ["parts"] && mac.asked.first != "GET /api/projects", "settled: the same words again are another part")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [nil]
        _ = await put(m, .add("Three"))
        await m.press(.close, names: [:])
        check(m.partSay == nil, "premise: another press took the line down")
        mac.projects = tasks(extra: #",{"id":3,"sentence":"Three"}"#)
        await m.read()
        check(m.partAdded == ["Three"], "still settled by a later read")
        m.tookAdded()
        mac.actAnswers = [nil, (200, "{}")]
        _ = await put(m, .add("Five"))
        _ = await put(m, .add("Six"))
        check(m.partSay == nil, "premise: another words' Add went through")
        mac.projects = tasks(extra: #",{"id":3,"sentence":"Three"},{"id":4,"sentence":"Six"},{"id":5,"sentence":"Five"}"#)
        await m.read()
        check(m.partAdded == ["Five"], "and the one that could not be told is still settled by a later read")
        mac.actAnswers = [nil]
        _ = await put(m, .add("Four"))
        mac.projects = (500, Data())
        mac.asked = []
        let ok = await put(m, .add("Four"))
        check(!ok && posts(mac).isEmpty && m.partSay == Board.holdCheckFailed, "pressed again and the check failed: nothing is sent, and it says so")
    }
    // The line is about the part as read after the write, not as read while the activity was out.
    do {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [(200, #"{"heard":{"who":"eli","state":"placed"}}"#)]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks(#""who":"eli""#) }; if r.url?.path.hasSuffix("/activity") == true { mac.onSend = nil; mac.holdTheNext() } }
        let going = Task { await put(m, eli) }
        await waitUntil({ mac.holding }, "the activity")
        check(m.partSay == "Told Eli.", "premise: said")
        mac.projects = tasks(#""who":"dana""#)
        await m.read()
        check(m.partSay == nil, "moved while the activity was out: the line goes")
        mac.release()
        _ = await going.value
        check(m.partSay == nil && m.partWriting == nil, "and is not said again")
    }
    // A refusal whose own read failed is kept against the next one that works.
    do {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [(400, #"{"error":"no"}"#)]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = (500, Data()) } }
        _ = await put(m, .close(part: "2"))
        mac.onSend = nil
        mac.projects = tasks(#""who":"dana""#)
        await m.read()
        check(m.partSay == "no", "the first read that works is what it is kept against")
        mac.projects = tasks()
        await m.read()
        check(m.partSay == nil && !m.partRefused, "and it goes when a later one differs")
    }
    // The menu was open while the page read on.
    for (what, now, says) in [("the part closed since", tasks(#""who":null,"closedAt":"2026-11-24T16:00:00.000Z""#), Board.partChanged), ("somebody on it since", tasks(#""who":"dana""#), Board.partChanged),
                              ("the part gone", (200, Data(#"{"projects":[{"id":"springcatalogue","name":"Spring","tasks":[{"number":1,"sentence":"All","parts":[{"id":1,"sentence":"All"}]}]}]}"#.utf8)), Board.partChanged),
                              ("the task finished since", tasks(own: #","closedAt":"2026-11-24T16:00:00.000Z""#, closed: true), Board.partChanged),
                              ("the task gone", (200, Data(#"{"projects":[]}"#.utf8)), Board.holdTaskGone), ("the read failed", (500, Data()), Board.holdCheckFailed)] as [(String, (Int, Data), String)] {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.projects = now
        let ok = await put(m, eli)
        check(!ok && posts(mac).isEmpty && m.partSay == says && m.partRefused && m.partWriting == nil, "\(what): nobody is put on it or told, and it says so")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(#""who":"dana""#); let m = await model(mac)
        _ = await put(m, .who(part: "2", "eli", was: nil))
        check(posts(mac).isEmpty && m.partSay == Board.partChanged, "already read as somebody else's while the menu was open: the same")
        let ok = await put(m, .who(part: "2", "eli", was: "dana"))
        check(ok && posts(mac) == ["part/2/who"], "CONTROL: from who it showed, it is sent")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.holdTheNext()
        let going = Task { await put(m, eli) }
        await waitUntil({ mac.holding }, "the fresh read")
        check(m.partWriting == eli && posts(mac).isEmpty, "nothing is sent before it is read")
        mac.epoch += 1
        mac.release()
        let ok = await going.value
        check(!ok && mac.asked.count == 1, "the Mac switched during the check: nothing sent")
    }
    do {
        // Pressed again: the last line goes at the press.
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [(400, #"{"error":"no"}"#)]
        _ = await put(m, .close(part: "2"))
        check(m.partSay == "no", "premise: refused")
        mac.holdTheNext()
        let going = Task { await put(m, .close(part: "2")) }
        await waitUntil({ mac.holding }, "the second press")
        check(m.partSay == nil && !m.partRefused, "pressed again: the last line goes at once")
        mac.release()
        _ = await going.value
    }
    do {
        // Other words than the ones nobody answered: sent with nothing read first.
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [nil]
        _ = await put(m, .add("Three"))
        check(m.partSay == Board.partUnsure, "premise: could not tell")
        mac.asked = []
        _ = await put(m, .add("Four"))
        check(posts(mac) == ["parts"] && mac.asked.first != "GET /api/projects", "other words: nothing is read first")
    }
    do {
        // Found made by the check, and the read after it failed: it is made all the same.
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [nil]
        _ = await put(m, .add("Three"))
        mac.asked = []
        mac.onSend = { r in
            if r.url!.path == "/api/projects" { mac.projects = mac.asked.count == 1 ? tasks(extra: #",{"id":3,"sentence":"Three"}"#) : (500, Data()) }
        }
        let ok = await put(m, .add("Three"))
        check(ok && m.partSay == nil && posts(mac).isEmpty, "found made, the read after it failed: made, and nothing is sent")
    }
    do {
        // A line on another part went at the press: what it was said of, changing now, takes nothing of this one's.
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [(400, #"{"error":"one"}"#), (400, #"{"error":"two"}"#)]
        _ = await put(m, .close(part: "1"))
        check(m.partSay == "one", "premise: refused")
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks(one: #""who":"eli""#) } }
        _ = await m.writePart(.close(part: "2"), atHold: true, name: name, names: [:])
        check(m.partSay == "two" && m.partAtHold, "the line is said where this press was made")
    }
    do {
        // Could not tell, then another part refused: the first reading done later leaves the refusal up.
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.actAnswers = [nil, (400, #"{"error":"no"}"#)]
        _ = await put(m, .close(part: "1"))
        check(m.partSay == Board.partUnsure, "premise: could not tell")
        _ = await put(m, .close(part: "2"))
        mac.projects = tasks(one: #""who":"dana","closedAt":"2026-11-24T16:00:00.000Z""#)
        await m.read()
        check(m.partSay == "no" && m.partRefused, "the first part reading done leaves the second's refusal up")
    }
    // The line goes with the next press of another kind, and is said by the control it was made with.
    for what in ["done", "hold", "close them"] {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        if what == "close them" {
            mac.projects = tasks(others: #",{"number":2,"sentence":"a","parent":1,"builtAt":"x"}"#)
            await m.read()
            check(m.page?.allSubtasksBuilt == true, "premise: its subtasks are built")
        }
        mac.actAnswers = [(400, #"{"error":"no"}"#)]
        _ = await m.writePart(.close(part: "2"), atHold: true, name: name, names: [:])
        check(m.partSay == "no" && m.partAtHold, "premise: refused, said by Choose who")
        if what == "done" { await m.press(.close, names: [:]) } else if what == "hold" { await m.toggleHold(wasOnHold: false, names: [:]) } else { await m.closeWithSubtasks(names: [:]) }
        check(m.partSay == nil && !m.partRefused && !m.partAtHold, "\(what): the line goes")
        // And neither runs beside the other.
        if what == "close them" {
            mac.asked = []
            mac.holdTheNext()
            let going = Task { await put(m, .close(part: "2")) }
            await waitUntil({ mac.holding }, "the part")
            await m.closeWithSubtasks(names: [:])
            check(posts(mac) == ["part/2/close"], "Close them sends nothing while a part is out")
            mac.release(); _ = await going.value
            mac.asked = []
            mac.holdTheNext()
            let closing = Task { await m.closeWithSubtasks(names: [:]) }
            await waitUntil({ mac.holding }, "Close them")
            let ok = await put(m, .close(part: "2"))
            check(!ok && !posts(mac).contains("part/2/close"), "nor a part while Close them is out")
            mac.release(); _ = await closing.value
        }
    }
    // One at a time, and not beside another press.
    do {
        let mac = FakeMac(); mac.projects = tasks(own: #","repeat":{"every":"hour"},"repeatWords":"every hour""#); let m = await model(mac)
        mac.holdTheNext()
        let going = Task { await put(m, eli) }
        await waitUntil({ mac.holding }, "the part write")
        check(m.partWriting == eli, "in the air")
        mac.release()
        mac.holdTheNext()
        await waitUntil({ mac.holding && posts(mac).count == 1 }, "its post")
        let second = await put(m, .close(part: "1"))
        await m.press(.close, names: [:])
        await m.toggleHold(wasOnHold: false, names: [:])
        _ = await m.saveRepeat(Board.repeatWire(Board.RepeatChoice(every: .day)), names: [:])
        _ = await m.saveReviewer("me", names: [:])
        m.sayNoMembers()
        check(!second && posts(mac) == ["part/2/who"] && m.partSay == nil, "a second part, Mark as done, a hold, and a Repeats or reviewer save send nothing meanwhile")
        mac.epoch += 1
        mac.release()
        let ok = await going.value
        check(!ok && mac.asked.count == 2, "the Mac switched meanwhile: nothing read, nothing said")
    }
    for what in ["done", "hold", "repeat", "reviewer"] {
        let mac = FakeMac(); mac.projects = tasks(own: #","repeat":{"every":"hour"},"repeatWords":"every hour""#); let m = await model(mac)
        mac.holdTheNext()
        let going = Task {
            switch what {
            case "done": await m.press(.close, names: [:])
            case "hold": await m.toggleHold(wasOnHold: false, names: [:])
            case "repeat": _ = await m.saveRepeat(Board.repeatWire(Board.RepeatChoice(every: .day)), names: [:])
            default: _ = await m.saveReviewer("me", names: [:])
            }
        }
        await waitUntil({ mac.holding }, what)
        let ok = await put(m, eli)
        check(!ok && !posts(mac).contains("part/2/who"), "nothing while \(what) is out")
        mac.release()
        await going.value
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        mac.epoch += 1
        _ = await put(m, eli)
        check(mac.asked.isEmpty, "switched before the press: nothing is sent")
    }
    // Choose who, under the line after Take off hold.
    do {
        let held = tasks(own: #","onHold":true"#)
        let mac = FakeMac(); mac.projects = held; let m = await model(mac)
        mac.actAnswers = [(200, #"{"task":{"number":1,"sentence":"All","progress":{"done":0,"total":2,"closed":false},"parts":[{"id":1,"sentence":"All","who":"dana"},{"id":2,"sentence":"Two"}]},"next":"It stays with Dana."}"#)]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks() } }
        await m.toggleHold(wasOnHold: true, names: [:])
        check(m.holdSay == "It stays with Dana." && m.holdChoose, "a free part beside one somebody is on: Choose who")
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks(#""who":"eli""#) } }
        let ok = await put(m, eli)
        check(ok && m.holdSay == nil && !m.holdChoose, "chosen: the line and Choose who go")
        mac.onSend = nil
        mac.projects = held
        await m.read()
        mac.actAnswers = [(200, #"{"task":{"number":1,"sentence":"All","progress":{"done":0,"total":2,"closed":false},"parts":[{"id":1,"sentence":"All","who":"dana"},{"id":2,"sentence":"Two"}]},"next":"It stays with Dana."}"#)]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks() } }
        await m.toggleHold(wasOnHold: true, names: [:])
        check(m.holdChoose, "premise: offered again")
        m.sayNoMembersOnHold()
        check(m.holdSay == Board.holdChooseNobody && !m.holdChoose, "nobody on the project: it says where people come from, and the button goes")
        mac.projects = tasks(#""who":"eli""#)
        await m.read()
        check(m.page?.parts.last?.who == "eli" && m.holdSay == Board.holdChooseNobody, "and that line is not about the task, so a read of it changed leaves it")
        mac.onSend = nil
        await m.toggleHold(wasOnHold: false, names: [:])
        check(m.holdSay == nil && !m.holdChoose, "a press starts clean")
    }
    do {
        // Choose who offered, then Put on hold refused: the refusal is said without Choose who beside it.
        let mac = FakeMac(); mac.projects = tasks(own: #","onHold":true"#); let m = await model(mac)
        mac.actAnswers = [(200, #"{"task":{"number":1,"sentence":"All","progress":{"done":0,"total":2,"closed":false},"parts":[{"id":1,"sentence":"All","who":"dana"},{"id":2,"sentence":"Two"}]},"next":"It stays with Dana."}"#), (400, #"{"error":"no"}"#)]
        mac.onSend = { r in if r.httpMethod == "POST" { mac.projects = tasks() } }
        await m.toggleHold(wasOnHold: true, names: [:])
        check(m.holdChoose, "premise: offered")
        await m.toggleHold(wasOnHold: false, names: [:])
        check(m.holdSay == "no" && m.holdRefused && !m.holdChoose, "a refused hold: no Choose who beside it")
    }
    do {
        let mac = FakeMac(); mac.projects = tasks(); let m = await model(mac)
        m.sayNoMembers()
        check(m.partSay == Board.partNoMembers && !m.partRefused, "nobody to pick: it says where people come from, not as a refusal")
        await m.read()
        check(m.partSay == Board.partNoMembers, "it stays while nobody is")
        mac.projects = (200, Data(String(decoding: tasks().1, as: UTF8.self).replacingOccurrences(of: #",{"sessionName":"eli","name":"Eli"}"#, with: "").utf8))
        await m.read()
        check(m.partSay == nil, "and goes when the members change")
    }
}
